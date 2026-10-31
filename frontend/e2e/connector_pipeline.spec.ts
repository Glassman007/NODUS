import { expect, test } from '@playwright/test'

const token = process.env.CPE2E_TOKEN!
const restrictedToken = process.env.CPE2E_RESTRICTED_TOKEN!
const workspace = process.env.CPE2E_WORKSPACE!
const prTitle = process.env.CPE2E_PR_TITLE!
const updatedPrTitle = process.env.CPE2E_UPDATED_PR_TITLE!
const publicPageTitle = process.env.CPE2E_PUBLIC_PAGE_TITLE!
const restrictedPageTitle = process.env.CPE2E_RESTRICTED_PAGE_TITLE!

async function connect(page: import('@playwright/test').Page, bearer: string) {
  await page.goto('/')
  await page.getByLabel('Bearer token').fill(bearer)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByLabel('Workspace')).toBeVisible()
  await page.getByLabel('Workspace').selectOption(workspace)
}

async function search(page: import('@playwright/test').Page, query: string) {
  await page.getByLabel('Search entities').fill(query)
  await page.getByRole('button', { name: 'Search' }).click()
}

test('a connector-ingested pull request is visible with its real relationships and provenance', async ({ page }) => {
  await connect(page, token)
  await search(page, updatedPrTitle)
  const card = page.getByRole('button', { name: updatedPrTitle })
  await expect(card).toBeVisible()
  await card.click()
  await expect(page.getByRole('heading', { name: updatedPrTitle })).toBeVisible()
  // Relationships produced by the real GitHub connector, not hand-authored fixtures.
  await expect(page.getByText('AUTHORED')).toBeVisible()
  await expect(page.getByText('MODIFIES').first()).toBeVisible()
  // Provenance: the evidence drawer names the real connector source, not a synthetic one.
  await expect(page.getByText('github-e2e', { exact: false }).first()).toBeVisible()
  // The pre-update title must not still be findable — the source update propagated end to end.
  await page.getByRole('button', { name: 'Back to search results' }).click()
  await search(page, prTitle)
  await expect(page.getByText('No matching entities.')).toBeVisible()
})

test('an authorized reader sees a public Confluence page but not a restricted one', async ({ page }) => {
  await connect(page, token)
  await search(page, publicPageTitle)
  await expect(page.getByRole('button', { name: publicPageTitle })).toBeVisible()
  await search(page, restrictedPageTitle)
  await expect(page.getByRole('button', { name: restrictedPageTitle })).toBeVisible()
})

test('a restricted reader cannot discover the unauthorized Confluence page through the browser', async ({ page }) => {
  await connect(page, restrictedToken)
  await search(page, restrictedPageTitle)
  await expect(page.getByText('No matching entities.')).toBeVisible()
  await expect(page.getByText(restrictedPageTitle, { exact: true })).toHaveCount(0)
  // The public page, by contrast, remains visible to the same restricted reader.
  await search(page, publicPageTitle)
  await expect(page.getByRole('button', { name: publicPageTitle })).toBeVisible()
})
