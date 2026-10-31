/**
 * Arbor: shared helpers for Arbor E2E tests.
 */

import type { ElectronApplication, Page } from '@playwright/test'
import { dismissMoveToApplicationsDialog, expect } from './e2e-fixtures'
import { smokeRepoFileName, smokeRepoName, smokeRepoPath } from './test-helpers'

/** Complete the welcome flow and open the smoke repository. */
export async function openSmokeRepository(page: Page) {
  await page.waitForFunction(
    () =>
      (document.getElementById('desktop-app-container')?.innerHTML.length ??
        0) > 100,
    null,
    { timeout: 30000 }
  )

  // The app is shared by every test file of the worker, so the welcome flow
  // has only to be completed by the first one.
  await page
    .locator('#welcome, #desktop-app-toolbar')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
  if (
    await page
      .locator('#welcome')
      .isVisible()
      .catch(() => false)
  ) {
    await page.locator('a.skip-button').click({ timeout: 30000 })
    const nameInput = page.locator('input[placeholder="Your Name"]')
    await nameInput.waitFor({ state: 'visible', timeout: 15000 })
    if ((await nameInput.inputValue()) === '') {
      await nameInput.fill('Arbor E2E')
    }
    const emailInput = page.locator(
      'input[placeholder="your-email@example.com"]'
    )
    if ((await emailInput.inputValue()) === '') {
      await emailInput.fill('arbor-e2e@example.com')
    }
    await page.locator('button:has-text("Finish")').click()
    await page.waitForSelector('#welcome', { state: 'hidden', timeout: 15000 })
  }
  await dismissMoveToApplicationsDialog(page)

  const repoFile = page
    .locator(`//*[contains(normalize-space(), "${smokeRepoFileName}")]`)
    .first()
  const addButton = page
    .locator(
      '//*[contains(normalize-space(), "Add an Existing Repository from your Local Drive") or contains(normalize-space(), "Add an Existing Repository from your local drive")]'
    )
    .first()
  const addRepositoryDialog = page.locator('dialog#add-existing-repository')

  // Once a previous test file committed the smoke file, the repository is
  // open without it in the changes list.
  const repositoryOpen = page
    .locator('#desktop-app-toolbar')
    .getByText(smokeRepoName)

  await Promise.race([
    repoFile.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
    repositoryOpen
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {}),
    addRepositoryDialog
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {}),
    addButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {}),
  ])

  if (await repositoryOpen.isVisible().catch(() => false)) {
    return
  }

  if (!(await repoFile.isVisible().catch(() => false))) {
    if (!(await addRepositoryDialog.isVisible().catch(() => false))) {
      await addButton.click()
    }
    await addRepositoryDialog.waitFor({ state: 'visible', timeout: 15000 })
    const pathInput = addRepositoryDialog.locator(
      'input[placeholder="repository path"]'
    )
    if ((await pathInput.inputValue()) !== smokeRepoPath) {
      await pathInput.fill(smokeRepoPath)
    }
    await addRepositoryDialog
      .locator(
        'button:has-text("Add Repository"), button:has-text("Add repository")'
      )
      .click()
  }

  await repoFile.waitFor({ state: 'visible', timeout: 15000 })
}

/** Click an item of the application menu by its id. */
export async function clickAppMenuItem(app: ElectronApplication, id: string) {
  await app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) {
      throw new Error(`Menu item not found: ${menuId}`)
    }
    item.click()
  }, id)
}

/*
 * Context menus are native Electron menus: these helpers replace
 * `Menu.prototype.popup` in the main process to capture the menu and trigger
 * its items instead of clicking on screen.
 */

export interface ICapturedMenuItem {
  readonly label: string
  readonly enabled: boolean
  readonly type: string
}

export async function installMenuCapture(app: ElectronApplication) {
  await app.evaluate(({ Menu }) => {
    const g = globalThis as any
    Menu.prototype.popup = function (options?: { callback?: () => void }) {
      g.__arborMenu = { menu: this, callback: options?.callback }
    }
  })
}

export async function clearCapturedMenu(app: ElectronApplication) {
  await app.evaluate(() => {
    const g = globalThis as any
    g.__arborMenu?.callback?.()
    g.__arborMenu = undefined
  })
}

export async function getCapturedMenu(
  app: ElectronApplication
): Promise<ReadonlyArray<ICapturedMenuItem>> {
  await expect
    .poll(() =>
      app.evaluate(() => (globalThis as any).__arborMenu !== undefined)
    )
    .toBe(true)

  return app.evaluate(() =>
    (globalThis as any).__arborMenu.menu.items.map((i: any) => ({
      label: i.label,
      enabled: i.enabled,
      type: i.type,
    }))
  )
}

export async function clickCapturedMenuItem(
  app: ElectronApplication,
  label: string
) {
  await app.evaluate((_, l) => {
    const g = globalThis as any
    const item = g.__arborMenu.menu.items.find((i: any) => i.label === l)
    if (item === undefined) {
      throw new Error(`Menu item not found: ${l}`)
    }
    g.__arborMenu = undefined
    item.click()
  }, label)
}
