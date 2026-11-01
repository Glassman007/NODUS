import { expect, test, type Page } from "@playwright/test";
const source = "NEX-SRC-SERVICE_CATALOG";
const other = "NEX-SRC-INTERFACE_REGISTRY";
function result(status = "COMPLETE") {
  return {
    run_id: "actual-fixture-run",
    status,
    summary: "Model narrative returned by the investigation endpoint.",
    findings: [],
    evidence_refs: [`${source}:folder/record:1`],
    entity_ids: ["NEX-SVC-PAYMENT_API"],
    relationship_ids: ["edge-1"],
    graph_revision: 7,
    source_coverage_limitations:
      status === "PARTIAL" ? ["Only selected sources were examined."] : [],
    unresolved_conflicts: [],
    rejected_unverified_claims: [],
    newly_discovered_relationship_ids: ["edge-1"],
    reused_relationship_ids: [],
    skill_used: {
      skill_id: "graph-trace",
      version: "1.0.0",
      content_digest: "a".repeat(64),
      trust_status: "TRUSTED",
    },
    model_usage: {
      model_used: "gemini-fixture",
      llm_calls: 2,
      tool_calls: 1,
      total_input_tokens: 20,
      total_output_tokens: 10,
      total_tokens: 30,
      estimated_cost_usd: 0.001,
    },
    tool_calls: [],
    error_message:
      status === "INCOMPLETE" ? "Model call stopped: RATE_LIMITED" : null,
  };
}
async function setup(page: Page, execute = true) {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/nexus/session"))
      return route.fulfill({
        json: {
          employee_id: "dev",
          display_name: "Authorized user",
          company_id: "nexus",
          role_code: execute ? "DEVELOPER" : "INTERN",
          project_ids: ["NEX-PRJ-PAY"],
          source_ids: [source, other],
          capabilities: { request_access: true, review_access_requests: false },
        },
      });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          subject: "nexus:dev",
          tenant_id: "nexus-tenant",
          permissions: [
            "READ_GRAPH",
            "READ_EVIDENCE",
            ...(execute ? ["EXECUTE_TOOL"] : []),
          ],
        },
      });
    if (path.endsWith("/workspaces"))
      return route.fulfill({
        json: { items: [{ id: "nexus-workspace", name: "NEXUS workspace" }] },
      });
    if (path.endsWith("/nexus/sources"))
      return route.fulfill({
        json: { items: [{ source_id: source }, { source_id: other }] },
      });
    if (path.endsWith("/investigations"))
      return route.fulfill({ json: result() });
    if (path.includes("/records/"))
      return route.fulfill({
        json: {
          source_id: source,
          record_id: "folder/record:1",
          title: "Documented payment dependency",
          revision: "r2",
        },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/");
  await page.getByLabel("Access token").fill("opaque-test");
  await page.getByLabel("Access token").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Workspace Overview" }),
  ).toBeVisible();
}
async function prepare(page: Page) {
  await page
    .getByLabel("What would you like to investigate?")
    .fill("Identify payment API dependencies and cite supporting evidence.");
  await page
    .getByRole("checkbox", { name: "Service Catalog", exact: true })
    .check();
}
test("read-only session keeps evidence views but cannot execute", async ({
  page,
}) => {
  await setup(page, false);
  await prepare(page);
  await expect(
    page.getByRole("button", { name: "Start investigation", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/does not grant EXECUTE_TOOL/)).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Knowledge & Evidence", exact: true }),
  ).toBeVisible();
});
test("developer validates objective and sources, submits exact contract, and drills into evidence", async ({
  page,
}) => {
  await setup(page);
  const submit = page.getByRole("button", {
    name: "Start investigation",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await page.getByLabel("What would you like to investigate?").fill("  ");
  await page
    .getByRole("checkbox", { name: "Service Catalog", exact: true })
    .check();
  await expect(submit).toBeDisabled();
  await prepare(page);
  await page
    .getByLabel("Entity identifier (optional)")
    .fill("NEX-SVC-PAYMENT_API");
  const sent = page.waitForRequest((r) =>
    r.url().endsWith("/nexus-workspace/investigations"),
  );
  await submit.click();
  expect((await sent).postDataJSON()).toEqual({
    project_id: "NEX-PRJ-PAY",
    objective:
      "Identify payment API dependencies and cite supporting evidence.",
    selected_source_ids: [source],
    entity_id: "NEX-SVC-PAYMENT_API",
  });
  await expect(
    page.getByRole("region", { name: "Investigation result", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Service Catalog:folder/record:1",
      exact: true,
    })
    .click();
  await expect(page.locator(".evidence-drilldown")).toContainText(
    "Documented payment dependency",
  );
  await page
    .getByRole("tab", { name: "Technical Details", exact: true })
    .click();
  await page.getByText("Execution details", { exact: true }).click();
  await expect(
    page.locator(".execution-details[open]").filter({ hasText: "model usage" }),
  ).toContainText("gemini-fixture");
  await page
    .getByRole("button", { name: "Return to Overview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Workspace Overview" }),
  ).toBeVisible();
});

test("evidence badges, immutable snapshot inspection and saved report reopening", async ({page}) => {
  await setup(page);
  const report = {...result(), entity_ids: ["NEX-SVC-PAYMENT_API", "billing"], persistence_status: "PERSISTED", verification_status: "PARTIALLY_VERIFIED",
    evidence_registry: [{ evidence_id: "ev_actual", run_id: "actual-fixture-run", source_id: source,
      record_id: "dependency-1", kind: "GRAPH_RELATIONSHIP", locator: "relationship:edge-1",
      excerpt: '{"source_id":"Payment API","type":"DEPENDS_ON","target_id":"Billing"}',
      content_hash: "abc123", retrieved_at: "2026-11-01T00:00:00Z", tool_id: "graph.neighborhood" }],
    structured_findings: [
      {finding_id: "edge-finding", claim: "Payment API DEPENDS_ON Billing", claim_type: "GRAPH_RELATIONSHIP",
        verification_status: "SUPPORTED", evidence_ids: ["ev_actual"], entity_ids: ["Payment API", "Billing"],
        relationship_ids: ["edge-1"], explanation: "Exact typed graph edge independently re-read."},
      {finding_id: "narrative", claim: "A speculative outage", claim_type: "NARRATIVE",
        verification_status: "INVALID_REFERENCE", evidence_ids: ["ev_forged"], entity_ids: [], relationship_ids: [],
        explanation: "Citation was not retrieved in this run."}
    ]};
  let posts = 0;
  await page.route("**/investigations", (route) => {
    if (route.request().method() === "GET") return route.fulfill({json: {items: [{run_id: report.run_id,
      objective: "Saved dependency investigation", created_at: "2026-11-01T00:00:00Z", project_id: "NEX-PRJ-PAY"}]}});
    posts++;
    return route.fulfill({json: report});
  });
  await page.route("**/investigations/actual-fixture-run", (route) => route.fulfill({json: report}));
  await page.route("**/relationships/edge-1", (route) => route.fulfill({json: {
    id: "edge-1", source_id: "NEX-SVC-PAYMENT_API", target_id: "billing", type: "DEPENDS_ON", active: true,
    source_id_ref: source, record_id: "dependency-1", origin: "source_asserted"}}));
  await page.route("**/entities/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    return route.fulfill({json: {id, name: id === "billing" ? "Billing" : "Payment API", type: "SERVICE", active: true}});
  });
  await prepare(page);
  await page.getByRole("button", {name: "Start investigation", exact: true}).click();
  await page.getByRole("tab", {name: "Evidence", exact: true}).click();
  await expect(page.getByText("Supported graph fact", {exact: true})).toBeVisible();
  await expect(page.getByText("INVALID REFERENCE", {exact: true})).toBeVisible();
  await page.getByText("Inspect evidence ·", {exact: false}).click();
  await expect(page.getByText("SHA-256: abc123")).toBeVisible();
  await expect(page.getByText("Unresolved citation: ev_forged")).toBeVisible();
  await page.getByRole("button", {name: /View related graph/}).click();
  await expect(page.getByRole("img", {name: "Interactive relationship graph: 2 nodes and 1 relationships"})).toBeVisible();
  await page.getByRole("button", {name: "Back to session investigations"}).click();
  await page.getByRole("button", {name: "Load saved investigations"}).click();
  await expect(page.getByText("Saved dependency investigation", {exact: true})).toBeVisible();
  expect(posts).toBe(1);
});
for (const status of ["COMPLETE", "PARTIAL", "INCOMPLETE", "BLOCKED"])
  test(`renders actual ${status} result with empty evidence honestly`, async ({
    page,
  }) => {
    await setup(page);
    await page.route("**/investigations", (route) =>
      route.fulfill({
        json: {
          ...result(status),
          evidence_refs: [],
          summary:
            status === "BLOCKED"
              ? "No authorized selected sources are in scope."
              : result(status).summary,
        },
      }),
    );
    await prepare(page);
    await page
      .getByRole("button", { name: "Start investigation", exact: true })
      .click();
    await expect(page.locator(".report-header .run-status")).toHaveText(
      `Execution: ${status}`,
    );
    await expect(
      page
        .getByText("Evidence verification unavailable", { exact: true })
        .first(),
    ).toBeVisible();
    if (status === "INCOMPLETE")
      await expect(page.getByRole("alert")).toContainText(
        "Model call stopped: RATE_LIMITED",
      );
    if (status === "PARTIAL") {
      await page
        .getByRole("tab", { name: "Risks & Gaps", exact: true })
        .click();
      await expect(
        page.getByText("Only selected sources were examined.", { exact: true }),
      ).toBeVisible();
    }
  });
for (const status of [403, 404])
  test(`evidence HTTP ${status} clears record content`, async ({ page }) => {
    await setup(page);
    await page.route("**/records/**", (route) =>
      route.fulfill({
        status,
        json: {
          error: {
            code: "NOT_FOUND",
            message: "Record unavailable",
            request_id: "evidence-request-1",
          },
        },
      }),
    );
    await prepare(page);
    await page
      .getByRole("button", { name: "Start investigation", exact: true })
      .click();
    await page.getByRole("tab", { name: "Evidence", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Service Catalog:folder/record:1",
        exact: true,
      })
      .click();
    await expect(page.locator(".evidence-drilldown")).toContainText(
      "evidence-request-1",
    );
    await expect(page.getByText("Documented payment dependency")).toHaveCount(
      0,
    );
  });
for (const status of [422, 500, 503, 504])
  test(`HTTP ${status} preserves request ID and does not retry`, async ({
    page,
  }) => {
    await setup(page);
    let count = 0;
    await page.route("**/investigations", (route) => {
      count++;
      return route.fulfill({
        status,
        json: {
          error: {
            code: "REQUEST_FAILED",
            message: "Service unable to process objective",
            request_id: "test-request-42",
          },
        },
      });
    });
    await prepare(page);
    await page
      .getByRole("button", { name: "Start investigation", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("test-request-42");
    expect(count).toBe(1);
    await expect(
      page.getByRole("region", { name: "Investigation result", exact: true }),
    ).toHaveCount(0);
  });
test("pending submission is single-flight and an identity switch discards its response", async ({
  page,
}) => {
  await setup(page);
  let count = 0;
  let finish!: () => Promise<void>;
  await page.route("**/investigations", (route) => {
    count++;
    finish = () => route.fulfill({ json: result() });
  });
  await prepare(page);
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(page.locator(".investigation-progress")).toContainText(
    "backend is processing",
  );
  await page.locator(".command-center form").dispatchEvent("submit");
  expect(count).toBe(1);
  await page.getByRole("button", { name: "Change token", exact: true }).click();
  await finish().catch(() => {});
  await expect(page.getByLabel("Access token")).toBeVisible();
  await expect(page.getByText("actual-fixture-run")).toHaveCount(0);
});
test("scope mismatch remains visible rather than hiding unselected evidence", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/investigations", (route) =>
    route.fulfill({
      json: {
        ...result(),
        summary: `Narrative cites ${other}`,
        evidence_refs: [`${other}:unselected-record`],
      },
    }),
  );
  await prepare(page);
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await page.getByRole("tab", { name: "Risks & Gaps", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Structured provenance outside source selection",
  );
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Interface Registry:unselected-record" }),
  ).toBeVisible();
});
test("network interruption is actionable and never retried", async ({
  page,
}) => {
  await setup(page);
  let count = 0;
  await page.route("**/investigations", (route) => {
    count++;
    return route.abort("failed");
  });
  await prepare(page);
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Network interruption");
  expect(count).toBe(1);
});
test("malformed result fails safely without rendering a false success", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/investigations", (route) =>
    route.fulfill({ json: { ...result(), findings: [42] } }),
  );
  await prepare(page);
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("invalid response");
  await expect(
    page.getByRole("region", { name: "Investigation result", exact: true }),
  ).toHaveCount(0);
});

test("an expired execution session returns to the token gate with its request ID", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/investigations", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: "UNAUTHORIZED",
          message: "Session revoked",
          request_id: "revoked-request",
        },
      },
    }),
  );
  await prepare(page);
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(page.getByLabel("Access token")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("revoked-request");
  await expect(page.getByText("actual-fixture-run")).toHaveCount(0);
});

test("refreshing revoked evidence removes previously displayed source metadata", async ({
  page,
}) => {
  await setup(page);
  await prepare(page);
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await page.getByRole("tab", { name: "Evidence", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Service Catalog:folder/record:1",
      exact: true,
    })
    .click();
  await expect(page.locator(".evidence-drilldown")).toContainText(
    "Documented payment dependency",
  );
  await page.route("**/records/**", (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: { message: "Access revoked", request_id: "record-revoked" },
      },
    }),
  );
  await page.getByRole("button", { name: "Refresh record access" }).click();
  await expect(page.locator(".evidence-drilldown")).toContainText(
    "record-revoked",
  );
  await expect(page.getByText("Documented payment dependency")).toHaveCount(0);
});
