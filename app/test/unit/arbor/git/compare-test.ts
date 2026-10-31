import assert from 'node:assert'
import { describe, it, TestContext } from 'node:test'
import { exec } from 'dugite'
import {
  compareBranches,
  describeComparison,
} from '../../../../src/lib/arbor/git/compare'
import { setupEmptyRepository } from '../../../helpers/repositories'
import { makeCommit, switchTo } from '../../../helpers/repository-scaffolding'

/**
 * master: A - B - M1
 *              \
 * feature:      F1 - F2
 */
async function setupDivergedRepository(t: TestContext) {
  const repository = await setupEmptyRepository(t)

  await makeCommit(repository, {
    commitMessage: 'A',
    entries: [{ path: 'README.md', contents: 'readme\n' }],
  })
  await makeCommit(repository, {
    commitMessage: 'B',
    entries: [{ path: 'shared.txt', contents: 'shared\n' }],
  })

  await switchTo(repository, 'feature')
  await makeCommit(repository, {
    commitMessage: 'F1',
    entries: [{ path: 'feature.txt', contents: 'one\ntwo\n' }],
  })
  await makeCommit(repository, {
    commitMessage: 'F2',
    entries: [{ path: 'shared.txt', contents: 'shared\nfrom feature\n' }],
  })

  await switchTo(repository, 'master')
  await makeCommit(repository, {
    commitMessage: 'M1',
    entries: [{ path: 'master.txt', contents: 'master\n' }],
  })

  return repository
}

describe('arbor/git/compare', () => {
  describe('compareBranches', () => {
    it('reports both sides of diverged branches', async t => {
      const repository = await setupDivergedRepository(t)
      const comparison = await compareBranches(repository, 'master', 'feature')

      assert.strictEqual(comparison.ahead, 2)
      assert.strictEqual(comparison.behind, 1)
      assert.deepStrictEqual(
        comparison.commitsAhead.map(c => c.summary),
        ['F2', 'F1']
      )
      assert.deepStrictEqual(
        comparison.commitsBehind.map(c => c.summary),
        ['M1']
      )

      const mergeBase = (
        await exec(['rev-parse', 'master~1'], repository.path)
      ).stdout.trim()
      assert.strictEqual(comparison.mergeBase, mergeBase)
    })

    it('lists only the files the head brings since the merge base', async t => {
      const repository = await setupDivergedRepository(t)
      const { changes } = await compareBranches(repository, 'master', 'feature')

      assert.ok(changes)
      assert.deepStrictEqual(changes.files.map(f => f.path).sort(), [
        'feature.txt',
        'shared.txt',
      ])
      assert.strictEqual(changes.linesAdded, 3)
      assert.strictEqual(changes.linesDeleted, 0)
    })

    it('is symmetric when swapping base and head', async t => {
      const repository = await setupDivergedRepository(t)
      const comparison = await compareBranches(repository, 'feature', 'master')

      assert.strictEqual(comparison.ahead, 1)
      assert.strictEqual(comparison.behind, 2)
      assert.deepStrictEqual(
        comparison.changes?.files.map(f => f.path),
        ['master.txt']
      )
    })

    it('caps the commit lists but not the counts', async t => {
      const repository = await setupDivergedRepository(t)
      const comparison = await compareBranches(
        repository,
        'master',
        'feature',
        1
      )

      assert.strictEqual(comparison.ahead, 2)
      assert.strictEqual(comparison.commitsAhead.length, 1)
    })

    it('throws for an unknown ref', async t => {
      const repository = await setupDivergedRepository(t)
      await assert.rejects(compareBranches(repository, 'master', 'nope'))
    })
  })

  describe('describeComparison', () => {
    const base = { base: 'main', head: 'feature' }

    it('describes every case', () => {
      assert.strictEqual(
        describeComparison({ ...base, ahead: 0, behind: 0 }),
        'feature and main are identical'
      )
      assert.strictEqual(
        describeComparison({ ...base, ahead: 1, behind: 0 }),
        'feature is 1 commit ahead of main'
      )
      assert.strictEqual(
        describeComparison({ ...base, ahead: 0, behind: 3 }),
        'feature is 3 commits behind main'
      )
      assert.strictEqual(
        describeComparison({ ...base, ahead: 2, behind: 1 }),
        'feature is 2 commits ahead of and 1 commit behind main'
      )
    })
  })
})
