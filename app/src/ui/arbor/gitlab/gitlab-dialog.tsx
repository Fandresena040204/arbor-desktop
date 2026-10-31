import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Button } from '../../lib/button'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'
import { LinkButton } from '../../lib/link-button'
import { TabBar } from '../../tab-bar'
import { TextArea } from '../../lib/text-area'
import { TextBox } from '../../lib/text-box'
import { getRemotes } from '../../../lib/git/remote'
import { getSymbolicRef } from '../../../lib/git/refs'
import { IRemote } from '../../../models/remote'
import {
  GitLabAccounts,
  IGitLabAccount,
  normalizeInstanceUrl,
} from '../../../lib/arbor/gitlab/gitlab-accounts'
import {
  GitLabAPI,
  GitLabAPIError,
  IGitLabIssue,
  IGitLabMergeRequest,
  IGitLabPipeline,
  IGitLabProject,
} from '../../../lib/arbor/gitlab/gitlab-api'
import { IGitLabRemote } from '../../../lib/arbor/gitlab/gitlab-remote'
import {
  branchOfSymbolicRef,
  chooseGitLabRemote,
  defaultMergeRequestTitle,
  describeGitLabPipeline,
  shortSha,
} from './gitlab-ui-utils'

export interface IGitLabDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

/** Stages between "no remote" and "signed in and loaded". */
enum GitLabPhase {
  Detecting = 0,
  NoRemote = 1,
  SignIn = 2,
  SignedIn = 3,
}

enum GitLabTab {
  MergeRequests = 0,
  Pipeline = 1,
  Issues = 2,
}

interface IGitLabDialogState {
  readonly phase: GitLabPhase
  /** A top-level error (detection or sign-in), shown as a `DialogError`. */
  readonly error: string | null
  readonly detecting: boolean
  readonly remotes: ReadonlyArray<IRemote>
  /** The remote used for the GitLab API, null until a match is found. */
  readonly remote: IGitLabRemote | null
  /** Instance URLs the user asked to try before signing in. */
  readonly extraInstanceUrls: ReadonlyArray<string>
  // The no-remote screen.
  readonly extraInstance: string
  // The sign-in form.
  readonly signInInstance: string
  readonly signInToken: string
  readonly signingIn: boolean
  /** The signed-in account, null until `saveAccount` succeeded. */
  readonly account: IGitLabAccount | null
  // The data of the signed-in project.
  readonly project: IGitLabProject | null
  readonly currentBranch: string | null
  readonly tab: GitLabTab
  // The merge requests tab.
  readonly mergeRequests: ReadonlyArray<IGitLabMergeRequest>
  readonly currentMergeRequest: IGitLabMergeRequest | null
  readonly mergeRequestsLoading: boolean
  readonly mergeRequestsLoaded: boolean
  readonly mergeRequestsError: string | null
  // The create merge request form.
  readonly mrTarget: string
  readonly mrTitle: string
  readonly mrDescription: string
  readonly mrDraft: boolean
  readonly mrRemoveSourceBranch: boolean
  readonly creatingMergeRequest: boolean
  // The pipeline tab.
  readonly pipeline: IGitLabPipeline | null
  readonly pipelineLoading: boolean
  readonly pipelineLoaded: boolean
  readonly pipelineError: string | null
  // The issues tab.
  readonly issues: ReadonlyArray<IGitLabIssue>
  readonly issuesLoading: boolean
  readonly issuesLoaded: boolean
  readonly issuesError: string | null
  readonly issueSearch: string
}

/** Debouncing of the issue search field. */
const IssueSearchDebounceMs = 300

/**
 * Arbor: a dialog to talk to the GitLab project of the repository — merge
 * requests, pipeline and issues, on gitlab.com or a self-hosted instance,
 * using a personal access token.
 */
export class GitLabDialog extends React.Component<
  IGitLabDialogProps,
  IGitLabDialogState
