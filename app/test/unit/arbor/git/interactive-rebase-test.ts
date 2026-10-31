import assert from 'node:assert'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { beforeEach, describe, it, type TestContext } from 'node:test'
import { exec } from 'dugite'

import { setupEmptyRepository } from '../../../helpers/repositories'
import { makeCommit } from '../../../helpers/repository-scaffolding'
import { isolateGitConfig } from '../../../helpers/git-config'
import { getCommits } from '../../../../src/lib/git'
import { pathExists } from '../../../../src/lib/path-exists'
import { Repository } from '../../../../src/models/repository'
import {
  abortInteractiveRebase,
  buildRebaseTodo,
  continueInteractiveRebase,
  getRebasePlan,
  IRebaseTodoEntry,
  runInteractiveRebase,
  validateRebasePlan,
} from '../../../../src/lib/arbor/git/interactive-rebase'

/** Build a plan entry, defaulting to a 'pick'. */
function entry(
  sha: string,
  summary: string,
  overrides: Partial<IRebaseTodoEntry> = {}
): IRebaseTodoEntry {
  return { action: 'pick', sha, summary, ...overrides }
}

/** Get the commit subjects of the current branch, newest first. */
async function getSubjects(repository: Repository) {
  const { stdout } = await exec(['log', '--format=%s'], repository.path)
  return stdout.trim().split('\n')
}

/** Get the full message of a single commit. */
async function getBody(repository: Repository, ref: string) {
  const { stdout } = await exec(
    ['log', '--format=%B', '--max-count=1', ref],
    repository.path
  )
  return stdout.trim()
}

/** Read a file as it exists in a given commit. */
async function getFileAtRef(repository: Repository, ref: string, path: string) {
  const { stdout } = await exec(['show', `${ref}:${path}`], repository.path)
  return stdout
}

/** Set up a repository with four independent commits A-B-C-D. */
async function setupFourCommitHistory(t: TestContext) {
  const repository = await setupEmptyRepository(t, 'main')

  for (const [path, contents, message] of [
    ['a.txt', 'a', 'A'],
    ['b.txt', 'b', 'B'],
    ['c.txt', 'c', 'C'],
    ['d.txt', 'd', 'D'],
  ]) {
    await makeCommit(repository, {
      entries: [{ path, contents }],
      commitMessage: message,
    })
  }

  const [d, c, b, a] = await getCommits(repository)

  return { repository, a, b, c, d }
}

/** The directory holding the persisted todo and message files. */
function rebaseDirectory(repository: Repository) {
  return join(repository.path, '.git', 'arbor-rebase')
}

