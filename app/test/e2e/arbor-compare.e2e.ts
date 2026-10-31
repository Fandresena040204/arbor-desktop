/* eslint-disable no-sync */

/**
 * Arbor: E2E test of the compare branches dialog (Branch > Compare branches…).
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import { clickAppMenuItem, openSmokeRepository } from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

const feature = 'arbor-compare-feature'

function git(args: ReadonlyArray<string>) {
  return execFileSync('git', [...args], {
    cwd: smokeRepoPath,
    encoding: 'utf8',
  }).trim()
}

function commitFile(name: string, contents: string, message: string) {
  fs.writeFileSync(path.join(smokeRepoPath, name), contents)
  git(['add', '--', name])
  git(['commit', '-m', message])
}

function dialog(page: Page) {
  return page.locator('dialog#arbor-compare-branches')
}

test.describe('Arbor compare branches', () => {
  let current = ''

  test('prepares diverged branches', async ({ mainWindow: page }) => {
    await openSmokeRepository(page)
    current = git(['rev-parse', '--abbrev-ref', 'HEAD'])

    git(['checkout', '-b', feature])
    commitFile('feature.txt', 'feature line\n', 'feature work')
    commitFile('more.txt', 'one\ntwo\n', 'more feature work')
    git(['checkout', current])
    commitFile('base.txt', 'base\n', 'base work')
  })

  test('compares the chosen branches', async ({ app, mainWindow: page }) => {
    await clickAppMenuItem(app, 'arbor-compare-branches')
    await dialog(page).waitFor({ state: 'visible', timeout: 15000 })

    await dialog(page)
      .locator('.arbor-compare-base select')
      .selectOption(current)
    await dialog(page)
      .locator('.arbor-compare-head select')
      .selectOption(feature)

    const summary = dialog(page).locator('.arbor-compare-summary')
    await expect(summary).toContainText(
      `${feature} is 2 commits ahead of and 1 commit behind ${current}`,
      { timeout: 15000 }
    )
    await expect(summary).toContainText('2 files')
    await expect(summary).toContainText('+3')

    await expect(
      dialog(page).locator('.arbor-compare-commits-ahead .arbor-compare-commit')
    ).toHaveText([/more feature work/, /feature work/])
    await expect(
      dialog(page).locator(
        '.arbor-compare-commits-behind .arbor-compare-commit'
      )
    ).toHaveText([/base work/])
  })

  test('shows the files and their diff', async ({ mainWindow: page }) => {
    await dialog(page)
      .getByText(/Files changed/)
      .click()

    const files = dialog(page).locator('.arbor-compare-file')
    await expect(files).toHaveCount(2)
    await expect(dialog(page).locator('.arbor-compare-diff')).toContainText(
      '+feature line',
      { timeout: 15000 }
    )

    await files.filter({ hasText: 'more.txt' }).click()
    await expect(dialog(page).locator('.arbor-compare-diff')).toContainText(
      '+two',
      { timeout: 15000 }
    )
    await dialog(page).screenshot({
      path: test.info().outputPath('arbor-compare.png'),
    })
  })

  test('swaps the branches', async ({ mainWindow: page }) => {
    await dialog(page).getByRole('button', { name: 'Swap branches' }).click()
    await expect(dialog(page).locator('.arbor-compare-summary')).toContainText(
      `${current} is 1 commit ahead of and 2 commits behind ${feature}`,
      { timeout: 15000 }
    )
  })

  test('closes', async ({ mainWindow: page }) => {
    await dialog(page).getByRole('button', { name: 'Close' }).last().click()
    await dialog(page).waitFor({ state: 'hidden', timeout: 15000 })
  })
})
