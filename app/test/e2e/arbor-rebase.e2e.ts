/* eslint-disable no-sync */

/**
 * Arbor: E2E test of the interactive rebase editor (Branch > Interactive
 * rebase…).
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import { clickAppMenuItem, openSmokeRepository } from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

function git(args: ReadonlyArray<string>) {
  return execFileSync('git', [...args], {
    cwd: smokeRepoPath,
    encoding: 'utf8',
  }).trim()
}

function commitFile(name: string) {
  fs.writeFileSync(path.join(smokeRepoPath, `${name}.txt`), `${name}\n`)
  git(['add', '--', `${name}.txt`])
  git(['commit', '-m', name])
  return git(['rev-parse', 'HEAD'])
}

function subjects(count: number) {
  return git(['log', `-${count}`, '--format=%s']).split(/\r?\n/)
}

function dialog(page: Page) {
  return page.locator('dialog#arbor-interactive-rebase')
}

function entry(page: Page, sha: string) {
  return dialog(page).locator(`.arbor-rebase-entry[data-sha="${sha}"]`)
}

async function openEditor(app: ElectronApplication, page: Page) {
  await clickAppMenuItem(app, 'arbor-interactive-rebase')
  await dialog(page).waitFor({ state: 'visible', timeout: 15000 })
}

async function pickStart(page: Page, summary: string) {
  await dialog(page)
    .locator('.arbor-rebase-start-entry', { hasText: summary })
    .first()
    .click()
  await dialog(page)
    .locator('.arbor-rebase-entry')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
}

function startButton(page: Page) {
  return dialog(page).getByRole('button', { name: 'Start rebase' })
}

test.describe('Arbor interactive rebase', () => {
  const shas: Record<string, string> = {}

  test('prepares a clean history', async ({ app, mainWindow: page }) => {
    await openSmokeRepository(page)
    // The smoke repository starts with an uncommitted file.
    git(['add', '-A'])
    git(['commit', '-m', 'smoke'])
    for (const name of ['one', 'two', 'three', 'four']) {
      shas[name] = commitFile(name)
    }
    await app.evaluate(({ BrowserWindow }) => {
      // eslint-disable-next-line no-loosely-typed-webcontents-ipc
      BrowserWindow.getAllWindows()[0].webContents.send('focus')
    })
  })

  test('lists the plan oldest first from the chosen commit', async ({
    app,
    mainWindow: page,
  }) => {
    await openEditor(app, page)
    await pickStart(page, 'two')

    const rows = dialog(page).locator('.arbor-rebase-entry')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveAttribute('data-sha', shas.two)
    await expect(rows.nth(2)).toHaveAttribute('data-sha', shas.four)
    // Nothing changed yet.
    await expect(startButton(page)).toBeDisabled()
    await dialog(page).screenshot({
      path: test.info().outputPath('arbor-rebase-plan.png'),
    })
  })

  test('rejects squashing into nothing', async ({ mainWindow: page }) => {
    await entry(page, shas.two)
      .locator('select.arbor-rebase-action')
      .selectOption('squash')
    await expect(dialog(page)).toContainText('cannot be')
    await expect(startButton(page)).toBeDisabled()
    await entry(page, shas.two)
      .locator('select.arbor-rebase-action')
      .selectOption('pick')
  })

  test('reorders, drops and rewords commits', async ({ mainWindow: page }) => {
    // Move "four" above "three", drop "two", reword "three".
    const shortFour = shas.four.substring(0, 7)
    await entry(page, shas.four)
      .getByRole('button', { name: `Move ${shortFour} up` })
      .click()
    await entry(page, shas.two)
      .locator('select.arbor-rebase-action')
      .selectOption('drop')
    await entry(page, shas.three)
      .locator('select.arbor-rebase-action')
      .selectOption('reword')
    await entry(page, shas.three).locator('textarea').fill('three, "reworded"')

    await expect(startButton(page)).toBeEnabled()
    await startButton(page).click()

    await dialog(page).waitFor({ state: 'hidden', timeout: 30000 })
    expect(subjects(3)).toEqual(['three, "reworded"', 'four', 'one'])
  })

  test('pauses on edit and continues', async ({ app, mainWindow: page }) => {
    await openEditor(app, page)
    await pickStart(page, 'four')

    const head = git(['rev-parse', 'HEAD'])
    await entry(page, head)
      .locator('select.arbor-rebase-action')
      .selectOption('edit')
    await startButton(page).click()

    // Desktop's own rebase flow takes over the paused rebase.
    await dialog(page).waitFor({ state: 'hidden', timeout: 30000 })
    const continueButton = page
      .locator('dialog')
      .getByRole('button', { name: 'Continue rebase' })
    await continueButton.waitFor({ state: 'visible', timeout: 30000 })

    // Amend the stopped commit like the user would.
    fs.writeFileSync(path.join(smokeRepoPath, 'edited.txt'), 'edited\n')
    git(['add', '--', 'edited.txt'])
    git(['commit', '--amend', '--no-edit'])

    await continueButton.click()
    await expect
      .poll(() =>
        fs.existsSync(path.join(smokeRepoPath, '.git', 'rebase-merge'))
      )
      .toBe(false)

    expect(git(['show', '--name-only', '--format=', 'HEAD'])).toContain(
      'edited.txt'
    )
    expect(subjects(1)).toEqual(['three, "reworded"'])
  })
})
