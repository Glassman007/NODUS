import { expect, test, type Page } from "@playwright/test";
const selected = "NEX-SRC-SERVICE_CATALOG";
const sourceOther = "NEX-SRC-COMPANY_FOUNDATION";
const objective =
  "Investigate commerce service dependencies and integration boundaries.\n\n" +
  "Include documented interfaces, evidence, uncertainty and rollout risks. ".repeat(
    25,
  );
const nodes = Array.from({ length: 78 }, (_, i) => ({
  id: `entity-${i}`,
  name:
    i === 0 ? "Order API" : i === 1 ? "Orders v2" : `Engineering entity ${i}`,
  type: i % 3 === 0 ? "SERVICE" : i % 3 === 1 ? "CONTRACT" : "EVENT",
  description: "Authorized entity description returned by the graph API.",
}));
const edges = Array.from({ length: 183 }, (_, i) => ({
  id: `edge-${i}`,
  source_id: `entity-${i % 78}`,
  target_id: `entity-${((i % 78) + 1 + Math.floor(i / 78)) % 78}`,
  type: i % 3 === 0 ? "DEPENDS_ON" : i % 3 === 1 ? "PROVIDES" : "CONSUMES",
  active: true,
  source_id_ref: i === 1 ? sourceOther : i === 2 ? null : selected,
  record_id: i === 2 ? null : `record-${i}`,
  origin: "source_asserted",
}));
async function setup(page: Page, denied = false) {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/nexus/session"))
      return route.fulfill({
        json: {
          employee_id: "developer",
          display_name: "Example developer",
          company_id: "nexus",
          role_code: "DEVELOPER",
          project_ids: ["COMMERCE"],
          source_ids: [selected, sourceOther],
          capabilities: { request_access: true, review_access_requests: false },
        },
      });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          subject: "nexus:developer",
          tenant_id: "nexus-tenant",
          permissions: ["READ_GRAPH", "READ_EVIDENCE", "EXECUTE_TOOL"],
        },
      });
    if (path.endsWith("/workspaces"))
      return route.fulfill({
        json: {
          items: [{ id: "verified-workspace", name: "Engineering workspace" }],
        },
      });
    if (path.endsWith("/nexus/sources"))
      return route.fulfill({
        json: { items: [{ source_id: selected }, { source_id: sourceOther }] },
      });
    if (path.endsWith("/investigations"))
      return route.fulfill({
        json: {
          run_id: "fixture-run",
          status: "COMPLETE",
          summary:
            '## Commerce dependencies\n\n**Order API** has observed graph connections.\n\n| Service | Interface |\n| --- | --- |\n| Order API | Orders v2 |\n\n- An interpretation requiring evidence review.\n\nThe narrative mentions `NEX-SRC-COMPANY_FOUNDATION`.\n\n<script>alert("unsafe")</script>',
          entity_ids: nodes.map((n) => n.id),
          relationship_ids: edges.map((e) => e.id),
          evidence_refs: [],
          findings: [],
          graph_revision: 1127,
        },
      });
    if (path.includes("/relationships/"))
      return route.fulfill(
        denied
          ? { status: 403, json: { error: { message: "No access" } } }
          : { json: edges.find((e) => path.endsWith("/" + e.id)) },
      );
    if (path.includes("/entities/"))
      return route.fulfill(
        denied
          ? { status: 403, json: { error: { message: "No access" } } }
          : { json: nodes.find((n) => path.endsWith("/" + n.id)) },
      );
    if (path.includes("/records/"))
      return route.fulfill({
        json: {
          source_id: selected,
          record_id: path.split("/").at(-1),
          title: "Source-backed interface declaration",
        },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/");
  await page.getByLabel("Access token").fill("opaque");
  await page.getByLabel("Access token").press("Enter");
  await page.getByLabel("What would you like to investigate?").fill(objective);
  await page
    .getByRole("checkbox", { name: "Service Catalog", exact: true })
    .check();
  await page.getByLabel("Entity identifier (optional)").fill("entity-0");
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Investigation result", exact: true }),
  ).toBeVisible();
}
for (const width of [390, 1280, 1920])
  test(`compact report and real relationship canvas at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await setup(page);
    expect(
      (await page.locator(".report-header h2").innerText()).length,
    ).toBeLessThanOrEqual(74);
    await expect(page.locator(".report-metrics")).toContainText("78");
    await expect(page.locator(".report-metrics")).toContainText("183");
    await expect(page.locator(".report-header .run-status")).toHaveText(
      "Execution: COMPLETE",
    );
    await expect(page.locator(".evidence-notice")).toContainText(
      "Evidence verification unavailable",
    );
    await expect(
      page.getByRole("heading", { name: "Investigation at a glance" }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Technical Details", exact: true })
      .click();
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await expect(page.locator(".report-markdown script")).toHaveCount(0);
    await page
      .getByText("View original objective", { exact: true })
      .first()
      .click();
    await expect(page.locator(".original-objective p")).toHaveText(objective);
    await page
      .getByText("View original objective", { exact: true })
      .first()
      .click();
    await page.screenshot({
      path: testInfo.outputPath(`report-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Risks & Gaps", exact: true }).click();
    await expect(
      page.getByText(/A text mention does not establish/),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page
      .getByRole("tab", { name: "Relationship Graph", exact: true })
      .click();
    await expect(
      page.getByRole("img", { name: /Interactive relationship graph/ }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".graph-caption")).toContainText(
      "1 retrieved relationships excluded",
    );
    await page.screenshot({
      path: testInfo.outputPath(`graph-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Zoom graph in", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Zoom graph out", exact: true })
      .click();
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page
      .getByRole("button", { name: "Reset layout", exact: true })
      .click();
    await page.getByRole("button", { name: "Two hops", exact: true }).click();
    await page
      .getByRole("button", { name: "Full investigation graph", exact: true })
      .click();
    await expect(page.locator(".graph-caption")).toContainText("78 nodes");
    await page.getByLabel("Find graph entity").fill("Order API");
    await page
      .getByRole("button", { name: "Focus match", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "Graph selection details" }),
    ).toContainText("Order API");
    await page.getByLabel("Find graph entity").fill("");
    await page.getByLabel("Graph relationship type").selectOption("DEPENDS_ON");
    await page.getByLabel("Graph relationship type").selectOption("");
    await page.getByLabel("Graph entity type").selectOption("SERVICE");
    await page.getByLabel("Graph entity type").selectOption("");
    await page
      .getByRole("tab", { name: "Services & Interfaces", exact: true })
      .click();
    await page.getByLabel("Find services and interfaces").fill("Order API");
    await page
      .getByRole("button", { name: "Show in graph", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Relationship Graph", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
test("graph records denied by the backend never become a mock graph", async ({
  page,
}) => {
  await setup(page, true);
  await page
    .getByRole("tab", { name: "Relationship Graph", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Detailed graph records unavailable" }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("img", { name: /Interactive relationship graph/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry graph records" }).first(),
  ).toBeVisible();
});
test("Markdown export preserves the original objective and real graph scope", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("tab", { name: "Relationship Graph", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Interactive relationship graph/ }),
  ).toBeVisible({ timeout: 30000 });
  const downloaded = page.waitForEvent("download");
  await page
    .locator(".report-header")
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("nodus-investigation.md");
  const stream = await file.createReadStream();
  let text = "";
  for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain(objective.trim());
  expect(text).toContain("Evidence verification unavailable");
  expect(text).toContain("Order API");
  expect(text).toContain("Current authorized relationship records");
});

test("edge inspection, fullscreen and PNG export operate on loaded relationships", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await setup(page);
  await page
    .getByRole("tab", { name: "Relationship Graph", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Interactive relationship graph/ }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByText("Browse visible records", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Order API → depends_on → Orders v2",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Graph selection details" }),
  ).toContainText("Tool-observed relationship");
  const image = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  expect((await image).suggestedFilename()).toBe("nodus-relationships.png");
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);
  await page
    .getByRole("button", { name: "Inspect supporting record", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Evidence", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".evidence-drilldown")).toContainText(
    "Source-backed interface declaration",
  );
});

test("identity changes remove the loaded graph and selected record details", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("tab", { name: "Relationship Graph", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: /Interactive relationship graph/ }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Change token", exact: true }).click();
  await expect(page.getByLabel("Access token")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Interactive relationship graph/ }),
  ).toHaveCount(0);
  await expect(page.getByText("Order API", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("fixture-run")),
  ).toBeNull();
});
