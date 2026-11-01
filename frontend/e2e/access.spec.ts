import { expect, test, type Page } from "@playwright/test";
async function mockWorkspace(page: Page, admin = false) {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/nexus/session"))
      return route.fulfill({
        json: {
          employee_id: "person",
          display_name: "Test person",
          company_id: "nexus",
          role_code: admin ? "ADMIN" : "INTERN",
          project_ids: ["A1", "B2"],
          capabilities: { request_access: true, review_access_requests: admin },
        },
      });
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          subject: "nexus:person",
          tenant_id: "nexus-tenant",
          permissions: [
            "READ_GRAPH",
            "READ_EVIDENCE",
            "EXECUTE_TOOL",
            ...(admin ? ["ADMIN"] : []),
          ],
        },
      });
    if (path.endsWith("/workspaces"))
      return route.fulfill({
        json: { items: [{ id: "engineering", name: "Engineering" }] },
      });
    if (path.endsWith("/nexus/sources"))
      return route.fulfill({
        json: {
          items: [
            { source_id: "source-a", owner_project_id: "A1" },
            { source_id: "source-b", owner_project_id: "B2" },
          ],
        },
      });
    if (path.endsWith("/investigations"))
      return route.fulfill({
        json: {
          run_id: "run-1",
          status: "PARTIAL",
          summary: "Review the customer database dependency.",
          findings: ["Review the migration boundary."],
          entity_ids: ["service-1"],
          relationship_ids: ["relation-1"],
          evidence_refs: ["source-a:record-1"],
          source_coverage_limitations: [
            "Only the selected source was examined.",
          ],
          unresolved_conflicts: [],
          rejected_unverified_claims: [],
        },
      });
    if (path.endsWith("/search"))
      return route.fulfill({
        json: {
          items: [
            {
              id: "service-1",
              name: "Authentication service",
              type: "Service",
            },
          ],
        },
      });
    if (path.endsWith("/evidence"))
      return route.fulfill({
        json: {
          items: [
            {
              source_id: "source-a",
              record_id: "record-1",
              title: "API specification",
            },
          ],
        },
      });
    return route.fulfill({ json: { items: [] } });
  });
}
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Access token").fill("opaque");
  await page.getByLabel("Access token").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Workspace Overview" }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1920) < 761)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
