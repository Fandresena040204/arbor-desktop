import {
  parseGitLabRemote,
  IGitLabRemote,
} from '../../../lib/arbor/gitlab/gitlab-remote'
import {
  GitLabPipelineStatus,
  IGitLabMergeRequest,
  IGitLabNote,
} from '../../../lib/arbor/gitlab/gitlab-api'

/** A remote as returned by `getRemotes`, without the extra `IRemote` shape. */
export interface INamedRemote {
  readonly name: string
  readonly url: string
}

/** How to render a pipeline status: its label and dot color class. */
export interface IGitLabPipelineStatusInfo {
  readonly label: string
  readonly className: string
}

/**
 * A merge request with the extra data of its detail view: its description,
 * its merge status and whether it has conflicts.
 */
export interface IGitLabMergeRequestDetails extends IGitLabMergeRequest {
  readonly description: string
  readonly hasConflicts: boolean
  /** The raw `merge_status`/`detailed_merge_status` value of GitLab. */
  readonly mergeStatus: string
}

/**
 * Pick the GitLab remote to show among the repository's remotes, keeping
 * `origin` first and the other remotes in the given order.
 *
 * @param remotes The remotes of the repository.
 * @param instanceUrls The known GitLab instance URLs.
 */
export function chooseGitLabRemote(
  remotes: ReadonlyArray<INamedRemote>,
  instanceUrls: ReadonlyArray<string>
): IGitLabRemote | null {
  const ordered = [
    ...remotes.filter(remote => remote.name === 'origin'),
    ...remotes.filter(remote => remote.name !== 'origin'),
  ]

  for (const remote of ordered) {
    const parsed = parseGitLabRemote(remote.url, instanceUrls)
    if (parsed !== null) {
      return parsed
    }
  }

  return null
}

/** The branch name of a symbolic ref like `refs/heads/main`, or null. */
export function branchOfSymbolicRef(ref: string | null): string | null {
  if (ref === null) {
    return null
  }

  return ref.startsWith('refs/heads/')
    ? ref.substring('refs/heads/'.length)
    : null
}

/** The head of a commit SHA, short enough to display. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

const PipelineStatusClasses: ReadonlyMap<GitLabPipelineStatus, string> =
  new Map([
    ['success', 'success'],
    ['failed', 'failed'],
    ['running', 'running'],
    ['pending', 'pending'],
  ])

const PipelineStatusLabels: ReadonlyMap<GitLabPipelineStatus, string> = new Map(
  [
    ['created', 'Created'],
    ['waiting_for_resource', 'Waiting for resource'],
    ['preparing', 'Preparing'],
    ['pending', 'Pending'],
    ['running', 'Running'],
    ['success', 'Success'],
    ['failed', 'Failed'],
    ['canceled', 'Canceled'],
    ['skipped', 'Skipped'],
    ['manual', 'Manual'],
    ['scheduled', 'Scheduled'],
  ]
)

/**
 * Describe a pipeline status with its display label and the class of its
 * colored dot: green for success, red for failed, blue for running, orange
 * for pending and grey for everything else.
 */
export function describeGitLabPipeline(
  status: GitLabPipelineStatus
): IGitLabPipelineStatusInfo {
  return {
    label: PipelineStatusLabels.get(status) ?? status,
    className: PipelineStatusClasses.get(status) ?? 'idle',
  }
}

/** The title to default to when nothing was supplied for a merge request. */
const FallbackMergeRequestTitle = 'Merge request'

/**
 * Turn a branch name into a human-friendly merge request title, dropping its
 * slash path (like the `feature/` prefix) and joining its pieces:
 * `feature/add-login` becomes "Add login".
 */
export function defaultMergeRequestTitle(branchName: string): string {
  const name = branchName.trim()
  if (name.length === 0) {
    return FallbackMergeRequestTitle
  }

  const segments = name.split('/').filter(segment => segment.length > 0)
  const subject = segments.pop()
  if (subject === undefined) {
    return FallbackMergeRequestTitle
  }

  const words = subject
    .split(/[-_]+/)
    .map(word => word.trim())
    .filter(word => word.length > 0)

  if (words.length === 0) {
    return FallbackMergeRequestTitle
  }

  return words
    .map((word, index) => (index === 0 ? capitalize(word) : word))
    .join(' ')
}

