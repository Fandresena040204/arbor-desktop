/* eslint-disable no-sync */

/**
 * Arbor: E2E test of the built-in merge tool, opened from the conflicted file
 * menu of Desktop's merge conflicts dialog.
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import {
  clickCapturedMenuItem,
  getCapturedMenu,
  installMenuCapture,
  openSmokeRepository,
} from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

const feature = 'arbor-merge-feature'
const file = 'conflict.txt'

function git(args: ReadonlyArray<string>, allowFailure = false) {
  try {
    return execFileSync('git', [...args], {
      cwd: smokeRepoPath,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim()
  } catch (e) {
    if (allowFailure) {
      return ''
    }
    throw e
  }
}

function commitFile(lines: ReadonlyArray<string>, message: string) {
  fs.writeFileSync(path.join(smokeRepoPath, file), lines.join('\n') + '\n')
  git(['add', '--', file])
  git(['commit', '-m', message])
}

function tool(page: Page) {
  return page.locator('dialog#arbor-merge-tool')
}

test.describe('Arbor merge tool', () => {
  test('creates a merge with two conflicts', async ({
    app,
    mainWindow: page,
  }) => {
    await openSmokeRepository(page)
    const current = git(['rev-parse', '--abbrev-ref', 'HEAD'])

    commitFile(['top', 'a', 'b', 'c', 'd', 'e', 'bottom'], 'conflict base')
    git(['checkout', '-b', feature])
    commitFile(['top FEATURE', 'a', 'b', 'c', 'd', 'e', 'bottom FEATURE'], 'f')
    git(['checkout', current])
    commitFile(['top MAIN', 'a', 'b', 'c', 'd', 'e', 'bottom MAIN'], 'm')
    git(['merge', feature], true)
    expect(git(['diff', '--name-only', '--diff-filter=U'])).toBe(file)

    await installMenuCapture(app)
    await app.evaluate(({ BrowserWindow }) => {
      // eslint-disable-next-line no-loosely-typed-webcontents-ipc
      BrowserWindow.getAllWindows()[0].webContents.send('focus')
    })
  })

  test('opens from the conflicted file menu', async ({
    app,
    mainWindow: page,
  }) => {
    // Desktop shows its conflicts dialog once it notices the merge; it can
    // also be reopened from the banner.
    const conflicted = page.locator('.unmerged-file-status-conflicts', {
      hasText: file,
    })
    const banner = page.getByRole('button', { name: /resolve/i })
    await expect
      .poll(
        async () => {
          if (await conflicted.isVisible()) {
            return true
          }
          if (await banner.first().isVisible()) {
            await banner.first().click()
          }
          return false
        },
        { timeout: 30000 }
      )
      .toBe(true)

    await conflicted
      .getByRole('button', { name: 'File resolution options' })
      .click()
    const items = await getCapturedMenu(app)
    expect(items.map(i => i.label)).toContain('Resolve in merge tool…')
    await clickCapturedMenuItem(app, 'Resolve in merge tool…')

    await tool(page).waitFor({ state: 'visible', timeout: 15000 })
    await expect(tool(page).locator('.arbor-merge-progress')).toHaveText(
      '0 of 2 conflicts resolved'
    )
    await expect(tool(page).locator('.arbor-merge-save')).toBeDisabled()
  })

  test('resolves each conflict differently', async ({ mainWindow: page }) => {
    await tool(page)
      .getByRole('button', { name: 'Accept current for conflict 1' })
      .click()
    await expect(tool(page).locator('.arbor-merge-progress')).toHaveText(
      '1 of 2 conflicts resolved'
    )

    await tool(page)
      .getByRole('button', { name: 'Edit result of conflict 2' })
      .click()
    await tool(page)
      .getByRole('textbox', { name: 'Result of conflict 2' })
      .fill('bottom MERGED')
    await tool(page).getByRole('button', { name: 'Done' }).click()

    await expect(tool(page).locator('.arbor-merge-progress')).toHaveText(
      '2 of 2 conflicts resolved'
    )
    await tool(page).screenshot({
      path: test.info().outputPath('arbor-merge-tool.png'),
    })
  })

  test('saves and marks the file resolved', async ({ mainWindow: page }) => {
    await tool(page).locator('.arbor-merge-save').click()
    await tool(page).waitFor({ state: 'hidden', timeout: 15000 })

    const content = fs
      .readFileSync(path.join(smokeRepoPath, file), 'utf8')
      .replace(/\r\n/g, '\n')
    expect(content).toBe(
      ['top MAIN', 'a', 'b', 'c', 'd', 'e', 'bottom MERGED', ''].join('\n')
    )
    expect(git(['diff', '--name-only', '--diff-filter=U'])).toBe('')

    // Desktop's conflicts dialog now lets the user conclude the merge.
    await page.getByRole('button', { name: 'Continue merge' }).click()
    await expect
      .poll(
        () => fs.existsSync(path.join(smokeRepoPath, '.git', 'MERGE_HEAD')),
        {
          timeout: 15000,
        }
      )
      .toBe(false)
    await expect(page.locator('dialog[open]')).toHaveCount(0)
  })
})
