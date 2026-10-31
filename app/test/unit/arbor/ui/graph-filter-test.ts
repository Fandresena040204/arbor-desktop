import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  doesCommitMatchFilter,
  filterToTerms,
} from '../../../../src/ui/arbor/graph/graph-filter'

const commit = {
  sha: '1a2b3c4d5e6f708910112233445566778899aabbccdd'.slice(0, 40),
  shortSha: '1a2b3c4',
  summary: 'Unwrap the initialokat frame',
  authorName: 'Grace Hopper',
  authorEmail: 'grace@navy.mill',
  refs: [{ name: 'feature/fog' }, { name: 'tag-v1' }],
}

describe('arbor/ui/graph-filter', () => {
  describe('filterToTerms', () => {
    it('splits on whitespace and ignores empty terms', () => {
      assert.deepStrictEqual(filterToTerms('  a  b  '), ['a', 'b'])
    })

    it('lowercases the terms', () => {
      assert.deepStrictEqual(filterToTerms('Grace'), ['grace'])
    })
  })

  describe('doesCommitMatchFilter', () => {
    it('matches everything on an empty filter', () => {
      assert.strictEqual(doesCommitMatchFilter(commit, ''), true)
      assert.strictEqual(doesCommitMatchFilter(commit, '   '), true)
    })

    it('matches on the summary, case insensitively', () => {
      assert.strictEqual(doesCommitMatchFilter(commit, 'INITIALOKAT'), true)
      assert.strictEqual(doesCommitMatchFilter(commit, 'fog-boat'), false)
    })

    it('matches a full or short SHA', () => {
      assert.strictEqual(
        doesCommitMatchFilter(commit, commit.sha.slice(0, 10)),
        true
      )
      assert.strictEqual(doesCommitMatchFilter(commit, 'zzzz'), false)
    })

    it('matches the author name or email', () => {
      assert.strictEqual(doesCommitMatchFilter(commit, 'hopper'), true)
      assert.strictEqual(doesCommitMatchFilter(commit, 'navy'), true)
    })

    it('matches a ref name, including tags', () => {
      assert.strictEqual(doesCommitMatchFilter(commit, 'feature'), true)
      assert.strictEqual(doesCommitMatchFilter(commit, 'tag-v1'), true)
      assert.strictEqual(doesCommitMatchFilter(commit, 'origin/main'), false)
    })

    it('requires every term to match', () => {
      assert.strictEqual(doesCommitMatchFilter(commit, 'grace frame'), true)
      assert.strictEqual(doesCommitMatchFilter(commit, 'grace nomatch'), false)
    })
  })
})
