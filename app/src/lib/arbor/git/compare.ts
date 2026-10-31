import { Commit } from '../../../models/commit'
import { Repository } from '../../../models/repository'
import {
  getAheadBehind,
  getBranchMergeBaseChangedFiles,
  getCommits,
  getMergeBase,
  IChangesetData,
  revRange,
  revSymmetricDifference,
} from '../../git'

/** Default maximum number of commits loaded on each side of a comparison. */
export const DefaultComparisonCommitLimit = 250

/** The result of comparing a `head` ref against a `base` ref. */
export interface IBranchComparison {
  readonly base: string
  readonly head: string

  /** The common ancestor of both refs, or null if they share no history. */
  readonly mergeBase: string | null

  /** Number of commits in `head` that are not in `base`. */
  readonly ahead: number

  /** Number of commits in `base` that are not in `head`. */
  readonly behind: number

  /** Commits in `head` that are not in `base`, newest first (capped). */
  readonly commitsAhead: ReadonlyArray<Commit>

  /** Commits in `base` that are not in `head`, newest first (capped). */
  readonly commitsBehind: ReadonlyArray<Commit>

  /**
   * Files `head` changes since the merge base, i.e. what merging `head` into
   * `base` would bring. Null when the refs share no history.
   */
  readonly changes: IChangesetData | null
}

/**
 * Compare `head` against `base` (both any commit-ish: branch, tag, SHA).
 *
 * Throws if either ref can't be resolved.
 */
export async function compareBranches(
  repository: Repository,
  base: string,
  head: string,
  commitLimit: number = DefaultComparisonCommitLimit
): Promise<IBranchComparison> {
  // `--left-right --count A...B` counts commits only in A, then only in B.
  const aheadBehind = await getAheadBehind(
    repository,
    revSymmetricDifference(head, base)
  )

  if (aheadBehind === null) {
    throw new Error(`Unable to compare '${head}' with '${base}'.`)
  }

  const [mergeBase, commitsAhead, commitsBehind] = await Promise.all([
    getMergeBase(repository, base, head),
    getCommits(repository, revRange(base, head), commitLimit),
    getCommits(repository, revRange(head, base), commitLimit),
  ])

  const changes =
    mergeBase === null
      ? null
      : await getBranchMergeBaseChangedFiles(repository, base, head, head)

  return {
    base,
    head,
    mergeBase,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    commitsAhead,
    commitsBehind,
    changes,
  }
}

/** A short human readable summary, e.g. "feature is 2 commits ahead of and 1 commit behind main". */
export function describeComparison(
  comparison: Pick<IBranchComparison, 'base' | 'head' | 'ahead' | 'behind'>
): string {
  const { base, head, ahead, behind } = comparison
  const commits = (n: number) => `${n} ${n === 1 ? 'commit' : 'commits'}`

  if (ahead === 0 && behind === 0) {
    return `${head} and ${base} are identical`
  }

  if (behind === 0) {
    return `${head} is ${commits(ahead)} ahead of ${base}`
  }

  if (ahead === 0) {
    return `${head} is ${commits(behind)} behind ${base}`
  }

  return `${head} is ${commits(ahead)} ahead of and ${commits(
    behind
  )} behind ${base}`
}
