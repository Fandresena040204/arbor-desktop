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
import { RelativeTime } from '../../relative-time'
import { writeClipboardText } from '../../main-process-proxy'
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
  IGitLabApprovals,
  IGitLabIssue,
  IGitLabMergeRequest,
  IGitLabNote,
  IGitLabPipeline,
  IGitLabProject,
} from '../../../lib/arbor/gitlab/gitlab-api'
import {
  signInWithGitLabOAuth,
  GitLabOAuthRedirectUri,
} from '../../../lib/arbor/gitlab/gitlab-oauth'
import { IGitLabRemote } from '../../../lib/arbor/gitlab/gitlab-remote'
import {
  branchOfSymbolicRef,
  chooseGitLabRemote,
  defaultMergeRequestTitle,
  describeGitLabApprovals,
  describeGitLabMergeStatus,
  describeGitLabPipeline,
  filterOutSystemNotes,
  IGitLabMergeRequestDetails,
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
  // The browser (OAuth) sign-in.
  readonly oauthApplicationId: string
  /** Waiting for the user to authorize Arbor in the browser. */
  readonly oauthWaiting: boolean
  /** Whether the redirect URI was just copied, for the button label. */
  readonly redirectUriCopied: boolean
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
  // The review of an open merge request.
  /** The iid of the merge request whose review is open, null when closed. */
  readonly openMergeRequestIid: number | null
  readonly mergeRequestDetail: IGitLabMergeRequestDetails | null
  readonly mergeRequestDetailLoading: boolean
  readonly mergeRequestDetailError: string | null
  // The approvals of the reviewed merge request.
  readonly approvals: IGitLabApprovals | null
  readonly approvalsLoading: boolean
  /** Approving or revoking the approval of the current user. */
  readonly approving: boolean
  readonly approvalsError: string | null
  // The comments of the reviewed merge request.
  readonly notes: ReadonlyArray<IGitLabNote>
  readonly notesLoading: boolean
  readonly notesLoaded: boolean
  readonly notesError: string | null
  readonly noteDraft: string
  readonly addingNote: boolean
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

/** How long the redirect URI button shows "Copied". */
const RedirectUriFeedbackMs = 2000

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
  private mergeRequestDetailRequest = 0
  private approvalsRequest = 0
  private notesRequest = 0
  private pipelineRequest = 0
  private issuesRequest = 0
  /** Grows with every OAuth sign-in so ignored results are dropped. */
  private oauthRequest = 0
  private issueSearchTimeoutId: number | null = null
  private redirectUriFeedbackTimeoutId: number | null = null

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
      oauthApplicationId: '',
      oauthWaiting: false,
      redirectUriCopied: false,
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
      openMergeRequestIid: null,
      mergeRequestDetail: null,
      mergeRequestDetailLoading: false,
      mergeRequestDetailError: null,
      approvals: null,
      approvalsLoading: false,
      approving: false,
      approvalsError: null,
      notes: [],
      notesLoading: false,
      notesLoaded: false,
      notesError: null,
      noteDraft: '',
      addingNote: false,
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
    if (this.redirectUriFeedbackTimeoutId !== null) {
      window.clearTimeout(this.redirectUriFeedbackTimeoutId)
      this.redirectUriFeedbackTimeoutId = null
    }
    // Nobody will come back to consume an OAuth sign-in result.
    ++this.oauthRequest
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
      openMergeRequestIid: null,
      mergeRequestDetail: null,
      mergeRequestDetailLoading: false,
      mergeRequestDetailError: null,
      approvals: null,
      approvalsLoading: false,
      approving: false,
      approvalsError: null,
      notes: [],
      notesLoading: false,
      notesLoaded: false,
      notesError: null,
      noteDraft: '',
      addingNote: false,
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
          oauthApplicationId:
            this.accounts.getApplicationId(remote.instanceUrl) ?? '',
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
    this.setState({
      signInInstance: value,
      // Prefill the Application ID saved for this instance, if any.
      oauthApplicationId:
        this.accounts.getApplicationId(normalizeInstanceUrl(value)) ?? '',
    })
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
    // Keep knowing the instance for this dialog, so signing out leads back
    // to its sign-in form rather than to "no GitLab remote".
    this.setState(state => ({
      signInToken: '',
      extraInstanceUrls: state.extraInstanceUrls.includes(account.instanceUrl)
        ? state.extraInstanceUrls
        : [...state.extraInstanceUrls, account.instanceUrl],
    }))
    await this.detect()
  }

  // #endregion

  // #region Browser (OAuth) sign-in

  private onOAuthApplicationIdChanged = (value: string) => {
    this.setState({ oauthApplicationId: value })
  }

  private onSignInWithBrowser = () => void this.signInWithBrowser()

  /**
   * Open the instance's OAuth page in the user's browser, wait for the
   * authorization, save the account and go back to the signed-in view.
   *
   * Cancelling the wait only drops the result: the flow, driven by the main
   * process, finishes on its own.
   */
  private async signInWithBrowser() {
    const instanceUrl = normalizeInstanceUrl(this.state.signInInstance)
    const applicationId = this.state.oauthApplicationId.trim()

    if (instanceUrl.length === 0 || applicationId.length === 0) {
      this.setState({
        error:
          instanceUrl.length === 0
            ? 'Enter the URL of your GitLab instance first.'
            : 'Enter the Application ID of your GitLab application.',
      })
      return
    }

    const request = ++this.oauthRequest
    this.setStateIfMounted({ oauthWaiting: true, error: null })

    try {
      const tokens = await signInWithGitLabOAuth(instanceUrl, applicationId)

      if (!this.isMounted || request !== this.oauthRequest) {
        return
      }

      const user = await new GitLabAPI(
        instanceUrl,
        tokens.accessToken
      ).getCurrentUser()

      if (!this.isMounted || request !== this.oauthRequest) {
        return
      }

      await this.accounts.saveOAuthAccount(
        { instanceUrl, username: user.username, name: user.name },
        tokens,
        applicationId
      )

      if (!this.isMounted || request !== this.oauthRequest) {
        return
      }

      this.setState({ oauthWaiting: false })
      await this.detect()
    } catch (e) {
      if (!this.isMounted || request !== this.oauthRequest) {
        return
      }

      const message = this.logAndDescribe(
        e,
        'unable to complete the browser sign-in'
      )
      this.setState({ oauthWaiting: false, error: message })
    }
  }

  /** Forget the pending authorization and stay on the sign-in form. */
  private onOAuthCancel = () => {
    ++this.oauthRequest
    this.setState({ oauthWaiting: false })
  }

  private onCopyRedirectUri = () => {
    void writeClipboardText(GitLabOAuthRedirectUri)

    this.setState({ redirectUriCopied: true })
    if (this.redirectUriFeedbackTimeoutId !== null) {
      window.clearTimeout(this.redirectUriFeedbackTimeoutId)
    }

    this.redirectUriFeedbackTimeoutId = window.setTimeout(() => {
      this.redirectUriFeedbackTimeoutId = null
      this.setStateIfMounted({ redirectUriCopied: false })
    }, RedirectUriFeedbackMs)
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

  // #region Merge request review

  /**
   * Open the review of a merge request by its iid: switch to its detail
   * view and load its description, approvals and comments.
   */
  private openMergeRequestReview(iid: number) {
    this.setState({
      openMergeRequestIid: iid,
      mergeRequestDetail: null,
      mergeRequestDetailLoading: false,
      mergeRequestDetailError: null,
      approvals: null,
      approvalsLoading: false,
      approving: false,
      approvalsError: null,
      notes: [],
      notesLoading: false,
      notesLoaded: false,
      notesError: null,
      noteDraft: '',
      addingNote: false,
    })
    void this.loadMergeRequestDetail(iid)
  }

  /** Close the review and go back to the lists of merge requests. */
  private onBackToMergeRequests = () => {
    // Invalidate any detail, approval or note still loading.
    ++this.mergeRequestDetailRequest
    ++this.approvalsRequest
    ++this.notesRequest

    this.setState({
      openMergeRequestIid: null,
      mergeRequestDetail: null,
      mergeRequestDetailLoading: false,
      mergeRequestDetailError: null,
      approvals: null,
      approvalsLoading: false,
      approving: false,
      approvalsError: null,
      notes: [],
      notesLoading: false,
      notesLoaded: false,
      notesError: null,
      noteDraft: '',
      addingNote: false,
    })
  }

  private async loadMergeRequestDetail(iid: number) {
    const { remote, api } = this.stateAPI()
    if (remote === null || api === null) {
      return
    }

    const request = ++this.mergeRequestDetailRequest
    this.setState({
      mergeRequestDetailLoading: true,
      mergeRequestDetailError: null,
    })

    try {
      const detail = await api.getMergeRequest(remote.projectPath, iid)
      if (
        !this.isMounted ||
        request !== this.mergeRequestDetailRequest ||
        this.state.openMergeRequestIid !== iid
      ) {
        return
      }

      this.setState({
        mergeRequestDetail: detail,
        mergeRequestDetailLoading: false,
      })
      void this.loadApprovals(iid)
      void this.loadNotes(iid)
    } catch (e) {
      if (
        !this.isMounted ||
        request !== this.mergeRequestDetailRequest ||
        this.state.openMergeRequestIid !== iid
      ) {
        return
      }

      const message = this.logAndDescribe(
        e,
        `unable to load the merge request !${iid}`
      )
      this.setState({
        mergeRequestDetailLoading: false,
        mergeRequestDetailError: message,
      })
    }
  }

  private async loadApprovals(iid: number) {
    const { remote, api } = this.stateAPI()
    if (remote === null || api === null) {
      return
    }

    const request = ++this.approvalsRequest

    try {
      const approvals = await api.getApprovals(remote.projectPath, iid)
      if (!this.isMounted || request !== this.approvalsRequest) {
        return
      }

      this.setState({
        approvals,
        approvalsLoading: false,
        approving: false,
        approvalsError: null,
      })
    } catch (e) {
      if (!this.isMounted || request !== this.approvalsRequest) {
        return
      }

      const message = this.logAndDescribe(
        e,
        `unable to load the approvals of the merge request !${iid}`
      )
      this.setState({
        approvalsLoading: false,
        approving: false,
        approvalsError: message,
      })
    }
  }

  private onApproveClicked = () => void this.setApproval(true)

  private onRevokeApprovalClicked = () => void this.setApproval(false)

  /** Approve or un-approve the reviewed merge request as the current user. */
  private async setApproval(approve: boolean) {
    const { remote, api } = this.stateAPI()
    const iid = this.state.openMergeRequestIid

    if (
      remote === null ||
      api === null ||
      iid === null ||
      this.state.approving
    ) {
      return
    }

    this.setState({ approving: true, approvalsError: null })

    try {
      if (approve) {
        await api.approve(remote.projectPath, iid)
      } else {
        await api.unapprove(remote.projectPath, iid)
      }

      await this.loadApprovals(iid)
    } catch (e) {
      if (!this.isMounted) {
        return
      }

      const message = this.logAndDescribe(
        e,
        `unable to ${
          approve ? 'approve' : 'revoke the approval of'
        } the merge request !${iid}`
      )
      this.setState({
        approving: false,
        approvalsError: message,
      })
    }
  }

  private async loadNotes(iid: number) {
    const { remote, api } = this.stateAPI()
    if (remote === null || api === null) {
      return
    }

    const request = ++this.notesRequest

    try {
      const notes = await api.listNotes(remote.projectPath, iid)
      if (!this.isMounted || request !== this.notesRequest) {
        return
      }

      this.setState({
        notes,
        notesLoading: false,
        notesLoaded: true,
        notesError: null,
      })
    } catch (e) {
      if (!this.isMounted || request !== this.notesRequest) {
        return
      }

      const message = this.logAndDescribe(
        e,
        `unable to load the comments of the merge request !${iid}`
      )
      this.setState({
        notesLoading: false,
        notesLoaded: true,
        notesError: message,
      })
    }
  }

  private onNoteDraftChanged = (value: string) => {
    this.setState({ noteDraft: value })
  }

  private onAddCommentClicked = () => void this.addComment()

  /** Post the comment drafted for the reviewed merge request. */
  private async addComment() {
    const { remote, api } = this.stateAPI()
    const iid = this.state.openMergeRequestIid
    const body = this.state.noteDraft.trim()

    if (
      remote === null ||
      api === null ||
      iid === null ||
      body.length === 0 ||
      this.state.addingNote
    ) {
      return
    }

    this.setState({ addingNote: true, notesError: null })

    try {
      await api.addNote(remote.projectPath, iid, body)
      if (!this.isMounted) {
        return
      }

      this.setState({ noteDraft: '', addingNote: false })
      await this.loadNotes(iid)
    } catch (e) {
      if (!this.isMounted) {
        return
      }

      const message = this.logAndDescribe(
        e,
        `unable to add a comment to the merge request !${iid}`
      )
      this.setState({ addingNote: false, notesError: message })
    }
  }

  // #endregion

  private openInBrowser = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    void this.props.dispatcher.openInBrowser(event.currentTarget.href)
  }

  private openIssue = (issue: IGitLabIssue) => {
    void this.props.dispatcher.openInBrowser(issue.webUrl)
  }

  /** Open the review of the merge request of the clicked row, by its iid. */
  private onMergeRequestClicked = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const iid = Number(event.currentTarget.dataset.iid)
    if (Number.isFinite(iid) && this.state.openMergeRequestIid === null) {
      this.openMergeRequestReview(iid)
    }
  }

  /** Open the review of the merge request of the current branch. */
  private onCurrentMergeRequestClicked = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const iid = Number(event.currentTarget.dataset.iid)
    if (Number.isFinite(iid) && this.state.openMergeRequestIid === null) {
      this.openMergeRequestReview(iid)
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
        if (this.state.oauthWaiting) {
          return
        }
        void this.signIn()
        break
      case GitLabPhase.SignedIn:
        if (
          this.state.tab === GitLabTab.MergeRequests &&
          this.state.currentMergeRequest === null &&
          this.state.openMergeRequestIid === null
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
            disabled={this.state.oauthWaiting}
          >
            Sign in
          </Button>
        </div>
        {this.renderOAuthSignIn()}
      </div>
    )
  }

  /** The browser sign-in section under the token sign-in. */
  private renderOAuthSignIn() {
    return (
      <div className="arbor-gitlab-oauth">
        <p className="arbor-gitlab-oauth-explanation">
          Or sign in with your browser. Create an application in GitLab &gt;
          Preferences &gt; Applications with the `api` scope and the redirect
          URI below.
        </p>
        <div className="arbor-gitlab-redirect">
          <code className="arbor-gitlab-redirect-uri">
            {GitLabOAuthRedirectUri}
          </code>
          <Button
            className="arbor-gitlab-copy-redirect"
            onClick={this.onCopyRedirectUri}
            ariaLabel="Copy the redirect URI"
          >
            {this.state.redirectUriCopied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <TextBox
          label="Application ID"
          className="arbor-gitlab-application-id"
          placeholder="The ID of your GitLab application"
          value={this.state.oauthApplicationId}
          onValueChanged={this.onOAuthApplicationIdChanged}
          disabled={this.state.oauthWaiting}
        />
        {this.state.oauthWaiting ? (
          <div className="arbor-gitlab-oauth-waiting">
            <span className="arbor-gitlab-oauth-waiting-text">
              {__DARWIN__
                ? 'Waiting for Authorization in Your Browser…'
                : 'Waiting for authorization in your browser…'}
            </span>
            <Button
              className="arbor-gitlab-oauth-cancel"
              onClick={this.onOAuthCancel}
              ariaLabel="Cancel the browser sign-in"
            >
              {__DARWIN__ ? 'Cancel' : 'Cancel'}
            </Button>
          </div>
        ) : (
          <Button
            className="arbor-gitlab-oauth-sign-in"
            onClick={this.onSignInWithBrowser}
            ariaLabel="Sign in with the browser"
          >
            {__DARWIN__ ? 'Sign In With Browser' : 'Sign in with browser'}
          </Button>
        )}
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

    if (this.state.openMergeRequestIid !== null) {
      return (
        <div className="arbor-gitlab-tab-body">
          {this.renderMergeRequestDetail()}
        </div>
      )
    }

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
      <button
        type="button"
        className="arbor-gitlab-mr arbor-gitlab-mr-summary"
        data-iid={mergeRequest.iid}
        aria-label={'Review merge request ' + mergeRequest.title}
        onClick={this.onCurrentMergeRequestClicked}
      >
        <span className="arbor-gitlab-mr-heading">
          {mergeRequest.draft && (
            <span className="arbor-gitlab-draft">Draft</span>
          )}
          <span className="arbor-gitlab-mr-title">{mergeRequest.title}</span>
        </span>
        <span className="arbor-gitlab-mr-meta">
          <span className="arbor-gitlab-mr-iid">!{mergeRequest.iid}</span>
          <span className="arbor-gitlab-mr-branches">
            {mergeRequest.sourceBranch} → {mergeRequest.targetBranch}
          </span>
          {mergeRequest.author.length > 0 ? (
            <span className="arbor-gitlab-mr-author">
              {__DARWIN__ ? 'By' : 'by'} {mergeRequest.author}
            </span>
          ) : null}
        </span>
      </button>
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

  /** The review of an open merge request: details, approvals, comments. */
  private renderMergeRequestDetail() {
    const {
      mergeRequestDetail: detail,
      mergeRequestDetailLoading,
      mergeRequestDetailError,
    } = this.state

    return (
      <div className="arbor-gitlab-mr-detail">
        <div className="arbor-gitlab-mr-detail-header">
          <Button
            className="arbor-gitlab-mr-back"
            onClick={this.onBackToMergeRequests}
            ariaLabel="Back to the merge requests"
          >
            Back
          </Button>
          {detail !== null && (
            <a
              className="arbor-gitlab-link arbor-gitlab-open-gitlab"
              href={detail.webUrl}
              onClick={this.openInBrowser}
              aria-label="Open this merge request in GitLab"
            >
              Open in GitLab
            </a>
          )}
        </div>
        {detail === null
          ? mergeRequestDetailError !== null
            ? this.renderTabError(mergeRequestDetailError)
            : mergeRequestDetailLoading
            ? this.renderStatus(
                __DARWIN__ ? 'Loading Merge Request…' : 'Loading merge request…'
              )
            : null
          : this.renderMergeRequestDetailBody(detail)}
      </div>
    )
  }

  private renderMergeRequestDetailBody(detail: IGitLabMergeRequestDetails) {
    const mergeStatus = describeGitLabMergeStatus(detail.mergeStatus)

    return (
      <>
        <div className="arbor-gitlab-mr-detail-info">
          <div className="arbor-gitlab-mr-detail-heading">
            {detail.draft && <span className="arbor-gitlab-draft">Draft</span>}
            <h3 className="arbor-gitlab-mr-detail-title">{detail.title}</h3>
          </div>
          <div className="arbor-gitlab-mr-meta">
            <span className="arbor-gitlab-mr-iid">!{detail.iid}</span>
            <span className="arbor-gitlab-mr-branches">
              {detail.sourceBranch} → {detail.targetBranch}
            </span>
            {detail.author.length > 0 ? (
              <span className="arbor-gitlab-mr-author">
                {__DARWIN__ ? 'By' : 'by'} {detail.author}
              </span>
            ) : null}
            {mergeStatus.label.length > 0 ? (
              <span
                className={`arbor-gitlab-mr-merge-status${
                  mergeStatus.needsAttention ? ' warning' : ''
                }`}
              >
                {mergeStatus.label}
              </span>
            ) : null}
          </div>
          {detail.hasConflicts ? (
            <p className="arbor-gitlab-mr-conflicts">
              This merge request has conflicts: resolve them before it can
              merge.
            </p>
          ) : null}
          {detail.description.length > 0 ? (
            <p className="arbor-gitlab-mr-description">{detail.description}</p>
          ) : null}
        </div>
        {this.renderApprovals()}
        {this.renderNotes()}
      </>
    )
  }

  private renderApprovals() {
    const { approvals, approvalsLoading, approvalsError } = this.state

    return (
      <section className="arbor-gitlab-approvals">
        <h3 className="arbor-gitlab-section-title">Approvals</h3>
        {this.renderTabError(approvalsError)}
        {approvals === null ? (
          approvalsLoading ? (
            this.renderStatus('Loading approvals…')
          ) : null
        ) : (
          <>
            <div className="arbor-gitlab-approvals-summary">
              {describeGitLabApprovals(approvals)}
            </div>
            <div className="arbor-gitlab-approvals-actions">
              {approvals.userHasApproved ? (
                <Button
                  className="arbor-gitlab-revoke-approval"
                  onClick={this.onRevokeApprovalClicked}
                  disabled={this.state.approving || approvalsLoading}
                  ariaLabel="Revoke your approval"
                >
                  {__DARWIN__ ? 'Revoke Approval' : 'Revoke approval'}
                </Button>
              ) : approvals.userCanApprove ? (
                <Button
                  className="arbor-gitlab-approve"
                  onClick={this.onApproveClicked}
                  disabled={this.state.approving || approvalsLoading}
                  ariaLabel="Approve this merge request"
                >
                  Approve
                </Button>
              ) : null}
              {this.state.approving ? (
                <span className="arbor-gitlab-status">
                  {__DARWIN__
                    ? 'Saving Your Approval…'
                    : 'Saving your approval…'}
                </span>
              ) : null}
            </div>
          </>
        )}
      </section>
    )
  }

  private renderNotes() {
    const { notes, notesLoading, notesLoaded, notesError } = this.state
    const comments = filterOutSystemNotes(notes)

    return (
      <section className="arbor-gitlab-notes">
        <h3 className="arbor-gitlab-section-title">Comments</h3>
        {this.renderTabError(notesError)}
        {notesLoading && !notesLoaded
          ? this.renderStatus('Loading comments…')
          : notesError === null && comments.length === 0
          ? this.renderStatus('No comment yet.')
          : null}
        {comments.length > 0 ? (
          <ul className="arbor-gitlab-note-list">
            {comments.map(note => (
              <li key={note.id} className="arbor-gitlab-note">
                <div className="arbor-gitlab-note-header">
                  <span className="arbor-gitlab-note-author">
                    @{note.author}
                  </span>
                  <RelativeTime
                    className="arbor-gitlab-note-time"
                    date={new Date(note.createdAt)}
                  />
                </div>
                <div className="arbor-gitlab-note-body">{note.body}</div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="arbor-gitlab-add-note">
          <TextArea
            label="Add a comment"
            textareaClassName="arbor-gitlab-note-draft"
            ariaLabel="Comment"
            placeholder="Write a comment on this merge request"
            value={this.state.noteDraft}
            onValueChanged={this.onNoteDraftChanged}
            disabled={this.state.addingNote}
            rows={3}
          />
          <Button
            className="arbor-gitlab-add-note-button"
            onClick={this.onAddCommentClicked}
            disabled={
              this.state.addingNote || this.state.noteDraft.trim().length === 0
            }
            ariaLabel="Add a comment to this merge request"
          >
            Comment
          </Button>
        </div>
      </section>
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
