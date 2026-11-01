export interface IGitLabUser {
  readonly id: number
  readonly username: string
  readonly name: string
  readonly avatarUrl: string
}

export interface IGitLabProject {
  readonly id: number
  readonly pathWithNamespace: string
  readonly webUrl: string
  readonly defaultBranch: string | null
}

export type GitLabMergeRequestState = 'opened' | 'closed' | 'merged' | 'locked'

export interface IGitLabMergeRequest {
  readonly iid: number
  readonly title: string
  readonly state: GitLabMergeRequestState
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly webUrl: string
  readonly author: string
  readonly draft: boolean
}

export type GitLabPipelineStatus =
  | 'created'
  | 'waiting_for_resource'
  | 'preparing'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'skipped'
  | 'manual'
  | 'scheduled'

export interface IGitLabPipeline {
  readonly id: number
  readonly status: GitLabPipelineStatus
  readonly ref: string
  readonly sha: string
  readonly webUrl: string
}

export interface IGitLabIssue {
  readonly iid: number
  readonly title: string
  readonly state: 'opened' | 'closed'
  readonly webUrl: string
}

/** Approval state of a merge request. */
export interface IGitLabApprovals {
  readonly approved: boolean
  readonly approvalsRequired: number
  readonly approvalsLeft: number
  /** Usernames of the approvers. */
  readonly approvedBy: ReadonlyArray<string>
  /** Whether the current user already approved. */
  readonly userHasApproved: boolean
  /** Whether the current user may approve. */
  readonly userCanApprove: boolean
}

/** A note (comment or system event) on a merge request. */
export interface IGitLabNote {
  readonly id: number
  readonly body: string
  readonly author: string
  /** ISO date. */
  readonly createdAt: string
  /** System notes are events (pushed commits, label changes…), not comments. */
  readonly system: boolean
}

/** Raw user shape returned by the GitLab API. */
interface IRawGitLabUser {
  readonly id: number
  readonly username: string
  readonly name: string
  readonly avatar_url: string
}

/** Raw project shape returned by the GitLab API. */
interface IRawGitLabProject {
  readonly id: number
  readonly path_with_namespace: string
  readonly web_url: string
  readonly default_branch?: string | null
}

/** Raw merge request shape returned by the GitLab API. */
interface IRawGitLabMergeRequest {
  readonly iid: number
  readonly title: string
  readonly state: string
  readonly source_branch: string
  readonly target_branch: string
  readonly web_url: string
  readonly author?: { readonly username?: string } | null
  readonly draft?: boolean | null
  readonly work_in_progress?: boolean | null
}

/** Raw merge request detail shape returned by the GitLab API. */
interface IRawGitLabMergeRequestDetails extends IRawGitLabMergeRequest {
  readonly description?: string | null
  readonly has_conflicts?: boolean | null
  readonly detailed_merge_status?: string | null
  readonly merge_status?: string | null
}

/** Raw approval state returned by the GitLab API. */
interface IRawGitLabApprovals {
  readonly approved?: boolean | null
  readonly approvals_required?: number | null
  readonly approvals_left?: number | null
  readonly approved_by?: ReadonlyArray<{
    readonly user?: { readonly username?: string } | null
  }> | null
  readonly user_has_approved?: boolean | null
  readonly user_can_approve?: boolean | null
}

/** Raw note shape returned by the GitLab API. */
interface IRawGitLabNote {
  readonly id: number
  readonly body: string
  readonly author?: { readonly username?: string } | null
  readonly created_at: string
  readonly system?: boolean | null
}

/** Raw pipeline shape returned by the GitLab API. */
interface IRawGitLabPipeline {
  readonly id: number
  readonly status: string
  readonly ref: string
  readonly sha: string
  readonly web_url: string
}

/** Raw issue shape returned by the GitLab API. */
interface IRawGitLabIssue {
  readonly iid: number
  readonly title: string
  readonly state: string
  readonly web_url: string
}

/** An error returned by the GitLab API (non-2xx response). */
export class GitLabAPIError extends Error {
  public readonly status: number

  public constructor(status: number, message: string) {
    super(message)
    this.name = 'GitLabAPIError'
    this.status = status
  }
}

/** Convert a raw user into the public shape. */
function toUser(raw: IRawGitLabUser): IGitLabUser {
  return {
    id: raw.id,
    username: raw.username,
    name: raw.name,
    avatarUrl: raw.avatar_url,
  }
}

