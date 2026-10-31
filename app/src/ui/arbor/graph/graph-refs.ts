import { IGraphRef } from '../../../lib/arbor/graph/graph-commits'

/**
 * A ref badge of the graph. Like GitLens and GitKraken, a local branch and
 * its remote counterparts with the same name share one badge.
 */
export interface IGraphRefBadge {
  readonly kind: 'branch' | 'remote' | 'tag' | 'head'
  /** Branch name without remote, tag name, or `HEAD`. */
  readonly name: string
  /** Whether a local branch with this name points here. */
  readonly local: boolean
  /** Remotes (e.g. `origin`) whose branch with this name points here. */
  readonly remotes: ReadonlyArray<string>
  /** Whether this is the checked out branch. */
  readonly current: boolean
}

function splitRemote(name: string): { remote: string; branch: string } {
  const slash = name.indexOf('/')
  return slash === -1
    ? { remote: name, branch: '' }
    : { remote: name.substring(0, slash), branch: name.substring(slash + 1) }
}

/** Group the refs of a commit into badges, current branch first. */
export function groupRefs(
  refs: ReadonlyArray<IGraphRef>,
  currentBranch: string | null
): ReadonlyArray<IGraphRefBadge> {
  const branches = new Map<string, { local: boolean; remotes: string[] }>()
  const others = new Array<IGraphRefBadge>()

  for (const ref of refs) {
    if (ref.type === 'local') {
      const entry = branches.get(ref.name) ?? { local: false, remotes: [] }
      entry.local = true
      branches.set(ref.name, entry)
    } else if (ref.type === 'remote') {
      const { remote, branch } = splitRemote(ref.name)
      const entry = branches.get(branch) ?? { local: false, remotes: [] }
      entry.remotes.push(remote)
      branches.set(branch, entry)
    } else {
      others.push({
        kind: ref.type,
        name: ref.name,
        local: false,
        remotes: [],
        current: false,
      })
    }
  }

  const badges: Array<IGraphRefBadge> = [...branches].map(([name, e]) => ({
    kind: e.local ? 'branch' : 'remote',
    name: e.local ? name : `${e.remotes[0]}/${name}`,
    local: e.local,
    remotes: e.remotes,
    current: e.local && name === currentBranch,
  }))

  const rank = (b: IGraphRefBadge) =>
    b.current
      ? 0
      : b.kind === 'head'
      ? 1
      : b.kind === 'branch'
      ? 2
      : b.kind === 'remote'
      ? 3
      : 4
  return [...badges, ...others].sort((a, b) => rank(a) - rank(b))
}

/** Up to two initials of an author name, for the avatar nodes. */
export function getInitials(name: string): string {
  const words = name
    .replace(/[<>()[\]"]/g, ' ')
    .split(/[\s._-]+/)
    .filter(w => w.length > 0)

  if (words.length === 0) {
    return '?'
  }
  const first = words[0].charAt(0)
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : ''
  return (first + last).toUpperCase()
}
