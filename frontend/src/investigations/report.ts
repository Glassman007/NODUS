import { projectLabel } from "../workspace/projectNames";
import type { SessionRun } from "./api";
import { sourceLabel, type SourceMetadata } from "../workspace/sourceNames";
import type { RunGraph } from "./graph";
export type ReportTab =
  "overview" | "graph" | "services" | "evidence" | "risks" | "ownership" | "technical";
export function reportTitle(
  run: Pick<SessionRun, "objective"> & { title?: string },
): string {
  const objective = run.objective.trim();
  const concise = (value: string) => {
    const title = value.replace(/^[\s#*-]*(?:\d+[.)]\s*)?/, "")
      .replace(/\s+/g, " ").replace(/[.!?:;]+$/, "").trim();
    return title.length >= 5 && title.length < 55 && !/\b\d+[.)]\s/.test(title)
      ? title : undefined;
  };
  const metadata = run.title?.trim();
  if (metadata && !/[\r\n]/.test(metadata)) {
    const title = concise(metadata);
    if (title) return title;
  }
  if (/\bcommerce\b/i.test(objective) && /\bdependenc\w*/i.test(objective))
    return "Service Dependencies & Interface Risks";
  const subject = objective.replace(/^[\s#*-]*(?:\d+[.)]\s*)?/, "")
    .split(/\r?\n|[.!?](?:\s|$)/)[0]
    .replace(/^(?:please\s+)?(?:investigate|identify|analyze|analyse|explore|review|trace|assess)\s+/i, "")
    .split(/\s+(?:and\s+)?(?:cite|include|using|based on|ensure)\b/i)[0];
  const title = concise(subject);
  return title ? title[0].toUpperCase() + title.slice(1) : "Investigation Report";
}
export function evidenceStatus(run: Pick<SessionRun, "evidence_refs" | "verification_status">) {
  return run.verification_status === "PARTIALLY_VERIFIED" ? "Some graph facts independently checked" : run.evidence_refs.length
    ? "Evidence not independently verified"
    : "Evidence verification unavailable";
}
export function claimStatus(status: string): string {
  return ({ SUPPORTED: "VERIFIED", INFERRED: "PARTIALLY_SUPPORTED" } as Record<string, string>)[status]
    ?? (["VERIFIED", "PARTIALLY_SUPPORTED", "CONTRADICTED"].includes(status) ? status : "UNVERIFIED");
}
export function verificationCounts(run: Pick<SessionRun, "structured_findings" | "actionable_findings">) {
  return {
    facts: (run.structured_findings ?? []).filter(f =>
      ["GRAPH_RELATIONSHIP", "GRAPH_PATH"].includes(f.claim_type) && claimStatus(f.verification_status) === "VERIFIED").length,
    actionable: (run.actionable_findings ?? []).filter(f => f.verification_status === "SUPPORTED" || f.verification_status === "VERIFIED").length,
  };
}
export function exportMarkdown(
  run: SessionRun,
  graph: RunGraph | null,
  sources: readonly SourceMetadata[],
) {
  const counts = verificationCounts(run);
  const structured = run.structured_findings?.map((finding) => `### ${finding.claim}\n\n${claimStatus(finding.verification_status)} (recorded: ${finding.verification_status}) · ${finding.claim_type}\n\n${finding.explanation}\n\nEvidence: ${finding.evidence_ids.map(id => { const snapshot = run.evidence_registry?.find(item => item.evidence_id === id); return snapshot ? `${id} | ${snapshot.source_id}:${snapshot.record_id} | ${snapshot.locator}` : id; }).join(", ") || "None established"}\n\nEntities: ${finding.entity_ids.join(", ")}\n\nRelationships: ${finding.relationship_ids.join(", ")}`).join("\n\n");
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
  return `# ${reportTitle(run)}\n\n## Original objective\n\n${run.objective}\n\n## Context\n\nProject: ${projectLabel(run.projectId)}\n\nCreated: ${run.created}\n\nExecution: ${run.status}\n\nEvidence: ${evidenceStatus(run)}\n\nEvidence references: ${run.evidence_refs.length} | Verified facts: ${counts.facts} | Verified actionable findings: ${counts.actionable}\n\n### Selected sources\n\n${names}\n\n## Model-generated overview\n\nThis narrative is not independently verified.\n\n${run.full_analysis ?? run.summary}\n\n## Structured findings\n\n${structured || (run.findings.length ? run.findings.join("\n\n") : "No structured findings returned.")}\n\n## Services and interfaces\n\n${
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