/** Convert a raw project into the public shape. */
function toProject(raw: IRawGitLabProject): IGitLabProject {
  return {
    id: raw.id,
    pathWithNamespace: raw.path_with_namespace,
    webUrl: raw.web_url,
    defaultBranch: raw.default_branch ?? null,
  }
}

/** Convert a raw merge request into the public shape. */
function toMergeRequest(raw: IRawGitLabMergeRequest): IGitLabMergeRequest {
  return {
    iid: raw.iid,
    title: raw.title,
    state: raw.state as GitLabMergeRequestState,
    sourceBranch: raw.source_branch,
    targetBranch: raw.target_branch,
    webUrl: raw.web_url,
    author: raw.author?.username ?? '',
    draft: raw.draft ?? raw.work_in_progress ?? false,
  }
}

/** Convert a raw pipeline into the public shape. */
function toPipeline(raw: IRawGitLabPipeline): IGitLabPipeline {
  return {
    id: raw.id,
    status: raw.status as GitLabPipelineStatus,
    ref: raw.ref,
    sha: raw.sha,
    webUrl: raw.web_url,
  }
}

/** Convert a raw issue into the public shape. */
function toIssue(raw: IRawGitLabIssue): IGitLabIssue {
  return {
    iid: raw.iid,
    title: raw.title,
    state: raw.state as IGitLabIssue['state'],
    webUrl: raw.web_url,
  }
}

/** Convert a raw merge request detail into the public shape. */
function toMergeRequestDetails(
  raw: IRawGitLabMergeRequestDetails
): IGitLabMergeRequest & {
  readonly description: string
  readonly hasConflicts: boolean
  readonly mergeStatus: string
} {
  return {
    ...toMergeRequest(raw),
    description: raw.description ?? '',
    hasConflicts: raw.has_conflicts ?? false,
    mergeStatus: raw.detailed_merge_status ?? raw.merge_status ?? '',
  }
}

/** Convert a raw approval state into the public shape. */
function toApprovals(raw: IRawGitLabApprovals): IGitLabApprovals {
  const approvedBy = (raw.approved_by ?? [])
    .map(approval => approval.user?.username)
    .filter((username): username is string => username !== undefined)

  return {
    approved: raw.approved ?? false,
    approvalsRequired: raw.approvals_required ?? 0,
    approvalsLeft: raw.approvals_left ?? 0,
    approvedBy,
    userHasApproved: raw.user_has_approved ?? false,
    userCanApprove: raw.user_can_approve ?? false,
  }
}

/** Convert a raw note into the public shape. */
function toNote(raw: IRawGitLabNote): IGitLabNote {
  return {
    id: raw.id,
    body: raw.body,
    author: raw.author?.username ?? '',
    createdAt: raw.created_at,
    system: raw.system ?? false,
  }
}

/** Build a query string from a set of optional parameters. */
function toQueryString(
  params: Readonly<Record<string, string | undefined>>
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, value)
    }
  }
  return query.toString()
}

/** Maximum number of pages fetched by a single list call. */
const maxPages = 5

/**
 * Minimal GitLab REST API v4 client authenticated with a personal access
 * token.
 */
export class GitLabAPI {
  private readonly instanceUrl: string
  private readonly token: string
  private readonly fetchFn: typeof fetch

  public constructor(
    instanceUrl: string,
    token: string,
    fetchFn: typeof fetch = fetch
  ) {
    this.instanceUrl = instanceUrl.replace(/\/+$/, '')
    this.token = token
    // Browsers require `fetch` to be called on the window, not as a method of
    // another object, so wrap it instead of storing it as is.
    this.fetchFn = (input, init) => fetchFn(input, init)
  }

  /** Get the user the access token belongs to. */
  public async getCurrentUser(): Promise<IGitLabUser> {
    const raw = await this.getJson<IRawGitLabUser>('/user')
    return toUser(raw)
  }

  /**
   * Get a project by its full path.
   *
   * @param projectPath The project path including namespaces.
   */
  public async getProject(projectPath: string): Promise<IGitLabProject> {
    const raw = await this.getJson<IRawGitLabProject>(
      this.projectPath(projectPath)
    )
    return toProject(raw)
  }

