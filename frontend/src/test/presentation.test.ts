import { describe, expect, it } from "vitest";
import { entityName, overviewPassages } from "../investigations/presentation";
import {
  parseInvestigationResult,
  type SessionRun,
} from "../investigations/api";
const run: SessionRun = {
  ...parseInvestigationResult({
    run_id: "r",
    status: "COMPLETE",
    summary: "Legacy preview",
  }),
  objective: "Investigate duplicate payment prevention.",
  workspaceId: "w",
  projectId: "p",
  selectedSourceIds: ["s"],
  created: "today",
};
describe("reader-first presentation", () => {
  it.each([
    ["PAYMENT_API", "Payment API"],
    ["REFUND_WORKER", "Refund Worker"],
    ["MERCHANT_PAYMENT_INTENT_METADATA", "Merchant Payment Intent Metadata"],
    ["AUTHORIZED_REFUND_COMMAND", "Authorized Refund Command"],
    ["SERVICE_ASSERTION_VALIDITY", "Service Assertion Validity"],
    ["SERVICE_HEALTH_METRICS", "Service Health Metrics"],
    ["merchant-payments-v1", "Merchant Payments V1"],
    ["gateway-routing-v2", "Gateway Routing V2"],
  ])("formats %s without changing its canonical ID", (name, expected) => {
    const node = { id: "NEX-FLOW-001", name };
    expect(entityName(node)).toBe(expected);
    expect(node.id).toBe("NEX-FLOW-001");
  });
  it("preserves authoritative human-readable names", () =>
    expect(entityName({ id: "id", name: "Merchant Payments v1" })).toBe(
      "Merchant Payments v1",
    ));
  it("selects the conclusion rather than task or graph metadata", () => {
    const result = overviewPassages({
      ...run,
      full_analysis:
        "## Investigation summary\n\n- **Task objective**: Investigate duplicate payment prevention.\n- **Starting entity**: NEX-PRJ-PAY\n- **Graph revision**: 1174\n\n## Conclusion\n\nThe selected records suggest that safeguards depend on consistent request handling.\n\n## Observations\n\n- Payment API uses the documented merchant interface.\n\n## Potential impact\n\nRepeated requests may require review of request handling.",
    });
    expect(result.conclusion?.text).toContain("selected records suggest");
    expect(result.conclusion?.text).not.toContain("Task objective");
    expect(result.observations).toHaveLength(1);
    expect(result.impact?.text).toContain("may require");
  });
  it("does not invent conclusions or impact when only metadata was returned", () => {
    const result = overviewPassages({
      ...run,
      summary:
        "## Task objective\n\nInvestigate duplicate payment prevention.\n\n## Graph revision\n\n1174",
    });
    expect(result.conclusion).toBeUndefined();
    expect(result.impact).toBeUndefined();
  });
  it("uses the complete available analysis rather than the legacy preview", () => {
    const full =
      "## Conclusion\n\nThe observed relationships suggest further review is required.\n\n" +
      "Additional context. ".repeat(300);
    const parsed = parseInvestigationResult({
      run_id: "r",
      status: "COMPLETE",
      summary: "Preview",
      full_analysis: full,
      analysis_character_count: full.length,
      analysis_truncated: false,
    });
    expect(parsed.full_analysis).toBe(full);
    expect(overviewPassages({ ...run, ...parsed }).conclusion?.text).toContain(
      "further review",
    );
  });
});
