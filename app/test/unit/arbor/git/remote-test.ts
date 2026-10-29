import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import { addRemote, getRemotes } from '../../../../src/lib/git/remote'
import { renameRemote } from '../../../../src/lib/arbor/git/remote'
import { setupEmptyRepository } from '../../../helpers/repositories'
import { isolateGitConfig } from '../../../helpers/git-config'

describe('arbor/git/remote', () => {
  beforeEach(isolateGitConfig)

  describe('renameRemote', () => {
    for (const [oldName, newName] of [
      ['origin', 'upstream'],
      ['--remote', 'renamed'],
    ]) {
      it(`renames ${oldName} to ${newName}`, async t => {
        const repository = await setupEmptyRepository(t)
        await addRemote(repository, oldName, '/repository')
        await addRemote(repository, 'retained', '/retained')

        await renameRemote(repository, oldName, newName)

        const remotes = await getRemotes(repository)
        assert.deepStrictEqual(
          remotes.map(r => r.name),
          [newName, 'retained'].sort()
        )
        assert.strictEqual(
          remotes.find(r => r.name === newName)?.url,
          '/repository'
        )
        assert.strictEqual(
          remotes.some(r => r.name === oldName),
          false
        )
      })
    }

    it('fails when the new name already exists', async t => {
      const repository = await setupEmptyRepository(t)
      await addRemote(repository, 'origin', '/origin')
      await addRemote(repository, 'upstream', '/upstream')

      await assert.rejects(renameRemote(repository, 'origin', 'upstream'))

      const remotes = await getRemotes(repository)
      assert.deepStrictEqual(
        remotes.map(r => r.name),
        ['origin', 'upstream']
      )
      assert.strictEqual(
        remotes.find(r => r.name === 'origin')?.url,
        '/origin'
      )
    })

    it('fails when the remote to rename does not exist', async t => {
      const repository = await setupEmptyRepository(t)

      await assert.rejects(renameRemote(repository, 'origin', 'upstream'))
    })
  })
})