for (const width of [390, 1280, 1920]) {
  test(`authenticated workspace at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockWorkspace(page);
    await login(page);
    await expect(page.getByLabel("Source A", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Source B", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: /Which services depend/ }).click();
    await expect(
      page.getByLabel("What would you like to investigate?"),
    ).toHaveValue("Which services depend on the customer database?");
    await expect(
      page.getByRole("button", { name: "Start investigation", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Source A", { exact: true }).check();
    const submitted = page.waitForRequest((r) =>
      r.url().endsWith("/engineering/investigations"),
    );
    await page
      .getByRole("button", { name: "Start investigation", exact: true })
      .click();
    expect((await submitted).postDataJSON()).toEqual({
      objective: "Which services depend on the customer database?",
      selected_source_ids: ["source-a"],
    });
    await expect(
      page.getByRole("heading", { name: "Investigation result", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Source A:record-1", { exact: true }),
    ).toBeVisible();
    await nav(page, "Knowledge & Evidence");
    await page.getByLabel("Search graph entities").fill("authentication");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    await expect(page.getByText(/API specification/).first()).toBeVisible();
    await nav(page, "My Access");
    await page.getByLabel("Resource identifier").fill("requested-resource");
    await page.getByLabel("Justification").fill("Review migration");
    await page
      .getByRole("button", { name: "Request additional access" })
      .click();
    await expect(
      page.getByRole("status", { name: "Workspace notification" }),
    ).toContainText("Access request submitted");
    await page.getByLabel("Switch project").selectOption("B2");
    await nav(page, "Overview");
    await expect(
      page.getByRole("heading", { name: "B2", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("What would you like to investigate?"),
    ).toHaveValue("");
    await expect(
      page.getByText("Source A:record-1", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Change token / sign out" }).click();
    await expect(page.getByLabel("Access token")).toHaveValue("");
    await expect(page.getByLabel("Authorized workspace")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(errors).toEqual([]);
  });
}
test("expired session removes all project content", async ({ page }) => {
  await mockWorkspace(page);
  await login(page);
  await page
    .getByLabel("What would you like to investigate?")
    .fill("Private objective");
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.getByLabel("Switch project").selectOption("B2");
  await expect(page.getByRole("alert")).toContainText(
    "not accepted or has expired",
  );
  await expect(page.getByLabel("Authorized workspace")).toHaveCount(0);
});
test("nested destination survives refresh with revalidation", async ({
  page,
}) => {
  await mockWorkspace(page);
  await login(page);
  await nav(page, "Projects");
  await page.reload();
  await page.getByLabel("Access token").fill("opaque");
  await page.getByLabel("Access token").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Authorized projects" }),
  ).toBeVisible();
});
test("permission denied search reveals no protected data", async ({ page }) => {
  await mockWorkspace(page);
  await login(page);
  await page.route("**/search?*", (route) =>
    route.fulfill({ status: 403, json: {} }),
  );
  await nav(page, "Knowledge & Evidence");
  await page.getByLabel("Search graph entities").fill("secret");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Permission denied");
  await expect(
    page.getByText("Authentication service", { exact: true }),
  ).toHaveCount(0);
});

test("admin review uses the authorized pending-request and decision APIs", async ({
  page,
}) => {
  await mockWorkspace(page, true);
  let approved = false;
  await page.route("**/nexus/access-requests/pending", (route) =>
    route.fulfill({
      json: {
        items: approved
          ? []
          : [
              {
                request_id: "ar-1",
                resource_id: "source-a",
                status: "PENDING",
                requested_actions: ["READ"],
                requested_project_id: "A1",
                justification: "Review migration",
              },
            ],
      },
    }),
  );
  await page.route("**/nexus/access-requests/ar-1/approve", (route) => {
    approved = true;
    return route.fulfill({ json: { status: "APPROVED" } });
  });
  await login(page);
  await nav(page, "My Access");
  await expect(
    page.getByRole("button", { name: "Request additional access" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh requests" }).click();
  await expect(
    page.getByText("Source A", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve requested scope" }).click();
  await expect(
    page.getByRole("status", { name: "Workspace notification" }),
  ).toContainText("Request approved");
  await expect(
    page.getByRole("heading", { name: "No requests returned" }),
  ).toBeVisible();
});

test("unavailable sources show an unknown metric and block execution", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.route("**/nexus/sources", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await login(page);
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await expect(
    page
      .locator(".metric")
      .filter({ hasText: "Available sources" })
      .locator("strong"),
  ).toHaveText("Unavailable");
  await page
    .getByLabel("What would you like to investigate?")
    .fill("Investigate service");
  await expect(
    page.getByRole("button", { name: "Start investigation", exact: true }),
  ).toBeDisabled();
});

test("readable source names preserve multi-source request IDs across the complete flow", async ({
  page,
}) => {
  await mockWorkspace(page);
  const architecture = "NEX-SRC-ARCHITECTURE_DECISIONS";
  const catalog = "NEX-SRC-SERVICE_CATALOG";
  await page.route("**/nexus/sources", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            source_id: architecture,
            owner_project_id: "A1",
            description: "Published decision records",
          },
          {
            source_id: catalog,
            owner_project_id: "A1",
            display_name: "Engineering Services",
          },
          { source_id: "NEX-SRC-SECURITY_POLICIES", owner_project_id: "A1" },
          { source_id: "NEX-SRC-PRIVATE_SOURCE", owner_project_id: "B2" },
        ],
      },
    }),
  );
  await login(page);
  await expect(
    page.getByRole("checkbox", { name: "Architecture Decisions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Private Source/ }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Architecture Decisions" }).check();
  await page.getByRole("checkbox", { name: "Engineering Services" }).check();
  await expect(
    page.getByRole("checkbox", { name: "Architecture Decisions" }),
  ).toHaveValue(architecture);
  await expect(page.locator(".source-option.selected")).toHaveCount(2);
  await page
    .getByLabel("What would you like to investigate?")
    .fill("Review service migration decisions");
  const submitted = page.waitForRequest((r) =>
    r.url().endsWith("/engineering/investigations"),
  );
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  expect((await submitted).postDataJSON().selected_source_ids).toEqual([
    architecture,
    catalog,
  ]);
  await expect(
    page.getByRole("heading", { name: "Investigation result", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "My Investigations", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await nav(page, "Recent Activity");
  await expect(
    page
      .locator(".session-activity")
      .getByText("Review service migration decisions", { exact: true }),
  ).toBeVisible();
  await nav(page, "Verification Results");
  await expect(
    page.getByRole("heading", { name: "Evidence coverage & verification" }),
  ).toBeVisible();
  await expect(
    page.getByText("NOT INDEPENDENTLY VERIFIED", { exact: true }).first(),
  ).toBeVisible();
  await nav(page, "Knowledge & Evidence");
  await page.getByLabel("Filter sources").fill("Architecture");
  await expect(
    page.getByRole("button", { name: "Inspect Architecture Decisions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect Engineering Services" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Inspect Architecture Decisions" })
    .click();
  await expect(page.locator(".source-detail")).toContainText(
    "Published decision records",
  );
  await page.getByLabel("Filter sources").fill(catalog);
  await expect(
    page.getByRole("button", { name: "Inspect Engineering Services" }),
  ).toBeVisible();
  await nav(page, "Projects");
  await expect(
    page.locator(".metadata-row").filter({ hasText: "Engineering Services" }),
  ).toBeVisible();
  await nav(page, "Knowledge & Dependencies");
  await page.getByLabel("Search graph entities").fill("service");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const dependencyRequest = page.waitForRequest((r) =>
    r.url().includes("/entities/service-1/reverse-dependencies"),
  );
  await page.getByRole("button", { name: "Dependencies", exact: true }).click();
  await dependencyRequest;
  await nav(page, "Decisions");
  await page.route("**/search?*", (route) =>
    route.fulfill({
      json: {
        items: [
          { id: "decision-1", name: "Migration approval", type: "DECISION" },
          { id: "service-2", name: "Unrelated service", type: "SERVICE" },
        ],
      },
    }),
  );
  await page.getByLabel("Search graph entities").fill("migration");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".entity-row")).toHaveCount(1);
  await expect(page.locator(".entity-row")).toContainText("Migration approval");
  await nav(page, "Access Requests");
  await page.getByRole("button", { name: "Refresh requests" }).click();
  await expect(
    page.getByRole("heading", { name: "No requests returned" }),
  ).toBeVisible();
  await nav(page, "My Access");
  await expect(
    page.getByRole("heading", { name: "Current authorization" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Handoffs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Agent Investigations", exact: true }),
  ).toHaveCount(0);
});

test("sidebar collapse persists without caching private workspace data", async ({
  page,
}) => {
  await mockWorkspace(page);
  await login(page);
  const width = await page
    .locator(".workspace-content")
    .evaluate((el) => el.getBoundingClientRect().width);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.getByLabel("Authorized workspace")).toHaveClass(
    /nav-collapsed/,
  );
  expect(
    await page
      .locator(".workspace-content")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeGreaterThan(width);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Recent Activity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recent session activity" }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("Access token").fill("opaque");
  await page.getByLabel("Access token").press("Enter");
  await expect(page.getByLabel("Authorized workspace")).toHaveClass(
    /nav-collapsed/,
  );
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Recent Activity", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    "nodus.sidebar.collapsed",
  ]);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(page.getByLabel("Authorized workspace")).not.toHaveClass(
    /nav-collapsed/,
  );
});

test("sidebar follows permissions rather than the role name and rejects protected deep links", async ({
  page,
}) => {
  await mockWorkspace(page, true);
  await page.route("**/api/v1/session", (route) =>
    route.fulfill({
      json: {
        subject: "nexus:person",
        tenant_id: "nexus-tenant",
        permissions: [],
      },
    }),
  );
  await login(page);
  for (const name of [
    "Knowledge & Evidence",
    "Knowledge & Dependencies",
    "Decisions",
  ]) {
    await expect(
      page.getByRole("navigation").getByRole("button", { name, exact: true }),
    ).toHaveCount(0);
  }
  await page.evaluate(() => {
    location.hash = "decisions";
  });
  await expect(
    page.getByRole("heading", { name: "Workspace Overview" }),
  ).toBeVisible();
  await expect(page.getByLabel("Search graph entities")).toHaveCount(0);
  await nav(page, "Access Requests");
  await expect(
    page.getByRole("button", { name: "Approve requested scope" }),
  ).toHaveCount(0);
});

test('duplicate source names remain individually selectable by original ID', async ({ page }) => {
  await mockWorkspace(page)
  await page.route('**/nexus/sources', route => route.fulfill({ json: { items: [
    { source_id: 'catalog-one', display_name: 'Shared Catalog', owner_project_id: 'A1' },
    { source_id: 'catalog-two', display_name: 'Shared Catalog', owner_project_id: 'A1' },
  ] } }))
  await login(page)
  await page.getByRole('checkbox', { name: 'Shared Catalog (catalog-two)', exact: true }).check()
  await expect(page.getByRole('checkbox', { name: 'Shared Catalog (catalog-one)', exact: true })).not.toBeChecked()
  await page.getByLabel('What would you like to investigate?').fill('Inspect catalog')
  const submitted = page.waitForRequest(r => r.url().endsWith('/engineering/investigations'))
  await page.getByRole('button', { name: 'Start investigation', exact: true }).click()
  expect((await submitted).postDataJSON().selected_source_ids).toEqual(['catalog-two'])
})
