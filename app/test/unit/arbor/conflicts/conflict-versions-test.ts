import assert from 'node:assert'
import { mkdir, readFile } from 'fs/promises'
import * as Path from 'path'
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import {
  getConflictVersions,
  writeConflictResolution,
} from '../../../../src/lib/arbor/conflicts/conflict-versions'
import {
  parseConflictFile,
  resolveConflictFile,
} from '../../../../src/lib/arbor/conflicts/conflict-file'
import { setupEmptyRepository } from '../../../helpers/repositories'
import { makeCommit, switchTo } from '../../../helpers/repository-scaffolding'

describe('arbor/conflicts/conflict-versions', () => {
  it('reads the three versions and stages a resolution', async t => {
    const repository = await setupEmptyRepository(t)
    // makeCommit doesn't create folders.
    await mkdir(Path.join(repository.path, 'dir'))
    await makeCommit(repository, {
      commitMessage: 'base',
      entries: [{ path: 'dir/file.txt', contents: 'line\n' }],
    })
    await switchTo(repository, 'feature')
    await makeCommit(repository, {
      commitMessage: 'theirs',
      entries: [{ path: 'dir/file.txt', contents: 'theirs\n' }],
    })
    await switchTo(repository, 'master')
    await makeCommit(repository, {
      commitMessage: 'ours',
      entries: [{ path: 'dir/file.txt', contents: 'ours\n' }],
    })

    const merge = await exec(['merge', 'feature'], repository.path)
    assert.notStrictEqual(merge.exitCode, 0)

    const path = Path.join('dir', 'file.txt')
    assert.deepStrictEqual(await getConflictVersions(repository, path), {
      base: 'line\n',
      ours: 'ours\n',
      theirs: 'theirs\n',
    })

    const onDisk = await readFile(Path.join(repository.path, path), 'utf8')
    const file = parseConflictFile(onDisk)
    assert.strictEqual(file.conflictCount, 1)

    const { text } = resolveConflictFile(
      file,
      new Map([[0, 'ours-then-theirs']])
    )
    await writeConflictResolution(repository, path, text)

    // Git may check the file out with CRLF (core.autocrlf), which is kept.
    const resolved = await readFile(Path.join(repository.path, path), 'utf8')
    assert.strictEqual(resolved.replace(/\r\n/g, '\n'), 'ours\ntheirs\n')
    const unmerged = await exec(
      ['diff', '--name-only', '--diff-filter=U'],
      repository.path
    )
    assert.strictEqual(unmerged.stdout.trim(), '')
  })

  it('returns null for a side that deleted the file', async t => {
    const repository = await setupEmptyRepository(t)
    await makeCommit(repository, {
      commitMessage: 'base',
      entries: [{ path: 'gone.txt', contents: 'v1\n' }],
    })
    await switchTo(repository, 'feature')
    await makeCommit(repository, {
      commitMessage: 'delete',
      entries: [{ path: 'gone.txt', contents: null }],
    })
    await switchTo(repository, 'master')
    await makeCommit(repository, {
      commitMessage: 'modify',
      entries: [{ path: 'gone.txt', contents: 'v2\n' }],
    })
    await exec(['merge', 'feature'], repository.path)

    assert.deepStrictEqual(await getConflictVersions(repository, 'gone.txt'), {
      base: 'v1\n',
      ours: 'v2\n',
      theirs: null,
    })
  })
})
