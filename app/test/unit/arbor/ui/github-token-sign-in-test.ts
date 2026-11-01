import assert from 'node:assert'
import { describe, it } from 'node:test'
import { getTokenSignInEndpoint } from '../../../../src/ui/arbor/github-token-sign-in'
import { getDotComAPIEndpoint } from '../../../../src/lib/api'

describe('arbor/ui/github-token-sign-in', () => {
  it('uses the GitHub.com API for GitHub.com', () => {
    assert.strictEqual(
      getTokenSignInEndpoint('dotcom', 'ignored'),
      getDotComAPIEndpoint()
    )
  })

  it('uses the API of a GitHub Enterprise server, with or without scheme', () => {
    assert.strictEqual(
      getTokenSignInEndpoint('enterprise', 'https://github.example.com'),
      'https://github.example.com/api/v3'
    )
    assert.strictEqual(
      getTokenSignInEndpoint('enterprise', ' github.example.com '),
      'https://github.example.com/api/v3'
    )
  })
})
