import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getArborReleasesApiUrl,
  toReleaseMetadata,
} from '../../../src/lib/arbor/arbor-releases'
import { getUpdatesURL } from '../../../../script/dist-info'
import { getVersion } from '../../../package-info'

const release = {
  tag_name: 'v1.1.0',
  name: 'Arbor 1.1.0',
  body: [
    'Highlights of this release:',
    '',
    '- [New] GitLab merge request reviews',
    '* [Fixed] Graph refresh on checkout  ',
    '- A note without a tag',
  ].join('\r\n'),
  published_at: '2026-11-01T10:00:00Z',
  draft: false,
  prerelease: false,
}

describe('arbor/arbor-releases', () => {
  it('turns release descriptions into notes', () => {
    assert.deepStrictEqual(toReleaseMetadata([release]), [
      {
        name: 'Arbor 1.1.0',
        version: '1.1.0',
        pub_date: '2026-11-01T10:00:00Z',
        notes: [
          '[New] GitLab merge request reviews',
          '[Fixed] Graph refresh on checkout',
          'A note without a tag',
        ],
      },
    ])
  })

  it('skips drafts, and prereleases unless asked', () => {
    const draft = { ...release, draft: true }
    const beta = { ...release, tag_name: 'v1.2.0-beta.1', prerelease: true }
    assert.deepStrictEqual(toReleaseMetadata([draft, beta]), [])
    assert.deepStrictEqual(
      toReleaseMetadata([draft, beta], true).map(r => r.version),
      ['1.2.0-beta.1']
    )
  })

  it('lists releases from the GitHub API', () => {
    assert.strictEqual(
      getArborReleasesApiUrl(10),
      'https://api.github.com/repos/Fandresena040204/arbor-desktop/releases?per_page=10'
    )
  })
})

describe('arbor/update feed', () => {
  const env = { ...process.env }
  const withEnv = (
    vars: Record<string, string | undefined>,
    fn: () => void
  ) => {
    Object.assign(process.env, vars)
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) {
        delete process.env[k]
      }
    }
    try {
      fn()
    } finally {
      process.env = { ...env }
    }
  }

  it('uses update.electronjs.org for Arbor releases', () => {
    withEnv(
      { ARBOR_UPDATES_URL: undefined, RELEASE_CHANNEL: 'production' },
      () => {
        assert.match(
          getUpdatesURL(),
          new RegExp(
            `^https://update\\.electronjs\\.org/Fandresena040204/arbor-desktop/${
              process.platform
            }-(x64|arm64)/${getVersion().replace(/\./g, '\\.')}$`
          )
        )
      }
    )
  })

  it('has no feed for development builds, and can be overridden', () => {
    withEnv(
      { ARBOR_UPDATES_URL: undefined, RELEASE_CHANNEL: 'development' },
      () => assert.strictEqual(getUpdatesURL(), '')
    )
    withEnv({ ARBOR_UPDATES_URL: 'https://example.org/feed' }, () =>
      assert.strictEqual(getUpdatesURL(), 'https://example.org/feed')
    )
  })
})