  /**
   * List merge requests for a project.
   *
   * @param projectPath The project path including namespaces.
   * @param options Optional filters.
   */
  public async listMergeRequests(
    projectPath: string,
    options?: {
      state?: GitLabMergeRequestState | 'all'
      sourceBranch?: string
    }
  ): Promise<ReadonlyArray<IGitLabMergeRequest>> {
    const raw = await this.getPages<IRawGitLabMergeRequest>(
      `${this.projectPath(projectPath)}/merge_requests`,
      {
        state: options?.state,
        source_branch: options?.sourceBranch,
      }
    )
    return raw.map(toMergeRequest)
  }

  /**
   * Create a merge request.
   *
   * @param projectPath The project path including namespaces.
   * @param mr The merge request to create.
   */
  public async createMergeRequest(
    projectPath: string,
    mr: {
      sourceBranch: string
      targetBranch: string
      title: string
      description?: string
      draft?: boolean
      removeSourceBranch?: boolean
    }
  ): Promise<IGitLabMergeRequest> {
    const body: Record<string, unknown> = {
      source_branch: mr.sourceBranch,
      target_branch: mr.targetBranch,
      title: mr.draft === true ? `Draft: ${mr.title}` : mr.title,
    }

    if (mr.description !== undefined) {
      body.description = mr.description
    }

    if (mr.removeSourceBranch !== undefined) {
      body.remove_source_branch = mr.removeSourceBranch
    }

    const raw = await this.postJson<IRawGitLabMergeRequest>(
      `${this.projectPath(projectPath)}/merge_requests`,
      body
    )
    return toMergeRequest(raw)
  }

  /**
   * Get a single merge request, including its description and merge status.
   *
   * @param projectPath The project path including namespaces.
   * @param iid The project-scoped merge request number.
   */
  public async getMergeRequest(
    projectPath: string,
    iid: number
  ): Promise<
    IGitLabMergeRequest & {
      readonly description: string
      readonly hasConflicts: boolean
      readonly mergeStatus: string
    }
  > {
    const raw = await this.getJson<IRawGitLabMergeRequestDetails>(
      `${this.projectPath(projectPath)}/merge_requests/${iid}`
    )
    return toMergeRequestDetails(raw)
  }

  /**
   * Get the approval state of a merge request.
   *
   * @param projectPath The project path including namespaces.
   * @param iid The project-scoped merge request number.
   */
  public async getApprovals(
    projectPath: string,
    iid: number
  ): Promise<IGitLabApprovals> {
    const raw = await this.getJson<IRawGitLabApprovals>(
      `${this.projectPath(projectPath)}/merge_requests/${iid}/approvals`
    )
    return toApprovals(raw)
  }

  /**
   * Approve a merge request as the current user.
   *
   * @param projectPath The project path including namespaces.
   * @param iid The project-scoped merge request number.
   */
  public async approve(projectPath: string, iid: number): Promise<void> {
    await this.request(
      `${this.projectPath(projectPath)}/merge_requests/${iid}/approve`,
      { method: 'POST' }
    )
  }

  /**
   * Remove the current user's approval from a merge request.
   *
   * @param projectPath The project path including namespaces.
   * @param iid The project-scoped merge request number.
   */
  public async unapprove(projectPath: string, iid: number): Promise<void> {
    await this.request(
      `${this.projectPath(projectPath)}/merge_requests/${iid}/unapprove`,
      { method: 'POST' }
    )
  }

  /**
   * List the notes of a merge request, oldest first.
   *
   * @param projectPath The project path including namespaces.
   * @param iid The project-scoped merge request number.
   */
  public async listNotes(
    projectPath: string,
    iid: number
  ): Promise<ReadonlyArray<IGitLabNote>> {
    const raw = await this.getPages<IRawGitLabNote>(
      `${this.projectPath(projectPath)}/merge_requests/${iid}/notes`,
      { sort: 'asc', order_by: 'created_at' }
    )
    return raw.map(toNote)
  }

  /**
   * Add a comment to a merge request.
   *
   * @param projectPath The project path including namespaces.
   * @param iid The project-scoped merge request number.
   * @param body The note body, in GitLab-flavored Markdown.
   */
  public async addNote(
    projectPath: string,
    iid: number,
    body: string
  ): Promise<IGitLabNote> {
    const raw = await this.postJson<IRawGitLabNote>(
      `${this.projectPath(projectPath)}/merge_requests/${iid}/notes`,
      { body }
    )
    return toNote(raw)
  }

