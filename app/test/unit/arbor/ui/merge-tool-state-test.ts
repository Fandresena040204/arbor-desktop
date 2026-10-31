import assert from 'node:assert'
import { describe, it } from 'node:test'
import { parseConflictFile } from '../../../../src/lib/arbor/conflicts/conflict-file'
import {
  chooseForAll,
  getAdjacentConflict,
  getConflicts,
  getResolvedLines,
  isProbablyBinary,
} from '../../../../src/ui/arbor/conflicts/merge-tool-state'

const file = parseConflictFile(
  [
    'a',
    '<<<<<<< HEAD',
    'ours 1',
    '=======',
    'theirs 1',
    '>>>>>>> feature',
    'b',
    '<<<<<<< HEAD',
    'ours 2',
    '||||||| base',
    'base 2',
    '=======',
    'theirs 2',
    '>>>>>>> feature',
    '',
  ].join('\n')
)

describe('arbor/ui/merge-tool-state', () => {
  it('lists the conflicts', () => {
    assert.deepStrictEqual(
      getConflicts(file).map(c => c.index),
      [0, 1]
    )
  })

  it('cycles through conflicts', () => {
    assert.strictEqual(getAdjacentConflict(file, 0, 'next'), 1)
    assert.strictEqual(getAdjacentConflict(file, 1, 'next'), 0)
    assert.strictEqual(getAdjacentConflict(file, 0, 'previous'), 1)
    assert.strictEqual(
      getAdjacentConflict(parseConflictFile('no conflict\n'), 0, 'next'),
      0
    )
  })

  it('applies one choice to every conflict', () => {
    assert.deepStrictEqual(
      [...chooseForAll(file, 'theirs')],
      [
        [0, 'theirs'],
        [1, 'theirs'],
      ]
    )
  })

  it('gives the lines of a resolved conflict', () => {
    const [, second] = getConflicts(file)
    assert.deepStrictEqual(getResolvedLines(second, 'base'), ['base 2'])
    assert.deepStrictEqual(getResolvedLines(second, 'theirs-then-ours'), [
      'theirs 2',
      'ours 2',
    ])
    assert.deepStrictEqual(getResolvedLines(second, { custom: [] }), [])
  })

  it('detects binary content', () => {
    assert.strictEqual(isProbablyBinary('a\0b'), true)
    assert.strictEqual(isProbablyBinary('text'), false)
  })
})
