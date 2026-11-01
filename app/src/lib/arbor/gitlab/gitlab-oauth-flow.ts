import { createHash, randomBytes } from 'crypto'

/**
 * Pure parts of GitLab's OAuth 2 authorization code flow with PKCE, shared by
 * the main process (which runs the flow) and the tests.
 */

/** The loopback port the redirect URI listens on. */
export const GitLabOAuthPort = 47901

/** The redirect URI to register in the GitLab application. */
export const GitLabOAuthRedirectUri = `http://127.0.0.1:${GitLabOAuthPort}/callback`

/** The access and refresh tokens of an OAuth sign-in. */
export interface IGitLabOAuthTokens {
  readonly accessToken: string
  readonly refreshToken: string
  /** When the access token expires, in milliseconds since the epoch. */
  readonly expiresAt: number
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** A random PKCE code verifier and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** A random value tying the callback to the request. */
export function createState(): string {
  return base64Url(randomBytes(16))
}

/** The URL of the instance's authorization page. */
export function buildAuthorizeUrl(
  instanceUrl: string,
  applicationId: string,
  state: string,
  challenge: string
): string {
  const url = new URL(`${instanceUrl.replace(/\/+$/, '')}/oauth/authorize`)
  url.searchParams.set('client_id', applicationId)
  url.searchParams.set('redirect_uri', GitLabOAuthRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('scope', 'api')
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** The URL of the instance's token endpoint. */
export function getTokenUrl(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/+$/, '')}/oauth/token`
}

/** The form body exchanging an authorization code for tokens. */
export function buildCodeExchangeBody(
  applicationId: string,
  code: string,
  verifier: string
): URLSearchParams {
  return new URLSearchParams({
    client_id: applicationId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: GitLabOAuthRedirectUri,
    code_verifier: verifier,
  })
}

/** The form body refreshing the tokens. */
export function buildRefreshBody(
  applicationId: string,
  refreshToken: string
): URLSearchParams {
  return new URLSearchParams({
    client_id: applicationId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    redirect_uri: GitLabOAuthRedirectUri,
  })
}

/** Read GitLab's token response. Throws when it isn't a successful one. */
export function parseTokenResponse(
  json: unknown,
  now: number = Date.now()
): IGitLabOAuthTokens {
  const value = (json ?? {}) as Record<string, unknown>
  if (typeof value.access_token !== 'string') {
    const reason =
      typeof value.error_description === 'string'
        ? value.error_description
        : typeof value.error === 'string'
        ? value.error
        : 'No access token in the response'
    throw new Error(`GitLab sign-in failed: ${reason}`)
  }

  // GitLab's access tokens last two hours unless it says otherwise.
  const expiresIn =
    typeof value.expires_in === 'number' ? value.expires_in : 7200
  return {
    accessToken: value.access_token,
    refreshToken:
      typeof value.refresh_token === 'string' ? value.refresh_token : '',
    expiresAt: now + expiresIn * 1000,
  }
}

/**
 * Read the authorization callback's query. Returns the code, or throws when
 * the user denied access or the state doesn't match.
 */
export function parseCallback(callbackUrl: string, expectedState: string) {
  const url = new URL(callbackUrl, GitLabOAuthRedirectUri)
  const error = url.searchParams.get('error')
  if (error !== null) {
    throw new Error(
      `GitLab sign-in failed: ${
        url.searchParams.get('error_description') ?? error
      }`
    )
  }
  if (url.searchParams.get('state') !== expectedState) {
    throw new Error('GitLab sign-in failed: unexpected state')
  }
  const code = url.searchParams.get('code')
  if (code === null || code.length === 0) {
    throw new Error('GitLab sign-in failed: no authorization code')
  }
  return code
}
