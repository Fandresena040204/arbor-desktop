import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  branchOfSymbolicRef,
  chooseGitLabRemote,
  defaultMergeRequestTitle,
  describeGitLabPipeline,
  shortSha,
} from '../../../../src/ui/arbor/gitlab/gitlab-ui-utils'

describe('arbor/ui/gitlab-ui-utils', () => {
  describe('chooseGitLabRemote', () => {
    const instances = ['https://git.example.com']

    it('picks origin before the other remotes', () => {
      const remote = chooseGitLabRemote(
        [
          { name: 'upstream', url: 'https://git.example.com/a/b.git' },
          { name: 'origin', url: 'https://gitlab.com/group/project.git' },
        ],
        instances
      )

      assert.deepStrictEqual(remote, {
        instanceUrl: 'https://gitlab.com',
        projectPath: 'group/project',
      })
    })

    it('falls back to the other remotes when origin is not GitLab', () => {
      const remote = chooseGitLabRemote(
        [
          { name: 'origin', url: 'https://github.com/user/project.git' },
          { name: 'mirror', url: 'git@git.example.com:group/project.git' },
        ],
        instances
      )

      assert.deepStrictEqual(remote, {
        instanceUrl: 'https://git.example.com',
        projectPath: 'group/project',
      })
    })

    it('returns null when no remote is a known GitLab', () => {
      const remote = chooseGitLabRemote(
        [
          { name: 'origin', url: 'https://github.com/user/project.git' },
          { name: 'other', url: 'https://bitbucket.org/user/project.git' },
        ],
        instances
      )

      assert.strictEqual(remote, null)
    })

    it('returns null when the repository has no remote', () => {
      assert.strictEqual(chooseGitLabRemote([], instances), null)
    })
  })

  describe('branchOfSymbolicRef', () => {
    it('reads a local branch ref', () => {
      assert.strictEqual(
        branchOfSymbolicRef('refs/heads/feature/add-login'),
        'feature/add-login'
      )
    })

    it('returns null for a detached HEAD or a null ref', () => {
      assert.strictEqual(branchOfSymbolicRef(null), null)
      assert.strictEqual(branchOfSymbolicRef('refs/tags/v1.0.0'), null)
    })
  })

  describe('describeGitLabPipeline', () => {
    it('colors the usual statuses', () => {
      assert.deepStrictEqual(describeGitLabPipeline('success'), {
        label: 'Success',
        className: 'success',
      })
      assert.deepStrictEqual(describeGitLabPipeline('failed'), {
        label: 'Failed',
        className: 'failed',
      })
      assert.deepStrictEqual(describeGitLabPipeline('running'), {
        label: 'Running',
        className: 'running',
      })
      assert.deepStrictEqual(describeGitLabPipeline('pending'), {
        label: 'Pending',
        className: 'pending',
      })
    })

    it('leaves the other statuses idle', () => {
      assert.deepStrictEqual(describeGitLabPipeline('canceled'), {
        label: 'Canceled',
        className: 'idle',
      })
      assert.deepStrictEqual(describeGitLabPipeline('skipped'), {
        label: 'Skipped',
        className: 'idle',
      })
    })
  })

  describe('defaultMergeRequestTitle', () => {
    it('turns a branch name into a title', () => {
      assert.strictEqual(
        defaultMergeRequestTitle('feature/add-login'),
        'Add login'
      )
      assert.strictEqual(
        defaultMergeRequestTitle('fix/ABC-123_detect-crash'),
        'ABC 123 detect crash'
      )
    })

    it('keeps the last segment for longer paths', () => {
      assert.strictEqual(
        defaultMergeRequestTitle('dependabot/npm_and_yarn/lodash-4.17.20'),
        'Lodash 4.17.20'
      )
    })

    it('handles plain names and falls back on odd input', () => {
      assert.strictEqual(defaultMergeRequestTitle('add-login'), 'Add login')
      assert.strictEqual(defaultMergeRequestTitle('  '), 'Merge request')
      assert.strictEqual(defaultMergeRequestTitle('/'), 'Merge request')
    })
  })

  describe('shortSha', () => {
    it('cuts a SHA to its head', () => {
      assert.strictEqual(
        shortSha('1234567890abcdef1234567890abcdef12345678'),
        '1234567'
      )
      assert.strictEqual(shortSha('abc'), 'abc')
    })
  })
})
