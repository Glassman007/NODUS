import { expect, test } from '@playwright/test'

const token = process.env.GH_E2E_TOKEN!
const workspaceA = process.env.GH_E2E_WORKSPACE_A!
const workspaceB = process.env.GH_E2E_WORKSPACE_B!
const employeeName = process.env.GH_E2E_EMPLOYEE_NAME!
const employeeId = process.env.GH_E2E_EMPLOYEE_ID!

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByLabel('Bearer token').fill(token)
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.getByLabel('Workspace')).toBeVisible()
}

test('local import is searchable and explorable through real HTTP', async ({ page }) => {
  await connect(page)
  await page.getByLabel('Workspace').selectOption(workspaceA)
  await page.getByLabel('Search entities').fill(employeeName)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('button', { name: new RegExp(employeeName) })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(employeeName) }).click()
  await expect(page.getByRole('heading', { name: employeeName })).toBeVisible()
  await expect(page.getByText('BELONGS_TO')).toBeVisible()
  await expect(page.getByText('Local source document')).toBeVisible()
  await page.getByRole('button', { name: 'Back to search results' }).click()
  await expect(page.getByRole('button', { name: new RegExp(employeeName) })).toBeVisible()
  await page.getByLabel('Workspace').selectOption(workspaceB)
  await expect(page.getByText(employeeName, { exact: true })).toHaveCount(0)
  await page.getByLabel('Search entities').fill(employeeName)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('No matching entities.')).toBeVisible()
})

test('old source response cannot populate the selected workspace', async ({ page }) => {
  await page.route(`**/api/v1/workspaces/${workspaceA}/sources`, async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 800))
    await route.fulfill({ response })
  })
  await connect(page)
  await page.getByLabel('Workspace').selectOption(workspaceB)
  await page.waitForTimeout(1000)
  await expect(page.getByText('local · 1 records')).toHaveCount(0)
})

test('old search and detail responses cannot replace another workspace', async ({ page }) => {
  await connect(page)
  await page.getByLabel('Workspace').selectOption(workspaceA)
  await page.route(`**/api/v1/workspaces/${workspaceA}/search?*`, async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 700))
    await route.fulfill({ response })
  })
  await page.getByLabel('Search entities').fill(employeeName)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByLabel('Workspace').selectOption(workspaceB)
  await page.waitForTimeout(900)
  await expect(page.getByText(employeeName, { exact: true })).toHaveCount(0)
  await page.getByLabel('Workspace').selectOption(workspaceA)
  await page.unrouteAll()
  await page.getByLabel('Search entities').fill(employeeName)
  await page.getByRole('button', { name: 'Search' }).click()
  await page.getByRole('button', { name: new RegExp(employeeName) }).click()
  await expect(page.getByRole('heading', { name: employeeName })).toBeVisible()
  await page.route(`**/api/v1/workspaces/${workspaceA}/entities/${encodeURIComponent(employeeId)}/neighborhood?*`, async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 700))
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: employeeId }).first().click()
  await page.getByLabel('Workspace').selectOption(workspaceB)
  await page.waitForTimeout(900)
  await expect(page.getByRole('heading', { name: employeeName })).toHaveCount(0)
})

test('old entity and evidence responses cannot replace another workspace', async ({ page }) => {
  await connect(page)
  await page.getByLabel('Workspace').selectOption(workspaceA)
  await page.getByLabel('Search entities').fill(employeeName)
  await page.getByRole('button', { name: 'Search' }).click()
  const card = page.getByRole('button', { name: new RegExp(employeeName) })
  await expect(card).toBeVisible()
  await page.route(`**/api/v1/workspaces/${workspaceA}/entities/${encodeURIComponent(employeeId)}`, async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.fulfill({ response })
  })
  await card.click()
  await page.getByLabel('Workspace').selectOption(workspaceB)
  await page.waitForTimeout(800)
  await expect(page.getByRole('heading', { name: employeeName })).toHaveCount(0)
  await page.unrouteAll()
  await page.getByLabel('Workspace').selectOption(workspaceA)
  await page.getByLabel('Search entities').fill(employeeName)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(card).toBeVisible()
  await page.route(`**/api/v1/workspaces/${workspaceA}/entities/${encodeURIComponent(employeeId)}/evidence`, async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.fulfill({ response })
  })
  await card.click()
  await page.getByLabel('Workspace').selectOption(workspaceB)
  await page.waitForTimeout(800)
  await expect(page.getByRole('heading', { name: employeeName })).toHaveCount(0)
})

test('old workspace metadata cannot restore a replaced connection', async ({ page }) => {
  await page.goto('/')
  await page.route('**/api/v1/workspaces', async route => {
    const response = await route.fetch()
    await new Promise(resolve => setTimeout(resolve, 700))
    await route.fulfill({ response })
  })
  await page.getByLabel('Bearer token').fill(token)
  await page.getByRole('button', { name: 'Connect' }).click()
  await page.getByLabel('Bearer token').fill('replaced-token')
  await page.waitForTimeout(900)
  await expect(page.getByLabel('Workspace')).toHaveCount(0)
  await expect(page.getByText('Signed in as')).toHaveCount(0)
})
