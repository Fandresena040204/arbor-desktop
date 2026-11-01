import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getGitCredentialEndpoint,
  GitLabAccounts,
  normalizeInstanceUrl,
  OAuthRefresher,
} from '../../../../src/lib/arbor/gitlab/gitlab-accounts'

function fakeStores(
  options: { now?: number; refresher?: OAuthRefresher } = {}
) {
  const values = new Map<string, string>()
  const tokens = new Map<string, string>()
  const gitCredentials = new Map<string, string>()
  const refreshes = new Array<string>()

  const refresher: OAuthRefresher =
    options.refresher ??
    (async (_instance, _app, refreshToken) => {
      refreshes.push(refreshToken)
      return {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: (options.now ?? 0) + 7200_000,
      }
    })

  return {
    values,
    tokens,
    gitCredentials,
    refreshes,
    accounts: new GitLabAccounts(
      {
        getItem: k => values.get(k) ?? null,
        setItem: (k, v) => void values.set(k, v),
      },
      {
        setItem: async (k, l, v) => void tokens.set(`${k}|${l}`, v),
        getItem: async (k, l) => tokens.get(`${k}|${l}`) ?? null,
        deleteItem: async (k, l) => tokens.delete(`${k}|${l}`),
      },
      {
        set: async (e, u, p) => void gitCredentials.set(`${e}|${u}`, p),
        delete: async (e, u) => gitCredentials.delete(`${e}|${u}`),
      },
      refresher,
      () => options.now ?? 0
    ),
  }
}

const instanceUrl = 'https://git.example.org'
const ada = { instanceUrl, username: 'ada', name: 'Ada' }

describe('arbor/gitlab/gitlab-accounts', () => {
  it('normalizes instance URLs and computes Git credential endpoints', () => {
    assert.strictEqual(
      normalizeInstanceUrl(' gitlab.example.org/ '),
      'https://gitlab.example.org'
    )
    assert.strictEqual(
      normalizeInstanceUrl('http://host:8080/gitlab//'),
      'http://host:8080/gitlab'
    )
    // Git only sends the protocol and host to credential helpers.
    assert.strictEqual(
      getGitCredentialEndpoint('http://host:8080/gitlab'),
      'http://host:8080/'
    )
  })

  it('saves accounts with their token in the token store and for Git', async () => {
    const { accounts, tokens, gitCredentials } = fakeStores()
    await accounts.saveAccount(
      { ...ada, instanceUrl: 'git.example.org/' },
      'secret'
    )

    assert.deepStrictEqual(accounts.getAccounts(), [ada])
    assert.strictEqual(
      await accounts.getToken('https://GIT.example.org'),
      'secret'
    )
    // The token is never stored with the account list.
    assert.ok(!JSON.stringify(accounts.getAccounts()).includes('secret'))
    assert.strictEqual(tokens.size, 1)
    assert.deepStrictEqual(
      [...gitCredentials],
      [['https://git.example.org/|oauth2', 'secret']]
    )
  })

  it('knows gitlab.com and every signed in instance', async () => {
    const { accounts } = fakeStores()
    await accounts.saveAccount(ada, 't')
    assert.deepStrictEqual(accounts.getInstanceUrls(), [
      'https://gitlab.com',
      instanceUrl,
    ])
  })

  it('replaces the account of an instance and removes accounts', async () => {
    const { accounts, tokens, gitCredentials } = fakeStores()
    await accounts.saveAccount(ada, 'one')
    await accounts.saveAccount({ ...ada, username: 'bob', name: 'Bob' }, 'two')

    assert.deepStrictEqual(
      accounts.getAccounts().map(a => a.username),
      ['bob']
    )
    assert.strictEqual(await accounts.getToken(instanceUrl), 'two')
    assert.strictEqual(tokens.size, 1)
    assert.strictEqual(gitCredentials.size, 1)

    await accounts.removeAccount(instanceUrl)
    assert.deepStrictEqual(accounts.getAccounts(), [])
    assert.strictEqual(await accounts.getToken(instanceUrl), null)
    assert.strictEqual(tokens.size, 0)
    assert.strictEqual(gitCredentials.size, 0)
  })

  it('returns a valid OAuth access token without refreshing it', async () => {
    const { accounts, refreshes, gitCredentials } = fakeStores({ now: 1000 })
    await accounts.saveOAuthAccount(
      ada,
      {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: 1000 + 3600_000,
      },
      'app-id'
    )

    assert.deepStrictEqual(accounts.getAccounts(), [ada])
    assert.strictEqual(await accounts.getToken(instanceUrl), 'access')
    assert.deepStrictEqual(refreshes, [])
    assert.strictEqual(accounts.getApplicationId('git.example.org/'), 'app-id')
    assert.strictEqual(
      gitCredentials.get('https://git.example.org/|oauth2'),
      'access'
    )
  })

  it('refreshes an expired OAuth access token, for Git too', async () => {
    const { accounts, refreshes, gitCredentials } = fakeStores({ now: 10_000 })
    await accounts.saveOAuthAccount(
      ada,
      { accessToken: 'old', refreshToken: 'refresh', expiresAt: 5000 },
      'app-id'
    )

    assert.strictEqual(await accounts.getToken(instanceUrl), 'new-access')
    assert.deepStrictEqual(refreshes, ['refresh'])
    assert.strictEqual(
      gitCredentials.get('https://git.example.org/|oauth2'),
      'new-access'
    )
    // The new tokens are kept: no second refresh.
    assert.strictEqual(await accounts.getToken(instanceUrl), 'new-access')
    assert.deepStrictEqual(refreshes, ['refresh'])
  })

  it('ignores a corrupted account list', () => {
    const { accounts, values } = fakeStores()
    values.set('arbor-gitlab-accounts', '{not json')
    assert.deepStrictEqual(accounts.getAccounts(), [])
  })
})
