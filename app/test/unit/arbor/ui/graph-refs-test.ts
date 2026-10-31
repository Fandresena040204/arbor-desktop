import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getInitials,
  groupRefs,
} from '../../../../src/ui/arbor/graph/graph-refs'

describe('arbor/ui/graph-refs', () => {
  it('merges a local branch with its remote counterparts', () => {
    assert.deepStrictEqual(
      groupRefs(
        [
          { type: 'remote', name: 'origin/main' },
          { type: 'local', name: 'main' },
          { type: 'remote', name: 'upstream/main' },
        ],
        'main'
      ),
      [
        {
          kind: 'branch',
          name: 'main',
          local: true,
          remotes: ['origin', 'upstream'],
          current: true,
        },
      ]
    )
  })

  it('keeps remote-only branches, tags and HEAD, current branch first', () => {
    const badges = groupRefs(
      [
        { type: 'tag', name: 'v1.0' },
        { type: 'remote', name: 'origin/feature/x' },
        { type: 'local', name: 'dev' },
        { type: 'local', name: 'main' },
      ],
      'main'
    )
    assert.deepStrictEqual(
      badges.map(b => `${b.kind}:${b.name}`),
      ['branch:main', 'branch:dev', 'remote:origin/feature/x', 'tag:v1.0']
    )
  })

  it('computes initials', () => {
    assert.strictEqual(getInitials('Ada Lovelace'), 'AL')
    assert.strictEqual(getInitials('linus'), 'L')
    assert.strictEqual(getInitials('jean-luc picard'), 'JP')
    assert.strictEqual(getInitials('  '), '?')
  })
})
