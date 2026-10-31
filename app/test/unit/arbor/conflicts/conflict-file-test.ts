import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  IConflictSegment,
  parseConflictFile,
  resolveConflictFile,
  serializeConflictFile,
} from '../../../../src/lib/arbor/conflicts/conflict-file'

const twoConflicts = [
  'header',
  '<<<<<<< HEAD',
  'ours 1',
  '=======',
  'theirs 1',
  '>>>>>>> feature',
  'middle',
  '<<<<<<< HEAD',
  'ours 2a',
  'ours 2b',
  '=======',
  '>>>>>>> feature',
  'footer',
  '',
].join('\n')

const diff3 = [
  '<<<<<<< HEAD',
  'ours',
  '||||||| merged common ancestors',
  'base',
  '=======',
  'theirs',
  '>>>>>>> topic',
  '',
].join('\n')

function conflicts(text: string) {
  return parseConflictFile(text).segments.filter(
    (s): s is IConflictSegment => s.kind === 'conflict'
  )
}

describe('arbor/conflicts/parseConflictFile', () => {
  it('splits common lines and conflicts', () => {
    const file = parseConflictFile(twoConflicts)

    assert.strictEqual(file.conflictCount, 2)
    assert.deepStrictEqual(
      file.segments.map(s => s.kind),
      ['common', 'conflict', 'common', 'conflict', 'common']
    )

    const [first, second] = conflicts(twoConflicts)
    assert.deepStrictEqual(first.ours, ['ours 1'])
    assert.deepStrictEqual(first.theirs, ['theirs 1'])
    assert.strictEqual(first.base, null)
    assert.strictEqual(first.oursLabel, 'HEAD')
    assert.strictEqual(first.theirsLabel, 'feature')
    assert.deepStrictEqual(second.ours, ['ours 2a', 'ours 2b'])
    assert.deepStrictEqual(second.theirs, [])
    assert.strictEqual(second.index, 1)
  })

  it('reads the base of diff3 markers', () => {
    const [conflict] = conflicts(diff3)
    assert.deepStrictEqual(conflict.base, ['base'])
    assert.strictEqual(conflict.baseLabel, 'merged common ancestors')
    assert.deepStrictEqual(conflict.theirs, ['theirs'])
  })

  it('keeps an unterminated conflict as plain lines', () => {
    const text = 'a\n<<<<<<< HEAD\nb\n=======\nc\n'
    const file = parseConflictFile(text)
    assert.strictEqual(file.conflictCount, 0)
    assert.strictEqual(serializeConflictFile(file), text)
  })

  it('does not mistake longer marker-like lines for markers', () => {
    const text = '<<<<<<<< not a marker\n========\n>>>>>>>> nope\n'
    assert.strictEqual(parseConflictFile(text).conflictCount, 0)
  })

  it('round-trips files exactly, including CRLF and missing final newline', () => {
    for (const text of [
      twoConflicts,
      diff3,
      twoConflicts.replace(/\n/g, '\r\n'),
      'no newline at end\n<<<<<<<\nx\n=======\ny\n>>>>>>>',
      '',
    ]) {
      assert.strictEqual(serializeConflictFile(parseConflictFile(text)), text)
    }
  })
})

describe('arbor/conflicts/resolveConflictFile', () => {
  it('applies every kind of choice', () => {
    const file = parseConflictFile(diff3)
    const resolve = (choice: Parameters<typeof resolveConflictFile>[1]) =>
      resolveConflictFile(file, choice).text

    assert.strictEqual(resolve(new Map([[0, 'ours']])), 'ours\n')
    assert.strictEqual(resolve(new Map([[0, 'theirs']])), 'theirs\n')
    assert.strictEqual(resolve(new Map([[0, 'base']])), 'base\n')
    assert.strictEqual(
      resolve(new Map([[0, 'ours-then-theirs']])),
      'ours\ntheirs\n'
    )
    assert.strictEqual(
      resolve(new Map([[0, 'theirs-then-ours']])),
      'theirs\nours\n'
    )
    assert.strictEqual(
      resolve(new Map([[0, { custom: ['hand', 'made'] }]])),
      'hand\nmade\n'
    )
  })

  it('keeps markers of unresolved conflicts and counts them', () => {
    const file = parseConflictFile(twoConflicts)
    const { text, unresolvedCount } = resolveConflictFile(
      file,
      new Map([[1, 'ours']])
    )

    assert.strictEqual(unresolvedCount, 1)
    assert.strictEqual(
      text,
      [
        'header',
        '<<<<<<< HEAD',
        'ours 1',
        '=======',
        'theirs 1',
        '>>>>>>> feature',
        'middle',
        'ours 2a',
        'ours 2b',
        'footer',
        '',
      ].join('\n')
    )
  })

  it('preserves CRLF line endings', () => {
    const file = parseConflictFile(twoConflicts.replace(/\n/g, '\r\n'))
    const { text, unresolvedCount } = resolveConflictFile(
      file,
      new Map([
        [0, 'theirs'],
        [1, 'theirs'],
      ])
    )
    assert.strictEqual(unresolvedCount, 0)
    assert.strictEqual(text, 'header\r\ntheirs 1\r\nmiddle\r\nfooter\r\n')
  })
})
