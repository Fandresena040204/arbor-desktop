/* eslint-disable no-sync */

/**
 * Arbor: E2E tests for the worktree context menu additions (show in file
 * manager / open in shell / open in editor, lock/unlock, prune).
 *
 * Context menus are native Electron menus, so the test replaces
 * `Menu.prototype.popup` in the main process to capture the menu and
 * trigger its items instead of clicking on screen.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import { openSmokeRepository } from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

const linkedPath = path.join(os.tmpdir(), 'arbor-e2e-worktree-linked')
const stalePath = path.join(os.tmpdir(), 'arbor-e2e-worktree-stale')

interface ICapturedMenuItem {
  readonly label: string
  readonly enabled: boolean
  readonly type: string
}

function git(args: ReadonlyArray<string>) {
  return execFileSync('git', [...args], {
    cwd: smokeRepoPath,
    encoding: 'utf8',
  })
}

function getWorktreeEntries() {
  return git(['worktree', 'list', '--porcelain'])
    .split(/\r?\n\r?\n/)
    .filter(b => b.trim().length > 0)
    .map(block => ({
      path: path.normalize(block.split(/\r?\n/)[0].replace('worktree ', '')),
      locked: /^locked/m.test(block),
    }))
}

function findWorktree(worktreePath: string) {
  const resolved = fs.realpathSync.native(path.dirname(worktreePath))
  const expected = path.join(resolved, path.basename(worktreePath))
  return getWorktreeEntries().find(
    e => e.path.toLowerCase() === expected.toLowerCase()
  )
}

async function installMenuCapture(app: ElectronApplication) {
  await app.evaluate(({ Menu }) => {
    const g = globalThis as any
    Menu.prototype.popup = function (options?: { callback?: () => void }) {
      g.__arborMenu = { menu: this, callback: options?.callback }
    }
  })
}

async function clearCapturedMenu(app: ElectronApplication) {
  await app.evaluate(() => {
    const g = globalThis as any
    g.__arborMenu?.callback?.()
    g.__arborMenu = undefined
  })
}

async function getCapturedMenu(
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

async function clickCapturedMenuItem(app: ElectronApplication, label: string) {
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

function getItem(items: ReadonlyArray<ICapturedMenuItem>, label: string) {
  const item = items.find(i => i.label === label)
  expect(item, `menu item "${label}"`).toBeDefined()
  return item!
}

async function openWorktreeFoldout(page: Page) {
  const list = page.locator('.worktree-list')
  if (!(await list.isVisible().catch(() => false))) {
    await page.locator('.worktree-button').click()
  }
  await list.waitFor({ state: 'visible', timeout: 15000 })
}

async function rightClickWorktree(page: Page, name: string) {
  await openWorktreeFoldout(page)
  await page
    .locator('.worktrees-list-item')
    .filter({ has: page.locator('.name', { hasText: name }) })
    .click({ button: 'right' })
}

test.describe('Arbor worktree context menu', () => {
  test.afterAll(() => {
    fs.rmSync(linkedPath, { recursive: true, force: true })
    fs.rmSync(stalePath, { recursive: true, force: true })
  })

  test('opens the smoke repository', async ({ mainWindow: page }) => {
    await openSmokeRepository(page)
  })

  test('shows the worktree dropdown once worktrees exist', async ({
    app,
    mainWindow: page,
  }) => {
    fs.rmSync(linkedPath, { recursive: true, force: true })
    fs.rmSync(stalePath, { recursive: true, force: true })
    git(['worktree', 'add', '-b', 'arbor-linked', linkedPath])
    git(['worktree', 'add', '-b', 'arbor-stale', stalePath])
    // Deleting the folder makes the worktree prunable.
    fs.rmSync(stalePath, { recursive: true, force: true })

    // The app refreshes the repository (and its worktrees) on focus.
    const worktreeButton = page.locator('.worktree-button')
    await expect
      .poll(
        async () => {
          await app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0]
            w.blur()
            w.focus()
          })
          return worktreeButton.isVisible()
        },
        { timeout: 30000 }
      )
      .toBe(true)

    await installMenuCapture(app)
  })

  test('lists the Arbor items for a linked worktree', async ({
    app,
    mainWindow: page,
  }) => {
    await rightClickWorktree(page, path.basename(linkedPath))
    const items = await getCapturedMenu(app)

    expect(getItem(items, 'Show in Explorer').enabled).toBe(true)
    expect(getItem(items, 'Open in shell').enabled).toBe(true)
    expect(getItem(items, 'Lock worktree').enabled).toBe(true)
    expect(
      items.some(
        i => i.label.startsWith('Open in') && i.label !== 'Open in shell'
      )
    ).toBe(true)
  })

  test('locks then unlocks a linked worktree', async ({
    app,
    mainWindow: page,
  }) => {
    await clickCapturedMenuItem(app, 'Lock worktree')
    await expect.poll(() => findWorktree(linkedPath)?.locked).toBe(true)

    await rightClickWorktree(page, path.basename(linkedPath))
    const items = await getCapturedMenu(app)
    expect(getItem(items, 'Unlock worktree').enabled).toBe(true)

    await clickCapturedMenuItem(app, 'Unlock worktree')
    await expect.poll(() => findWorktree(linkedPath)?.locked).toBe(false)
  })

  test('disables open actions for a missing worktree', async ({
    app,
    mainWindow: page,
  }) => {
    await rightClickWorktree(page, path.basename(stalePath))
    const items = await getCapturedMenu(app)

    expect(getItem(items, 'Show in Explorer').enabled).toBe(false)
    expect(getItem(items, 'Open in shell').enabled).toBe(false)
    await clearCapturedMenu(app)
  })

  test('prunes stale worktrees from the toolbar menu', async ({
    app,
    mainWindow: page,
  }) => {
    await page.keyboard.press('Escape')
    await page.locator('.worktree-button').click({ button: 'right' })
    const items = await getCapturedMenu(app)

    expect(getItem(items, 'Prune stale worktrees').enabled).toBe(true)
    await clickCapturedMenuItem(app, 'Prune stale worktrees')

    await expect.poll(() => findWorktree(stalePath)).toBeUndefined()
    expect(findWorktree(linkedPath)).toBeDefined()
  })
})
