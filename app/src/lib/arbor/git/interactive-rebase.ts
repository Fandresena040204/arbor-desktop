import { GitError } from 'dugite'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

import { Repository } from '../../../models/repository'
import { git } from '../../git/core'
import { getCommits } from '../../git/log'
import {
  abortRebase,
  getRebaseInternalState,
  rebaseInteractive,
  RebaseResult,
} from '../../git/rebase'
import { revRange } from '../../git/rev-list'
import { pathExists } from '../../path-exists'

/** The action applied to a commit by an interactive rebase. */
export type RebaseTodoAction =
  | 'pick'
  | 'reword'
  | 'edit'
  | 'squash'
  | 'fixup'
  | 'drop'

/** A single line of an interactive rebase plan. */
export interface IRebaseTodoEntry {
  readonly action: RebaseTodoAction
  readonly sha: string
  readonly summary: string
  /**
   * New full message for 'reword' (required), or for the resulting commit of a
   * squash group (optional, on the LAST squash/fixup entry of the group).
   */
  readonly message?: string
}

/** The possible outcomes of an interactive rebase. */
export type InteractiveRebaseOutcome =
  | 'completed'
  | 'conflicts'
  | 'stopped-for-edit'
  | 'error'

/** The directory used to persist todo and message files across rebase stops. */
const RebaseDirectoryName = 'arbor-rebase'

/**
 * Get the commits after `baseRef` up to HEAD, oldest first, all marked as
 * 'pick'.
 *
 * @param repository The repository to read the history from.
 * @param baseRef The commit before the first one to rebase, or null to start
 * from the root commit.
 */
export async function getRebasePlan(
  repository: Repository,
  baseRef: string | null
): Promise<ReadonlyArray<IRebaseTodoEntry>> {
  const commits = await getCommits(
    repository,
    baseRef === null ? undefined : revRange(baseRef, 'HEAD')
  )

  return commits
    .slice()
    .reverse()
    .map(commit => ({
      action: 'pick' as const,
      sha: commit.sha,
      summary: commit.summary,
    }))
}

/**
 * Validate a rebase plan.
 *
 * @returns An error message describing the first problem found, or null when
 * the plan is valid.
 */
export function validateRebasePlan(
  entries: ReadonlyArray<IRebaseTodoEntry>
): string | null {
  const firstKeptEntry = entries.find(entry => entry.action !== 'drop')

  if (firstKeptEntry === undefined) {
    return 'The rebase plan must keep at least one commit.'
  }

  if (firstKeptEntry.action === 'squash' || firstKeptEntry.action === 'fixup') {
    return `The first kept commit cannot be '${firstKeptEntry.action}'.`
  }

  for (const entry of entries) {
    if (
      entry.action === 'reword' &&
      (entry.message === undefined || entry.message.trim().length === 0)
    ) {
      return `The 'reword' entry for ${entry.sha} requires a message.`
    }
  }

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.sha)) {
      return `The rebase plan contains the commit ${entry.sha} more than once.`
    }
    seen.add(entry.sha)
  }

  return null
}

/** Whether the action folds a commit into the previous one. */
function isSquashOrFixup(entry: IRebaseTodoEntry) {
  return entry.action === 'squash' || entry.action === 'fixup'
}

/**
 * Convert a filesystem path to a path usable by Git's shell commands on every
 * platform.
 */
function toGitPath(path: string) {
  return path.replace(/\\/g, '/')
}

/** Quote a path so it can be embedded in a double quoted shell argument. */
function quoteGitPath(path: string) {
  return `"${toGitPath(path).replace(/["$`]/g, character => `\\${character}`)}"`
}

/** Build the `exec` command used to rewrite a commit message from a file. */
function buildAmendCommand(path: string) {
  return `exec git commit --amend --allow-empty --only -F ${quoteGitPath(path)}`
}

/**
 * Build the text of the todo list consumed by `git rebase -i`.
 *
 * A 'reword' entry is emitted as a `pick` followed by an `exec` that amends the
 * commit message, which avoids having to drive GIT_EDITOR. A squash/fixup group
 * whose last entry carries a message gets the same `exec` after the group.
 *
 * @param entries The plan to serialize.
 * @param messageFile Returns the path of the file holding `entries[index]`'s
 * message.
 */
export function buildRebaseTodo(
  entries: ReadonlyArray<IRebaseTodoEntry>,
  messageFile: (index: number) => string
): string {
  const lines = new Array<string>()

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    if (entry.action === 'reword') {
      lines.push(`pick ${entry.sha} ${entry.summary}`)
      lines.push(buildAmendCommand(messageFile(i)))
      continue
    }

    lines.push(`${entry.action} ${entry.sha} ${entry.summary}`)

    if (!isSquashOrFixup(entry)) {
      continue
    }

    const isLastInGroup =
      i === entries.length - 1 || !isSquashOrFixup(entries[i + 1])

    if (
      isLastInGroup &&
      entry.message !== undefined &&
      entry.message.trim().length > 0
    ) {
      lines.push(buildAmendCommand(messageFile(i)))
    }
  }

  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * Resolve the git directory of a repository.
 *
 * `git rev-parse --git-dir` can return a path relative to the working
 * directory, and points at the per-worktree administrative directory when the
 * repository is a linked worktree.
 */
