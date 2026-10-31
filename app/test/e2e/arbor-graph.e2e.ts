/* eslint-disable no-sync */

/**
 * Arbor: E2E test of the interactive commit graph (View > Toggle graph).
 */

import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import {
  clickAppMenuItem,
  clickCapturedMenuItem,
  getCapturedMenu,
  installMenuCapture,
  openSmokeRepository,
} from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

const branch = 'arbor-graph-branch'

function git(args: ReadonlyArray<string>) {
  return execFileSync('git', [...args], {
    cwd: smokeRepoPath,
    encoding: 'utf8',
  }).trim()
}

function commitFile(name: string, message: string) {
  fs.writeFileSync(path.join(smokeRepoPath, name), `${message}\n`)
  git(['add', '--', name])
  git(['commit', '-m', message])
}

function graph(page: Page) {
  return page.locator('.arbor-graph-view')
}

function rowWithRef(page: Page, name: string) {
  return graph(page)
    .locator('.arbor-graph-row')
    .filter({ has: page.locator('.arbor-graph-ref', { hasText: name }) })
}

test.describe('Arbor commit graph', () => {
  let current = ''

  test('prepares branches, a tag and a remote ref', async ({
    app,
    mainWindow: page,
  }) => {
    await openSmokeRepository(page)
    current = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    // The smoke repository may start with an uncommitted file, which would
    // block the cherry-pick.
    if (git(['status', '--porcelain']) !== '') {
      git(['add', '-A'])
      git(['commit', '-m', 'smoke'])
    }
    commitFile('graph-base.txt', 'graph base')
    git(['checkout', '-b', branch])
    commitFile('graph-branch.txt', 'graph branch work')
    git(['update-ref', `refs/remotes/origin/${branch}`, 'HEAD'])
    git(['checkout', current])
    commitFile('graph-main.txt', 'graph main work')
    git(['tag', 'v-arbor-graph'])
    await installMenuCapture(app)
    // Let Desktop notice the new commits (its status gates the cherry-pick).
    await app.evaluate(({ BrowserWindow }) => {
      // eslint-disable-next-line no-loosely-typed-webcontents-ipc
      BrowserWindow.getAllWindows()[0].webContents.send('focus')
    })
    await expect(page.getByText('0 changed files')).toBeVisible({
      timeout: 15000,
    })
  })

  test('opens from the View menu and draws the refs', async ({
    app,
    mainWindow: page,
  }) => {
    await clickAppMenuItem(app, 'arbor-toggle-graph')
    await graph(page).waitFor({ state: 'visible', timeout: 15000 })

    await expect(
      graph(page).locator('.arbor-graph-ref.branch.current')
    ).toHaveText(current, { timeout: 15000 })
    await expect(rowWithRef(page, 'v-arbor-graph')).toHaveCount(1)
    // The local branch and origin's copy share one badge, with a remote icon.
    const badge = rowWithRef(page, branch).locator('.arbor-graph-ref')
    await expect(badge).toHaveCount(1)
    await expect(badge.locator('.remote-icon')).toHaveCount(1)

    // Two diverged branches need at least two lanes.
    const width = await graph(page)
      .locator('.arbor-graph-svg')
      .first()
      .getAttribute('width')
    expect(Number(width)).toBeGreaterThanOrEqual(50)
    await graph(page).screenshot({
      path: test.info().outputPath('arbor-graph.png'),
    })
  })

  test('shows the details of the selected commit', async ({
    mainWindow: page,
  }) => {
    await rowWithRef(page, branch).click()
    const sha = git(['rev-parse', branch])
    await expect(graph(page).locator('.arbor-graph-details')).toContainText(sha)
    await expect(
      graph(page).locator('.arbor-graph-details-message')
    ).toContainText('graph branch work')
  })

  test('dims commits that do not match the filter', async ({
    mainWindow: page,
  }) => {
    await graph(page)
      .getByRole('textbox', { name: 'Filter commits' })
      .fill('graph branch work')
    await expect(
      graph(page).locator('.arbor-graph-row:not(.dimmed)')
    ).toHaveCount(1)
    await graph(page).getByRole('textbox', { name: 'Filter commits' }).fill('')
  })

  test('cherry-picks a commit from the context menu', async ({
    app,
    mainWindow: page,
  }) => {
    await rowWithRef(page, branch).click({ button: 'right' })
    const items = await getCapturedMenu(app)
    const item = (label: string) => items.find(i => i.label === label)

    expect(item('Create branch here…')?.enabled).toBe(true)
    expect(item(`Checkout ${branch}`)?.enabled).toBe(true)
    // Not in the current branch: can't be rebased from, can be picked.
    expect(item('Interactive rebase from here…')?.enabled).toBe(false)
    expect(item('Cherry-pick onto current branch')?.enabled).toBe(true)

    await clickCapturedMenuItem(app, 'Cherry-pick onto current branch')
    await expect
      .poll(() => git(['log', '-1', '--format=%s', current]), {
        timeout: 30000,
      })
      .toBe('graph branch work')
  })

  test('shows uncommitted changes as a WIP row', async ({
    mainWindow: page,
  }) => {
    fs.writeFileSync(path.join(smokeRepoPath, 'graph-wip.txt'), 'wip\n')
    await graph(page).getByRole('button', { name: 'Refresh graph' }).click()

    const wip = graph(page).locator('.arbor-graph-row.wip')
    await expect(wip).toContainText('// WIP: 1 changed file', {
      timeout: 15000,
    })
    await expect(wip.locator('circle.wip')).toHaveCount(1)
    await graph(page).screenshot({
      path: test.info().outputPath('arbor-graph-wip.png'),
    })
    fs.rmSync(path.join(smokeRepoPath, 'graph-wip.txt'))
  })

  test('closes back to the repository view', async ({ mainWindow: page }) => {
    // The cherry-pick may show Desktop's success banner; the graph stays.
    await graph(page).getByRole('button', { name: 'Close graph' }).click()
    await expect(graph(page)).toHaveCount(0)
    await expect(page.locator('#repository')).toBeVisible()
  })
})
