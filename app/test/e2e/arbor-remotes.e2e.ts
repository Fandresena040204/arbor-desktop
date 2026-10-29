/* eslint-disable no-sync */

/**
 * Arbor: E2E tests for the multi-remote manager in Repository settings
 * (add, rename, change URL, remove, fetch and push to a chosen remote).
 *
 * Remotes are local bare repositories so no network or credentials are needed.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import { clickAppMenuItem, openSmokeRepository } from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

const root = path.join(os.tmpdir(), 'arbor-e2e-remotes')
const originPath = path.join(root, 'origin.git')
const backupPath = path.join(root, 'backup.git')
const otherPath = path.join(root, 'other.git')
const clonePath = path.join(root, 'clone')

function git(args: ReadonlyArray<string>, cwd = smokeRepoPath) {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()
}

function getRemotes(): Record<string, string> {
  const out = git(['remote', '-v'])
  const remotes: Record<string, string> = {}
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line)
    if (m) {
      remotes[m[1]] = m[2]
    }
  }
  return remotes
}

function remoteHasBranch(bare: string, branch: string) {
  return git(['branch', '--list', branch], bare).length > 0
}

function settings(page: Page) {
  return page.locator('dialog#repository-settings')
}

function row(page: Page, name: string) {
  return settings(page).locator(`.arbor-remote-row[data-remote="${name}"]`)
}

async function addRemote(page: Page, name: string, url: string) {
  const dialog = settings(page)
  await dialog.locator('input[aria-label="Name for new remote"]').fill(name)
  await dialog.locator('input[aria-label="URL for new remote"]').fill(url)
  await dialog.locator('button[aria-label="Add remote"]').click()
  await row(page, name).waitFor({ state: 'visible', timeout: 15000 })
}

test.describe('Arbor multiple remotes', () => {
  let branch = ''

  test.beforeAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.mkdirSync(root, { recursive: true })
    for (const p of [originPath, backupPath, otherPath]) {
      execFileSync('git', ['init', '--bare', p], { stdio: 'ignore' })
    }
  })

  test.afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  test('opens repository settings on the Remotes tab', async ({
    app,
    mainWindow: page,
  }) => {
    await openSmokeRepository(page)
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])

    await clickAppMenuItem(app, 'show-repository-settings')
    await settings(page).waitFor({ state: 'visible', timeout: 15000 })
    await expect(settings(page)).toContainText('Remotes')
    await expect(
      settings(page).locator('button[aria-label="Publish repository"]')
    ).toBeVisible()
  })

  test('adds two remotes', async ({ mainWindow: page }) => {
    await addRemote(page, 'origin', originPath)
    await addRemote(page, 'backup', backupPath)

    expect(getRemotes()).toEqual({ origin: originPath, backup: backupPath })
    await settings(page).screenshot({
      path: test.info().outputPath('arbor-remotes-tab.png'),
    })
  })

  test('rejects an invalid or duplicate remote name', async ({
    mainWindow: page,
  }) => {
    const dialog = settings(page)
    await dialog
      .locator('input[aria-label="Name for new remote"]')
      .fill('origin')
    await dialog
      .locator('input[aria-label="URL for new remote"]')
      .fill(otherPath)
    await dialog.locator('button[aria-label="Add remote"]').click()
    await expect(dialog.locator('.arbor-remote-error')).toContainText(
      'already exists'
    )

    await dialog
      .locator('input[aria-label="Name for new remote"]')
      .fill('bad name')
    await dialog.locator('button[aria-label="Add remote"]').click()
    await expect(dialog.locator('.arbor-remote-error')).toContainText(
      'Invalid remote name'
    )

    expect(Object.keys(getRemotes()).sort()).toEqual(['backup', 'origin'])
    await dialog.locator('input[aria-label="Name for new remote"]').fill('')
    await dialog.locator('input[aria-label="URL for new remote"]').fill('')
  })

  test('renames a remote and changes its URL', async ({ mainWindow: page }) => {
    await row(page, 'backup')
      .locator('button[aria-label="Edit remote backup"]')
      .click()
    await row(page, 'backup')
      .locator('input[aria-label="New name for remote backup"]')
      .fill('mirror')
    await row(page, 'backup')
      .locator('input[aria-label="New URL for remote backup"]')
      .fill(otherPath)
    await row(page, 'backup')
      .locator('button[aria-label="Save remote backup"]')
      .click()

    await row(page, 'mirror').waitFor({ state: 'visible', timeout: 15000 })
    await expect
      .poll(() => getRemotes())
      .toEqual({
        origin: originPath,
        mirror: otherPath,
      })
  })

  test('pushes to origin and sets it as upstream', async ({
    mainWindow: page,
  }) => {
    await settings(page).getByText('Set as upstream when pushing').click()
    await row(page, 'origin')
      .locator('button[aria-label="Push branch to origin"]')
      .click()

    await expect
      .poll(() => remoteHasBranch(originPath, branch), { timeout: 30000 })
      .toBe(true)
    await expect
      .poll(() => git(['config', `branch.${branch}.remote`]))
      .toBe('origin')
  })

  test('pushes to a second remote without changing the upstream', async ({
    mainWindow: page,
  }) => {
    await settings(page).getByText('Set as upstream when pushing').click()
    await row(page, 'mirror')
      .locator('button[aria-label="Push branch to mirror"]')
      .click()

    await expect
      .poll(() => remoteHasBranch(otherPath, branch), { timeout: 30000 })
      .toBe(true)
    expect(git(['config', `branch.${branch}.remote`])).toBe('origin')
  })

  test('fetches a single remote', async ({ mainWindow: page }) => {
    // Create a new branch on origin from another clone.
    execFileSync('git', ['clone', originPath, clonePath], { stdio: 'ignore' })
    git(['checkout', '-b', 'from-elsewhere'], clonePath)
    git(['push', 'origin', 'from-elsewhere'], clonePath)

    await row(page, 'origin')
      .locator('button[aria-label="Fetch origin"]')
      .click()

    await expect
      .poll(() => git(['branch', '-r']), { timeout: 30000 })
      .toContain('origin/from-elsewhere')
  })

  test('removes a remote after confirmation', async ({ mainWindow: page }) => {
    await row(page, 'mirror')
      .locator('button[aria-label="Remove remote mirror"]')
      .click()
    await expect(row(page, 'mirror')).toContainText('Remove mirror?')
    await row(page, 'mirror')
      .locator('button[aria-label="Remove mirror"]')
      .click()

    await expect(row(page, 'mirror')).toHaveCount(0)
    expect(Object.keys(getRemotes())).toEqual(['origin'])
  })

  test('closes repository settings', async ({ mainWindow: page }) => {
    await page.keyboard.press('Escape')
    await settings(page).waitFor({ state: 'hidden', timeout: 15000 })
  })
})
