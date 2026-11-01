import { expect, test } from "@playwright/test";
import {
  parseInvestigationResult,
  parseEvidenceReference,
} from "../src/investigations/api";

test("live developer investigation through UI-3 and the running FastAPI backend", async ({
  page,
}) => {
  test.skip(
    process.env.NODUS_LIVE_INVESTIGATION !== "1",
    "Opt in explicitly: one live Gemini investigation, no retries",
  );
  test.setTimeout(720_000);
  const selected = ["NEX-SRC-INTERFACE_REGISTRY", "NEX-SRC-SERVICE_CATALOG"];
  await page.goto("/");
  await page
    .getByLabel("Access token")
    .fill(process.env.NODUS_LIVE_DEVELOPER_TOKEN ?? "dev-02-pay");
  await page.getByLabel("Access token").press("Enter");
  await expect(page.getByLabel("Authenticated role")).toHaveText("DEVELOPER");
  await expect(
    page.getByRole("heading", { name: "Workspace Overview" }),
  ).toBeVisible();
  await page
    .getByLabel("What would you like to investigate?")
    .fill(
      "Identify the documented dependencies of NEX-SVC-PAYMENT_API and cite the supporting source evidence. Distinguish observed graph relationships from unsupported statements and report any coverage limitations.",
    );
  await page
    .getByLabel("Entity identifier (optional)")
    .fill("NEX-SVC-PAYMENT_API");
  await page
    .getByRole("checkbox", { name: "Interface Registry", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Service Catalog", exact: true })
    .check();
  const sent = page.waitForRequest((request) =>
    request.url().endsWith("/nexus-workspace/investigations"),
  );
  const received = page.waitForResponse(
    (response) => response.url().endsWith("/nexus-workspace/investigations"),
    { timeout: 680_000 },
  );
  console.log(
    "LIVE_INVESTIGATION: submitting one developer investigation via the UI.",
  );
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  const body = (await sent).postDataJSON();
  expect(body.selected_source_ids).toEqual(selected);
  expect(body.entity_id).toBe("NEX-SVC-PAYMENT_API");
  const response = await received;
  expect(response.status()).toBe(200);
  const result = parseInvestigationResult(await response.json());
  await expect(page.locator(".report-header .run-status")).toHaveText(
    `Execution: ${result.status}`,
  );
  await expect(page.locator(".report-markdown").first()).toHaveText(
    result.summary,
  );
  const structured = [
    ...result.evidence_refs,
    ...result.tool_calls.flatMap((call) => call.evidence_refs),
  ];
  const outside = [
    ...new Set(
      structured.filter((ref) => {
        const parsed = parseEvidenceReference(ref, selected);
        return parsed && !selected.includes(parsed.sourceId);
      }),
    ),
  ];
  const narrative = [result.summary, ...result.findings].join("\n");
  const narrativeOutside = [
    ...new Set(narrative.match(/NEX-SRC-[A-Z0-9_-]+/g) ?? []),
  ].filter((id) => !selected.includes(id));
  console.log(
    "LIVE_INVESTIGATION_RESULT",
    JSON.stringify({
      run_id: result.run_id,
      status: result.status,
      error_message: result.error_message,
      model_usage: result.model_usage,
      evidence_refs: result.evidence_refs,
      entity_ids: result.entity_ids,
      relationship_ids: result.relationship_ids,
      limitations: result.source_coverage_limitations,
      structured_sources_outside_selection: outside,
      narrative_sources_outside_selection: narrativeOutside,
      summary: result.summary,
    }),
  );
  if (result.evidence_refs.length) {
    await page.getByRole("tab", { name: "Evidence", exact: true }).click();
    await page.locator(".result-panel .reference-list button").first().click();
    await expect(page.locator(".evidence-drilldown")).toBeVisible();
    await expect(
      page.locator(".evidence-drilldown .loading-state"),
    ).toHaveCount(0, { timeout: 35_000 });
    console.log(
      "LIVE_EVIDENCE_DRILLDOWN",
      await page.locator(".evidence-drilldown").innerText(),
    );
  }
});
