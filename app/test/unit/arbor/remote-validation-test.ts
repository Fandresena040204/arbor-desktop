import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  validateRemoteName,
  validateRemoteUrl,
} from '../../../src/ui/arbor/remotes/remote-validation'

describe('validateRemoteName', () => {
  const existingNames = ['origin', 'upstream']

  it('returns error for empty name', () => {
    const error = validateRemoteName('', existingNames)
    assert.equal(error, 'Remote name is required')
  })

  it('returns error for name with spaces', () => {
    const error = validateRemoteName('my remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with tilde', () => {
    const error = validateRemoteName('my~remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with caret', () => {
    const error = validateRemoteName('my^remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with colon', () => {
    const error = validateRemoteName('my:remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with question mark', () => {
    const error = validateRemoteName('my?remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with asterisk', () => {
    const error = validateRemoteName('my*remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with opening bracket', () => {
    const error = validateRemoteName('my[remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with closing bracket', () => {
    const error = validateRemoteName('my]remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with backslash', () => {
    const error = validateRemoteName('my\\remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name with double dot', () => {
    const error = validateRemoteName('my..remote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name starting with hyphen', () => {
    const error = validateRemoteName('-myremote', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name ending with slash', () => {
    const error = validateRemoteName('myremote/', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name ending with .lock', () => {
    const error = validateRemoteName('myremote.lock', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name already taken', () => {
    const error = validateRemoteName('origin', existingNames)
    assert.equal(error, 'A remote with this name already exists')
  })

  it('returns error for name already taken (case sensitive)', () => {
    const error = validateRemoteName('ORIGIN', existingNames)
    assert.equal(error, null)
  })

  it('allows name that matches currentName (rename to same name)', () => {
    const error = validateRemoteName('origin', existingNames, 'origin')
    assert.equal(error, null)
  })

  it('allows valid name not in existing names', () => {
    const error = validateRemoteName('myremote', existingNames)
    assert.equal(error, null)
  })

  it('allows valid name with hyphens and underscores', () => {
    const error = validateRemoteName('my-remote_name', existingNames)
    assert.equal(error, null)
  })

  it('allows valid name with numbers', () => {
    const error = validateRemoteName('remote123', existingNames)
    assert.equal(error, null)
  })

  it('allows valid name with dot in middle', () => {
    const error = validateRemoteName('my.remote', existingNames)
    assert.equal(error, null)
  })

  it('returns error for name that is just a dot', () => {
    const error = validateRemoteName('.', existingNames)
    assert.equal(error, 'Invalid remote name')
  })

  it('returns error for name ending with .lock (case sensitive)', () => {
    const error = validateRemoteName('remote.LOCK', existingNames)
    assert.equal(error, null)
  })
})

describe('validateRemoteUrl', () => {
  it('returns error for empty url', () => {
    const error = validateRemoteUrl('')
    assert.equal(error, 'Remote URL is required')
  })

  it('returns error for whitespace-only url', () => {
    const error = validateRemoteUrl('   ')
    assert.equal(error, 'Remote URL is required')
  })

  it('returns error for tab-only url', () => {
    const error = validateRemoteUrl('\t')
    assert.equal(error, 'Remote URL is required')
  })

  it('returns error for newline-only url', () => {
    const error = validateRemoteUrl('\n')
    assert.equal(error, 'Remote URL is required')
  })

  it('returns null for valid HTTPS url', () => {
    const error = validateRemoteUrl('https://github.com/user/repo.git')
    assert.equal(error, null)
  })

  it('returns null for valid SSH url', () => {
    const error = validateRemoteUrl('git@github.com:user/repo.git')
    assert.equal(error, null)
  })

  it('returns null for valid HTTP url', () => {
    const error = validateRemoteUrl('http://github.com/user/repo')
    assert.equal(error, null)
  })

  it('returns null for valid git protocol url', () => {
    const error = validateRemoteUrl('git://github.com/user/repo.git')
    assert.equal(error, null)
  })

  it('returns null for url with username', () => {
    const error = validateRemoteUrl('https://user@github.com/user/repo.git')
    assert.equal(error, null)
  })

  it('returns null for url with port', () => {
    const error = validateRemoteUrl('ssh://git@github.com:2222/user/repo.git')
    assert.equal(error, null)
  })

  it('returns null for local path', () => {
    const error = validateRemoteUrl('/path/to/repo')
    assert.equal(error, null)
  })

  it('returns null for relative path', () => {
    const error = validateRemoteUrl('../repo')
    assert.equal(error, null)
  })

  it('returns null for url with surrounding whitespace', () => {
    const error = validateRemoteUrl('  https://github.com/user/repo.git  ')
    assert.equal(error, null)
  })
})
