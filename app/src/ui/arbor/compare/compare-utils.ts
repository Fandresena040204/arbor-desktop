/** Names of the branches offered by the compare dialog, locals first. */
export interface IComparableBranches {
  readonly local: ReadonlyArray<string>
  readonly remote: ReadonlyArray<string>
}

const DefaultBaseCandidates = [
  'main',
  'master',
  'develop',
  'development',
  'origin/main',
  'origin/master',
]

/**
 * Pick the initial base and head refs of the comparison: the given ones if
 * they exist, otherwise the current branch as head and a usual default branch
 * (or the first other branch) as base.
 */
export function getInitialRefs(
  branches: IComparableBranches,
  currentBranch: string | null,
  requested: { readonly base?: string; readonly head?: string }
): { readonly base: string | null; readonly head: string | null } {
  const all = [...branches.local, ...branches.remote]
  const exists = (name: string | undefined | null): name is string =>
    name !== undefined && name !== null && all.includes(name)

  const head = exists(requested.head)
    ? requested.head
    : exists(currentBranch)
    ? currentBranch
    : all[0] ?? null

  const base = exists(requested.base)
    ? requested.base
    : DefaultBaseCandidates.find(c => c !== head && all.includes(c)) ??
      all.find(name => name !== head) ??
      null

  return { base, head }
}

/** "1 file" / "3 files", "1 commit" / "2 commits". */
export function pluralize(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}
