/**
 * Arbor: E2E test of the integrated terminal panel (View > Toggle terminal).
 */

import type { Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoName } from './test-helpers'
import { clickAppMenuItem, openSmokeRepository } from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

function panel(page: Page) {
  return page.locator('.arbor-terminal-panel')
}

function screen(page: Page) {
  return panel(page).locator('.xterm-rows')
}

async function typeCommand(page: Page, command: string) {
  await panel(page).locator('.arbor-terminal-xterm').click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

test.describe('Arbor integrated terminal', () => {
  test('opens the smoke repository', async ({ mainWindow: page }) => {
    await openSmokeRepository(page)
  })

  test('opens from the View menu in the repository folder', async ({
    app,
    mainWindow: page,
  }) => {
    await clickAppMenuItem(app, 'arbor-toggle-terminal')
    await panel(page).waitFor({ state: 'visible', timeout: 15000 })
    await expect(panel(page).locator('.arbor-terminal-shell')).toContainText(
      process.platform === 'win32' ? 'powershell' : '/'
    )

    // The prompt shows the current folder on every default shell we use.
    await expect(screen(page)).toContainText(smokeRepoName, {
      timeout: 20000,
    })
  })

  test('runs commands typed by the user', async ({ mainWindow: page }) => {
    // The shell computes 42; the echoed command line only has "40+2".
    const command =
      process.platform === 'win32'
        ? 'echo "ARBOR_$(40+2)_MARK"'
        : 'echo "ARBOR_$((40+2))_MARK"'
    await typeCommand(page, command)

    await expect(screen(page)).toContainText('ARBOR_42_MARK', {
      timeout: 20000,
    })
    await panel(page).screenshot({
      path: test.info().outputPath('arbor-terminal.png'),
    })
  })

  test('restarts the shell', async ({ mainWindow: page }) => {
    await panel(page)
      .locator('.arbor-terminal-header button[aria-label="Restart terminal"]')
      .click()
    await expect(screen(page)).not.toContainText('ARBOR_42_MARK', {
      timeout: 15000,
    })
    await expect(screen(page)).toContainText(smokeRepoName, {
      timeout: 20000,
    })
  })

  test('closes with the Close button and toggles back', async ({
    app,
    mainWindow: page,
  }) => {
    await panel(page).locator('button[aria-label="Close terminal"]').click()
    await expect(panel(page)).toHaveCount(0)

    await clickAppMenuItem(app, 'arbor-toggle-terminal')
    await panel(page).waitFor({ state: 'visible', timeout: 15000 })
    await clickAppMenuItem(app, 'arbor-toggle-terminal')
    await expect(panel(page)).toHaveCount(0)
  })
})