describe('arbor/git/interactive-rebase', () => {
  beforeEach(isolateGitConfig)

  describe('getRebasePlan', () => {
    it('returns every commit as a pick when starting from the root', async t => {
      const { repository } = await setupFourCommitHistory(t)

      const plan = await getRebasePlan(repository, null)

      assert.deepStrictEqual(
        plan.map(e => [e.action, e.summary]),
        [
          ['pick', 'A'],
          ['pick', 'B'],
          ['pick', 'C'],
          ['pick', 'D'],
        ]
      )
    })

    it('returns the commits after the base ref, oldest first', async t => {
      const { repository, a } = await setupFourCommitHistory(t)

      const plan = await getRebasePlan(repository, a.sha)

      assert.deepStrictEqual(
        plan.map(e => e.summary),
        ['B', 'C', 'D']
      )
    })

    it('returns an empty plan when the base ref is HEAD', async t => {
      const { repository } = await setupFourCommitHistory(t)

      assert.deepStrictEqual(await getRebasePlan(repository, 'HEAD'), [])
    })
  })

  describe('validateRebasePlan', () => {
    it('accepts a plan that keeps at least one commit', () => {
      assert.strictEqual(
        validateRebasePlan([
          entry('a', 'A'),
          entry('b', 'B', { action: 'squash', message: 'A and B' }),
          entry('c', 'C', { action: 'drop' }),
        ]),
        null
      )
    })

    it('accepts a reword with a message', () => {
      assert.strictEqual(
        validateRebasePlan([
          entry('a', 'A', { action: 'reword', message: 'x' }),
        ]),
        null
      )
    })

    it('rejects an empty plan', () => {
      assert.notStrictEqual(validateRebasePlan([]), null)
    })

    it('rejects a plan where every commit is dropped', () => {
      assert.notStrictEqual(
        validateRebasePlan([
          entry('a', 'A', { action: 'drop' }),
          entry('b', 'B', { action: 'drop' }),
        ]),
        null
      )
    })

    it('rejects a first kept commit that is a squash', () => {
      assert.notStrictEqual(
        validateRebasePlan([
          entry('a', 'A', { action: 'drop' }),
          entry('b', 'B', { action: 'squash' }),
        ]),
        null
      )
    })

    it('rejects a first kept commit that is a fixup', () => {
      assert.notStrictEqual(
        validateRebasePlan([entry('a', 'A', { action: 'fixup' })]),
        null
      )
    })

    it('rejects a reword without a message', () => {
      assert.notStrictEqual(
        validateRebasePlan([entry('a', 'A', { action: 'reword' })]),
        null
      )
    })

    it('rejects a reword with an empty or whitespace-only message', () => {
      for (const message of ['', '   ', '\n\t']) {
        assert.notStrictEqual(
          validateRebasePlan([entry('a', 'A', { action: 'reword', message })]),
          null
        )
      }
    })

    it('rejects duplicate commits', () => {
      assert.notStrictEqual(
        validateRebasePlan([entry('a', 'A'), entry('a', 'A')]),
        null
      )
    })
  })

  describe('buildRebaseTodo', () => {
    it('serializes the simple actions in order', () => {
      const todo = buildRebaseTodo(
        [
          entry('1', 'one'),
          entry('2', 'two', { action: 'edit' }),
          entry('3', 'three', { action: 'drop' }),
        ],
        i => `/messages/${i}.txt`
      )

      assert.strictEqual(
        todo,
        ['pick 1 one', 'edit 2 two', 'drop 3 three', ''].join('\n')
      )
    })

    it('rewrites a reword message with an exec command', () => {
      const todo = buildRebaseTodo(
        [entry('abc', 'hello', { action: 'reword', message: 'new' })],
        i => `/messages/${i}.txt`
      )

      assert.strictEqual(
        todo,
        [
          'pick abc hello',
          'exec git commit --amend --allow-empty --only -F "/messages/0.txt"',
          '',
        ].join('\n')
      )
    })

    it('uses forward slashes for Windows paths', () => {
      const todo = buildRebaseTodo(
        [entry('abc', 'hello', { action: 'reword', message: 'new' })],
        () => 'C:\\repo\\.git\\arbor-rebase\\message-0.txt'
      )

      assert.strictEqual(
        todo,
        [
          'pick abc hello',
          'exec git commit --amend --allow-empty --only -F "C:/repo/.git/arbor-rebase/message-0.txt"',
          '',
        ].join('\n')
      )
    })

    it('amends a squash group once, after its last entry', () => {
      const todo = buildRebaseTodo(
        [
          entry('a', 'A'),
          entry('b', 'B', { action: 'squash' }),
          entry('c', 'C', { action: 'fixup', message: 'combined' }),
          entry('d', 'D'),
        ],
        i => `/messages/${i}.txt`
      )

      assert.strictEqual(
        todo,
        [
          'pick a A',
          'squash b B',
          'fixup c C',
          'exec git commit --amend --allow-empty --only -F "/messages/2.txt"',
          'pick d D',
          '',
        ].join('\n')
      )
    })

    it('ignores a message on a non-last entry of a squash group', () => {
      let calls = 0
      const todo = buildRebaseTodo(
        [
          entry('a', 'A'),
          entry('b', 'B', { action: 'squash', message: 'ignored' }),
          entry('c', 'C', { action: 'squash' }),
        ],
        i => {
          calls++
          return `/messages/${i}.txt`
        }
      )

      assert.strictEqual(
        todo,
        ['pick a A', 'squash b B', 'squash c C', ''].join('\n')
      )
      assert.strictEqual(calls, 0)
    })

    it('leaves the default git message when no message is given', () => {
      const todo = buildRebaseTodo(
        [entry('a', 'A'), entry('b', 'B', { action: 'squash' })],
        i => `/messages/${i}.txt`
      )

      assert.strictEqual(todo, ['pick a A', 'squash b B', ''].join('\n'))
    })

    it('returns an empty string for an empty plan', () => {
      assert.strictEqual(
        buildRebaseTodo([], i => `${i}`),
        ''
      )
    })
  })

  describe('runInteractiveRebase', () => {
    it('throws when the plan is invalid', async t => {
      const { repository } = await setupFourCommitHistory(t)

      await assert.rejects(runInteractiveRebase(repository, null, []))
    })

    it('reorders commits', async t => {
      const { repository, a, b, c, d } = await setupFourCommitHistory(t)

      const outcome = await runInteractiveRebase(repository, null, [
        entry(a.sha, a.summary),
        entry(b.sha, b.summary),
        entry(d.sha, d.summary),
        entry(c.sha, c.summary),
      ])

      assert.strictEqual(outcome, 'completed')
      assert.deepStrictEqual(await getSubjects(repository), [
        'C',
        'D',
        'B',
        'A',
      ])
    })

    it('drops a commit', async t => {
      const { repository, a, b, c, d } = await setupFourCommitHistory(t)

      const outcome = await runInteractiveRebase(repository, null, [
        entry(a.sha, a.summary),
        entry(b.sha, b.summary, { action: 'drop' }),
        entry(c.sha, c.summary),
        entry(d.sha, d.summary),
      ])

      assert.strictEqual(outcome, 'completed')
      assert.deepStrictEqual(await getSubjects(repository), ['D', 'C', 'A'])

      const removed = await exec(
        ['cat-file', '-e', 'HEAD:b.txt'],
        repository.path
      )
      assert.notStrictEqual(removed.exitCode, 0)
    })

    it('squashes a commit with a custom message', async t => {
      const { repository, a, b, c, d } = await setupFourCommitHistory(t)
      const message = 'Squashed B and C\n\nWith a body.\nAnd a second line.'

      const outcome = await runInteractiveRebase(repository, null, [
        entry(a.sha, a.summary),
        entry(b.sha, b.summary),
        entry(c.sha, c.summary, { action: 'squash', message }),
        entry(d.sha, d.summary),
      ])

      assert.strictEqual(outcome, 'completed')
      assert.deepStrictEqual(await getSubjects(repository), [
        'D',
        'Squashed B and C',
        'A',
      ])
      assert.strictEqual(await getBody(repository, 'HEAD~1'), message)
      assert.strictEqual(await getFileAtRef(repository, 'HEAD~1', 'b.txt'), 'b')
      assert.strictEqual(await getFileAtRef(repository, 'HEAD~1', 'c.txt'), 'c')
    })

    it('fixes up a commit while keeping the first message', async t => {
      const { repository, a, b, c, d } = await setupFourCommitHistory(t)

      const outcome = await runInteractiveRebase(repository, null, [
        entry(a.sha, a.summary),
        entry(b.sha, b.summary),
        entry(c.sha, c.summary, { action: 'fixup' }),
        entry(d.sha, d.summary),
      ])

      assert.strictEqual(outcome, 'completed')
      assert.deepStrictEqual(await getSubjects(repository), ['D', 'B', 'A'])
      assert.strictEqual(await getBody(repository, 'HEAD~1'), 'B')
      assert.strictEqual(await getFileAtRef(repository, 'HEAD~1', 'c.txt'), 'c')
    })

    it('rewords a commit with quotes, apostrophes and multiple lines', async t => {
      const { repository, a, b, c, d } = await setupFourCommitHistory(t)
      const message =
        'Reworded "B" with \'quotes\'\n\nBody with "double" and \'single\' quotes.\nSecond line.'

      const outcome = await runInteractiveRebase(repository, null, [
        entry(a.sha, a.summary),
        entry(b.sha, b.summary, { action: 'reword', message }),
        entry(c.sha, c.summary),
        entry(d.sha, d.summary),
      ])

      assert.strictEqual(outcome, 'completed')
      assert.deepStrictEqual(await getSubjects(repository), [
        'D',
        'C',
        'Reworded "B" with \'quotes\'',
        'A',
      ])
      assert.strictEqual(await getBody(repository, 'HEAD~2'), message)
    })

    it('stops for edit and continues after an amend', async t => {
      const { repository, a, b, c, d } = await setupFourCommitHistory(t)

      const outcome = await runInteractiveRebase(repository, null, [
        entry(a.sha, a.summary),
        entry(b.sha, b.summary, { action: 'edit' }),
        entry(c.sha, c.summary),
        entry(d.sha, d.summary),
      ])

      assert.strictEqual(outcome, 'stopped-for-edit')
      assert.strictEqual(await pathExists(rebaseDirectory(repository)), true)

      await writeFile(join(repository.path, 'b.txt'), 'edited')
      await exec(['add', 'b.txt'], repository.path)
      await exec(['commit', '--amend', '--no-edit'], repository.path)

      assert.strictEqual(
        await continueInteractiveRebase(repository),
        'completed'
      )
      assert.deepStrictEqual(await getSubjects(repository), [
        'D',
        'C',
        'B',
        'A',
      ])
      assert.strictEqual(
        await getFileAtRef(repository, 'HEAD~2', 'b.txt'),
        'edited'
      )
      assert.strictEqual(await pathExists(rebaseDirectory(repository)), false)
    })

    it('reports conflicts and aborts cleanly', async t => {
      const repository = await setupEmptyRepository(t, 'main')

      await makeCommit(repository, {
        entries: [{ path: 'file.txt', contents: 'base' }],
        commitMessage: 'A',
      })
      await makeCommit(repository, {
        entries: [{ path: 'file.txt', contents: 'B' }],
        commitMessage: 'B',
      })
      await makeCommit(repository, {
        entries: [{ path: 'file.txt', contents: 'C' }],
        commitMessage: 'C',
      })

      const [c, b, a] = await getCommits(repository)
      const originalHead = (
        await exec(['rev-parse', 'HEAD'], repository.path)
      ).stdout.trim()

      const outcome = await runInteractiveRebase(repository, null, [
        entry(a.sha, a.summary),
        entry(c.sha, c.summary),
        entry(b.sha, b.summary),
      ])

      assert.strictEqual(outcome, 'conflicts')

      const unmerged = await exec(
        ['diff', '--name-only', '--diff-filter=U'],
        repository.path
      )
      assert.strictEqual(unmerged.stdout.trim(), 'file.txt')

      await abortInteractiveRebase(repository)

      const head = (
        await exec(['rev-parse', 'HEAD'], repository.path)
      ).stdout.trim()
      assert.strictEqual(head, originalHead)
      assert.deepStrictEqual(await getSubjects(repository), ['C', 'B', 'A'])
      assert.strictEqual(await pathExists(rebaseDirectory(repository)), false)
    })

    it('persists its files in the linked worktree git directory', async t => {
      const { repository } = await setupFourCommitHistory(t)
      const worktreePath = `${repository.path}-linked`

      await exec(
        ['worktree', 'add', '-b', 'linked', worktreePath],
        repository.path
      )
      t.after(() => rm(worktreePath, { recursive: true, force: true }))

      const worktree = new Repository(worktreePath, -1, null, false)
      const [d, c, b, a] = await getCommits(worktree)

      const outcome = await runInteractiveRebase(worktree, null, [
        entry(a.sha, a.summary),
        entry(b.sha, b.summary),
        entry(c.sha, c.summary, { action: 'edit' }),
        entry(d.sha, d.summary),
      ])

      assert.strictEqual(outcome, 'stopped-for-edit')

      const gitDir = (
        await exec(['rev-parse', '--git-dir'], worktreePath)
      ).stdout.trim()

      assert.strictEqual(await pathExists(join(gitDir, 'arbor-rebase')), true)
      assert.strictEqual(
        await pathExists(join(repository.path, '.git', 'arbor-rebase')),
        false
      )

      assert.strictEqual(await continueInteractiveRebase(worktree), 'completed')
      assert.strictEqual(await pathExists(join(gitDir, 'arbor-rebase')), false)
    })
  })

  describe('continueInteractiveRebase', () => {
    it('returns an error when no rebase is in progress', async t => {
      const { repository } = await setupFourCommitHistory(t)

      assert.strictEqual(await continueInteractiveRebase(repository), 'error')
    })
  })

  describe('abortInteractiveRebase', () => {
    it('does nothing when no rebase is in progress', async t => {
      const { repository } = await setupFourCommitHistory(t)

      await abortInteractiveRebase(repository)

      assert.deepStrictEqual(await getSubjects(repository), [
        'D',
        'C',
        'B',
        'A',
      ])
    })

    it('removes leftover persisted files', async t => {
      const { repository } = await setupFourCommitHistory(t)
      const directory = rebaseDirectory(repository)

      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'todo.txt'), 'pick')

      await abortInteractiveRebase(repository)

      assert.strictEqual(await pathExists(directory), false)
    })
  })
})
