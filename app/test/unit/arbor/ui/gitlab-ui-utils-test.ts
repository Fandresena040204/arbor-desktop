import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  branchOfSymbolicRef,
  chooseGitLabRemote,
  defaultMergeRequestTitle,
  describeGitLabApprovals,
  describeGitLabMergeStatus,
  describeGitLabPipeline,
  filterOutSystemNotes,
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

  describe('describeGitLabMergeStatus', () => {
    it('labels the well-known statuses', () => {
      assert.strictEqual(
        describeGitLabMergeStatus('can_be_merged').label,
        'Can be merged'
      )
      assert.strictEqual(
        describeGitLabMergeStatus('mergeable').label,
        'Can be merged'
      )
      assert.strictEqual(describeGitLabMergeStatus('blocked').label, 'Blocked')
    })

    it('marks the blocking statuses as needing attention', () => {
      assert.strictEqual(
        describeGitLabMergeStatus('can_be_merged').needsAttention,
        false
      )
      assert.strictEqual(
        describeGitLabMergeStatus('cannot_be_merged').needsAttention,
        true
      )
      assert.strictEqual(
        describeGitLabMergeStatus('conflicts').needsAttention,
        true
      )
      assert.strictEqual(
        describeGitLabMergeStatus('blocked').needsAttention,
        true
      )
      assert.strictEqual(
        describeGitLabMergeStatus('discussions_not_resolved').needsAttention,
        true
      )
    })

    it('turns unknown statuses into readable words', () => {
      const status = describeGitLabMergeStatus('ci_still_running')
      assert.strictEqual(status.label, 'Pipeline still running')
      const unknown = describeGitLabMergeStatus('unusual_new_status')
      assert.strictEqual(unknown.label, 'Unusual New Status')
      assert.strictEqual(unknown.needsAttention, false)
    })

    it('has no label when the status is missing', () => {
      assert.strictEqual(describeGitLabMergeStatus('').label, '')
      assert.strictEqual(describeGitLabMergeStatus(' ').label, '')
      assert.strictEqual(describeGitLabMergeStatus('').needsAttention, false)
    })
  })

  describe('describeGitLabApprovals', () => {
    it('lists the approvers when there are some', () => {
      assert.strictEqual(
        describeGitLabApprovals({
          approvalsRequired: 2,
          approvedBy: ['alice', 'bob'],
        }),
        'Approved by @alice, @bob'
      )
    })

    it('lists each approver once', () => {
      assert.strictEqual(
        describeGitLabApprovals({
          approvalsRequired: 3,
          approvedBy: ['alice', ' alice', 'bob', ''],
        }),
        'Approved by @alice, @bob'
      )
    })

    it('states the requirement when nobody approved yet', () => {
      assert.strictEqual(
        describeGitLabApprovals({ approvalsRequired: 1, approvedBy: [] }),
        '1 approval required'
      )
      assert.strictEqual(
        describeGitLabApprovals({ approvalsRequired: 3, approvedBy: [] }),
        '3 approvals required'
      )
    })

    it('says so when no approval is required', () => {
      assert.strictEqual(
        describeGitLabApprovals({ approvalsRequired: 0, approvedBy: [] }),
        'No approvals required'
      )
    })
  })

  describe('filterOutSystemNotes', () => {
    const note = (id: number, system: boolean) => ({
      id,
      body: `body ${id}`,
      author: 'alice',
      createdAt: '2024-01-01T00:00:00Z',
      system,
    })

    it('keeps only the comments', () => {
      const notes = [note(1, false), note(2, true), note(3, false)]
      assert.deepStrictEqual(filterOutSystemNotes(notes), [
        note(1, false),
        note(3, false),
      ])
    })

    it('keeps everything when there is no system note', () => {
      const notes = [note(1, false)]
      assert.deepStrictEqual(filterOutSystemNotes(notes), notes)
    })

    it('returns an empty list for only system notes', () => {
      assert.deepStrictEqual(filterOutSystemNotes([note(1, true)]), [])
      assert.deepStrictEqual(filterOutSystemNotes([]), [])
    })
  })
})
