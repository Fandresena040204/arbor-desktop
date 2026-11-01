import * as http from 'http'
import { shell } from 'electron'
import * as ipcMain from '../ipc-main'
import { ArborGitLabOAuthResult } from '../../lib/ipc-shared'
import {
  buildAuthorizeUrl,
  buildCodeExchangeBody,
  buildRefreshBody,
  createPkcePair,
  createState,
  GitLabOAuthPort,
  getTokenUrl,
  parseCallback,
  parseTokenResponse,
} from '../../lib/arbor/gitlab/gitlab-oauth-flow'

/**
 * Arbor: runs GitLab's OAuth authorization code flow with PKCE. The browser
 * is sent to the instance's authorization page and comes back to a loopback
 * server; the code is then exchanged here, in the main process, where the
 * token endpoint isn't subject to the renderer's CORS rules.
 */

/** How long to wait for the user to authorize Arbor in the browser. */
const SignInTimeout = 5 * 60 * 1000

const CallbackPage = `<!doctype html><meta charset="utf-8"><title>Arbor</title>
<body style="font-family:sans-serif;padding:2em">
<h1>Signed in to GitLab</h1><p>You can close this tab and go back to Arbor.</p>`

/** Cancels the sign-in in progress, if any. */
let cancelPending: ((reason: Error) => void) | null = null

async function requestTokens(
  instanceUrl: string,
  body: URLSearchParams
): Promise<ArborGitLabOAuthResult> {
  try {
    const response = await fetch(getTokenUrl(instanceUrl), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    })
    return { tokens: parseTokenResponse(await response.json()) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Wait for the browser to come back with the code; `cancel` stops waiting. */
function waitForCode(state: string) {
  // A new sign-in replaces one the user gave up on.
  cancelPending?.(new Error('GitLab sign-in was replaced by a new one'))

  let cancel: (reason: Error) => void = () => {}
  const code = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const code = parseCallback(req.url, state)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(CallbackPage)
        resolve(code)
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(e instanceof Error ? e.message : String(e))
        reject(e)
      }
      finish()
    })
    const timer = setTimeout(() => {
      reject(new Error('GitLab sign-in timed out'))
      finish()
    }, SignInTimeout)
    const finish = () => {
      clearTimeout(timer)
      server.close()
      if (cancelPending === cancel) {
        cancelPending = null
      }
    }
    cancel = (reason: Error) => {
      reject(reason)
      finish()
    }

    server.on('error', e => {
      reject(e)
      finish()
    })
    server.listen(GitLabOAuthPort, '127.0.0.1')
    cancelPending = cancel
  })
  return { code, cancel }
}

/** Register the IPC handlers of GitLab OAuth. */
export function registerArborGitLabOAuthHost() {
  ipcMain.handle(
    'arbor-gitlab-oauth-start',
    async (_, instanceUrl, applicationId) => {
      const { verifier, challenge } = createPkcePair()
      const state = createState()

      const { code, cancel } = waitForCode(state)
      try {
        await shell.openExternal(
          buildAuthorizeUrl(instanceUrl, applicationId, state, challenge)
        )
        return requestTokens(
          instanceUrl,
          buildCodeExchangeBody(applicationId, await code, verifier)
        )
      } catch (e) {
        cancel(e instanceof Error ? e : new Error(String(e)))
        code.catch(() => {})
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'arbor-gitlab-oauth-refresh',
    (_, instanceUrl, applicationId, refreshToken) =>
      requestTokens(instanceUrl, buildRefreshBody(applicationId, refreshToken))
  )
}
