import { TokenStore } from '../../stores/token-store'

/** A GitLab account the user signed in with, on gitlab.com or self-hosted. */
export interface IGitLabAccount {
  /** Instance base URL without trailing slash, e.g. https://gitlab.com */
  readonly instanceUrl: string
  readonly username: string
  readonly name: string
}

/** Where accounts (not tokens) are kept; `localStorage` in the app. */
export interface IAccountStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Where tokens are kept; the OS credential store in the app. */
export interface ITokenStore {
  setItem(key: string, login: string, value: string): Promise<void>
  getItem(key: string, login: string): Promise<string | null>
  deleteItem(key: string, login: string): Promise<boolean>
}

const AccountsKey = 'arbor-gitlab-accounts'

/** The URL of gitlab.com, always known as a GitLab instance. */
export const GitLabDotComUrl = 'https://gitlab.com'

/** Normalize an instance URL: trimmed, no trailing slash, https by default. */
export function normalizeInstanceUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function tokenKey(instanceUrl: string) {
  return `Arbor GitLab - ${instanceUrl}`
}

/**
 * GitLab accounts: their list in `storage`, their personal access tokens in
 * the OS credential store, like GitHub Desktop does for GitHub tokens.
 */
export class GitLabAccounts {
  public constructor(
    private readonly storage: IAccountStorage = localStorage,
    private readonly tokens: ITokenStore = TokenStore
  ) {}

  /** Every saved account. */
  public getAccounts(): ReadonlyArray<IGitLabAccount> {
    try {
      const value = JSON.parse(this.storage.getItem(AccountsKey) ?? '[]')
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  /** The instances to recognize remotes of: gitlab.com and every account's. */
  public getInstanceUrls(): ReadonlyArray<string> {
    const urls = new Set([
      GitLabDotComUrl,
      ...this.getAccounts().map(a => a.instanceUrl),
    ])
    return [...urls]
  }

  /** The account of an instance, if the user signed in to it. */
  public findAccount(instanceUrl: string): IGitLabAccount | undefined {
    const url = normalizeInstanceUrl(instanceUrl).toLowerCase()
    return this.getAccounts().find(a => a.instanceUrl.toLowerCase() === url)
  }

  /** Save (or replace) the account of an instance and its token. */
  public async saveAccount(account: IGitLabAccount, token: string) {
    const instanceUrl = normalizeInstanceUrl(account.instanceUrl)
    const previous = this.findAccount(instanceUrl)
    if (previous !== undefined) {
      await this.removeAccount(previous.instanceUrl)
    }

    await this.tokens.setItem(tokenKey(instanceUrl), account.username, token)
    this.write([...this.getAccounts(), { ...account, instanceUrl }])
  }

  /** The token of an instance's account, or null. */
  public async getToken(instanceUrl: string): Promise<string | null> {
    const account = this.findAccount(instanceUrl)
    return account === undefined
      ? null
      : this.tokens.getItem(tokenKey(account.instanceUrl), account.username)
  }

  /** Forget an instance's account and delete its token. */
  public async removeAccount(instanceUrl: string) {
    const account = this.findAccount(instanceUrl)
    if (account === undefined) {
      return
    }
    await this.tokens.deleteItem(
      tokenKey(account.instanceUrl),
      account.username
    )
    this.write(
      this.getAccounts().filter(a => a.instanceUrl !== account.instanceUrl)
    )
  }

  private write(accounts: ReadonlyArray<IGitLabAccount>) {
    this.storage.setItem(AccountsKey, JSON.stringify(accounts))
  }
}
