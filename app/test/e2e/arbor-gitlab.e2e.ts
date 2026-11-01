/* eslint-disable no-sync */

/**
 * Arbor: E2E test of the GitLab dialog (Repository > GitLab…) against a fake
 * self-hosted GitLab instance served from the test process.
 */

import { execFileSync } from 'child_process'
import type { Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import {
  branch,
  createFakeGitLab,
  projectPath,
  token,
} from './arbor-fake-gitlab'
import { clickAppMenuItem, openSmokeRepository } from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

function git(args: ReadonlyArray<string>) {
  return execFileSync('git', [...args], {
    cwd: smokeRepoPath,
    encoding: 'utf8',
  }).trim()
}

function dialog(page: Page) {
  return page.locator('dialog#arbor-gitlab')
}

test.describe('Arbor GitLab', () => {
  const gitlab = createFakeGitLab()
  let previousBranch = ''

  test.beforeAll(() => gitlab.start())
  test.afterAll(async ({ app }) => {
    await gitlab.stop()
    git(['checkout', previousBranch])
    git(['remote', 'remove', 'gitlab'])
    // Let Desktop notice the checkout before the next test file.
    await app.evaluate(({ BrowserWindow }) => {
      // eslint-disable-next-line no-loosely-typed-webcontents-ipc
      BrowserWindow.getAllWindows()[0].webContents.send('focus')
    })
  })

  test('prepares a repository with a self-hosted GitLab remote', async ({
    app,
    mainWindow: page,
  }) => {
    await openSmokeRepository(page)
    previousBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    git(['remote', 'add', 'gitlab', `${gitlab.baseUrl}/${projectPath}.git`])
    git(['checkout', '-b', branch])
    await app.evaluate(({ BrowserWindow }) => {
      // eslint-disable-next-line no-loosely-typed-webcontents-ipc
      BrowserWindow.getAllWindows()[0].webContents.send('focus')
    })
  })

  test('asks for the unknown instance, then for a token', async ({
    app,
    mainWindow: page,
  }) => {
    await clickAppMenuItem(app, 'arbor-gitlab')
    await dialog(page).waitFor({ state: 'visible', timeout: 15000 })

    await expect(dialog(page).locator('.arbor-gitlab-no-remote')).toBeVisible({
      timeout: 15000,
    })
    await dialog(page).getByLabel('GitLab instance URL').fill(gitlab.baseUrl)
    await dialog(page)
      .getByRole('button', { name: 'Use this instance' })
      .click()

    await expect(dialog(page).locator('.arbor-gitlab-sign-in')).toBeVisible({
      timeout: 15000,
    })
  })

  test('rejects a wrong token and signs in with the right one', async ({
    mainWindow: page,
  }) => {
    const tokenBox = dialog(page).locator('input[type="password"]')
    await tokenBox.fill('wrong')
    await dialog(page)
      .getByRole('button', { name: 'Sign in', exact: true })
      .click()
    await expect(dialog(page)).toContainText(/invalid token/i, {
      timeout: 15000,
    })

    await tokenBox.fill(token)
    await dialog(page)
      .getByRole('button', { name: 'Sign in', exact: true })
      .click()
    await expect(dialog(page).locator('.arbor-gitlab-header')).toContainText(
      '@arbor',
      { timeout: 15000 }
    )
    await expect(dialog(page).locator('.arbor-gitlab-header')).toContainText(
      projectPath
    )
  })

  test('creates a merge request for the current branch', async ({
    mainWindow: page,
  }) => {
    const form = dialog(page).locator('.arbor-gitlab-create-mr')
    await expect(form).toBeVisible({ timeout: 15000 })
    await expect(form.getByLabel('Title')).toHaveValue('Add login')
    await form.getByRole('button', { name: 'Create merge request' }).click()

    await expect(
      dialog(page).locator('.arbor-gitlab-current-mr')
    ).toContainText('Add login', { timeout: 15000 })
    const created = gitlab.requests.find(r => r.method === 'POST')
    expect(created?.body).toMatchObject({
      source_branch: branch,
      target_branch: 'master',
      title: 'Add login',
    })
    await dialog(page).screenshot({
      path: test.info().outputPath('arbor-gitlab.png'),
    })
  })

  test('shows the pipeline and the issues', async ({ mainWindow: page }) => {
    await dialog(page).getByText('Pipeline', { exact: true }).click()
    await expect(dialog(page).locator('.arbor-gitlab-pipeline')).toContainText(
      /success/i,
      { timeout: 15000 }
    )

    await dialog(page).getByText('Issues', { exact: true }).click()
    await expect(dialog(page).locator('.arbor-gitlab-issue')).toContainText(
      'Arbor issue',
      { timeout: 15000 }
    )
  })

  test('gives the token to Git for push and pull', async ({
    mainWindow: page,
  }) => {
    const endpoint = `${gitlab.baseUrl}/`
    expect(
      await page.evaluate(
        e => localStorage.getItem(`genericGitAuth/username/${e}`),
        endpoint
      )
    ).toBe('oauth2')
  })

  test('reviews the merge request', async ({ mainWindow: page }) => {
    await dialog(page).getByText('Merge requests', { exact: true }).click()
    await dialog(page).locator('.arbor-gitlab-mr-summary').click()

    const detail = dialog(page).locator('.arbor-gitlab-mr-detail')
    await expect(detail).toContainText('Adds the login page.', {
      timeout: 15000,
    })
    await expect(detail.locator('.arbor-gitlab-approvals')).toContainText(
      /1 approval required/i
    )

    await detail.locator('.arbor-gitlab-approve').click()
    await expect(detail.locator('.arbor-gitlab-approvals')).toContainText(
      'Approved by @arbor',
      { timeout: 15000 }
    )
    await expect(detail.locator('.arbor-gitlab-revoke-approval')).toBeVisible()

    // System notes (events) are not listed as comments.
    await expect(detail.locator('.arbor-gitlab-note')).toHaveCount(0)
    await detail.locator('.arbor-gitlab-note-draft').fill('Looks good!')
    await detail.locator('.arbor-gitlab-add-note-button').click()
    await expect(detail.locator('.arbor-gitlab-note')).toContainText(
      'Looks good!',
      { timeout: 15000 }
    )
    await dialog(page).screenshot({
      path: test.info().outputPath('arbor-gitlab-review.png'),
    })
  })

  test('signs out, which removes the Git credential', async ({
    mainWindow: page,
  }) => {
    // Signing out also removes the token from the OS credential store.
    await dialog(page).getByRole('button', { name: 'Sign out' }).click()
    await expect(dialog(page).locator('.arbor-gitlab-sign-in')).toBeVisible({
      timeout: 15000,
    })
    expect(
      await page.evaluate(
        e => localStorage.getItem(`genericGitAuth/username/${e}`),
        `${gitlab.baseUrl}/`
      )
    ).toBeNull()
  })

  test('signs in with the browser (OAuth)', async ({
    app,
    mainWindow: page,
  }) => {
    // Stand in for the browser: follow the authorization page's redirect to
    // Arbor's loopback redirect URI.
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (target: string) => {
        await fetch(target)
      }
    })

    const oauth = dialog(page).locator('.arbor-gitlab-oauth')
    await oauth
      .locator('.arbor-gitlab-application-id input')
      .fill('arbor-e2e-app')
    await oauth.locator('.arbor-gitlab-oauth-sign-in').click()

    await expect(dialog(page).locator('.arbor-gitlab-header')).toContainText(
      '@arbor',
      { timeout: 30000 }
    )
    const exchange = gitlab.requests.find(r => r.url === '/oauth/token')
    expect(exchange?.body?.code_verifier).toBeTruthy()
  })

  test('shows pipeline statuses in the graph', async ({ mainWindow: page }) => {
    await page.keyboard.press('Escape')
    await dialog(page).waitFor({ state: 'hidden', timeout: 15000 })

    const graph = page.locator('.arbor-graph-view')
    if ((await graph.count()) === 0) {
      await page.getByRole('button', { name: 'Graph', exact: true }).click()
    }
    await graph.getByRole('button', { name: 'Refresh graph' }).click()

    const tip = graph
      .locator('.arbor-graph-row')
      .filter({ has: page.locator('.arbor-graph-ref', { hasText: branch }) })
    await expect(tip.locator('.arbor-graph-pipeline.failed')).toHaveCount(1, {
      timeout: 15000,
    })
  })

  test('signs out and closes', async ({ app, mainWindow: page }) => {
    await clickAppMenuItem(app, 'arbor-gitlab')
    await dialog(page).waitFor({ state: 'visible', timeout: 15000 })
    await dialog(page).getByRole('button', { name: 'Sign out' }).click()
    await expect(dialog(page).locator('.arbor-gitlab-sign-in')).toBeVisible({
      timeout: 15000,
    })
    await page.keyboard.press('Escape')
    await dialog(page).waitFor({ state: 'hidden', timeout: 15000 })
  })
})