> {
  private isMounted = false
  /** The token of the signed-in account, kept out of the state. */
  private token: string | null = null
  private readonly accounts = new GitLabAccounts()
  /** Grows with every data request so that stale results are dropped. */
  private projectRequest = 0
  private mergeRequestRequest = 0
  private pipelineRequest = 0
  private issuesRequest = 0
  private issueSearchTimeoutId: number | null = null

  public constructor(props: IGitLabDialogProps) {
    super(props)
    this.state = {
      phase: GitLabPhase.Detecting,
      error: null,
      detecting: true,
      remotes: [],
      remote: null,
      extraInstanceUrls: [],
      extraInstance: '',
      signInInstance: '',
      signInToken: '',
      signingIn: false,
      account: null,
      project: null,
      currentBranch: null,
      tab: GitLabTab.MergeRequests,
      mergeRequests: [],
      currentMergeRequest: null,
      mergeRequestsLoading: false,
      mergeRequestsLoaded: false,
      mergeRequestsError: null,
      mrTarget: '',
      mrTitle: '',
      mrDescription: '',
      mrDraft: false,
      mrRemoveSourceBranch: false,
      creatingMergeRequest: false,
      pipeline: null,
      pipelineLoading: false,
      pipelineLoaded: false,
      pipelineError: null,
      issues: [],
      issuesLoading: false,
      issuesLoaded: false,
      issuesError: null,
      issueSearch: '',
    }
  }

  public componentDidMount() {
    this.isMounted = true
    void this.detect()
  }

  public componentWillUnmount() {
    this.isMounted = false
    if (this.issueSearchTimeoutId !== null) {
      window.clearTimeout(this.issueSearchTimeoutId)
      this.issueSearchTimeoutId = null
    }
  }

  /** The GitLab client of the signed-in account, or null. */
  private get api(): GitLabAPI | null {
    const { account } = this.state
    return account === null || this.token === null
      ? null
      : new GitLabAPI(account.instanceUrl, this.token)
  }

  private get isBusy(): boolean {
    return (
      this.state.detecting ||
      this.state.signingIn ||
      this.state.creatingMergeRequest
    )
  }

  private setStateIfMounted(state: Partial<IGitLabDialogState>) {
    if (this.isMounted) {
      this.setState(prevState => ({ ...prevState, ...state }))
    }
  }

  private logAndDescribe(e: unknown, subject: string): string {
    log.error(`Arbor: ${subject}`, e instanceof Error ? e : undefined)
    return e instanceof Error ? e.message : String(e)
  }

  // #region Detection

  /**
   * Read the remotes of the repository and the current branch, find the
   * remote to use and continue to the sign-in or to the signed-in view.
   */
  private detect = async () => {
    this.setStateIfMounted({
      phase: GitLabPhase.Detecting,
      detecting: true,
      error: null,
      remote: null,
      account: null,
      project: null,
      currentBranch: null,
      tab: GitLabTab.MergeRequests,
      mergeRequests: [],
      currentMergeRequest: null,
      mergeRequestsLoading: false,
      mergeRequestsLoaded: false,
      mergeRequestsError: null,
      pipeline: null,
      pipelineLoading: false,
      pipelineLoaded: false,
      pipelineError: null,
      issues: [],
      issuesLoading: false,
      issuesLoaded: false,
      issuesError: null,
    })

    const { repository } = this.props
    try {
      const [remotes, headRef] = await Promise.all([
        getRemotes(repository),
        getSymbolicRef(repository, 'HEAD'),
      ])

      if (!this.isMounted) {
        return
      }

      const currentBranch = branchOfSymbolicRef(headRef)
      const remote = chooseGitLabRemote(remotes, this.knownInstanceUrls())

      if (remote !== null) {
        this.setState({
          detecting: false,
          remotes,
          currentBranch,
          phase: GitLabPhase.SignIn,
          remote,
          signInInstance: remote.instanceUrl,
        })
        void this.followSignIn()
      } else {
        this.setState({
          detecting: false,
          remotes,
          currentBranch,
          phase: GitLabPhase.NoRemote,
        })
      }
    } catch (e) {
      const message = this.logAndDescribe(
        e,
        "unable to read the repository's remotes"
      )
      this.props.dispatcher.postError(
        e instanceof Error ? e : new Error(String(e))
      )
      this.setStateIfMounted({
        phase: GitLabPhase.NoRemote,
        detecting: false,
        error: message,
      })
    }
  }

  /** The instances known from the accounts plus the ones the user added. */
  private knownInstanceUrls(): ReadonlyArray<string> {
    return [...this.accounts.getInstanceUrls(), ...this.state.extraInstanceUrls]
  }

  /** Initialize the sign-in form or go straight to the signed-in view. */
  private followSignIn = async () => {
    const { remote } = this.state
    if (remote === null) {
      return
    }

    const account = this.accounts.findAccount(remote.instanceUrl)
    if (account === undefined) {
      this.setStateIfMounted({ phase: GitLabPhase.SignIn })
      return
    }

    const token = await this.accounts.getToken(remote.instanceUrl)
    if (token === null) {
      this.setStateIfMounted({ phase: GitLabPhase.SignIn })
      return
    }

    this.signInAs(account, token)
  }

  private signInAs(account: IGitLabAccount, token: string) {
    this.token = token
    this.setStateIfMounted({ phase: GitLabPhase.SignedIn, account })
    void this.loadProject()
  }

  // #endregion

  // #region Sign in / sign out

  private onSignInInstanceChanged = (value: string) => {
    this.setState({ signInInstance: value })
  }

  private onSignInTokenChanged = (value: string) => {
    this.setState({ signInToken: value })
  }

  private onExtraInstanceChanged = (value: string) => {
    this.setState({ extraInstance: value })
  }

  /** Try the instance URL entered by the user on the no-remote screen. */
  private onUseExtraInstance = () => {
    const instanceUrl = normalizeInstanceUrl(this.state.extraInstance)
    if (instanceUrl.length === 0) {
      this.setState({
        error:
          'Enter the URL of your GitLab instance, e.g. https://git.example.com.',
      })
      return
    }

    if (
      this.accounts.getInstanceUrls().includes(instanceUrl) ||
      this.state.extraInstanceUrls.includes(instanceUrl)
    ) {
      this.setState({ error: null, extraInstance: '' })
      return
    }

    this.setState(
      prevState => ({
        error: null,
        extraInstanceUrls: [...prevState.extraInstanceUrls, instanceUrl],
      }),
      () => void this.detect()
    )
  }

  private onSignIn = () => void this.signIn()

  private async signIn() {
    const instanceUrl = normalizeInstanceUrl(this.state.signInInstance)
    const token = this.state.signInToken.trim()

    if (instanceUrl.length === 0 || token.length === 0) {
      this.setState({
        error: 'Enter an instance URL and a personal access token.',
      })
      return
    }

    this.setState({ signingIn: true, error: null })

    try {
      const user = await new GitLabAPI(instanceUrl, token).getCurrentUser()
      const account = {
        instanceUrl,
        username: user.username,
        name: user.name,
      }

      await this.accounts.saveAccount(account, token)
      this.setState({ signingIn: false, signInToken: '' })
      await this.detect()
    } catch (e) {
      const message = this.logAndDescribe(e, 'unable to sign in to GitLab')
      const invalidToken =
        e instanceof GitLabAPIError && (e.status === 401 || e.status === 403)

      this.setState({
        signingIn: false,
        error: invalidToken
          ? 'Invalid token. Create a personal access token with the api scope.'
          : message,
      })
    }
  }

  private onSignOut = () => void this.signOut()

  private async signOut() {
    const { account } = this.state
    if (account === null) {
      return
    }

    try {
      await this.accounts.removeAccount(account.instanceUrl)
    } catch (e) {
      this.props.dispatcher.postError(
        e instanceof Error ? e : new Error(String(e))
      )
    }

    this.token = null
    this.setState({ signInToken: '' })
    await this.detect()
  }

  // #endregion

  // #region Signed-in data

  private async loadProject() {
    const { remote, currentBranch } = this.state
    const api = this.api
    if (remote === null || api === null) {
      return
    }

    const request = ++this.projectRequest
    try {
      const project = await api.getProject(remote.projectPath)
      if (!this.isMounted || request !== this.projectRequest) {
        return
      }

      this.setState(prevState => ({
        project,
        mrTarget:
          prevState.mrTarget.length === 0
            ? project.defaultBranch ?? ''
            : prevState.mrTarget,
        mrTitle:
          prevState.mrTitle.length === 0 && currentBranch !== null
            ? defaultMergeRequestTitle(currentBranch)
            : prevState.mrTitle,
      }))

      void this.loadTab(this.state.tab)
    } catch (e) {
      const message = this.logAndDescribe(
        e,
        `unable to load the GitLab project ${remote.projectPath}`
      )
      this.setStateIfMounted({ error: message })
    }
  }

  /** Load the data of a tab, excluding the ones that already were. */
  private loadTab(tab: GitLabTab, refresh = false) {
    switch (tab) {
      case GitLabTab.MergeRequests:
        if (refresh || !this.state.mergeRequestsLoaded) {
          return this.loadMergeRequests()
        }
        break
      case GitLabTab.Pipeline:
        if (refresh || !this.state.pipelineLoaded) {
          return this.loadPipeline()
        }
        break
      case GitLabTab.Issues:
        if (refresh || !this.state.issuesLoaded) {
          return this.loadIssues()
        }
        break
      default:
        break
    }

    return Promise.resolve()
  }

  private onTabClicked = (tab: GitLabTab) => {
    const previous = this.state.tab
    this.setState({ tab })
    if (tab !== previous) {
      void this.loadTab(tab)
    }
  }

  private async loadMergeRequests(keepCurrent?: IGitLabMergeRequest) {
    const { remote, currentBranch, api } = this.stateAPI()
    if (api === null || remote === null) {
      return
    }

    const request = ++this.mergeRequestRequest
    this.setState({ mergeRequestsLoading: true, mergeRequestsError: null })

    try {
      const mergeRequests = await api.listMergeRequests(remote.projectPath, {
        state: 'opened',
      })

      if (!this.isMounted || request !== this.mergeRequestRequest) {
        return
      }

      const current =
        (currentBranch === null
          ? null
          : mergeRequests.find(mr => mr.sourceBranch === currentBranch)) ??
        keepCurrent ??
        null

      this.setState({
        mergeRequests,
        currentMergeRequest: current,
        mergeRequestsLoaded: true,
        mergeRequestsLoading: false,
      })
    } catch (e) {
      const message = this.logAndDescribe(
        e,
        'unable to load the open merge requests'
      )
      this.setState({
        mergeRequestsLoading: false,
        mergeRequestsLoaded: true,
        mergeRequestsError: message,
      })
    }
  }

  private async loadPipeline() {
    const { remote, currentBranch, api } = this.stateAPI()
    if (api === null || remote === null || currentBranch === null) {
      this.setState({
        pipeline: null,
        pipelineLoaded: true,
        pipelineLoading: false,
      })
      return
    }

    const request = ++this.pipelineRequest
    this.setState({ pipelineLoading: true, pipelineError: null })

    try {
      const pipeline = await api.getLatestPipeline(
        remote.projectPath,
        currentBranch
      )

      if (!this.isMounted || request !== this.pipelineRequest) {
        return
      }

      this.setState({
        pipeline,
        pipelineLoaded: true,
        pipelineLoading: false,
      })
    } catch (e) {
      const message = this.logAndDescribe(
        e,
        `unable to load the pipeline of ${currentBranch}`
      )
      this.setState({
        pipelineLoading: false,
        pipelineLoaded: true,
        pipelineError: message,
      })
    }
  }

  private async loadIssues() {
    const { remote, api } = this.stateAPI()
    if (api === null || remote === null) {
      return
    }

    const request = ++this.issuesRequest
    this.setState({ issuesLoading: true, issuesError: null })

    try {
      const issues = await api.listIssues(remote.projectPath, {
        state: 'opened',
        search: this.state.issueSearch.trim() || undefined,
      })

      if (!this.isMounted || request !== this.issuesRequest) {
        return
      }

      this.setState({
        issues,
        issuesLoaded: true,
        issuesLoading: false,
      })
    } catch (e) {
      const message = this.logAndDescribe(e, 'unable to load the issues')
      this.setState({
        issuesLoading: false,
        issuesLoaded: true,
        issuesError: message,
      })
    }
  }

  /**
   * The pieces every signed-in request needs, null when signed out.
   *
   * (A local helper to avoid three `this.state` destructurings.)
   */
  private stateAPI(): {
    remote: IGitLabRemote | null
    currentBranch: string | null
    api: GitLabAPI | null
  } {
    return {
      remote: this.state.remote,
      currentBranch: this.state.currentBranch,
      api: this.api,
    }
  }

  private onIssueSearchChanged = (value: string) => {
    this.setState({ issueSearch: value })

    if (this.issueSearchTimeoutId !== null) {
      window.clearTimeout(this.issueSearchTimeoutId)
    }

    this.issueSearchTimeoutId = window.setTimeout(() => {
      this.issueSearchTimeoutId = null
      void this.loadIssues()
    }, IssueSearchDebounceMs)
  }

  // #endregion

  // #region Merge request creation

  private onMrTargetChanged = (value: string) => {
    this.setState({ mrTarget: value })
  }

  private onMrTitleChanged = (value: string) => {
    this.setState({ mrTitle: value })
  }

  private onMrDescriptionChanged = (value: string) => {
    this.setState({ mrDescription: value })
  }

  private onMrDraftChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ mrDraft: event.currentTarget.checked })
  }

  private onMrRemoveSourceBranchChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.setState({ mrRemoveSourceBranch: event.currentTarget.checked })
  }

  private onCreateMergeRequest = () => void this.createMergeRequest()

  private async createMergeRequest() {
    const { remote, currentBranch, api } = this.stateAPI()

    if (
      remote === null ||
      api === null ||
      currentBranch === null ||
      this.state.mrTarget.trim().length === 0 ||
      this.state.mrTitle.trim().length === 0
    ) {
      return
    }

    this.setState({ creatingMergeRequest: true, mergeRequestsError: null })

    try {
      const mergeRequest = await api.createMergeRequest(remote.projectPath, {
        sourceBranch: currentBranch,
        targetBranch: this.state.mrTarget.trim(),
        title: this.state.mrTitle.trim(),
        description: this.state.mrDescription.trim() || undefined,
        draft: this.state.mrDraft || undefined,
        removeSourceBranch: this.state.mrRemoveSourceBranch || undefined,
      })

      if (!this.isMounted) {
        return
      }

      this.setState({ creatingMergeRequest: false })
      void this.loadMergeRequests(mergeRequest)
    } catch (e) {
      const message = this.logAndDescribe(
        e,
        'unable to create the merge request'
      )
      this.setState({
        creatingMergeRequest: false,
        mergeRequestsError: message,
      })
    }
  }

  // #endregion

  private openInBrowser = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    void this.props.dispatcher.openInBrowser(event.currentTarget.href)
  }

  private openMergeRequest = (mergeRequest: IGitLabMergeRequest) => {
    void this.props.dispatcher.openInBrowser(mergeRequest.webUrl)
  }

  private openIssue = (issue: IGitLabIssue) => {
    void this.props.dispatcher.openInBrowser(issue.webUrl)
  }

  /** Open the merge request of the clicked row, by its iid. */
  private onMergeRequestClicked = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const iid = Number(event.currentTarget.dataset.iid)
    const mergeRequest = this.state.mergeRequests.find(mr => mr.iid === iid)
    if (mergeRequest !== undefined) {
      this.openMergeRequest(mergeRequest)
    }
  }

  /** Open the issue of the clicked row, by its iid. */
  private onIssueClicked = (event: React.MouseEvent<HTMLButtonElement>) => {
    const iid = Number(event.currentTarget.dataset.iid)
    const issue = this.state.issues.find(i => i.iid === iid)
    if (issue !== undefined) {
      this.openIssue(issue)
    }
  }

  private onRefreshPipeline = () => void this.loadPipeline()

  /**
   * The dialog form submits with Enter: sign in or create the merge request
   * when it makes sense, otherwise do nothing (and keep the dialog open).
   */
  private onSubmit = () => {
    switch (this.state.phase) {
      case GitLabPhase.SignIn:
        void this.signIn()
        break
      case GitLabPhase.SignedIn:
        if (
          this.state.tab === GitLabTab.MergeRequests &&
          this.state.currentMergeRequest === null
        ) {
          void this.createMergeRequest()
        }
        break
      default:
        break
    }
  }

  /** Open the personal access tokens page of the instance of the form. */
  private openTokenPage = () => {
    const instanceUrl = normalizeInstanceUrl(this.state.signInInstance)
    void this.props.dispatcher.openInBrowser(
      `${instanceUrl}/-/user_settings/personal_access_tokens?scopes=api`
    )
  }

  public render() {
    const busy = this.isBusy

    return (
      <Dialog
        id="arbor-gitlab"
        title="GitLab"
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
        disabled={busy}
        loading={busy}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        <DialogContent>{this.renderBody()}</DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Close"
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderBody() {
    switch (this.state.phase) {
      case GitLabPhase.Detecting:
        return this.renderDetecting()
      case GitLabPhase.NoRemote:
        return this.renderNoRemote()
      case GitLabPhase.SignIn:
        return this.renderSignIn()
      case GitLabPhase.SignedIn:
        return this.renderSignedIn()
      default:
        return null
    }
  }

  private renderDetecting() {
    return (
      <div className="arbor-gitlab-status">
        Checking this repository's remotes…
      </div>
    )
  }

  private renderNoRemote() {
    return (
      <div className="arbor-gitlab-no-remote">
        <p className="arbor-gitlab-explanation">
          This repository has no GitLab remote. Push it to GitLab, update its
          remotes, or enter the URL of a self-hosted GitLab instance that hosts
          it.
        </p>
        <div className="arbor-gitlab-row">
          <TextBox
            label="GitLab instance URL"
            className="arbor-gitlab-instance"
            placeholder="https://gitlab.example.com"
            value={this.state.extraInstance}
            onValueChanged={this.onExtraInstanceChanged}
          />
          <Button
            className="arbor-gitlab-use-instance"
            onClick={this.onUseExtraInstance}
          >
            Use this instance
          </Button>
        </div>
      </div>
    )
  }

  private renderSignIn() {
    return (
      <div className="arbor-gitlab-sign-in">
        <div className="arbor-gitlab-row">
          <TextBox
            label="GitLab instance"
            className="arbor-gitlab-instance"
            value={this.state.signInInstance}
            onValueChanged={this.onSignInInstanceChanged}
          />
        </div>
        <TextBox
          label="Personal access token"
          className="arbor-gitlab-token"
          type="password"
          ariaLabel="Personal access token"
          value={this.state.signInToken}
          onValueChanged={this.onSignInTokenChanged}
        />
        <p className="arbor-gitlab-help">
          Create one with the `api` scope in GitLab &gt; Preferences &gt; Access
          tokens:{' '}
          <LinkButton
            className="arbor-gitlab-token-link"
            ariaLabel="Create a personal access token"
            onClick={this.openTokenPage}
          >
            Create an access token
          </LinkButton>
        </p>
        <div className="arbor-gitlab-row">
          <Button
            className="arbor-gitlab-sign-in-button"
            onClick={this.onSignIn}
          >
            Sign in
          </Button>
        </div>
      </div>
    )
  }

  private renderSignedIn() {
    const { account, project, tab } = this.state

    if (account === null) {
      return this.renderDetecting()
    }

    return (
      <div className="arbor-gitlab-pane">
        <div className="arbor-gitlab-header">
          <div className="arbor-gitlab-identity">
            {project === null ? (
              <span className="arbor-gitlab-project-pending">
                {this.state.remote?.projectPath ?? 'Loading project…'}
              </span>
            ) : (
              <a
                className="arbor-gitlab-link arbor-gitlab-project-link"
                href={project.webUrl}
                onClick={this.openInBrowser}
              >
                {project.pathWithNamespace}
              </a>
            )}
            <span className="arbor-gitlab-user">
              {__DARWIN__ ? 'Signed In As' : 'Signed in as'} @{account.username}
            </span>
          </div>
          <Button
            className="arbor-gitlab-sign-out"
            size="small"
            onClick={this.onSignOut}
            ariaLabel="Sign out of GitLab"
          >
            {__DARWIN__ ? 'Sign Out' : 'Sign out'}
          </Button>
        </div>
        <div className="arbor-gitlab-tabs">
          <TabBar selectedIndex={tab} onTabClicked={this.onTabClicked}>
            <span>{__DARWIN__ ? 'Merge Requests' : 'Merge requests'}</span>
            <span>{__DARWIN__ ? 'Pipeline' : 'Pipeline'}</span>
            <span>Issues</span>
          </TabBar>
          {tab === GitLabTab.MergeRequests
            ? this.renderMergeRequestTab()
            : null}
          {tab === GitLabTab.Pipeline ? this.renderPipelineTab() : null}
          {tab === GitLabTab.Issues ? this.renderIssuesTab() : null}
        </div>
      </div>
    )
  }

  private renderStatus(message: string) {
    return <div className="arbor-gitlab-status">{message}</div>
  }

  private renderTabError(message: string | null) {
    return message === null ? null : (
      <div className="arbor-gitlab-error">{message}</div>
    )
  }

  // #region Merge requests tab

  private renderMergeRequestTab() {
    const { mergeRequestsLoading, mergeRequestsLoaded, currentMergeRequest } =
      this.state

    return (
      <div className="arbor-gitlab-tab-body">
        {this.renderTabError(this.state.mergeRequestsError)}
        <section className="arbor-gitlab-current-mr">
          <h3 className="arbor-gitlab-section-title">
            {__DARWIN__ ? 'Current Branch' : 'Current branch'}
          </h3>
          {mergeRequestsLoading && !mergeRequestsLoaded
            ? this.renderStatus('Loading merge requests…')
            : currentMergeRequest !== null
            ? this.renderCurrentMergeRequest(currentMergeRequest)
            : this.renderCreateMergeRequestForm()}
        </section>
        <section className="arbor-gitlab-mrs">
          <h3 className="arbor-gitlab-section-title">
            {__DARWIN__ ? 'Open Merge Requests' : 'Open merge requests'} (
            {this.state.mergeRequests.length})
          </h3>
          {this.renderMergeRequestList()}
        </section>
      </div>
    )
  }

  private renderCurrentMergeRequest(mergeRequest: IGitLabMergeRequest) {
    return (
      <div className="arbor-gitlab-mr-summary">
        <div className="arbor-gitlab-mr-heading">
          {mergeRequest.draft && (
            <span className="arbor-gitlab-draft">Draft</span>
          )}
          <a
            className="arbor-gitlab-link arbor-gitlab-mr-link"
            href={mergeRequest.webUrl}
            onClick={this.openInBrowser}
          >
            {mergeRequest.title}
          </a>
        </div>
        <div className="arbor-gitlab-mr-meta">
          <span className="arbor-gitlab-mr-iid">!{mergeRequest.iid}</span>
          <span className="arbor-gitlab-mr-branches">
            {mergeRequest.sourceBranch} → {mergeRequest.targetBranch}
          </span>
          {mergeRequest.author.length > 0 ? (
            <span className="arbor-gitlab-mr-author">
              {__DARWIN__ ? 'By' : 'by'} {mergeRequest.author}
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  /**
   * The form to create a merge request from the current branch, only shown
   * when the branch has no open merge request.
   */
  private renderCreateMergeRequestForm() {
    if (this.state.currentBranch === null) {
      return this.renderStatus(
        'Not on a branch: check out a branch to create a merge request.'
      )
    }

    return (
      <div className="arbor-gitlab-create-mr">
        <div className="arbor-gitlab-row">
          <TextBox
            label="Source"
            className="arbor-gitlab-mr-source"
            value={this.state.currentBranch}
            readOnly={true}
          />
          <TextBox
            label="Target"
            className="arbor-gitlab-mr-target"
            placeholder={this.state.project?.defaultBranch ?? 'Target branch'}
            value={this.state.mrTarget}
            onValueChanged={this.onMrTargetChanged}
          />
        </div>
        <TextBox
          label="Title"
          className="arbor-gitlab-mr-title"
          value={this.state.mrTitle}
          onValueChanged={this.onMrTitleChanged}
        />
        <TextArea
          label="Description"
          textareaClassName="arbor-gitlab-mr-description"
          placeholder="What does this merge request change?"
          value={this.state.mrDescription}
          onValueChanged={this.onMrDescriptionChanged}
          rows={8}
        />
        <div className="arbor-gitlab-mr-options">
          <Checkbox
            className="arbor-gitlab-mr-draft-option"
            label="Draft"
            value={this.state.mrDraft ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onMrDraftChanged}
          />
          <Checkbox
            className="arbor-gitlab-mr-remove-branch-option"
            label="Delete source branch when merged"
            value={
              this.state.mrRemoveSourceBranch
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onMrRemoveSourceBranchChanged}
          />
        </div>
        <Button
          className="arbor-gitlab-create-mr-button"
          onClick={this.onCreateMergeRequest}
          ariaLabel="Create merge request"
        >
          {__DARWIN__ ? 'Create Merge Request' : 'Create merge request'}
        </Button>
      </div>
    )
  }

  private renderMergeRequestList() {
    const { mergeRequests, mergeRequestsLoading, mergeRequestsLoaded } =
      this.state

    if (mergeRequestsLoading && !mergeRequestsLoaded) {
      return this.renderStatus('Loading merge requests…')
    }

    if (mergeRequests.length === 0) {
      return this.renderStatus('No merge request for this project.')
    }

    return (
      <ul className="arbor-gitlab-mr-list" role="listbox">
        {mergeRequests.map(mr => (
          <li key={mr.iid} role="option" aria-selected={false}>
            <button
              type="button"
              className="arbor-gitlab-mr"
              data-iid={mr.iid}
              aria-label={'Open merge request ' + mr.title}
              onClick={this.onMergeRequestClicked}
            >
              <span className="arbor-gitlab-mr-heading">
                {mr.draft && <span className="arbor-gitlab-draft">Draft</span>}
                <span className="arbor-gitlab-mr-title">{mr.title}</span>
              </span>
              <span className="arbor-gitlab-mr-meta">
                <span className="arbor-gitlab-mr-iid">!{mr.iid}</span>
                <span className="arbor-gitlab-mr-branches">
                  {mr.sourceBranch} → {mr.targetBranch}
                </span>
                {mr.author.length > 0 ? (
                  <span className="arbor-gitlab-mr-author">{mr.author}</span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  // #endregion

  // #region Pipeline tab

  private renderPipelineTab() {
    const { pipeline, currentBranch, pipelineLoading, pipelineLoaded } =
      this.state

    return (
      <div className="arbor-gitlab-tab-body arbor-gitlab-pipeline-tab">
        {this.renderTabError(this.state.pipelineError)}
        <div className="arbor-gitlab-pipeline">
          {pipelineLoading && !pipelineLoaded
            ? this.renderStatus('Loading the last pipeline…')
            : pipeline === null
            ? this.renderStatus(
                currentBranch === null
                  ? 'No pipeline: not on a branch.'
                  : `No pipeline for ${currentBranch}.`
              )
            : this.renderPipelineSummary(pipeline)}
          <Button
            className="arbor-gitlab-pipeline-refresh"
            onClick={this.onRefreshPipeline}
          >
            Refresh
          </Button>
        </div>
      </div>
    )
  }

  private renderPipelineSummary(pipeline: IGitLabPipeline) {
    const status = describeGitLabPipeline(pipeline.status)

    return (
      <div className="arbor-gitlab-pipeline-summary">
        <span className={`arbor-gitlab-pipeline-dot ${status.className}`} />
        <span className="arbor-gitlab-pipeline-status">{status.label}</span>
        <span className="arbor-gitlab-pipeline-sha">
          {shortSha(pipeline.sha)}
        </span>
        <a
          className="arbor-gitlab-link arbor-gitlab-pipeline-link"
          href={pipeline.webUrl}
          onClick={this.openInBrowser}
          aria-label="Open the pipeline in the browser"
        >
          {__DARWIN__ ? 'View Pipeline' : 'View pipeline'}
        </a>
      </div>
    )
  }

  // #endregion

  // #region Issues tab

  private renderIssuesTab() {
    const { issues, issuesLoading, issuesLoaded } = this.state

    return (
      <div className="arbor-gitlab-tab-body arbor-gitlab-issues-tab">
        <TextBox
          className="arbor-gitlab-issue-search"
          type="search"
          placeholder="Search issues"
          ariaLabel="Search issues"
          value={this.state.issueSearch}
          onValueChanged={this.onIssueSearchChanged}
        />
        {this.renderTabError(this.state.issuesError)}
        {issuesLoading && !issuesLoaded
          ? this.renderStatus('Loading issues…')
          : null}
        {!issuesLoading && issues.length === 0
          ? this.renderStatus('No issue matches this search.')
          : null}
        {this.renderIssueList(issues)}
      </div>
    )
  }

  private renderIssueList(issues: ReadonlyArray<IGitLabIssue>) {
    if (issues.length === 0) {
      return null
    }

    return (
      <ul className="arbor-gitlab-issue-list" role="listbox">
        {issues.map(issue => (
          <li key={issue.iid} role="option" aria-selected={false}>
            <button
              type="button"
              className="arbor-gitlab-issue"
              data-iid={issue.iid}
              aria-label={'Open issue ' + issue.title}
              onClick={this.onIssueClicked}
            >
              <span className="arbor-gitlab-issue-iid">#{issue.iid}</span>
              <span className="arbor-gitlab-issue-title">{issue.title}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  // #endregion
}
