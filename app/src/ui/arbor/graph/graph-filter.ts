/**
 * Filtering of the commits displayed in the graph view.
 *
 * The filter is a set of whitespace separated terms: every term must match
 * either the summary, the SHA, the author or one of the refs of a commit.
 */

/** The bits of a graph commit the filter can search in. */
export interface IGraphFilterableCommit {
  readonly sha: string
  readonly shortSha: string
  readonly summary: string
  readonly authorName: string
  readonly authorEmail: string
  readonly refs: ReadonlyArray<{ readonly name: string }>
}

/** Parse the filter into lowercase terms, ignoring whitespace. */
export function filterToTerms(filter: string): ReadonlyArray<string> {
  return filter
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(term => term.length > 0)
}

/** Whether the commit matches the filter (an empty filter matches all). */
export function doesCommitMatchFilter(
  commit: IGraphFilterableCommit,
  filter: string
): boolean {
  const terms = filterToTerms(filter)
  if (terms.length === 0) {
    return true
  }

  const fields = [
    commit.sha,
    commit.shortSha,
    commit.summary,
    commit.authorName,
    commit.authorEmail,
    ...commit.refs.map(ref => ref.name),
  ]

  const haystack = fields.join(' ').toLowerCase()
  return terms.every(term => haystack.includes(term))
}
