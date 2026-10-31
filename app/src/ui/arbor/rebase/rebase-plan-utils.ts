import {
  IRebaseTodoEntry,
  RebaseTodoAction,
} from '../../../lib/arbor/git/interactive-rebase'

/** The direction in which a plan entry can be moved. */
export type RebaseMoveDirection = 'up' | 'down'

/** Whether an action folds the commit into the commit above it. */
export function isSquashOrFixup(action: RebaseTodoAction) {
  return action === 'squash' || action === 'fixup'
}

/**
 * Move the entry at `from` to `to`.
 *
 * @returns The reordered plan, or `entries` itself when the move is a no-op.
 */
export function moveRebaseEntryTo(
  entries: ReadonlyArray<IRebaseTodoEntry>,
  from: number,
  to: number
): ReadonlyArray<IRebaseTodoEntry> {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= entries.length ||
    to >= entries.length
  ) {
    return entries
  }

  const reordered = entries.slice()
  const [entry] = reordered.splice(from, 1)
  reordered.splice(to, 0, entry)

  return reordered
}

/**
 * Move the entry at `index` one position up or down.
 *
 * @returns The reordered plan, or `entries` itself when the move is a no-op.
 */
export function moveRebaseEntry(
  entries: ReadonlyArray<IRebaseTodoEntry>,
  index: number,
  direction: RebaseMoveDirection
): ReadonlyArray<IRebaseTodoEntry> {
  return moveRebaseEntryTo(
    entries,
    index,
    direction === 'up' ? index - 1 : index + 1
  )
}

/**
 * Whether `entries` is still the untouched plan, i.e. every commit is picked
 * in the original order. Such a plan is a no-op and can't be started.
 */
export function isRebasePlanUnchanged(
  original: ReadonlyArray<IRebaseTodoEntry>,
  entries: ReadonlyArray<IRebaseTodoEntry>
): boolean {
  return (
    original.length === entries.length &&
    entries.every(
      (entry, index) =>
        entry.action === 'pick' && entry.sha === original[index].sha
    )
  )
}

/** How a plan entry relates to the commit above it. */
export interface IRebaseEntryGrouping {
  /** Whether the entry is folded into the previous kept commit. */
  readonly indented: boolean
  /** Whether the entry closes a squash/fixup group. */
  readonly endsSquashGroup: boolean
}

/**
 * Group the entries of a plan for display.
 *
 * A squash or fixup entry is indented under the commit it is folded into and
 * the last entry of a group is the one which may carry the message of the
 * combined commit.
 */
export function getRebaseEntryGrouping(
  entries: ReadonlyArray<IRebaseTodoEntry>
): ReadonlyArray<IRebaseEntryGrouping> {
  let keptBefore = false

  return entries.map((entry, index) => {
    const indented = isSquashOrFixup(entry.action) && keptBefore
    const next = entries[index + 1]
    const endsSquashGroup =
      indented && (next === undefined || !isSquashOrFixup(next.action))

    if (entry.action !== 'drop') {
      keptBefore = true
    }

    return { indented, endsSquashGroup }
  })
}

/**
 * The SHA of the first commit marked as 'edit', i.e. the commit a rebase
 * stopped on, or null when the plan doesn't edit any commit.
 */
export function getFirstEditSha(
  entries: ReadonlyArray<IRebaseTodoEntry>
): string | null {
  const entry = entries.find(e => e.action === 'edit')

  return entry === undefined ? null : entry.sha
}
