import {
  parseGitLabRemote,
  IGitLabRemote,
} from '../../../lib/arbor/gitlab/gitlab-remote'
import { GitLabPipelineStatus } from '../../../lib/arbor/gitlab/gitlab-api'

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
