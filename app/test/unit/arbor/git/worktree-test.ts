import assert from 'node:assert'
import { rm } from 'fs/promises'
import { describe, it, type TestContext } from 'node:test'
import { exec } from 'dugite'
import { setupEmptyRepository } from '../../../helpers/repositories'
import { makeCommit } from '../../../helpers/repository-scaffolding'
import { listWorktrees } from '../../../../src/lib/git'
import {
  lockWorktree,
  pruneWorktrees,
  unlockWorktree,
} from '../../../../src/lib/arbor/git/worktree'

describe('arbor/git/worktree', () => {
  /**
   * Sets up a repository with a commit and a single linked worktree and
   * registers cleanup of that worktree directory with the test context.
   */
  async function setupLinkedWorktree(t: TestContext) {
    const repo = await setupEmptyRepository(t, 'main')
    await makeCommit(repo, {
      entries: [{ path: 'README', contents: 'hello' }],
    })
    await exec(['branch', 'feature-a'], repo.path)

    const worktreePath = repo.path + '-wt-a'
    await exec(['worktree', 'add', worktreePath, 'feature-a'], repo.path)
    t.after(() => rm(worktreePath, { recursive: true, force: true }))

    return { repo, worktreePath }
  }

  describe('lockWorktree', () => {
    it('locks a linked worktree', async t => {
      const { repo, worktreePath } = await setupLinkedWorktree(t)

      await lockWorktree(repo.path, worktreePath)

      const linked = (await listWorktrees(repo)).find(
        wt => wt.type === 'linked'
      )
      assert.notStrictEqual(linked, undefined)
      assert.strictEqual(linked?.isLocked, true)
    })

    it('stores the reason given for the lock', async t => {
      const { repo, worktreePath } = await setupLinkedWorktree(t)

      await lockWorktree(repo.path, worktreePath, 'in use by a test')

      const { stdout } = await exec(
        ['worktree', 'list', '--porcelain'],
        repo.path
      )
      assert(stdout.includes('locked in use by a test'))
    })
  })

  describe('unlockWorktree', () => {
    it('unlocks a previously locked worktree', async t => {
      const { repo, worktreePath } = await setupLinkedWorktree(t)

      await lockWorktree(repo.path, worktreePath)
      await unlockWorktree(repo.path, worktreePath)

      const linked = (await listWorktrees(repo)).find(
        wt => wt.type === 'linked'
      )
      assert.notStrictEqual(linked, undefined)
      assert.strictEqual(linked?.isLocked, false)
    })
  })

  describe('pruneWorktrees', () => {
    it('removes worktrees whose directory no longer exists', async t => {
      const { repo, worktreePath } = await setupLinkedWorktree(t)

      await rm(worktreePath, { recursive: true, force: true })

      const prunable = (await listWorktrees(repo)).find(
        wt => wt.type === 'linked'
      )
      assert.strictEqual(prunable?.isPrunable, true)

      await pruneWorktrees(repo.path)

      const remaining = await listWorktrees(repo)
      assert.strictEqual(remaining.length, 1)
      assert.strictEqual(remaining[0].type, 'main')
    })

    it('leaves locked worktrees alone', async t => {
      const { repo, worktreePath } = await setupLinkedWorktree(t)

      await lockWorktree(repo.path, worktreePath)
      await rm(worktreePath, { recursive: true, force: true })

      await pruneWorktrees(repo.path)

      const linked = (await listWorktrees(repo)).find(
        wt => wt.type === 'linked'
      )
      assert.notStrictEqual(linked, undefined)
      assert.strictEqual(linked?.isLocked, true)
    })
  })
})
