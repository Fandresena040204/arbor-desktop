import assert from 'node:assert'
import { createHash } from 'crypto'
import { describe, it } from 'node:test'
import {
  buildAuthorizeUrl,
  buildCodeExchangeBody,
  buildRefreshBody,
  createPkcePair,
  createState,
  GitLabOAuthRedirectUri,
  getTokenUrl,
  parseCallback,
  parseTokenResponse,
} from '../../../../src/lib/arbor/gitlab/gitlab-oauth-flow'

describe('arbor/gitlab/gitlab-oauth-flow', () => {
  it('creates a PKCE pair whose challenge is the S256 of the verifier', () => {
    const { verifier, challenge } = createPkcePair()
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/)
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    assert.strictEqual(challenge, expected)
    assert.notStrictEqual(createPkcePair().verifier, verifier)
    assert.notStrictEqual(createState(), createState())
  })

  it('builds the authorization URL', () => {
    const url = new URL(
      buildAuthorizeUrl('https://git.example.org/gitlab/', 'app-id', 's', 'c')
    )
    assert.strictEqual(
      url.origin + url.pathname,
      'https://git.example.org/gitlab/oauth/authorize'
    )
    assert.deepStrictEqual(Object.fromEntries(url.searchParams), {
      client_id: 'app-id',
      redirect_uri: GitLabOAuthRedirectUri,
      response_type: 'code',
      state: 's',
      scope: 'api',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    })
    assert.strictEqual(
      getTokenUrl('https://gitlab.com/'),
      'https://gitlab.com/oauth/token'
    )
  })

  it('builds the token request bodies', () => {
    assert.deepStrictEqual(
      Object.fromEntries(buildCodeExchangeBody('id', 'code', 'verifier')),
      {
        client_id: 'id',
        code: 'code',
        grant_type: 'authorization_code',
        redirect_uri: GitLabOAuthRedirectUri,
        code_verifier: 'verifier',
      }
    )
    assert.strictEqual(
      buildRefreshBody('id', 'r').get('grant_type'),
      'refresh_token'
    )
  })

  it('parses token responses', () => {
    assert.deepStrictEqual(
      parseTokenResponse(
        { access_token: 'a', refresh_token: 'r', expires_in: 60 },
        1000
      ),
      { accessToken: 'a', refreshToken: 'r', expiresAt: 61000 }
    )
    assert.strictEqual(
      parseTokenResponse({ access_token: 'a' }, 0).expiresAt,
      7200 * 1000
    )
    assert.throws(
      () =>
        parseTokenResponse({
          error: 'invalid_grant',
          error_description: 'expired',
        }),
      /expired/
    )
  })

  it('reads the callback', () => {
    assert.strictEqual(parseCallback('/callback?code=abc&state=s', 's'), 'abc')
    assert.throws(
      () => parseCallback('/callback?code=abc&state=x', 's'),
      /state/
    )
    assert.throws(
      () => parseCallback('/callback?error=access_denied&state=s', 's'),
      /access_denied/
    )
    assert.throws(
      () => parseCallback('/callback?state=s', 's'),
      /no authorization code/
    )
  })
})
