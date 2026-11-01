import * as React from 'react'
import {
  GitLabAccounts,
  GitLabDotComUrl,
  normalizeInstanceUrl,
} from '../../../lib/arbor/gitlab/gitlab-accounts'
import { GitLabAPI, GitLabAPIError } from '../../../lib/arbor/gitlab/gitlab-api'
import {
  GitLabOAuthRedirectUri,
  signInWithGitLabOAuth,
} from '../../../lib/arbor/gitlab/gitlab-oauth'
import { Button } from '../../lib/button'
import { TextBox } from '../../lib/text-box'
import { Loading } from '../../lib/loading'

interface IGitLabWelcomeSignInProps {
  /** Called once signed in. */
  readonly onSignedIn: () => void
  readonly onCancel: () => void
}

interface IGitLabWelcomeSignInState {
  readonly instanceUrl: string
  readonly token: string
  readonly applicationId: string
  readonly busy: 'token' | 'browser' | null
  readonly error: string | null
}

function describeError(e: unknown): string {
  if (e instanceof GitLabAPIError && e.status === 401) {
    return 'Invalid token. Check that it has the api scope and hasn’t expired.'
  }
  return e instanceof Error ? e.message : String(e)
}

/**
 * Arbor: the welcome flow step to sign in to GitLab (gitlab.com or a
 * self-hosted instance), with a personal access token or with the browser.
 */
export class GitLabWelcomeSignIn extends React.Component<
  IGitLabWelcomeSignInProps,
  IGitLabWelcomeSignInState
> {
  private readonly accounts = new GitLabAccounts()
  private isMounted = false
  /** Increases on cancel, so that a late sign-in result is ignored. */
  private attempt = 0

  public constructor(props: IGitLabWelcomeSignInProps) {
    super(props)
    this.state = {
      instanceUrl: GitLabDotComUrl,
      token: '',
      applicationId: this.accounts.getApplicationId(GitLabDotComUrl) ?? '',
      busy: null,
      error: null,
    }
  }

  public componentDidMount() {
    this.isMounted = true
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  private onInstanceUrlChanged = (instanceUrl: string) =>
    this.setState({
      instanceUrl,
      error: null,
      applicationId:
        this.accounts.getApplicationId(instanceUrl) ?? this.state.applicationId,
    })

  private onTokenChanged = (token: string) =>
    this.setState({ token, error: null })

  private onApplicationIdChanged = (applicationId: string) =>
    this.setState({ applicationId, error: null })

  private onSignInWithToken = async () => {
    const instanceUrl = normalizeInstanceUrl(this.state.instanceUrl)
    const token = this.state.token.trim()
    if (token.length === 0 || this.state.busy !== null) {
      return
    }

    const attempt = ++this.attempt
    this.setState({ busy: 'token', error: null })
    try {
      const user = await new GitLabAPI(instanceUrl, token).getCurrentUser()
      await this.accounts.saveAccount(
        { instanceUrl, username: user.username, name: user.name },
        token
      )
      if (this.isMounted && attempt === this.attempt) {
        this.props.onSignedIn()
      }
    } catch (e) {
      if (this.isMounted && attempt === this.attempt) {
        this.setState({ busy: null, error: describeError(e) })
      }
    }
  }

  private onSignInWithBrowser = async () => {
    const instanceUrl = normalizeInstanceUrl(this.state.instanceUrl)
    const applicationId = this.state.applicationId.trim()
    if (applicationId.length === 0 || this.state.busy !== null) {
      return
    }

    const attempt = ++this.attempt
    this.setState({ busy: 'browser', error: null })
    try {
      const tokens = await signInWithGitLabOAuth(instanceUrl, applicationId)
      const user = await new GitLabAPI(
        instanceUrl,
        tokens.accessToken
      ).getCurrentUser()
      await this.accounts.saveOAuthAccount(
        { instanceUrl, username: user.username, name: user.name },
        tokens,
        applicationId
      )
      if (this.isMounted && attempt === this.attempt) {
        this.props.onSignedIn()
      }
    } catch (e) {
      if (this.isMounted && attempt === this.attempt) {
        this.setState({ busy: null, error: describeError(e) })
      }
    }
  }

  private onCancel = () => {
    this.attempt++
    this.props.onCancel()
  }

  public render() {
    const { instanceUrl, token, applicationId, busy, error } = this.state
    const tokenUrl = `${normalizeInstanceUrl(
      instanceUrl
    )}/-/user_settings/personal_access_tokens?scopes=api`

    return (
      <section id="sign-in-gitlab" aria-label="Sign in to GitLab">
        <h1 className="welcome-title">Sign in to GitLab</h1>

        <div className="arbor-welcome-gitlab">
          <TextBox
            label="GitLab instance URL"
            value={instanceUrl}
            onValueChanged={this.onInstanceUrlChanged}
            disabled={busy !== null}
            placeholder="https://gitlab.com"
          />

          <h2>With a personal access token</h2>
          <TextBox
            label="Personal access token"
            type="password"
            value={token}
            onValueChanged={this.onTokenChanged}
            disabled={busy !== null}
          />
          <p className="welcome-text arbor-welcome-gitlab-hint">
            Create one with the <code>api</code> scope in GitLab &gt;
            Preferences &gt; Access tokens ({tokenUrl}).
          </p>
          <Button
            type="submit"
            onClick={this.onSignInWithToken}
            disabled={busy !== null || token.trim().length === 0}
          >
            {busy === 'token' && <Loading />}
            Sign in with token
          </Button>

          <h2>Or with your browser</h2>
          <p className="welcome-text arbor-welcome-gitlab-hint">
            Create an application in GitLab &gt; Preferences &gt; Applications
            with the <code>api</code> scope and the redirect URI{' '}
            <code>{GitLabOAuthRedirectUri}</code>, then enter its Application
            ID.
          </p>
          <TextBox
            label="Application ID"
            value={applicationId}
            onValueChanged={this.onApplicationIdChanged}
            disabled={busy !== null}
          />
          <Button
            onClick={this.onSignInWithBrowser}
            disabled={busy !== null || applicationId.trim().length === 0}
          >
            {busy === 'browser' && <Loading />}
            Sign in with browser
          </Button>
          {busy === 'browser' && (
            <p className="welcome-text">
              Waiting for authorization in your browser…
            </p>
          )}

          {error !== null && (
            <p className="arbor-welcome-gitlab-error" role="alert">
              {error}
            </p>
          )}

          <div className="arbor-welcome-gitlab-actions">
            <Button onClick={this.onCancel}>Cancel</Button>
          </div>
        </div>
      </section>
    )
  }
}
