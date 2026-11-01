import * as React from 'react'
import { WelcomeStep } from './welcome'
import { LinkButton } from '../lib/link-button'
import { Dispatcher } from '../dispatcher'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { BrowserRedirectMessage } from '../lib/authentication-form'

/**
 * The URL to the sign-up page on GitHub.com. Used in conjunction
 * with account actions in the app where the user might want to
 * consider signing up.
 */
export const CreateAccountURL = 'https://github.com/join?source=github-desktop'

interface IStartProps {
  readonly advance: (step: WelcomeStep) => void
  readonly dispatcher: Dispatcher
  readonly loadingBrowserAuth: boolean
}

/** The first step of the Welcome flow. */
export class Start extends React.Component<IStartProps, {}> {
  public render() {
    return (
      <section
        id="start"
        // Arbor: the welcome flow introduces Arbor.
        aria-label="Welcome to Arbor"
        aria-describedby="start-description"
      >
        <div className="start-content">
          <h1 className="welcome-title">
            Welcome to <span>Arbor</span>
          </h1>
          {!this.props.loadingBrowserAuth ? (
            <>
              <p id="start-description" className="welcome-text">
                Arbor is a Git client for GitHub, GitHub Enterprise and GitLab
                (gitlab.com or self-hosted). Sign in below to get started with
                your existing projects.
              </p>
            </>
          ) : (
            <p>{BrowserRedirectMessage}</p>
          )}

          <div className="welcome-main-buttons">
            {/* Arbor: GitLab first, GitHub second. */}
            <Button
              type="submit"
              className="arbor-sign-in-gitlab"
              disabled={this.props.loadingBrowserAuth}
              onClick={this.signInToGitLab}
              autoFocus={true}
            >
              Sign in to GitLab
            </Button>
            <Button
              className="button-with-icon"
              disabled={this.props.loadingBrowserAuth}
              onClick={this.signInWithBrowser}
              role="link"
            >
              {this.props.loadingBrowserAuth && <Loading />}
              Sign in to GitHub.com
              <Octicon symbol={octicons.linkExternal} />
            </Button>
            {this.props.loadingBrowserAuth ? (
              <Button onClick={this.cancelBrowserAuth}>Cancel</Button>
            ) : (
              <Button onClick={this.signInToEnterprise}>
                Sign in to GitHub Enterprise
              </Button>
            )}
          </div>
          {/* Arbor: GitHub sign-in with a personal access token. */}
          <p className="welcome-text arbor-github-token-sign-in">
            <LinkButton onClick={this.signInToGitHubWithToken}>
              Sign in to GitHub with a token
            </LinkButton>
          </p>
          <div className="skip-action-container">
            <p className="welcome-text">
              New here? Create a free{' '}
              <LinkButton uri="https://gitlab.com/users/sign_up">
                GitLab
              </LinkButton>{' '}
              or{' '}
              <LinkButton
                uri={CreateAccountURL}
                className="create-account-link"
              >
                GitHub
              </LinkButton>{' '}
              account.
            </p>
            <LinkButton className="skip-button" onClick={this.skip}>
              Skip this step
            </LinkButton>
          </div>
        </div>

        <div className="start-footer">
          <p>
            By creating an account, you agree to the{' '}
            <LinkButton uri={'https://github.com/site/terms'}>
              Terms of Service
            </LinkButton>
            . For more information about GitHub's privacy practices, see the{' '}
            <LinkButton uri={'https://github.com/site/privacy'}>
              GitHub Privacy Statement.
            </LinkButton>
          </p>
          {/* Arbor: no usage metrics are sent. */}
          <p>Arbor doesn't send any usage metrics.</p>
        </div>
      </section>
    )
  }

  private signInWithBrowser = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) {
      event.preventDefault()
    }

    this.props.advance(WelcomeStep.SignInToDotComWithBrowser)
    this.props.dispatcher.requestBrowserAuthenticationToDotcom()
  }

  private cancelBrowserAuth = () => {
    this.props.advance(WelcomeStep.Start)
  }

  private signInToGitHubWithToken = () => {
    this.props.advance(WelcomeStep.SignInToGitHubWithToken)
  }

  // Arbor: GitLab sign-in step.
  private signInToGitLab = () => {
    this.props.advance(WelcomeStep.SignInToGitLab)
  }

  private signInToEnterprise = () => {
    this.props.advance(WelcomeStep.SignInToEnterprise)
  }

  private skip = () => {
    this.props.advance(WelcomeStep.ConfigureGit)
  }
}
