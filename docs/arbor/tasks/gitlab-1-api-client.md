# Task: GitLab support, part 1 — API client and remote detection

Brief for a delegated agent (role `dev-back`). Self-contained.

Project: D:\perso\GitHub_desktop = "Arbor", a fork of GitHub Desktop
(Electron + TypeScript + React). Do NOT commit or push. Do NOT install any
dependency.

## Goal

Lay the groundwork for GitLab support (gitlab.com and self-hosted
instances): detect GitLab remotes and talk to the GitLab REST API v4 with a
personal access token. No UI yet (that comes in a later task).

## Fork rules (mandatory)

- Everything goes under `app/src/lib/arbor/gitlab/`, plus tests under
  `app/test/unit/arbor/gitlab/`. Do not modify any existing file.
- Prettier style (no `;`, single quotes, 2 spaces), JSDoc `/** */` comments,
  `readonly` interfaces.
- Use the global `fetch` and inject it (constructor parameter) so tests can
  pass a fake. Do not use `app/src/lib/http.ts` (it is GitHub-specific).

## Context to read

- `app/src/lib/remote-parsing.ts`: `parseRemote(url)` parses SSH/HTTPS remote
  URLs, but it only supports `owner/name`. GitLab needs nested groups
  (`group/subgroup/project`).
- `app/src/lib/api.ts`: the GitHub client, for the style only.

## Contract (exact)

1. `app/src/lib/arbor/gitlab/gitlab-remote.ts`

   ```ts
   export interface IGitLabRemote {
     /** Instance base URL without trailing slash, e.g. https://gitlab.com or https://git.example.org/gitlab */
     readonly instanceUrl: string
     /** Full project path with namespaces, e.g. group/sub/project (no .git) */
     readonly projectPath: string
   }

   /**
    * Parse a remote URL into a GitLab project, or null if it doesn't belong to
    * one of `instanceUrls`. gitlab.com is always known.
    * Supports https://host[/prefix]/a/b/c(.git), ssh://git@host[:port]/a/b(.git),
    * git@host:a/b/c(.git).
    */
   export function parseGitLabRemote(
     remoteUrl: string,
     instanceUrls: ReadonlyArray<string>
   ): IGitLabRemote | null
   ```

   - Host matching is case-insensitive. A self-hosted instance under a path
     prefix (`https://example.org/gitlab`) only matches HTTPS remotes that
     start with that prefix; for SSH remotes, match on the host alone.
   - Strip credentials (`https://user:token@host/...`) and a trailing `/`.

2. `app/src/lib/arbor/gitlab/gitlab-api.ts`

   ```ts
   export interface IGitLabUser { readonly id: number; readonly username: string; readonly name: string; readonly avatarUrl: string }
   export interface IGitLabProject { readonly id: number; readonly pathWithNamespace: string; readonly webUrl: string; readonly defaultBranch: string | null }
   export type GitLabMergeRequestState = 'opened' | 'closed' | 'merged' | 'locked'
   export interface IGitLabMergeRequest { readonly iid: number; readonly title: string; readonly state: GitLabMergeRequestState; readonly sourceBranch: string; readonly targetBranch: string; readonly webUrl: string; readonly author: string; readonly draft: boolean }
   export type GitLabPipelineStatus = 'created' | 'waiting_for_resource' | 'preparing' | 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 'manual' | 'scheduled'
   export interface IGitLabPipeline { readonly id: number; readonly status: GitLabPipelineStatus; readonly ref: string; readonly sha: string; readonly webUrl: string }
   export interface IGitLabIssue { readonly iid: number; readonly title: string; readonly state: 'opened' | 'closed'; readonly webUrl: string }

   export class GitLabAPIError extends Error {
     public constructor(public readonly status: number, message: string)
   }

   export class GitLabAPI {
     public constructor(instanceUrl: string, token: string, fetchFn: typeof fetch = fetch)
     public getCurrentUser(): Promise<IGitLabUser>                                   // GET /api/v4/user
     public getProject(projectPath: string): Promise<IGitLabProject>                 // GET /api/v4/projects/:url-encoded-path
     public listMergeRequests(projectPath: string, options?: { state?: GitLabMergeRequestState | 'all'; sourceBranch?: string }): Promise<ReadonlyArray<IGitLabMergeRequest>>
     public createMergeRequest(projectPath: string, mr: { sourceBranch: string; targetBranch: string; title: string; description?: string; draft?: boolean; removeSourceBranch?: boolean }): Promise<IGitLabMergeRequest>   // POST; draft => title prefixed "Draft: "
     public getLatestPipeline(projectPath: string, ref: string): Promise<IGitLabPipeline | null>   // GET /pipelines?ref=&per_page=1&order_by=id&sort=desc
     public listIssues(projectPath: string, options?: { state?: 'opened' | 'closed' | 'all'; search?: string }): Promise<ReadonlyArray<IGitLabIssue>>
   }
   ```

   - Auth header `PRIVATE-TOKEN: <token>`, `Accept: application/json`,
     JSON body for POST. Map snake_case fields to the camelCase interfaces
     (`path_with_namespace`, `web_url`, `default_branch`, `source_branch`,
     `target_branch`, `author.username`, `avatar_url`, `draft` falling back to
     `work_in_progress`).
   - Lists: follow pagination with `per_page=100` and the `x-next-page`
     header, at most 5 pages.
   - Non-2xx responses throw `GitLabAPIError(status, message)`, where the
     message comes from the JSON `message` or `error` field when present.
     A network failure rethrows the original error.
   - Strip a trailing `/` from `instanceUrl`. Encode `projectPath` with
     `encodeURIComponent` (so `/` becomes `%2F`).

## Done when

- `app/test/unit/arbor/gitlab/gitlab-remote-test.ts`: HTTPS, SSH (both
  forms), port, nested groups, `.git` suffix, credentials, self-hosted with a
  path prefix, unknown host → null, case-insensitive host.
- `app/test/unit/arbor/gitlab/gitlab-api-test.ts`, with a fake `fetch` that
  records requests and returns canned `Response`s: headers, URL encoding,
  field mapping, pagination (2 pages), the "Draft: " prefix, latest pipeline
  null when empty, and errors (404 with a JSON message, 401).
- `node script/test.mjs app/test/unit/arbor/gitlab` passes.
- `node node_modules/typescript/bin/tsc --noEmit -p .` reports no error.
- `npx eslint --rulesdir ./eslint-rules app/src/lib/arbor/gitlab app/test/unit/arbor/gitlab`
  and `npx prettier --check` (same paths) are clean.
- Final summary: files created and test output.
