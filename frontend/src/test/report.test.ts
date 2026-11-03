import { describe, expect, it, vi } from "vitest";
import {
  parseInvestigationResult,
  type SessionRun,
} from "../investigations/api";
import { loadRunGraph, neighbors, parseEdge } from "../investigations/graph";
import {
  evidenceStatus,
  exportMarkdown,
  reportTitle,
  claimStatus,
  verificationCounts,
} from "../investigations/report";
import type { WorkspaceRequest } from "../auth/models";
const run: SessionRun = {
  ...parseInvestigationResult({
    run_id: "run-1",
    status: "COMPLETE",
    summary: "A model interpretation",
    entity_ids: ["service", "contract"],
    relationship_ids: ["edge"],
  }),
  objective:
    "Investigate commerce dependencies.\n" + "Full instructions. ".repeat(100),
  projectId: "project",
  workspaceId: "verified-workspace",
  selectedSourceIds: ["source"],
  created: "2026-11-01T10:00:00Z",
};
describe("report presentation keeps original records intact", () => {
  it("derives a concise title without changing the original objective", () => {
    const original = run.objective;
    expect(reportTitle(run)).toBe("Service Dependencies & Interface Risks");
    expect(reportTitle({ objective: "x ".repeat(200) })).toBe("Investigation Report");
    expect(reportTitle({ objective: "1. Trace payment API dependencies.\n2. Cite all evidence." })).toBe("Payment API dependencies");
    expect(reportTitle({ objective: "" })).toBe("Investigation Report");
    expect(reportTitle({ objective: original, title: "Ownership Risks" })).toBe("Ownership Risks");
    expect(run.objective).toBe(original);
  });
  it("keeps graph verification distinct from narrative and actionable problems", () => {
    const finding = { finding_id: "fact", claim: "A depends on B", claim_type: "GRAPH_RELATIONSHIP", verification_status: "SUPPORTED", evidence_ids: ["ev_1"], entity_ids: ["a", "b"], relationship_ids: ["edge"], explanation: "Exact edge re-read" };
    const result = { ...run, evidence_refs: ["source:record"], structured_findings: [finding, { ...finding, finding_id: "narrative", claim_type: "NARRATIVE", verification_status: "UNVERIFIED" }] };
    expect(verificationCounts(result)).toEqual({ facts: 1, actionable: 0 });
    expect(result.evidence_refs).toHaveLength(1);
    expect(claimStatus("INFERRED")).toBe("PARTIALLY_SUPPORTED");
    expect(claimStatus("STALE")).toBe("UNVERIFIED");
    expect(claimStatus("CONTRADICTED")).toBe("CONTRADICTED");
    expect(exportMarkdown(result, null, [])).toContain("VERIFIED (recorded: SUPPORTED)");
    expect(exportMarkdown(result, null, [])).toContain("Relationships: edge");
  });
  it("keeps complete execution separate from evidence verification", () => {
    expect(evidenceStatus(run)).toBe("Evidence verification unavailable");
    expect(evidenceStatus({ ...run, evidence_refs: ["source:record"] })).toBe(
      "Evidence not independently verified",
    );
  });
  it("exports readable Markdown containing original scope and verification limitations", () => {
    const md = exportMarkdown(run, null, [
      { source_id: "source", name: "Service Catalog" },
    ]);
    expect(md).toContain("# Service Dependencies & Interface Risks");
    expect(md).toContain(run.objective);
    expect(md).toContain("Service Catalog");
    expect(md).toContain("Evidence verification unavailable");
    expect(md).toContain("Graph details have not been loaded");
  });
});
describe("authorized investigation graph retrieval", () => {
  it("uses run IDs and verified workspace, retains provenance and never calls an invented batch endpoint", async () => {
    const request = vi.fn(async (path: string) =>
      path.includes("/relationships/")
        ? {
            id: "edge",
            source_id: "service",
            target_id: "contract",
            type: "PROVIDES",
            source_id_ref: "source",
            record_id: "record-1",
            origin: "source_asserted",
          }
        : {
            id: path.endsWith("service") ? "service" : "contract",
            name: "Returned name",
            type: "SERVICE",
          },
    );
    const graph = await loadRunGraph(
      run,
      request as WorkspaceRequest,
      new AbortController().signal,
    );
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].source_id_ref).toBe("source");
    expect(
      request.mock.calls.every(([path]) =>
        path.startsWith("workspaces/verified-workspace/"),
      ),
    ).toBe(true);
    expect(request.mock.calls).toHaveLength(3);
  });
  it("does not invent endpoints or placeholder nodes when records are denied", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes("/entities/contract")) throw new Error("Forbidden");
      return path.includes("/relationships/")
        ? {
            id: "edge",
            source_id: "service",
            target_id: "contract",
            type: "DEPENDS_ON",
          }
        : { id: "service", name: "Service", type: "SERVICE" };
    });
    const graph = await loadRunGraph(
      run,
      request as WorkspaceRequest,
      new AbortController().signal,
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.missing).toBe(2);
  });
  it("rejects mismatched relationship identifiers", () =>
    expect(() =>
      parseEdge(
        { id: "different", source_id: "a", target_id: "b", type: "DEPENDS_ON" },
        "requested",
      ),
    ).toThrow("Invalid relationship"));
  it("bounds read concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const request = vi.fn(async (path: string) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { id: path.split("/").at(-1), name: "name", type: "SERVICE" };
    });
    await loadRunGraph(
      {
        ...run,
        entity_ids: Array.from({ length: 18 }, (_, i) => String(i)),
        relationship_ids: [],
      },
      request as WorkspaceRequest,
      new AbortController().signal,
    );
    expect(maximum).toBeLessThanOrEqual(6);
  });
  it("stops reads for an aborted project scope", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn();
    await expect(
      loadRunGraph(run, request, controller.signal),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("expands only actual one- and two-hop relationships", () => {
    const graph = {
      edges: [
        {
          id: "ab",
          source_id: "a",
          target_id: "b",
          type: "DEPENDS_ON",
          source_id_ref: null,
          record_id: null,
          origin: null,
        },
        {
          id: "bc",
          source_id: "b",
          target_id: "c",
          type: "DEPENDS_ON",
          source_id_ref: null,
          record_id: null,
          origin: null,
        },
      ],
    };
    expect([...neighbors(graph, "a", 1)]).toEqual(["a", "b"]);
    expect([...neighbors(graph, "a", 2)]).toEqual(["a", "b", "c"]);
  });
});
