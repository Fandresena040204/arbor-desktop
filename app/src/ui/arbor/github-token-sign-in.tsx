import * as React from 'react'
import { getDotComAPIEndpoint, getEnterpriseAPIURL } from '../../lib/api'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { Loading } from '../lib/loading'
import { RadioGroup } from '../lib/radio-group'

type GitHubHost = 'dotcom' | 'enterprise'

interface IGitHubTokenSignInProps {
  readonly dispatcher: Dispatcher
  /** Called once signed in. */
  readonly onSignedIn: () => void
  readonly onCancel: () => void
}

interface IGitHubTokenSignInState {
  readonly host: GitHubHost
  readonly enterpriseUrl: string
  readonly token: string
  readonly busy: boolean
  readonly error: string | null
}

/** The API endpoint of GitHub.com, or of the given GitHub Enterprise server. */
export function getTokenSignInEndpoint(
  host: GitHubHost,
  enterpriseUrl: string
): string {
  if (host === 'dotcom') {
    return getDotComAPIEndpoint()
  }
  const url = enterpriseUrl.trim()
  return getEnterpriseAPIURL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
}

/**
 * Arbor: sign in to GitHub.com or GitHub Enterprise with a personal access
 * token, for when signing in with the browser isn't possible or wanted.
 */
export class GitHubTokenSignIn extends React.Component<
  IGitHubTokenSignInProps,
  IGitHubTokenSignInState
> {
  private isMounted = false
  /** Increases on cancel, so that a late sign-in result is ignored. */
  private attempt = 0

  public constructor(props: IGitHubTokenSignInProps) {
    super(props)
    this.state = {
      host: 'dotcom',
      enterpriseUrl: '',
      token: '',
      busy: false,
      error: null,
    }
  }

  public componentDidMount() {
    this.isMounted = true
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  private onHostChanged = (host: GitHubHost) =>
    this.setState({ host, error: null })

  private onEnterpriseUrlChanged = (enterpriseUrl: string) =>
    this.setState({ enterpriseUrl, error: null })

  private onTokenChanged = (token: string) =>
    this.setState({ token, error: null })

  private onSignIn = async () => {
    const { host, enterpriseUrl, busy } = this.state
    const token = this.state.token.trim()
    if (busy || token.length === 0) {
      return
    }
    if (host === 'enterprise' && enterpriseUrl.trim().length === 0) {
      this.setState({ error: 'Enter the address of your GitHub Enterprise.' })
      return
    }

    const attempt = ++this.attempt
    this.setState({ busy: true, error: null })
    try {
      await this.props.dispatcher.arborSignInWithToken(
        getTokenSignInEndpoint(host, enterpriseUrl),
        token
      )
      if (this.isMounted && attempt === this.attempt) {
        this.props.onSignedIn()
      }
    } catch (e) {
      if (this.isMounted && attempt === this.attempt) {
        this.setState({
          busy: false,
          error: `Unable to sign in with this token: ${
            e instanceof Error ? e.message : String(e)
          }`,
        })
      }
    }
  }

  private onCancel = () => {
    this.attempt++
    this.props.onCancel()
  }

  private renderHost = (host: GitHubHost) =>
    host === 'dotcom' ? 'GitHub.com' : 'GitHub Enterprise'

  public render() {
    const { host, enterpriseUrl, token, busy, error } = this.state

    return (
      <section
        id="sign-in-github-token"
        aria-label="Sign in to GitHub with a token"
      >
        <h1 className="welcome-title">Sign in to GitHub with a token</h1>

        <div className="arbor-welcome-gitlab">
          <RadioGroup<GitHubHost>
            ariaLabelledBy="arbor-github-token-host"
            selectedKey={host}
            radioButtonKeys={['dotcom', 'enterprise']}
            onSelectionChanged={this.onHostChanged}
            renderRadioButtonLabelContents={this.renderHost}
          />
          {host === 'enterprise' && (
            <TextBox
              label="GitHub Enterprise address"
              value={enterpriseUrl}
              onValueChanged={this.onEnterpriseUrlChanged}
              placeholder="https://github.example.com"
              disabled={busy}
            />
          )}
          <TextBox
            label="Personal access token"
            type="password"
            value={token}
            onValueChanged={this.onTokenChanged}
            disabled={busy}
          />
          <p className="welcome-text arbor-welcome-gitlab-hint">
            Create a classic token in GitHub &gt; Settings &gt; Developer
            settings &gt; Personal access tokens with the <code>repo</code>,{' '}
            <code>workflow</code>, <code>read:org</code> and <code>user</code>{' '}
            scopes.
          </p>
          <Button
            type="submit"
            onClick={this.onSignIn}
            disabled={busy || token.trim().length === 0}
          >
            {busy && <Loading />}
            Sign in
          </Button>

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
