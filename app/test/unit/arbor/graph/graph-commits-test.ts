import assert from 'node:assert'
import { describe, it } from 'node:test'
import { exec } from 'dugite'
import {
  getGraphCommits,
  parseDecorations,
} from '../../../../src/lib/arbor/graph/graph-commits'
import { computeGraphLayout } from '../../../../src/lib/arbor/graph/graph-layout'
import { setupEmptyRepository } from '../../../helpers/repositories'
import { makeCommit, switchTo } from '../../../helpers/repository-scaffolding'

describe('arbor/graph/parseDecorations', () => {
  it('parses HEAD, local, remote and tag refs', () => {
    assert.deepStrictEqual(
      parseDecorations(
        'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1.0'
      ),
      {
        isHead: true,
        refs: [
          { type: 'local', name: 'main' },
          { type: 'remote', name: 'origin/main' },
          { type: 'tag', name: 'v1.0' },
        ],
      }
    )
  })

  it('handles a detached HEAD, branch names with slashes and no refs', () => {
    assert.deepStrictEqual(parseDecorations('HEAD, refs/heads/feature/x'), {
      isHead: true,
      refs: [
        { type: 'head', name: 'HEAD' },
        { type: 'local', name: 'feature/x' },
      ],
    })
    assert.deepStrictEqual(parseDecorations(''), { isHead: false, refs: [] })
  })
})

describe('arbor/graph/getGraphCommits', () => {
  it('loads every branch with parents and refs', async t => {
    const repository = await setupEmptyRepository(t)
    await makeCommit(repository, {
      commitMessage: 'A',
      entries: [{ path: 'a.txt', contents: 'a\n' }],
    })
    await switchTo(repository, 'feature')
    await makeCommit(repository, {
      commitMessage: 'F',
      entries: [{ path: 'f.txt', contents: 'f\n' }],
    })
    await switchTo(repository, 'master')
    await makeCommit(repository, {
      commitMessage: 'B',
      entries: [{ path: 'b.txt', contents: 'b\n' }],
    })
    await exec(['merge', '--no-ff', '-m', 'M', 'feature'], repository.path)
    await exec(['tag', 'v1'], repository.path)
    await exec(
      ['update-ref', 'refs/remotes/origin/feature', 'feature'],
      repository.path
    )

    const commits = await getGraphCommits(repository, 100)

    assert.deepStrictEqual(commits.map(c => c.summary).sort(), [
      'A',
      'B',
      'F',
      'M',
    ])
    assert.strictEqual(commits[0].summary, 'M')
    assert.strictEqual(commits[0].parents.length, 2)
    assert.strictEqual(commits[0].isHead, true)
    assert.deepStrictEqual(commits[0].refs, [
      { type: 'local', name: 'master' },
      { type: 'tag', name: 'v1' },
    ])

    const f = commits.find(c => c.summary === 'F')!
    assert.deepStrictEqual(f.refs.map(r => `${r.type}:${r.name}`).sort(), [
      'local:feature',
      'remote:origin/feature',
    ])
    const a = commits.find(c => c.summary === 'A')!
    assert.deepStrictEqual(a.parents, [])
    assert.ok(a.authorDate > Date.UTC(2020, 0, 1))

    // Children always come before their parents.
    const index = new Map(commits.map((c, i) => [c.sha, i]))
    for (const commit of commits) {
      for (const parent of commit.parents) {
        assert.ok(index.get(commit.sha)! < index.get(parent)!)
      }
    }

    const layout = computeGraphLayout(commits)
    assert.strictEqual(layout.maxWidth, 2)
  })

  it('pages with limit and skip', async t => {
    const repository = await setupEmptyRepository(t)
    for (const name of ['1', '2', '3']) {
      await makeCommit(repository, {
        commitMessage: name,
        entries: [{ path: `${name}.txt`, contents: name }],
      })
    }

    const page = await getGraphCommits(repository, 2, 1)
    assert.deepStrictEqual(
      page.map(c => c.summary),
      ['2', '1']
    )
  })

  it('returns nothing for a repository without commits', async t => {
    const repository = await setupEmptyRepository(t)
    assert.deepStrictEqual(await getGraphCommits(repository, 10), [])
  })
})
