/* eslint-disable no-sync */

/**
 * Arbor: E2E test of the GitLab dialog (Repository > GitLab…) against a fake
 * self-hosted GitLab instance served from the test process.
 */

import * as http from 'http'
import { AddressInfo } from 'net'
import { execFileSync } from 'child_process'
import type { Page } from '@playwright/test'
import { test, expect } from './e2e-fixtures'
import { smokeRepoPath } from './test-helpers'
import { clickAppMenuItem, openSmokeRepository } from './arbor-helpers'

test.describe.configure({ mode: 'serial' })

const token = 'glpat-arbor-e2e'
const branch = 'feature/add-login'
const projectPath = 'group/sub/project'

interface IRecordedRequest {
  readonly method: string
  readonly url: string
  readonly body: any
}

/** A fake GitLab instance, answering like GitLab's API v4 (including CORS). */
function createFakeGitLab() {
  const requests = new Array<IRecordedRequest>()
  const mergeRequests = new Array<Record<string, unknown>>()
  const notes = new Array<Record<string, unknown>>()
  let approved = false
  let baseUrl = ''

  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }

    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', baseUrl)
      const isForm = (req.headers['content-type'] ?? '').includes(
        'application/x-www-form-urlencoded'
      )
      const body =
        raw.length === 0
          ? null
          : isForm
          ? Object.fromEntries(new URLSearchParams(raw))
          : JSON.parse(raw)
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify(json))
      }

      requests.push({
        method: req.method ?? '',
        url: url.pathname + url.search,
        body,
      })

      // OAuth: the authorization page approves right away and sends the
      // browser back to Arbor's loopback redirect URI.
      if (url.pathname === '/oauth/authorize') {
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '')
        redirect.searchParams.set('code', 'oauth-code')
        redirect.searchParams.set('state', url.searchParams.get('state') ?? '')
        res.writeHead(302, { Location: redirect.toString() })
        res.end()
        return
      }
      if (url.pathname === '/oauth/token') {
        const valid =
          body?.grant_type === 'authorization_code' &&
          body?.code === 'oauth-code' &&
          body?.client_id === 'arbor-e2e-app' &&
          typeof body?.code_verifier === 'string'
        send(
          valid ? 200 : 400,
          valid
            ? {
                access_token: token,
                refresh_token: 'refresh',
                expires_in: 7200,
              }
            : { error: 'invalid_grant' }
        )
        return
      }

      if (req.headers.authorization !== `Bearer ${token}`) {
        send(401, { message: '401 Unauthorized' })
        return
      }

      const project = `/api/v4/projects/${encodeURIComponent(projectPath)}`
      const path = url.pathname

      if (path === '/api/v4/user') {
        send(200, {
          id: 1,
          username: 'arbor',
          name: 'Arbor E2E',
          avatar_url: '',
        })
      } else if (path === project) {
        send(200, {
          id: 42,
          path_with_namespace: projectPath,
          web_url: `${baseUrl}/${projectPath}`,
          default_branch: 'master',
        })
      } else if (
        path === `${project}/merge_requests` &&
        req.method === 'POST'
      ) {
        const mr = {
          iid: mergeRequests.length + 1,
          title: body.title,
          state: 'opened',
          source_branch: body.source_branch,
          target_branch: body.target_branch,
          web_url: `${baseUrl}/${projectPath}/-/merge_requests/${
            mergeRequests.length + 1
          }`,
          author: { username: 'arbor' },
          draft: false,
        }
        mergeRequests.push(mr)
        send(201, mr)
      } else if (path === `${project}/merge_requests`) {
        const source = url.searchParams.get('source_branch')
        send(
          200,
          mergeRequests.filter(
            m => source === null || m.source_branch === source
          )
        )
      } else if (path === `${project}/merge_requests/1`) {
        send(200, {
          ...mergeRequests[0],
          description: 'Adds the login page.',
          has_conflicts: false,
          detailed_merge_status: 'mergeable',
        })
      } else if (path === `${project}/merge_requests/1/approvals`) {
        send(200, {
          approved,
          approvals_required: 1,
          approvals_left: approved ? 0 : 1,
          approved_by: approved ? [{ user: { username: 'arbor' } }] : [],
          user_has_approved: approved,
          user_can_approve: true,
        })
      } else if (path === `${project}/merge_requests/1/approve`) {
        approved = true
        send(201, {})
      } else if (path === `${project}/merge_requests/1/unapprove`) {
        approved = false
        send(201, {})
      } else if (
        path === `${project}/merge_requests/1/notes` &&
        req.method === 'POST'
      ) {
        const note = {
          id: notes.length + 1,
          body: body.body,
          author: { username: 'arbor' },
          created_at: new Date().toISOString(),
          system: false,
        }
        notes.push(note)
        send(201, note)
      } else if (path === `${project}/merge_requests/1/notes`) {
        send(200, [
          {
            id: 100,
            body: 'added 1 commit',
            author: { username: 'arbor' },
            created_at: new Date().toISOString(),
            system: true,
          },
          ...notes,
        ])
      } else if (
        path === `${project}/pipelines` &&
        url.searchParams.has('sha')
      ) {
        send(200, [
          {
            id: 8,
            status: 'failed',
            ref: branch,
            sha: url.searchParams.get('sha'),
            web_url: `${baseUrl}/${projectPath}/-/pipelines/8`,
          },
        ])
      } else if (path === `${project}/pipelines`) {
        send(200, [
          {
            id: 7,
            status: 'success',
            ref: url.searchParams.get('ref'),
            sha: 'abcdef1234567890',
            web_url: `${baseUrl}/${projectPath}/-/pipelines/7`,
          },
        ])
      } else if (path === `${project}/issues`) {
        send(200, [
          {
            iid: 3,
            title: 'Arbor issue',
            state: 'opened',
            web_url: `${baseUrl}/${projectPath}/-/issues/3`,
          },
        ])
      } else {
        send(404, { message: '404 Not Found' })
      }
    })
  })

  return {
    requests,
    get baseUrl() {
      return baseUrl
    },
    start: () =>
      new Promise<void>(resolve =>
        server.listen(0, '127.0.0.1', () => {
          baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
          resolve()
        })
      ),
    stop: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

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
