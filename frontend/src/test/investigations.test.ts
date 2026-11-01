import { describe, expect, it, vi } from "vitest";
import {
  evidenceRecordPath,
  parseEvidenceReference,
  parseInvestigationResult,
  scopeMismatches,
  submitInvestigation,
} from "../investigations/api";
import { ApiError, responseError } from "../auth/errors";
import type { WorkspaceRequest } from "../auth/models";
const minimal = {
  run_id: "run-1",
  status: "COMPLETE",
  summary: "Actual model narrative",
};
describe("investigation API contracts", () => {
  it("rejects evidence from another investigation", () => {
    expect(() => parseInvestigationResult({...minimal, evidence_registry: [{run_id: "other-run"}]})).toThrow();
  });
  it("keeps verification and source usage separate from successful execution", () => {
    const parsed = parseInvestigationResult({...minimal, verification_status: "UNVERIFIED",
      source_usage: {selected: 2}, verification_summary: {UNVERIFIED: 1},
      selected_source_ids: ["selected"], requested_source_ids: ["selected", "unavailable"]});
    expect(parsed.status).toBe("COMPLETE");
    expect(parsed.verification_status).toBe("UNVERIFIED");
    expect(parsed.source_usage).toEqual({selected: 2});
    expect(parsed.selected_source_ids).toEqual(["selected"]);
  });
  it.each(["COMPLETE", "PARTIAL", "INCOMPLETE", "BLOCKED"])(
    "preserves %s without inferring verification",
    (status) => {
      const parsed = parseInvestigationResult({ ...minimal, status });
      expect(parsed.status).toBe(status);
      expect(parsed.findings).toEqual([]);
      expect(parsed.evidence_refs).toEqual([]);
    },
  );
  it("narrows complete execution metadata and nullable fields", () => {
    const parsed = parseInvestigationResult({
      ...minimal,
      graph_revision: 4,
      newly_discovered_relationship_ids: ["edge-1"],
      reused_relationship_ids: ["edge-2"],
      skill_used: {
        skill_id: "graph-trace",
        version: "1.0.0",
        content_digest: "abc",
        trust_status: "TRUSTED",
      },
      model_usage: {
        llm_calls: 2,
        tool_calls: 1,
        total_tokens: 42,
        total_input_tokens: 30,
        total_output_tokens: 12,
        estimated_cost_usd: 0.002,
        model_used: "gemini-test",
      },
      tool_calls: [
        {
          tool_id: "evidence",
          version: "1.0.0",
          status: "OK",
          evidence_refs: ["source:record"],
          graph_revision: 4,
        },
      ],
    });
    expect(parsed.model_usage.total_tokens).toBe(42);
    expect(parsed.tool_calls[0].evidence_refs).toEqual(["source:record"]);
    expect(parsed.error_message).toBeNull();
  });
  it.each([
    null,
    [],
    {},
    { ...minimal, status: "RUNNING" },
    { ...minimal, findings: [7] },
    { ...minimal, model_usage: { total_tokens: "42" } },
    { ...minimal, tool_calls: [null] },
    { ...minimal, skill_used: "skill" },
  ])("rejects malformed payloads: %j", (value) =>
    expect(() => parseInvestigationResult(value)).toThrow("invalid response"),
  );
  it("submits exact IDs and optional entity without client authorization substitutes", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(minimal) as unknown as WorkspaceRequest;
    await submitInvestigation(
      request,
      "nexus-workspace",
      {
        objective: " Objective ",
        selected_source_ids: ["NEX-SRC-SERVICE_CATALOG"],
        entity_id: " NEX-SVC-PAYMENT_API ",
      },
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledWith(
      "workspaces/nexus-workspace/investigations",
      expect.any(AbortSignal),
      {
        objective: "Objective",
        selected_source_ids: ["NEX-SRC-SERVICE_CATALOG"],
        entity_id: "NEX-SVC-PAYMENT_API",
      },
    );
  });
  it("omits an unselected entity", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(minimal) as unknown as WorkspaceRequest;
    await submitInvestigation(
      request,
      "verified",
      { objective: "x", selected_source_ids: ["original-id"] },
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledWith(
      "workspaces/verified/investigations",
      expect.any(AbortSignal),
      { objective: "x", selected_source_ids: ["original-id"] },
    );
  });
  it("retains record slashes and colons while encoding the URL", () => {
    const ref = parseEvidenceReference("source:with:colon:folder/record:1", [
      "source",
      "source:with:colon",
    ])!;
    expect(ref).toEqual({
      sourceId: "source:with:colon",
      recordId: "folder/record:1",
    });
    expect(evidenceRecordPath("nexus-workspace", ref)).toBe(
      "workspaces/nexus-workspace/records/source%3Awith%3Acolon/folder%2Frecord%3A1",
    );
    expect(parseEvidenceReference("opaque", [])).toBeNull();
  });
  it("reports out-of-selection tool evidence without removing it", () => {
    const parsed = parseInvestigationResult({
      ...minimal,
      evidence_refs: ["other:record"],
    });
    const run = {
      ...parsed,
      objective: "x",
      workspaceId: "w",
      projectId: "p",
      selectedSourceIds: ["selected"],
      created: "today",
    };
    expect(scopeMismatches(run)).toEqual(["other:record"]);
    expect(run.evidence_refs).toEqual(["other:record"]);
  });
});
describe("public API errors", () => {
  it.each([401, 403, 404, 422, 500, 503, 504])(
    "preserves HTTP %s and request identifiers",
    async (status) => {
      const error = await responseError(
        new Response(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "Public server message",
              request_id: "request-42",
              details: null,
            },
          }),
          { status },
        ),
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(status);
      expect(error.message).toContain("request-42");
    },
  );
  it("does not expose exception pages or stack traces", async () => {
    const error = await responseError(
      new Response(
        JSON.stringify({ error: { message: "Traceback: secret stack trace" } }),
        { status: 500 },
      ),
    );
    expect(error.message).not.toContain("secret");
    const html = await responseError(
      new Response("<html>private exception</html>", { status: 503 }),
    );
    expect(html.message).not.toContain("private");
  });
});
