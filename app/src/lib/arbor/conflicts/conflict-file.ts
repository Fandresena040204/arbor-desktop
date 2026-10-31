/**
 * Parsing and resolution of files containing Git conflict markers, for the
 * built-in 3-way merge tool. Both the default (`merge`) and the `diff3` /
 * `zdiff3` marker styles are supported.
 */

const oursMarker = /^<{7}(?: (.*))?$/
const baseMarker = /^\|{7}(?: (.*))?$/
const separatorMarker = /^={7}$/
const theirsMarker = /^>{7}(?: (.*))?$/

/** Lines outside of any conflict. */
export interface ICommonSegment {
  readonly kind: 'common'
  readonly lines: ReadonlyArray<string>
}

/** One conflict, with the lines of each side (without the markers). */
export interface IConflictSegment {
  readonly kind: 'conflict'
  /** Position of this conflict among the file's conflicts, from 0. */
  readonly index: number
  readonly ours: ReadonlyArray<string>
  /** The merge base lines, or null without diff3 markers. */
  readonly base: ReadonlyArray<string> | null
  readonly theirs: ReadonlyArray<string>
  /** Text after the `<<<<<<<` marker, usually `HEAD`. */
  readonly oursLabel: string
  readonly baseLabel: string
  /** Text after the `>>>>>>>` marker, usually the incoming branch. */
  readonly theirsLabel: string
}

export type ConflictFileSegment = ICommonSegment | IConflictSegment

export interface IParsedConflictFile {
  readonly segments: ReadonlyArray<ConflictFileSegment>
  /** Line ending used by the file. */
  readonly eol: '\n' | '\r\n'
  /** Whether the file ends with a line ending. */
  readonly trailingEol: boolean
  readonly conflictCount: number
}

/** How to resolve one conflict. */
export type ConflictChoice =
  | 'ours'
  | 'theirs'
  | 'base'
  | 'ours-then-theirs'
  | 'theirs-then-ours'
  | { readonly custom: ReadonlyArray<string> }

/** Split a conflicted file into common and conflict segments. */
export function parseConflictFile(text: string): IParsedConflictFile {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const trailingEol = text.endsWith('\n')
  const body = trailingEol ? text.slice(0, -eol.length) : text
  const lines = body.length === 0 ? [] : body.split(/\r?\n/)

  const segments = new Array<ConflictFileSegment>()
  let common = new Array<string>()
  let conflictCount = 0

  const flushCommon = () => {
    if (common.length > 0) {
      segments.push({ kind: 'common', lines: common })
      common = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const start = oursMarker.exec(lines[i])
    if (start === null) {
      common.push(lines[i++])
      continue
    }

    // Try to read a whole conflict; if it's unterminated, keep the lines as is.
    const ours = new Array<string>()
    let base: Array<string> | null = null
    const theirs = new Array<string>()
    let baseLabel = ''
    let theirsLabel = ''
    let section: 'ours' | 'base' | 'theirs' = 'ours'
    let end = -1

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      const baseMatch = section === 'ours' ? baseMarker.exec(line) : null
      if (baseMatch !== null) {
        section = 'base'
        base = []
        baseLabel = baseMatch[1] ?? ''
      } else if (section !== 'theirs' && separatorMarker.test(line)) {
        section = 'theirs'
      } else if (section === 'theirs' && theirsMarker.test(line)) {
        theirsLabel = theirsMarker.exec(line)![1] ?? ''
        end = j
        break
      } else if (section === 'ours') {
        ours.push(line)
      } else if (section === 'base') {
        base!.push(line)
      } else {
        theirs.push(line)
      }
    }

    if (end === -1) {
      common.push(lines[i++])
      continue
    }

    flushCommon()
    segments.push({
      kind: 'conflict',
      index: conflictCount++,
      ours,
      base,
      theirs,
      oursLabel: start[1] ?? '',
      baseLabel,
      theirsLabel,
    })
    i = end + 1
  }

  flushCommon()
  return { segments, eol, trailingEol, conflictCount }
}

function markerLine(marker: string, label: string) {
  return label.length > 0 ? `${marker} ${label}` : marker
}

function conflictLines(segment: IConflictSegment): ReadonlyArray<string> {
  return [
    markerLine('<<<<<<<', segment.oursLabel),
    ...segment.ours,
    ...(segment.base === null
      ? []
      : [markerLine('|||||||', segment.baseLabel), ...segment.base]),
    '=======',
    ...segment.theirs,
    markerLine('>>>>>>>', segment.theirsLabel),
  ]
}

function chosenLines(
  segment: IConflictSegment,
  choice: ConflictChoice
): ReadonlyArray<string> {
  if (typeof choice === 'object') {
    return choice.custom
  }

  switch (choice) {
    case 'ours':
      return segment.ours
    case 'theirs':
      return segment.theirs
    case 'base':
      return segment.base ?? []
    case 'ours-then-theirs':
      return [...segment.ours, ...segment.theirs]
    case 'theirs-then-ours':
      return [...segment.theirs, ...segment.ours]
  }
}

/**
 * Build the file content, replacing each conflict that has a choice by the
 * chosen lines. Conflicts without a choice keep their markers.
 */
export function resolveConflictFile(
  file: IParsedConflictFile,
  choices: ReadonlyMap<number, ConflictChoice>
): { readonly text: string; readonly unresolvedCount: number } {
  const lines = new Array<string>()
  let unresolvedCount = 0

  for (const segment of file.segments) {
    if (segment.kind === 'common') {
      lines.push(...segment.lines)
      continue
    }

    const choice = choices.get(segment.index)
    if (choice === undefined) {
      unresolvedCount++
      lines.push(...conflictLines(segment))
    } else {
      lines.push(...chosenLines(segment, choice))
    }
  }

  const text =
    lines.join(file.eol) +
    (file.trailingEol && lines.length > 0 ? file.eol : '')
  return { text, unresolvedCount }
}

/** Rebuild the original text of a parsed file. */
export function serializeConflictFile(file: IParsedConflictFile): string {
  return resolveConflictFile(file, new Map()).text
}
