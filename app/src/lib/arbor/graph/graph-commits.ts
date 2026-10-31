import { Repository } from '../../../models/repository'
import { git } from '../../git/core'
import { createLogParser } from '../../git/git-delimiter-parser'

/** A ref pointing at a commit of the graph. */
export interface IGraphRef {
  readonly type: 'head' | 'local' | 'remote' | 'tag'
  /** Short name, e.g. `main`, `origin/main` or `v1.0`. */
  readonly name: string
}

/** A commit as needed to draw the graph. */
export interface IGraphCommit {
  readonly sha: string
  readonly shortSha: string
  /** Parent SHAs, first parent first. Empty for a root commit. */
  readonly parents: ReadonlyArray<string>
  readonly summary: string
  readonly authorName: string
  readonly authorEmail: string
  /** Author date, in milliseconds since the epoch. */
  readonly authorDate: number
  readonly refs: ReadonlyArray<IGraphRef>
  /** Whether HEAD points at this commit. */
  readonly isHead: boolean
}

/**
 * Parse a `%D` decoration produced with `--decorate=full`, e.g.
 * `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`.
 */
export function parseDecorations(decorations: string): {
  readonly refs: ReadonlyArray<IGraphRef>
  readonly isHead: boolean
} {
  const refs = new Array<IGraphRef>()
  let isHead = false

  for (const raw of decorations.split(', ')) {
    let item = raw.trim()
    if (item.length === 0) {
      continue
    }

    if (item === 'HEAD') {
      // Detached HEAD.
      isHead = true
      refs.push({ type: 'head', name: 'HEAD' })
      continue
    }

    if (item.startsWith('HEAD -> ')) {
      isHead = true
      item = item.substring('HEAD -> '.length)
    }

    if (item.startsWith('tag: ')) {
      item = item.substring('tag: '.length)
    }

    if (item.startsWith('refs/heads/')) {
      refs.push({ type: 'local', name: item.substring('refs/heads/'.length) })
    } else if (item.startsWith('refs/remotes/')) {
      const name = item.substring('refs/remotes/'.length)
      // `origin/HEAD` only mirrors the remote's default branch.
      if (!name.endsWith('/HEAD')) {
        refs.push({ type: 'remote', name })
      }
    } else if (item.startsWith('refs/tags/')) {
      refs.push({ type: 'tag', name: item.substring('refs/tags/'.length) })
    }
  }

  return { refs, isHead }
}

/**
 * Load commits reachable from every ref (branches, remotes, tags, HEAD),
 * newest first, with children always listed before their parents.
 */
export async function getGraphCommits(
  repository: Repository,
  limit: number,
  skip: number = 0
): Promise<ReadonlyArray<IGraphCommit>> {
  const { formatArgs, parse } = createLogParser({
    sha: '%H',
    shortSha: '%h',
    parents: '%P',
    summary: '%s',
    authorName: '%an',
    authorEmail: '%ae',
    authorDate: '%at',
    decorations: '%D',
  })

  const result = await git(
    [
      'log',
      '--all',
      'HEAD',
      '--date-order',
      '--decorate=full',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      ...formatArgs,
      '--',
    ],
    repository.path,
    'getGraphCommits',
    // An unborn HEAD makes `git log HEAD` fail.
    { successExitCodes: new Set([0, 128]) }
  )

  if (result.exitCode !== 0) {
    return []
  }

  return parse(result.stdout).map(entry => {
    const { refs, isHead } = parseDecorations(entry.decorations)
    return {
      sha: entry.sha,
      shortSha: entry.shortSha,
      parents: entry.parents.length > 0 ? entry.parents.split(' ') : [],
      summary: entry.summary,
      authorName: entry.authorName,
      authorEmail: entry.authorEmail,
      authorDate: parseInt(entry.authorDate, 10) * 1000,
      refs,
      isHead,
    }
  })
}
