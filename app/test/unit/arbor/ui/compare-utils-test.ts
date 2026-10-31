import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getInitialRefs,
  pluralize,
} from '../../../../src/ui/arbor/compare/compare-utils'

const branches = {
  local: ['feature', 'main', 'fix'],
  remote: ['origin/main', 'origin/feature'],
}

describe('arbor/ui/compare-utils', () => {
  it('compares the current branch against the default branch', () => {
    assert.deepStrictEqual(getInitialRefs(branches, 'feature', {}), {
      base: 'main',
      head: 'feature',
    })
  })

  it('uses the requested refs when they exist', () => {
    assert.deepStrictEqual(
      getInitialRefs(branches, 'feature', { base: 'fix', head: 'origin/main' }),
      { base: 'fix', head: 'origin/main' }
    )
    assert.deepStrictEqual(
      getInitialRefs(branches, 'feature', { base: 'gone', head: 'gone' }),
      { base: 'main', head: 'feature' }
    )
  })

  it('never compares the default branch against itself', () => {
    assert.deepStrictEqual(getInitialRefs(branches, 'main', {}), {
      base: 'origin/main',
      head: 'main',
    })
    assert.deepStrictEqual(
      getInitialRefs({ local: ['a', 'b'], remote: [] }, 'a', {}),
      { base: 'b', head: 'a' }
    )
  })

  it('handles a detached HEAD and a single branch', () => {
    assert.deepStrictEqual(getInitialRefs(branches, null, {}), {
      base: 'main',
      head: 'feature',
    })
    assert.deepStrictEqual(
      getInitialRefs({ local: ['only'], remote: [] }, 'only', {}),
      { base: null, head: 'only' }
    )
  })

  it('pluralizes', () => {
    assert.strictEqual(pluralize(1, 'file'), '1 file')
    assert.strictEqual(pluralize(0, 'commit'), '0 commits')
  })
})