/** Capitalize the first letter of a word, leaving the rest as is. */
function capitalize(word: string): string {
  if (word.length === 0) {
    return word
  }

  const code = word.charCodeAt(0)
  return code >= 65 && code <= 90
    ? word
    : word.charAt(0).toUpperCase() + word.slice(1)
}

/** How to render the merge status of a merge request. */
export interface IGitLabMergeStatusInfo {
  /** The display label, empty when the status is unknown or missing. */
  readonly label: string
  /** True for statuses that prevent (or delay) the merge. */
  readonly needsAttention: boolean
}

const MergeStatusLabels: ReadonlyMap<string, string> = new Map([
  ['can_be_merged', 'Can be merged'],
  ['mergeable', 'Can be merged'],
  ['cannot_be_merged', 'Conflicts'],
  ['conflicts', 'Conflicts'],
  ['cannot_be_merged_rechecking', 'Checking for conflicts'],
  ['unchecked', 'Not checked'],
  ['checking', 'Checking'],
  ['blocked', 'Blocked'],
  ['ci_still_running', 'Pipeline still running'],
  ['ci_missing', 'Pipeline missing'],
  ['ci_must_pass', 'Pipeline must pass'],
  ['external_status_checks', 'Status checks'],
  ['approved_status_checks_failed', 'Status checks failed'],
  ['discussions_not_resolved', 'Unresolved threads'],
  ['policies_denied', 'Merge blocked by policy'],
])

/** The merge statuses that stop the merge request from merging. */
const BlockingMergeStatuses = new Set([
  'cannot_be_merged',
  'conflicts',
  'cannot_be_merged_rechecking',
  'blocked',
  'ci_must_pass',
  'approved_status_checks_failed',
  'discussions_not_resolved',
  'policies_denied',
])

/**
 * Describe a GitLab merge status (from `merge_status` or the more detailed
 * `detailed_merge_status`) with its display label and whether it blocks the
 * merge. Unknown statuses get a readable version of their raw value.
 */
export function describeGitLabMergeStatus(
  status: string
): IGitLabMergeStatusInfo {
  const trimmed = status.trim().toLowerCase()

  if (trimmed.length === 0) {
    return { label: '', needsAttention: false }
  }

  const known = MergeStatusLabels.get(trimmed)
  if (known !== undefined) {
    return { label: known, needsAttention: BlockingMergeStatuses.has(trimmed) }
  }

  return {
    label: prettyGitLabStatus(trimmed),
    needsAttention: BlockingMergeStatuses.has(trimmed),
  }
}

/** Turn a snake-cased status like `ci_still_running` into display words. */
function prettyGitLabStatus(status: string): string {
  const words = status
    .split('_')
    .map(word => word.trim())
    .filter(word => word.length > 0)

  return words.map(word => capitalize(word)).join(' ')
}

/** The shape of the approval state a summary needs. */
export interface IGitLabApprovalsSummaryInput {
  readonly approvalsRequired: number
  /** Usernames of the users who already approved. */
  readonly approvedBy: ReadonlyArray<string>
}

/**
 * Summarize the approval state of a merge request in a single line: the
 * approvers when there are some, otherwise the requirement left, or a line
 * saying no approval is required.
 */
export function describeGitLabApprovals(
  approvals: IGitLabApprovalsSummaryInput
): string {
  const usernames = [
    ...new Set(
      approvals.approvedBy
        .map(name => name.trim())
        .filter(name => name.length > 0)
    ),
  ].map(name => `@${name}`)

  if (usernames.length > 0) {
    return 'Approved by ' + usernames.join(', ')
  }

  return approvalsRequiredLabel(approvals.approvalsRequired)
}

/** The label of the approval requirement, without any approver. */
function approvalsRequiredLabel(approvalsRequired: number): string {
  if (approvalsRequired <= 0) {
    return 'No approvals required'
  }

  return approvalsRequired === 1
    ? '1 approval required'
    : `${approvalsRequired} approvals required`
}

/** The notes which are real comments (system events are not comments). */
export function filterOutSystemNotes(
  notes: ReadonlyArray<IGitLabNote>
): ReadonlyArray<IGitLabNote> {
  return notes.filter(note => !note.system)
}
