export interface IGitLabRemote {
  /** Instance base URL without trailing slash, e.g. https://gitlab.com or https://git.example.org/gitlab */
  readonly instanceUrl: string
  /** Full project path with namespaces, e.g. group/sub/project (no .git) */
  readonly projectPath: string
}

/** A remote URL split into the pieces we need for instance matching. */
interface IParsedRemoteUrl {
  /** Whether the remote uses a web (HTTP(S)) or an SSH-style URL. */
  readonly kind: 'web' | 'ssh'
  /** Lower-cased hostname, without port or credentials. */
  readonly hostname: string
  /** Path portion of the URL, without leading or trailing slashes. */
  readonly path: string
}

/** A normalized instance URL split into the pieces we need for matching. */
interface IParsedInstanceUrl {
  /** The instance URL exactly as configured, without a trailing slash. */
  readonly instanceUrl: string
  /** Lower-cased hostname. */
  readonly hostname: string
  /** Path prefix without leading or trailing slashes (empty for gitlab.com). */
  readonly pathPrefix: string
}

const gitLabDotCom = 'https://gitlab.com'

/** Remove leading and trailing slashes from a URL path. */
function trimSlashes(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Parse a remote URL into its host and path.
 *
 * Supports `https://host/...`, `ssh://git@host[:port]/...` and the scp-like
 * `git@host:...` form. Credentials and query strings are ignored.
 */
function parseRemoteUrl(remoteUrl: string): IParsedRemoteUrl | null {
  const value = remoteUrl.trim().replace(/\/+$/, '')
  if (value.length === 0) {
    return null
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)
  if (schemeMatch !== null) {
    try {
      const parsed = new URL(value)
      if (parsed.hostname.length === 0) {
        return null
      }

      const scheme = schemeMatch[1].toLowerCase()
      const kind = scheme === 'http' || scheme === 'https' ? 'web' : 'ssh'

      return {
        kind,
        hostname: parsed.hostname.toLowerCase(),
        path: trimSlashes(parsed.pathname),
      }
    } catch {
      return null
    }
  }

  // scp-like syntax: git@host:group/subgroup/project.git
  const scpMatch = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(value)
  if (scpMatch !== null) {
    return {
      kind: 'ssh',
      hostname: scpMatch[1].toLowerCase(),
      path: trimSlashes(scpMatch[2]),
    }
  }

  return null
}

/** Normalize an instance URL, adding an https scheme when it is missing. */
function parseInstanceUrl(instanceUrl: string): IParsedInstanceUrl | null {
  const trimmed = instanceUrl.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) {
    return null
  }

  const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const parsed = new URL(value)
    if (parsed.hostname.length === 0) {
      return null
    }

    return {
      instanceUrl: value.replace(/\/+$/, ''),
      hostname: parsed.hostname.toLowerCase(),
      pathPrefix: trimSlashes(parsed.pathname),
    }
  } catch {
    return null
  }
}

/**
 * Turn a URL path into a GitLab project path, or null when it doesn't look
 * like a complete project path (`namespace/project`).
 */
function toProjectPath(path: string): string | null {
  let value = trimSlashes(path)
  if (value.endsWith('.git')) {
    value = value.slice(0, -4)
  }
  value = trimSlashes(value)

  if (value.length === 0) {
    return null
  }

  const segments = value.split('/')
  if (
    segments.length < 2 ||
    segments.some(s => s.length === 0 || s === '.' || s === '..')
  ) {
    return null
  }

  return value
}

/**
 * Parse a remote URL into a GitLab project, or null if it doesn't belong to
 * one of `instanceUrls`. gitlab.com is always known.
 *
 * Supports https://host[/prefix]/a/b/c(.git), ssh://git@host[:port]/a/b(.git),
 * git@host:a/b/c(.git).
 *
 * @param remoteUrl The remote URL as stored by git.
 * @param instanceUrls Additional GitLab instances, e.g. a self-hosted server.
 */
export function parseGitLabRemote(
  remoteUrl: string,
  instanceUrls: ReadonlyArray<string>
): IGitLabRemote | null {
  const remote = parseRemoteUrl(remoteUrl)
  if (remote === null) {
    return null
  }

  const configuredInstances = [gitLabDotCom, ...instanceUrls]
    .map(parseInstanceUrl)
    .filter((instance): instance is IParsedInstanceUrl => instance !== null)

  let bestMatch: { instance: IParsedInstanceUrl; projectPath: string } | null =
    null

  for (const instance of configuredInstances) {
    if (instance.hostname !== remote.hostname) {
      continue
    }

    if (remote.kind === 'web') {
      const prefix = instance.pathPrefix
      if (
        prefix.length > 0 &&
        remote.path !== prefix &&
        !remote.path.startsWith(`${prefix}/`)
      ) {
        continue
      }

      const projectPath = toProjectPath(remote.path.slice(prefix.length))
      if (projectPath === null) {
        continue
      }

      if (
        bestMatch === null ||
        instance.pathPrefix.length > bestMatch.instance.pathPrefix.length
      ) {
        bestMatch = { instance, projectPath }
      }
    } else {
      // SSH remotes carry no indication of the instance's web path prefix, so
      // they are matched on the host alone.
      const projectPath = toProjectPath(remote.path)
      if (projectPath === null) {
        continue
      }

      if (
        bestMatch === null ||
        instance.pathPrefix.length > bestMatch.instance.pathPrefix.length
      ) {
        bestMatch = { instance, projectPath }
      }
    }
  }

  return bestMatch === null
    ? null
    : {
        instanceUrl: bestMatch.instance.instanceUrl,
        projectPath: bestMatch.projectPath,
      }
}
