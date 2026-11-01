import { expect, test, type Page } from "@playwright/test";
const source = "NEX-SRC-SERVICE_CATALOG";
const names = [
  "PAYMENT_API",
  "REFUND_WORKER",
  "MERCHANT_PAYMENT_INTENT_METADATA",
  "AUTHORIZED_REFUND_COMMAND",
  "SERVICE_ASSERTION_VALIDITY",
  "SERVICE_HEALTH_METRICS",
  "merchant-payments-v1",
  "gateway-routing-v2",
];
const labels = [
  "Payment API",
  "Refund Worker",
  "Merchant Payment Intent Metadata",
  "Authorized Refund Command",
  "Service Assertion Validity",
  "Service Health Metrics",
  "Merchant Payments V1",
  "Gateway Routing V2",
];
const nodes = names.map((name, index) => ({
  id:
    index === 0
      ? "NEX-SVC-PAYMENT_API"
      : `NEX-FLOW-${String(index).padStart(3, "0")}`,
  name,
  type: index < 2 ? "SERVICE" : index < 6 ? "EVENT" : "CONTRACT",
  description:
    "Authorized component metadata. " +
    (index === 2
      ? "https://example.test/" + "long-path-with-identifiers-".repeat(18)
      : "Documented component details."),
}));
const edges = nodes
  .slice(1)
  .map((node, index) => ({
    id: `edge-${index}`,
    source_id: nodes[0].id,
    target_id: node.id,
    type: index < 1 ? "DEPENDS_ON" : index < 5 ? "CONSUMES" : "PROVIDES",
    active: true,
    source_id_ref: source,
    record_id: `actual-record-${index}`,
    origin: "source_asserted",
  }));
const analysis =
  "## Investigation summary\n\n- **Task objective**: Investigate duplicate payment prevention.\n- **Starting entity**: NEX-PRJ-PAY\n- **Graph revision**: 1174\n\n## Conclusion\n\nThe available records suggest that NEX-SVC-PAYMENT_API coordinates payment processing, but duplicate-prevention behavior still requires implementation review.\n\n## Observations\n\n- The service uses documented interfaces to communicate with other payment components.\n\n- The graph records show dependencies that engineers can inspect.\n\n## Potential impact\n\nInconsistent request handling may affect payment processing; the result does not prove a duplicate charge.\n\n## Detailed technical analysis\n\n" +
  "Technical content remains available for investigation. ".repeat(110) +
  "\n\nCOMPLETE_ANALYSIS_FINAL_PARAGRAPH";
async function login(page: Page) {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/nexus/session"))
      return route.fulfill({
        json: {
          employee_id: "arav",
          display_name: "Arav Mehta",
          role_code: "DEVELOPER",
          company_id: "nexus",
          project_ids: ["NEX-PRJ-PAY"],
          source_ids: [source],
          capabilities: { request_access: true, review_access_requests: false },
        },
      });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          subject: "nexus:arav",
          tenant_id: "nexus-tenant",
          permissions: ["READ_GRAPH", "READ_EVIDENCE", "EXECUTE_TOOL"],
        },
      });
    if (path.endsWith("/workspaces"))
      return route.fulfill({
        json: { items: [{ id: "nexus-workspace", name: "Workspace" }] },
      });
    if (path.endsWith("/nexus/sources"))
      return route.fulfill({ json: { items: [{ source_id: source }] } });
    if (path.endsWith("/investigations"))
      return route.fulfill({
        json: {
          run_id: "payment-fixture",
          status: "COMPLETE",
          summary: analysis.slice(0, 4000),
          full_analysis: analysis,
          analysis_character_count: analysis.length,
          analysis_truncated: false,
          entity_ids: nodes.map((n) => n.id),
          relationship_ids: edges.map((e) => e.id),
          evidence_refs: [],
          graph_revision: 1174,
        },
      });
    if (path.includes("/entities/"))
      return route.fulfill({
        json: nodes.find((n) => path.endsWith("/" + n.id)),
      });
    if (path.includes("/relationships/"))
      return route.fulfill({
        json: edges.find((e) => path.endsWith("/" + e.id)),
      });
    if (path.includes("/records/"))
      return route.fulfill({
        json: {
          source_id: source,
          record_id: path.split("/").at(-1),
          title: "Authorized source record",
        },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/");
  await page.getByLabel("Access token").fill("test");
  await page.getByLabel("Access token").press("Enter");
  await page
    .getByLabel("What would you like to investigate?")
    .fill(
      "Investigate duplicate payment prevention and documented payment-system safeguards.",
    );
  await page
    .getByRole("checkbox", { name: "Service Catalog", exact: true })
    .check();
  await page.getByLabel("Entity identifier (optional)").fill(nodes[0].id);
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Investigation at a glance" }),
  ).toBeVisible();
}
for (const [width, height] of [
  [1920, 1080],
  [1366, 768],
  [1280, 800],
  [768, 1000],
  [390, 844],
])
  test(`readable overview and component browser at ${width}x${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await login(page);
    await expect(page.locator(".key-takeaway")).toContainText(
      "duplicate-prevention behavior still requires implementation review",
    );
    await expect(page.locator(".key-takeaway")).not.toContainText(
      "Task objective",
    );
    await expect(page.locator(".key-takeaway")).not.toContainText(
      "Graph revision",
    );
    await expect(
      page.getByText(/Claim-to-evidence mappings are not supplied/),
    ).toBeVisible();
    await expect(page.locator('.relevant-systems')).toContainText('Payment API');
    await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`), fullPage: true });
    await page
      .getByRole("tab", { name: "Services & Interfaces", exact: true })
      .click();
    await expect(page.locator(".component-card")).toHaveCount(8);
    for (const label of labels)
      await expect(
        page.locator(".component-card h4").filter({ hasText: label }),
      ).toBeVisible();
    const columns = await page
      .locator(".component-grid")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      );
    expect(columns).toBeLessThanOrEqual(2);
    await page.screenshot({
      path: testInfo.outputPath(`components-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: /^Events/ }).click();
    await expect(page.locator(".component-card")).toHaveCount(4);
    await page.getByRole("button", { name: /^Interfaces/ }).click();
    await expect(page.locator(".component-card")).toHaveCount(2);
    await page.getByRole("button", { name: /^All/ }).click();
    await page
      .getByLabel("Find services and interfaces")
      .fill("MERCHANT_PAYMENT_INTENT_METADATA");
    await expect(page.locator(".component-card")).toHaveCount(1);
    await expect(page.locator(".component-card h4")).toHaveText(
      "Merchant Payment Intent Metadata",
    );
    await page
      .getByRole("button", { name: "Show in graph", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "Graph selection details" }),
    ).toContainText("Merchant Payment Intent Metadata");
    await page
      .getByRole("tab", { name: "Services & Interfaces", exact: true })
      .click();
    await page.getByLabel("Find services and interfaces").fill("PAYMENT_API");
    const card = page
      .locator(".component-card")
      .filter({ hasText: "NEX-SVC-PAYMENT_API" })
      .first();
    await card.locator("summary").click();
    await expect(
      card.locator(".all-connections .component-connection"),
    ).toHaveCount(7);
    await card
      .getByRole("button", { name: "Inspect source record", exact: true })
      .click();
    await expect(page.locator(".evidence-drilldown")).toContainText(
      "Authorized source record",
    );
    await page
      .getByRole("tab", { name: "Technical Details", exact: true })
      .click();
    await expect(page.locator(".complete-analysis")).toContainText(
      "COMPLETE_ANALYSIS_FINAL_PARAGRAPH",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
