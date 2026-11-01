import { Repository } from '../../../models/repository'
import { getRemotes } from '../../../lib/git'
import { GitLabAccounts } from '../../../lib/arbor/gitlab/gitlab-accounts'
import { GitLabAPI } from '../../../lib/arbor/gitlab/gitlab-api'
import { parseGitLabRemote } from '../../../lib/arbor/gitlab/gitlab-remote'

/** Most commits whose pipeline the graph asks GitLab about. */
const MaxPipelineCommits = 30

/** Simultaneous requests to GitLab. */
const Concurrency = 6

/** The simplified status shown on a graph row. */
export type GraphPipelineStatus = 'success' | 'failed' | 'running' | 'other'

/** Map a GitLab pipeline status to the one shown in the graph. */
export function toGraphPipelineStatus(status: string): GraphPipelineStatus {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
    case 'canceled':
      return 'failed'
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
    case 'running':
      return 'running'
    default:
      return 'other'
  }
}

/**
 * The pipeline status of the given commits, when the repository has a GitLab
 * remote the user signed in to; an empty map otherwise or on any error, the
 * graph simply showing no status then.
 */
export async function loadGraphPipelines(
  repository: Repository,
  shas: ReadonlyArray<string>
): Promise<ReadonlyMap<string, GraphPipelineStatus>> {
  const statuses = new Map<string, GraphPipelineStatus>()
  try {
    const accounts = new GitLabAccounts()
    const remotes = await getRemotes(repository)
    const ordered = [
      ...remotes.filter(r => r.name === 'origin'),
      ...remotes.filter(r => r.name !== 'origin'),
    ]
    const instances = accounts.getInstanceUrls()
    const project = ordered
      .map(r => parseGitLabRemote(r.url, instances))
      .find(p => p !== null)
    if (project === undefined || project === null) {
      return statuses
    }

    const token = await accounts.getToken(project.instanceUrl)
    if (token === null) {
      return statuses
    }

    const api = new GitLabAPI(project.instanceUrl, token)
    const queue = shas.slice(0, MaxPipelineCommits)
    const worker = async () => {
      for (let sha = queue.shift(); sha !== undefined; sha = queue.shift()) {
        const pipeline = await api
          .getPipelineForSha(project.projectPath, sha)
          .catch(() => null)
        if (pipeline !== null) {
          statuses.set(sha, toGraphPipelineStatus(pipeline.status))
        }
      }
    }
    await Promise.all(Array.from({ length: Concurrency }, worker))
  } catch (e) {
    log.warn(
      'Arbor: unable to load pipeline statuses for the graph',
      e instanceof Error ? e : undefined
    )
  }
  return statuses
}
