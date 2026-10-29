// Arbor: pure validation helpers for the repository settings remote manager.

/**
 * Returns an error message, or null if the name is valid.
 */
export function validateRemoteName(
  name: string,
  existingNames: ReadonlyArray<string>,
  currentName?: string
): string | null {
  if (name === '') {
    return 'Remote name is required'
  }

  const invalidCharacters = /[\s~^:?*[\]\\]/

  if (invalidCharacters.test(name) || name.includes('..')) {
    return 'Invalid remote name'
  }

  if (name.startsWith('-') || name.endsWith('/') || name.endsWith('.lock')) {
    return 'Invalid remote name'
  }

  // Git does not allow '.' or '..' as remote names
  if (name === '.' || name === '..') {
    return 'Invalid remote name'
  }

  const taken = existingNames.filter(
    existingName => existingName !== currentName
  )

  if (taken.includes(name)) {
    return 'A remote with this name already exists'
  }

  return null
}

/**
 * Returns an error message, or null if the URL is valid.
 */
export function validateRemoteUrl(url: string): string | null {
  if (url.trim() === '') {
    return 'Remote URL is required'
  }

  return null
}
