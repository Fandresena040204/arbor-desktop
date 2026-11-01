/**
 * Arbor: a fake GitLab instance for E2E tests, answering like GitLab's API v4
 * (including CORS and OAuth), served from the test process.
 */

import * as http from 'http'
import { AddressInfo } from 'net'

export const token = 'glpat-arbor-e2e'
export const branch = 'feature/add-login'
export const projectPath = 'group/sub/project'

interface IRecordedRequest {
  readonly method: string
  readonly url: string
  readonly body: any
}

/** A fake GitLab instance, answering like GitLab's API v4 (including CORS). */
export function createFakeGitLab() {
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
