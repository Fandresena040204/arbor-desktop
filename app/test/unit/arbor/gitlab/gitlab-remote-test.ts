import assert from 'node:assert'
import { describe, it } from 'node:test'
import { parseGitLabRemote } from '../../../../src/lib/arbor/gitlab/gitlab-remote'

describe('arbor/gitlab/gitlab-remote', () => {
  describe('parseGitLabRemote', () => {
    it('parses an HTTPS remote on gitlab.com', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('https://gitlab.com/group/project.git', []),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/project',
        }
      )
    })

    it('parses nested groups', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('https://gitlab.com/group/subgroup/project.git', []),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/subgroup/project',
        }
      )
    })

    it('parses an scp-like SSH remote', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('git@gitlab.com:group/subgroup/project.git', []),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/subgroup/project',
        }
      )
    })

    it('parses an ssh:// remote', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('ssh://git@gitlab.com/group/project.git', []),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/project',
        }
      )
    })

    it('ignores the port of an ssh:// remote', () => {
      assert.deepStrictEqual(
        parseGitLabRemote(
          'ssh://git@gitlab.com:2222/group/subgroup/project.git',
          []
        ),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/subgroup/project',
        }
      )
    })

    it('strips a trailing slash and the .git suffix', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('https://gitlab.com/group/project.git/', []),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/project',
        }
      )
    })

    it('strips credentials from an HTTPS remote', () => {
      assert.deepStrictEqual(
        parseGitLabRemote(
          'https://user:personal-access-token@gitlab.com/group/project.git',
          []
        ),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/project',
        }
      )
    })

    it('matches a self-hosted instance with a path prefix', () => {
      assert.deepStrictEqual(
        parseGitLabRemote(
          'https://git.example.org/gitlab/group/subgroup/project.git',
          ['https://git.example.org/gitlab']
        ),
        {
          instanceUrl: 'https://git.example.org/gitlab',
          projectPath: 'group/subgroup/project',
        }
      )
    })

    it('normalizes a trailing slash in the instance URL', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('https://git.example.org/gitlab/group/project.git', [
          'https://git.example.org/gitlab/',
        ]),
        {
          instanceUrl: 'https://git.example.org/gitlab',
          projectPath: 'group/project',
        }
      )
    })

    it('does not match an HTTPS remote outside the instance path prefix', () => {
      assert.strictEqual(
        parseGitLabRemote('https://git.example.org/group/project.git', [
          'https://git.example.org/gitlab',
        ]),
        null
      )
    })

    it('matches an SSH remote on the host alone', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('git@git.example.org:group/project.git', [
          'https://git.example.org/gitlab',
        ]),
        {
          instanceUrl: 'https://git.example.org/gitlab',
          projectPath: 'group/project',
        }
      )
    })

    it('returns null for an unknown host', () => {
      assert.strictEqual(
        parseGitLabRemote('https://example.com/group/project.git', []),
        null
      )
    })

    it('matches hosts case-insensitively', () => {
      assert.deepStrictEqual(
        parseGitLabRemote('https://GitLab.COM/group/project.git', []),
        {
          instanceUrl: 'https://gitlab.com',
          projectPath: 'group/project',
        }
      )
    })

    it('returns null when the remote has no project path', () => {
      assert.strictEqual(parseGitLabRemote('https://gitlab.com', []), null)
    })

    it('returns null for a URL that is not a git remote', () => {
      assert.strictEqual(parseGitLabRemote('not a remote', []), null)
    })
  })
})
