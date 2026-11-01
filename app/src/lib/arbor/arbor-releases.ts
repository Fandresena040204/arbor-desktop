import { ReleaseMetadata } from '../../models/release-notes'

/** The GitHub repository Arbor releases are published to. */
export const ArborReleasesRepository = 'Fandresena040204/arbor-desktop'

/** The parts of a GitHub release (REST API) used for release notes. */
export interface IGitHubRelease {
  readonly tag_name: string
  readonly name: string | null
  readonly body: string | null
  readonly published_at: string | null
  readonly draft: boolean
  readonly prerelease: boolean
}

/**
 * Turn Arbor's GitHub releases into the release metadata the release notes
 * dialog shows. Each "- " or "* " line of a release's description is a note;
 * notes can start with Desktop's tags ([New], [Fixed], [Improved], [Removed],
 * [Added]) to be grouped. Drafts are skipped, and prereleases unless asked.
 */
export function toReleaseMetadata(
  releases: ReadonlyArray<IGitHubRelease>,
  includePrereleases: boolean = false
): ReadonlyArray<ReleaseMetadata> {
  return releases
    .filter(r => !r.draft && (includePrereleases || !r.prerelease))
    .filter(r => r.published_at !== null)
    .map(r => ({
      name: r.name ?? r.tag_name,
      version: r.tag_name.replace(/^v/, ''),
      pub_date: r.published_at!,
      notes: (r.body ?? '')
        .split(/\r?\n/)
        .map(line => /^\s*[-*]\s+(.*\S)\s*$/.exec(line)?.[1])
        .filter((note): note is string => note !== undefined),
    }))
}

/** The URL of the GitHub API listing Arbor's releases. */
export function getArborReleasesApiUrl(limit?: number): string {
  const url = new URL(
    `https://api.github.com/repos/${ArborReleasesRepository}/releases`
  )
  if (limit !== undefined) {
    url.searchParams.set('per_page', Math.min(limit, 100).toString())
  }
  return url.toString()
}
