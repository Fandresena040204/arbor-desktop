import { TokenStore } from '../../stores/token-store'
import {
  deleteGenericCredential,
  setGenericCredential,
} from '../../generic-git-auth'
import { IGitLabOAuthTokens } from './gitlab-oauth-flow'

/** A GitLab account the user signed in with, on gitlab.com or self-hosted. */
export interface IGitLabAccount {
  /** Instance base URL without trailing slash, e.g. https://gitlab.com */
  readonly instanceUrl: string
  readonly username: string
  readonly name: string
}

/** How an account authenticates, kept with the account (no secrets). */
interface IStoredGitLabAccount extends IGitLabAccount {
  readonly auth?: 'token' | 'oauth'
  /** OAuth: the GitLab application the tokens belong to. */
  readonly applicationId?: string
  /** OAuth: when the access token expires, in ms since the epoch. */
  readonly expiresAt?: number
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

/**
 * Where Git finds credentials for HTTPS remotes: Desktop's generic Git
 * credentials, which its credential helper hands to Git on push/pull.
 */
export interface IGitCredentials {
  set(endpoint: string, username: string, password: string): Promise<void>
  delete(endpoint: string, username: string): Promise<unknown>
}

/** Exchanges a refresh token for new OAuth tokens. */
export type OAuthRefresher = (
  instanceUrl: string,
  applicationId: string,
  refreshToken: string
) => Promise<IGitLabOAuthTokens>

const AccountsKey = 'arbor-gitlab-accounts'
const ApplicationIdsKey = 'arbor-gitlab-oauth-application-ids'

/** Refresh OAuth access tokens this long before they expire. */
const RefreshMargin = 60 * 1000

/**
 * The username Git uses with a GitLab token: GitLab accepts any username
 * along with a personal access or OAuth token, and documents `oauth2`.
 */
export const GitLabGitUsername = 'oauth2'

/** The URL of gitlab.com, always known as a GitLab instance. */
export const GitLabDotComUrl = 'https://gitlab.com'

/** Normalize an instance URL: trimmed, no trailing slash, https by default. */
export function normalizeInstanceUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * The endpoint Desktop's credential helper looks credentials up by for the
 * remotes of an instance: Git only sends the protocol and host.
 */
export function getGitCredentialEndpoint(instanceUrl: string): string {
  return `${new URL(normalizeInstanceUrl(instanceUrl)).origin}/`
}

function tokenKey(instanceUrl: string) {
  return `Arbor GitLab - ${instanceUrl}`
}

const defaultGitCredentials: IGitCredentials = {
  set: (endpoint, username, password) =>
    setGenericCredential(endpoint, username, password),
  delete: (endpoint, username) => deleteGenericCredential(endpoint, username),
}

const defaultRefresher: OAuthRefresher = async (...args) =>
  (await import('./gitlab-oauth')).refreshGitLabOAuth(...args)

/**
 * GitLab accounts: their list in `storage`, their tokens in the OS credential
 * store, like GitHub Desktop does for GitHub tokens. The token is also given
 * to Git, so pushing to and pulling from the instance over HTTPS just works.
 */
export class GitLabAccounts {
  public constructor(
    private readonly storage: IAccountStorage = localStorage,
    private readonly tokens: ITokenStore = TokenStore,
    private readonly gitCredentials: IGitCredentials = defaultGitCredentials,
    private readonly refreshOAuth: OAuthRefresher = defaultRefresher,
    private readonly now: () => number = Date.now
  ) {}

  /** Every saved account. */
  public getAccounts(): ReadonlyArray<IGitLabAccount> {
    return this.getStoredAccounts().map(a => ({
      instanceUrl: a.instanceUrl,
      username: a.username,
      name: a.name,
    }))
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
    const stored = this.findStoredAccount(instanceUrl)
    return stored === undefined
      ? undefined
      : this.getAccounts().find(a => a.instanceUrl === stored.instanceUrl)
  }

  /** Save (or replace) the account of an instance and its access token. */
  public async saveAccount(account: IGitLabAccount, token: string) {
    await this.save({ ...account, auth: 'token' }, token, token)
  }

