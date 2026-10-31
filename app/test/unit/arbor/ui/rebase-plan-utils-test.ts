import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IRebaseTodoEntry,
  RebaseTodoAction,
} from '../../../../src/lib/arbor/git/interactive-rebase'
import {
  getFirstEditSha,
  getRebaseEntryGrouping,
  isRebasePlanUnchanged,
  isSquashOrFixup,
  moveRebaseEntry,
  moveRebaseEntryTo,
} from '../../../../src/ui/arbor/rebase/rebase-plan-utils'

function entry(
  sha: string,
  action: RebaseTodoAction = 'pick'
): IRebaseTodoEntry {
  return { action, sha, summary: `Commit ${sha}` }
}

const plan = [entry('a'), entry('b'), entry('c')]

function shas(entries: ReadonlyArray<IRebaseTodoEntry>) {
  return entries.map(e => e.sha)
}

describe('isSquashOrFixup', () => {
  it('recognizes squash and fixup only', () => {
    assert.equal(isSquashOrFixup('squash'), true)
    assert.equal(isSquashOrFixup('fixup'), true)

    for (const action of ['pick', 'reword', 'edit', 'drop'] as const) {
      assert.equal(isSquashOrFixup(action), false)
    }
  })
})

describe('moveRebaseEntryTo', () => {
  it('moves an entry down', () => {
    assert.deepEqual(shas(moveRebaseEntryTo(plan, 0, 2)), ['b', 'c', 'a'])
  })

  it('moves an entry up', () => {
    assert.deepEqual(shas(moveRebaseEntryTo(plan, 2, 0)), ['c', 'a', 'b'])
  })

  it('returns the same array when the move is a no-op', () => {
    assert.equal(moveRebaseEntryTo(plan, 1, 1), plan)
  })

  it('returns the same array for out of bounds indices', () => {
    assert.equal(moveRebaseEntryTo(plan, -1, 1), plan)
    assert.equal(moveRebaseEntryTo(plan, 0, -1), plan)
    assert.equal(moveRebaseEntryTo(plan, 3, 1), plan)
    assert.equal(moveRebaseEntryTo(plan, 0, 3), plan)
  })

  it('does not mutate the original plan', () => {
    moveRebaseEntryTo(plan, 0, 2)
    assert.deepEqual(shas(plan), ['a', 'b', 'c'])
  })

  it('keeps the entry payload', () => {
    const withMessage: ReadonlyArray<IRebaseTodoEntry> = [
      { ...entry('a', 'reword'), message: 'New message' },
      entry('b'),
    ]

    assert.equal(moveRebaseEntryTo(withMessage, 0, 1)[1].message, 'New message')
  })
})

describe('moveRebaseEntry', () => {
  it('moves up', () => {
    assert.deepEqual(shas(moveRebaseEntry(plan, 1, 'up')), ['b', 'a', 'c'])
  })

  it('moves down', () => {
    assert.deepEqual(shas(moveRebaseEntry(plan, 1, 'down')), ['a', 'c', 'b'])
  })

  it('cannot move the first entry up', () => {
    assert.equal(moveRebaseEntry(plan, 0, 'up'), plan)
  })

  it('cannot move the last entry down', () => {
    assert.equal(moveRebaseEntry(plan, 2, 'down'), plan)
  })
})

describe('isRebasePlanUnchanged', () => {
  it('is true for the untouched plan', () => {
    assert.equal(isRebasePlanUnchanged(plan, plan.slice()), true)
  })

  it('is true for two empty plans', () => {
    assert.equal(isRebasePlanUnchanged([], []), true)
  })

  it('is false when an action changed', () => {
    const changed = [entry('a'), entry('b', 'reword'), entry('c')]
    assert.equal(isRebasePlanUnchanged(plan, changed), false)
  })

  it('is false when the order changed', () => {
    const reordered = [entry('b'), entry('a'), entry('c')]
    assert.equal(isRebasePlanUnchanged(plan, reordered), false)
  })

  it('is false when a commit was dropped from the plan', () => {
    assert.equal(isRebasePlanUnchanged(plan, [entry('a'), entry('c')]), false)
  })
})

describe('getRebaseEntryGrouping', () => {
  it('indents nothing when everything is picked', () => {
    assert.deepEqual(getRebaseEntryGrouping(plan), [
      { indented: false, endsSquashGroup: false },
      { indented: false, endsSquashGroup: false },
      { indented: false, endsSquashGroup: false },
    ])
  })

  it('indents a squash under the commit above it', () => {
    const grouping = getRebaseEntryGrouping([entry('a'), entry('b', 'squash')])

    assert.deepEqual(grouping, [
      { indented: false, endsSquashGroup: false },
      { indented: true, endsSquashGroup: true },
    ])
  })

  it('only closes the group on the last squash or fixup', () => {
    const grouping = getRebaseEntryGrouping([
      entry('a'),
      entry('b', 'squash'),
      entry('c', 'fixup'),
      entry('d', 'squash'),
      entry('e'),
    ])

    assert.deepEqual(grouping, [
      { indented: false, endsSquashGroup: false },
      { indented: true, endsSquashGroup: false },
      { indented: true, endsSquashGroup: false },
      { indented: true, endsSquashGroup: true },
      { indented: false, endsSquashGroup: false },
    ])
  })

  it('does not indent a squash without a kept commit above it', () => {
    const grouping = getRebaseEntryGrouping([
      entry('a', 'drop'),
      entry('b', 'squash'),
    ])

    assert.deepEqual(grouping, [
      { indented: false, endsSquashGroup: false },
      { indented: false, endsSquashGroup: false },
    ])
  })
})

describe('getFirstEditSha', () => {
  it('returns null when nothing is edited', () => {
    assert.equal(getFirstEditSha(plan), null)
  })

  it('returns the first edited commit', () => {
    assert.equal(
      getFirstEditSha([entry('a'), entry('b', 'edit'), entry('c', 'edit')]),
      'b'
    )
  })
})