async function getGitDir(repository: Repository) {
  const { stdout } = await git(
    ['rev-parse', '--git-dir'],
    repository.path,
    'getInteractiveRebaseGitDir'
  )

  return resolve(repository.path, stdout.trim())
}

/** Get the directory where todo and message files are persisted. */
async function getRebaseDirectory(repository: Repository) {
  return join(await getGitDir(repository), RebaseDirectoryName)
}

/** Remove the persisted todo and message files. */
async function removeRebaseDirectory(repository: Repository) {
  const directory = await getRebaseDirectory(repository)
  await rm(directory, { recursive: true, force: true })
}

/** Whether a rebase is currently in progress in the repository. */
async function isRebaseInProgress(repository: Repository) {
  const gitDir = await getGitDir(repository)

  for (const marker of ['rebase-merge', 'rebase-apply']) {
    if (await pathExists(join(gitDir, marker))) {
      return true
    }
  }

  return (await getRebaseInternalState(repository)) !== null
}

/** Whether the working directory contains unresolved conflicts. */
async function hasUnmergedFiles(repository: Repository) {
  const { stdout } = await git(
    ['diff', '--name-only', '--diff-filter=U'],
    repository.path,
    'getInteractiveRebaseUnmergedFiles'
  )

  return stdout.trim().length > 0
}

/** Classify an outcome while a rebase is still in progress. */
async function classifyInProgressOutcome(
  repository: Repository
): Promise<InteractiveRebaseOutcome> {
  return (await hasUnmergedFiles(repository)) ? 'conflicts' : 'stopped-for-edit'
}

/**
 * Turn the state left behind by a Git command into an outcome.
 *
 * A rebase that stopped for an `edit` or for a conflict is still in progress
 * even when Git exits successfully, so the repository state takes precedence
 * over the reported result.
 */
async function resolveOutcome(
  repository: Repository,
  result: RebaseResult
): Promise<InteractiveRebaseOutcome> {
  if (await isRebaseInProgress(repository)) {
    return classifyInProgressOutcome(repository)
  }

  // Nothing is in progress anymore, so the persisted files are of no use.
  await removeRebaseDirectory(repository)
  return result === RebaseResult.Error ? 'error' : 'completed'
}

/**
 * Run an interactive rebase described by `entries`.
 *
 * @param repository The repository to rebase.
 * @param baseRef The commit before the first one to rebase, or null to start
 * from the root commit.
 * @param entries The ordered plan, oldest commit first.
 *
 * @throws When the plan is invalid.
 */
export async function runInteractiveRebase(
  repository: Repository,
  baseRef: string | null,
  entries: ReadonlyArray<IRebaseTodoEntry>
): Promise<InteractiveRebaseOutcome> {
  const validationError = validateRebasePlan(entries)

  if (validationError !== null) {
    throw new Error(validationError)
  }

  const directory = await getRebaseDirectory(repository)
  const todoPath = join(directory, 'todo.txt')

  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })

  for (let i = 0; i < entries.length; i++) {
    const message = entries[i].message

    if (message !== undefined) {
      await writeFile(join(directory, `message-${i}.txt`), message)
    }
  }

  await writeFile(
    todoPath,
    buildRebaseTodo(entries, i => join(directory, `message-${i}.txt`))
  )

  let result: RebaseResult

  try {
    result = await rebaseInteractive(repository, toGitPath(todoPath), baseRef, {
      gitEditor: ':',
    })
  } catch (e) {
    log.error('[interactive-rebase] failed to run the interactive rebase', e)

    return (await isRebaseInProgress(repository))
      ? classifyInProgressOutcome(repository)
      : 'error'
  }

  return resolveOutcome(repository, result)
}

/**
 * Continue the interactive rebase after an `edit` stop or after conflicts have
 * been resolved.
 */
export async function continueInteractiveRebase(
  repository: Repository
): Promise<InteractiveRebaseOutcome> {
  if (!(await isRebaseInProgress(repository))) {
    return 'error'
  }

  try {
    const result = await git(
      ['rebase', '--continue'],
      repository.path,
      'continueInteractiveRebase',
      {
        expectedErrors: new Set([
          GitError.RebaseConflicts,
          GitError.UnresolvedConflicts,
        ]),
        env: { GIT_EDITOR: ':' },
      }
    )

    const rebaseResult =
      result.exitCode === 0
        ? RebaseResult.CompletedWithoutError
        : result.gitError === GitError.RebaseConflicts
        ? RebaseResult.ConflictsEncountered
        : result.gitError === GitError.UnresolvedConflicts
        ? RebaseResult.OutstandingFilesNotStaged
        : RebaseResult.Error

    return resolveOutcome(repository, rebaseResult)
  } catch (e) {
    log.error(
      '[interactive-rebase] failed to continue the interactive rebase',
      e
    )

    return (await isRebaseInProgress(repository))
      ? classifyInProgressOutcome(repository)
      : 'error'
  }
}

/** Abort the interactive rebase, if any, and remove the persisted files. */
export async function abortInteractiveRebase(
  repository: Repository
): Promise<void> {
  try {
    if (await isRebaseInProgress(repository)) {
      await abortRebase(repository)
    }
  } finally {
    await removeRebaseDirectory(repository)
  }
}
