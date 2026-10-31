import {
  ConflictChoice,
  IConflictSegment,
  IParsedConflictFile,
  resolveConflictFile,
} from '../../../lib/arbor/conflicts/conflict-file'

/** The conflicts of a parsed file, in order. */
export function getConflicts(
  file: IParsedConflictFile
): ReadonlyArray<IConflictSegment> {
  return file.segments.filter(
    (s): s is IConflictSegment => s.kind === 'conflict'
  )
}

/**
 * The conflict to move to from `active`, cycling through the conflicts.
 * Returns `active` when there's nothing to move to.
 */
export function getAdjacentConflict(
  file: IParsedConflictFile,
  active: number,
  direction: 'previous' | 'next'
): number {
  const count = file.conflictCount
  if (count === 0) {
    return active
  }
  const step = direction === 'next' ? 1 : -1
  return (((active + step) % count) + count) % count
}

/** The same choice for every conflict of the file. */
export function chooseForAll(
  file: IParsedConflictFile,
  choice: ConflictChoice
): ReadonlyMap<number, ConflictChoice> {
  return new Map(getConflicts(file).map(c => [c.index, choice]))
}

/** The lines a conflict resolves to with the given choice. */
export function getResolvedLines(
  conflict: IConflictSegment,
  choice: ConflictChoice
): ReadonlyArray<string> {
  const { text } = resolveConflictFile(
    { segments: [conflict], eol: '\n', trailingEol: false, conflictCount: 1 },
    new Map([[conflict.index, choice]])
  )
  return text.length === 0 ? [] : text.split('\n')
}

/** Whether a file's content looks binary (contains a NUL character). */
export function isProbablyBinary(content: string): boolean {
  return content.includes('\0')
}