  /** Save (or replace) an account signed in with OAuth. */
  public async saveOAuthAccount(
    account: IGitLabAccount,
    tokens: IGitLabOAuthTokens,
    applicationId: string
  ) {
    const instanceUrl = normalizeInstanceUrl(account.instanceUrl)
    const ids = this.readApplicationIds()
    this.storage.setItem(
      ApplicationIdsKey,
      JSON.stringify({ ...ids, [instanceUrl.toLowerCase()]: applicationId })
    )

    await this.save(
      {
        ...account,
        auth: 'oauth',
        applicationId,
        expiresAt: tokens.expiresAt,
      },
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      }),
      tokens.accessToken
    )
  }

  /** The OAuth application last used with an instance, to prefill it. */
  public getApplicationId(instanceUrl: string): string | null {
    const url = normalizeInstanceUrl(instanceUrl).toLowerCase()
    return this.readApplicationIds()[url] ?? null
  }

  /**
   * A usable token for an instance's account, or null. OAuth access tokens
   * about to expire are refreshed first.
   */
  public async getToken(instanceUrl: string): Promise<string | null> {
    const account = this.findStoredAccount(instanceUrl)
    if (account === undefined) {
      return null
    }

    const secret = await this.tokens.getItem(
      tokenKey(account.instanceUrl),
      account.username
    )
    if (secret === null || account.auth !== 'oauth') {
      return secret
    }

    let stored: { accessToken: string; refreshToken: string }
    try {
      stored = JSON.parse(secret)
    } catch {
      return null
    }

    if ((account.expiresAt ?? 0) - RefreshMargin > this.now()) {
      return stored.accessToken
    }

    if (account.applicationId === undefined || stored.refreshToken === '') {
      return null
    }
    const tokens = await this.refreshOAuth(
      account.instanceUrl,
      account.applicationId,
      stored.refreshToken
    )
    await this.saveOAuthAccount(account, tokens, account.applicationId)
    return tokens.accessToken
  }

  /** Forget an instance's account and delete its token. */
  public async removeAccount(instanceUrl: string) {
    const account = this.findStoredAccount(instanceUrl)
    if (account === undefined) {
      return
    }
    await this.tokens.deleteItem(
      tokenKey(account.instanceUrl),
      account.username
    )
    await this.gitCredentials.delete(
      getGitCredentialEndpoint(account.instanceUrl),
      GitLabGitUsername
    )
    this.write(
      this.getStoredAccounts().filter(
        a => a.instanceUrl !== account.instanceUrl
      )
    )
  }

  private async save(
    account: IStoredGitLabAccount,
    secret: string,
    gitPassword: string
  ) {
    const instanceUrl = normalizeInstanceUrl(account.instanceUrl)
    const previous = this.findStoredAccount(instanceUrl)
    if (previous !== undefined) {
      await this.removeAccount(previous.instanceUrl)
    }

    await this.tokens.setItem(tokenKey(instanceUrl), account.username, secret)
    await this.gitCredentials.set(
      getGitCredentialEndpoint(instanceUrl),
      GitLabGitUsername,
      gitPassword
    )
    this.write([...this.getStoredAccounts(), { ...account, instanceUrl }])
  }

  private findStoredAccount(
    instanceUrl: string
  ): IStoredGitLabAccount | undefined {
    const url = normalizeInstanceUrl(instanceUrl).toLowerCase()
    return this.getStoredAccounts().find(
      a => a.instanceUrl.toLowerCase() === url
    )
  }

  private getStoredAccounts(): ReadonlyArray<IStoredGitLabAccount> {
    try {
      const value = JSON.parse(this.storage.getItem(AccountsKey) ?? '[]')
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  private readApplicationIds(): Record<string, string> {
    try {
      const value = JSON.parse(this.storage.getItem(ApplicationIdsKey) ?? '{}')
      return typeof value === 'object' && value !== null ? value : {}
    } catch {
      return {}
    }
  }

  private write(accounts: ReadonlyArray<IStoredGitLabAccount>) {
    this.storage.setItem(AccountsKey, JSON.stringify(accounts))
  }
}