  /**
   * Get the latest pipeline for a ref, or null when there is none.
   *
   * @param projectPath The project path including namespaces.
   * @param ref The branch or tag name.
   */
  public async getLatestPipeline(
    projectPath: string,
    ref: string
  ): Promise<IGitLabPipeline | null> {
    const query = toQueryString({
      ref,
      per_page: '1',
      order_by: 'id',
      sort: 'desc',
    })
    const raw = await this.getJson<ReadonlyArray<IRawGitLabPipeline>>(
      `${this.projectPath(projectPath)}/pipelines?${query}`
    )
    return raw.length === 0 ? null : toPipeline(raw[0])
  }

  /**
   * Get the latest pipeline for a commit, or null when there is none.
   *
   * @param projectPath The project path including namespaces.
   * @param sha The commit SHA.
   */
  public async getPipelineForSha(
    projectPath: string,
    sha: string
  ): Promise<IGitLabPipeline | null> {
    const query = toQueryString({
      sha,
      per_page: '1',
      order_by: 'id',
      sort: 'desc',
    })
    const raw = await this.getJson<ReadonlyArray<IRawGitLabPipeline>>(
      `${this.projectPath(projectPath)}/pipelines?${query}`
    )
    return raw.length === 0 ? null : toPipeline(raw[0])
  }

  /**
   * List issues for a project.
   *
   * @param projectPath The project path including namespaces.
   * @param options Optional filters.
   */
  public async listIssues(
    projectPath: string,
    options?: { state?: 'opened' | 'closed' | 'all'; search?: string }
  ): Promise<ReadonlyArray<IGitLabIssue>> {
    const raw = await this.getPages<IRawGitLabIssue>(
      `${this.projectPath(projectPath)}/issues`,
      {
        state: options?.state,
        search: options?.search,
      }
    )
    return raw.map(toIssue)
  }

  /** Build the API path for a project, encoding its namespaces. */
  private projectPath(projectPath: string): string {
    return `/projects/${encodeURIComponent(projectPath)}`
  }

  /** Perform a GET request and parse its JSON body. */
  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path)
    return (await response.json()) as T
  }

  /** Perform a POST request with a JSON body and parse its JSON response. */
  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return (await response.json()) as T
  }

  /** Fetch every page of a list endpoint, following `x-next-page`. */
  private async getPages<T>(
    path: string,
    params: Readonly<Record<string, string | undefined>>
  ): Promise<ReadonlyArray<T>> {
    const results: Array<T> = []
    let page: string | null = null

    for (let index = 0; index < maxPages; index++) {
      const query = toQueryString({
        ...params,
        per_page: '100',
        page: page ?? undefined,
      })
      const response = await this.request(`${path}?${query}`)
      const items = (await response.json()) as ReadonlyArray<T>
      results.push(...items)

      page = response.headers.get('x-next-page')
      if (page === null || page.length === 0) {
        break
      }
    }

    return results
  }

  /** Perform an authenticated request, throwing on non-2xx responses. */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // Works for personal access tokens and OAuth tokens alike, unlike
      // the PRIVATE-TOKEN header which OAuth tokens aren't accepted in.
      Authorization: `Bearer ${this.token}`,
    }

    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await this.fetchFn(`${this.instanceUrl}/api/v4${path}`, {
      ...init,
      headers,
    })

    if (!response.ok) {
      throw new GitLabAPIError(
        response.status,
        await this.errorMessage(response)
      )
    }

    return response
  }

  /** Extract a human-readable message from an error response. */
  private async errorMessage(response: Response): Promise<string> {
    const fallback =
      response.statusText.length > 0
        ? response.statusText
        : `GitLab API request failed with status ${response.status}`

    try {
      const body = (await response.json()) as unknown
      if (body !== null && typeof body === 'object') {
        const record = body as Record<string, unknown>
        const message = record.message ?? record.error
        if (typeof message === 'string' && message.length > 0) {
          return message
        }
        if (message !== undefined) {
          return JSON.stringify(message)
        }
      }
    } catch {
      // The body wasn't JSON, fall back to the status text.
    }

    return fallback
  }
}
