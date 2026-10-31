import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  GitLabAccounts,
  normalizeInstanceUrl,
} from '../../../../src/lib/arbor/gitlab/gitlab-accounts'

function fakeStores() {
  const values = new Map<string, string>()
  const tokens = new Map<string, string>()
  return {
    tokens,
    accounts: new GitLabAccounts(
      {
        getItem: k => values.get(k) ?? null,
        setItem: (k, v) => void values.set(k, v),
      },
      {
        setItem: async (k, l, v) => void tokens.set(`${k}|${l}`, v),
        getItem: async (k, l) => tokens.get(`${k}|${l}`) ?? null,
        deleteItem: async (k, l) => tokens.delete(`${k}|${l}`),
      }
    ),
  }
}

describe('arbor/gitlab/gitlab-accounts', () => {
  it('normalizes instance URLs', () => {
    assert.strictEqual(
      normalizeInstanceUrl(' gitlab.example.org/ '),
      'https://gitlab.example.org'
    )
    assert.strictEqual(
      normalizeInstanceUrl('http://host:8080/gitlab//'),
      'http://host:8080/gitlab'
    )
  })

  it('saves accounts with their token in the token store', async () => {
    const { accounts, tokens } = fakeStores()
    await accounts.saveAccount(
      { instanceUrl: 'git.example.org/', username: 'ada', name: 'Ada' },
      'secret'
    )

    assert.deepStrictEqual(accounts.getAccounts(), [
      { instanceUrl: 'https://git.example.org', username: 'ada', name: 'Ada' },
    ])
    assert.strictEqual(
      await accounts.getToken('https://GIT.example.org'),
      'secret'
    )
    // The token is never stored with the account list.
    assert.ok(!JSON.stringify(accounts.getAccounts()).includes('secret'))
    assert.strictEqual(tokens.size, 1)
  })

  it('knows gitlab.com and every signed in instance', async () => {
    const { accounts } = fakeStores()
    await accounts.saveAccount(
      { instanceUrl: 'https://git.example.org', username: 'ada', name: 'Ada' },
      't'
    )
    assert.deepStrictEqual(accounts.getInstanceUrls(), [
      'https://gitlab.com',
      'https://git.example.org',
    ])
  })

  it('replaces the account of an instance and removes accounts', async () => {
    const { accounts, tokens } = fakeStores()
    const instanceUrl = 'https://git.example.org'
    await accounts.saveAccount(
      { instanceUrl, username: 'ada', name: 'Ada' },
      'one'
    )
    await accounts.saveAccount(
      { instanceUrl, username: 'bob', name: 'Bob' },
      'two'
    )

    assert.deepStrictEqual(
      accounts.getAccounts().map(a => a.username),
      ['bob']
    )
    assert.strictEqual(await accounts.getToken(instanceUrl), 'two')
    assert.strictEqual(tokens.size, 1)

    await accounts.removeAccount(instanceUrl)
    assert.deepStrictEqual(accounts.getAccounts(), [])
    assert.strictEqual(await accounts.getToken(instanceUrl), null)
    assert.strictEqual(tokens.size, 0)
  })

  it('ignores a corrupted account list', () => {
    const accounts = new GitLabAccounts(
      { getItem: () => '{not json', setItem: () => {} },
      {
        setItem: async () => {},
        getItem: async () => null,
        deleteItem: async () => false,
      }
    )
    assert.deepStrictEqual(accounts.getAccounts(), [])
  })
})
