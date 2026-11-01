import type { SessionRun } from "./api";
import { sourceLabel, type SourceMetadata } from "../workspace/sourceNames";
import type { RunGraph } from "./graph";
export type ReportTab =
  "overview" | "graph" | "services" | "evidence" | "risks" | "ownership" | "technical";
export function reportTitle(
  run: Pick<SessionRun, "objective"> & { title?: string },
): string {
  if (run.title?.trim()) return run.title.trim().slice(0, 90);
  const first = run.objective
    .replace(/[#*_`>]/g, "")
    .split(/\n|(?<=[.!?])\s/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!first) return "Investigation report";
  return first.length <= 74
    ? first
    : first.slice(0, 71).replace(/\s+\S*$/, "") + "…";
}
export function evidenceStatus(run: Pick<SessionRun, "evidence_refs" | "verification_status">) {
  return run.verification_status === "PARTIALLY_VERIFIED" ? "Some graph facts independently checked" : run.evidence_refs.length
    ? "Evidence not independently verified"
    : "Evidence verification unavailable";
}
export function exportMarkdown(
  run: SessionRun,
  graph: RunGraph | null,
  sources: readonly SourceMetadata[],
) {
  const structured = run.structured_findings?.map((finding) => `### ${finding.claim}\n\n${finding.verification_status} · ${finding.claim_type}\n\n${finding.explanation}\n\nEvidence: ${finding.evidence_ids.join(", ") || "None established"}`).join("\n\n");
  const names = run.selectedSourceIds
    .map((id) => `- ${sourceLabel(id, sources)}`)
    .join("\n");
  const graphRows = graph?.edges
    .filter(
      (edge) =>
        edge.source_id_ref &&
        run.selectedSourceIds.includes(edge.source_id_ref),
    )
    .map(
      (edge) =>
        `| ${graph.nodes.find((node) => node.id === edge.source_id)?.name ?? edge.source_id} | ${edge.type} | ${graph.nodes.find((node) => node.id === edge.target_id)?.name ?? edge.target_id} | ${edge.source_id_ref ? sourceLabel(edge.source_id_ref, sources) : "Not returned"} |`,
    )
    .join("\n");
  return `# ${reportTitle(run)}\n\n## Original objective\n\n${run.objective}\n\n## Context\n\nProject: ${run.projectId}\n\nCreated: ${run.created}\n\nExecution: ${run.status}\n\nEvidence: ${evidenceStatus(run)}\n\n### Selected sources\n\n${names}\n\n## Model-generated overview\n\nThis narrative is not independently verified.\n\n${run.full_analysis ?? run.summary}\n\n## Structured findings\n\n${structured || (run.findings.length ? run.findings.join("\n\n") : "No structured findings returned.")}\n\n## Services and interfaces\n\n${
    graph
      ? graph.nodes
          .filter((n) =>
            ["SERVICE", "CONTRACT", "SYSTEM"].includes(n.type ?? ""),
          )
          .map((n) => `- ${n.name ?? n.id} (${n.type}, ${n.id})`)
          .join("\n") || "No service/interface records loaded."
      : "Graph details have not been loaded."
  }\n\n## Current authorized relationship records\n\nThese records were retrieved after execution using run-observed identifiers. They are not an immutable investigation snapshot or independent narrative verification.\n\n${graphRows ? "| Source | Relationship | Target | Provenance source |\n| --- | --- | --- | --- |\n" + graphRows : "No detailed relationships loaded."}\n\n## Risks and gaps\n\n${[...run.source_coverage_limitations, ...run.unresolved_conflicts, ...run.rejected_unverified_claims].map((s) => "- " + s).join("\n") || "None reported by the investigation."}\n\n## Evidence references\n\n${run.evidence_refs.map((ref) => "- " + ref).join("\n") || "No independently verifiable evidence references returned."}\n\n## Technical information\n\nRun: ${run.run_id}\n\nWorkspace: ${run.workspaceId}\n\nGraph revision: ${run.graph_revision ?? "Unavailable"}\n\n${graph ? `${graph.nodes.length} nodes and ${graph.edges.length} relationships loaded. ${graph.missing} records unavailable or outside loading limits.` : "Graph detail retrieval not performed."}\n`;
}
export function downloadFile(
  contents: string,
  filename: string,
  mime = "text/markdown",
) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
