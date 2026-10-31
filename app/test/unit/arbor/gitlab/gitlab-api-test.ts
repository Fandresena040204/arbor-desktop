import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  GitLabAPI,
  GitLabAPIError,
} from '../../../../src/lib/arbor/gitlab/gitlab-api'

interface IFetchCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** A fake fetch that records calls and returns canned responses. */
class RecordingFetch {
  public readonly calls: Array<IFetchCall> = []
  private readonly responses: ReadonlyArray<Response | Error>

  public constructor(responses: ReadonlyArray<Response | Error>) {
    this.responses = responses
  }

  public readonly fetch: typeof fetch = async (input, init) => {
    this.calls.push({ url: input.toString(), init })

    const response = this.responses[this.calls.length - 1]
    if (response === undefined) {
      throw new Error('Unexpected fetch call')
    }

    if (response instanceof Error) {
      throw response
    }

    return response
  }
}

/** Build a JSON response for the fake fetch. */
function jsonResponse(
  body: unknown,
  options?: {
    readonly status?: number
    readonly headers?: Readonly<Record<string, string>>
  }
): Response {
  return new Response(JSON.stringify(body), {
    status: options?.status ?? 200,
    headers: { 'content-type': 'application/json', ...options?.headers },
  })
}

/** Create an API client backed by a fake fetch. */
function createAPI(
  responses: ReadonlyArray<Response | Error>,
  instanceUrl = 'https://gitlab.com'
): { readonly api: GitLabAPI; readonly fake: RecordingFetch } {
  const fake = new RecordingFetch(responses)
  return {
    api: new GitLabAPI(instanceUrl, 'secret-token', fake.fetch),
    fake,
  }
}

/** Read a header from a recorded request. */
function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

/** Read a query parameter from a recorded request URL. */
function searchParam(url: string, name: string): string | null {
  return new URL(url).searchParams.get(name)
}

describe('arbor/gitlab/gitlab-api', () => {
  describe('getCurrentUser', () => {
    it('sends the auth headers and maps the response', async () => {
      const { api, fake } = createAPI([
        jsonResponse({
          id: 12,
          username: 'alice',
          name: 'Alice',
          avatar_url: 'https://gitlab.com/uploads/alice.png',
        }),
      ])

      const user = await api.getCurrentUser()

      assert.deepStrictEqual(user, {
        id: 12,
        username: 'alice',
        name: 'Alice',
        avatarUrl: 'https://gitlab.com/uploads/alice.png',
      })
      assert.strictEqual(fake.calls.length, 1)
      assert.strictEqual(fake.calls[0].url, 'https://gitlab.com/api/v4/user')
      assert.strictEqual(
        header(fake.calls[0].init, 'PRIVATE-TOKEN'),
        'secret-token'
      )
      assert.strictEqual(
        header(fake.calls[0].init, 'Accept'),
        'application/json'
      )
    })
  })

  describe('getProject', () => {
    it('encodes the project path and maps the response', async () => {
      const { api, fake } = createAPI([
        jsonResponse({
          id: 42,
          path_with_namespace: 'group/subgroup/project',
          web_url: 'https://gitlab.com/group/subgroup/project',
          default_branch: 'main',
        }),
      ])

      const project = await api.getProject('group/subgroup/project')

      assert.deepStrictEqual(project, {
        id: 42,
        pathWithNamespace: 'group/subgroup/project',
        webUrl: 'https://gitlab.com/group/subgroup/project',
        defaultBranch: 'main',
      })
      assert.strictEqual(
        fake.calls[0].url,
        'https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Fproject'
      )
    })

    it('maps a missing default branch to null', async () => {
      const { api } = createAPI([
        jsonResponse({
          id: 7,
          path_with_namespace: 'group/empty',
          web_url: 'https://gitlab.com/group/empty',
          default_branch: null,
        }),
      ])

      const project = await api.getProject('group/empty')

      assert.strictEqual(project.defaultBranch, null)
    })

    it('strips a trailing slash from the instance URL', async () => {
      const { api, fake } = createAPI(
        [
          jsonResponse({
            id: 1,
            path_with_namespace: 'g/p',
            web_url: '',
            default_branch: null,
          }),
        ],
        'https://gitlab.example.org/'
      )

      await api.getProject('g/p')

      assert.strictEqual(
        fake.calls[0].url,
        'https://gitlab.example.org/api/v4/projects/g%2Fp'
      )
    })
  })

  describe('listMergeRequests', () => {
    it('follows pagination and maps the responses', async () => {
      const { api, fake } = createAPI([
        jsonResponse(
          [
            {
              iid: 1,
              title: 'MR one',
              state: 'opened',
              source_branch: 'feature/a',
              target_branch: 'main',
              web_url: 'https://gitlab.com/group/project/-/merge_requests/1',
              author: { username: 'alice' },
              draft: true,
            },
            {
              iid: 2,
              title: 'MR two',
              state: 'closed',
              source_branch: 'feature/b',
              target_branch: 'main',
              web_url: 'https://gitlab.com/group/project/-/merge_requests/2',
              author: { username: 'bob' },
              work_in_progress: true,
            },
          ],
          { headers: { 'x-next-page': '2' } }
        ),
        jsonResponse([
          {
            iid: 3,
            title: 'MR three',
            state: 'merged',
            source_branch: 'feature/c',
            target_branch: 'main',
            web_url: 'https://gitlab.com/group/project/-/merge_requests/3',
            author: { username: 'carol' },
          },
        ]),
      ])

      const mergeRequests = await api.listMergeRequests('group/project')

      assert.deepStrictEqual(mergeRequests, [
        {
          iid: 1,
          title: 'MR one',
          state: 'opened',
          sourceBranch: 'feature/a',
          targetBranch: 'main',
          webUrl: 'https://gitlab.com/group/project/-/merge_requests/1',
          author: 'alice',
          draft: true,
        },
        {
          iid: 2,
          title: 'MR two',
          state: 'closed',
          sourceBranch: 'feature/b',
          targetBranch: 'main',
          webUrl: 'https://gitlab.com/group/project/-/merge_requests/2',
          author: 'bob',
          draft: true,
        },
        {
          iid: 3,
          title: 'MR three',
          state: 'merged',
          sourceBranch: 'feature/c',
          targetBranch: 'main',
          webUrl: 'https://gitlab.com/group/project/-/merge_requests/3',
          author: 'carol',
          draft: false,
        },
      ])

      assert.strictEqual(fake.calls.length, 2)
      assert.strictEqual(searchParam(fake.calls[0].url, 'per_page'), '100')
      assert.strictEqual(searchParam(fake.calls[0].url, 'page'), null)
      assert.strictEqual(searchParam(fake.calls[1].url, 'page'), '2')
    })

    it('passes the state and source branch filters', async () => {
      const { api, fake } = createAPI([jsonResponse([])])

      await api.listMergeRequests('group/project', {
        state: 'opened',
        sourceBranch: 'feature/x',
      })

      assert.strictEqual(searchParam(fake.calls[0].url, 'state'), 'opened')
      assert.strictEqual(
        searchParam(fake.calls[0].url, 'source_branch'),
        'feature/x'
      )
    })
  })

  describe('createMergeRequest', () => {
    it('posts a draft merge request with the expected body', async () => {
      const { api, fake } = createAPI([
        jsonResponse({
          iid: 9,
          title: 'Draft: Add GitLab support',
          state: 'opened',
          source_branch: 'feature/gitlab',
          target_branch: 'main',
          web_url: 'https://gitlab.com/group/project/-/merge_requests/9',
          author: { username: 'alice' },
          draft: true,
        }),
      ])

      const mergeRequest = await api.createMergeRequest('group/project', {
        sourceBranch: 'feature/gitlab',
        targetBranch: 'main',
        title: 'Add GitLab support',
        description: 'Adds the API client',
        draft: true,
        removeSourceBranch: true,
      })

      assert.deepStrictEqual(mergeRequest, {
        iid: 9,
        title: 'Draft: Add GitLab support',
        state: 'opened',
        sourceBranch: 'feature/gitlab',
        targetBranch: 'main',
        webUrl: 'https://gitlab.com/group/project/-/merge_requests/9',
        author: 'alice',
        draft: true,
      })

      assert.strictEqual(fake.calls.length, 1)
      const [call] = fake.calls
      assert.strictEqual(call.init?.method, 'POST')
      assert.strictEqual(
        call.url,
        'https://gitlab.com/api/v4/projects/group%2Fproject/merge_requests'
      )
      assert.strictEqual(header(call.init, 'Content-Type'), 'application/json')
      assert.deepStrictEqual(JSON.parse(call.init?.body as string), {
        source_branch: 'feature/gitlab',
        target_branch: 'main',
        title: 'Draft: Add GitLab support',
        description: 'Adds the API client',
        remove_source_branch: true,
      })
    })

    it('does not prefix the title when the merge request is not a draft', async () => {
      const { api, fake } = createAPI([
        jsonResponse({
          iid: 10,
          title: 'Regular merge request',
          state: 'opened',
          source_branch: 'feature/a',
          target_branch: 'main',
          web_url: 'https://gitlab.com/group/project/-/merge_requests/10',
          author: { username: 'alice' },
        }),
      ])

      await api.createMergeRequest('group/project', {
        sourceBranch: 'feature/a',
        targetBranch: 'main',
        title: 'Regular merge request',
      })

      assert.deepStrictEqual(JSON.parse(fake.calls[0].init?.body as string), {
        source_branch: 'feature/a',
        target_branch: 'main',
        title: 'Regular merge request',
      })
    })
  })

  describe('getLatestPipeline', () => {
    it('returns null when the project has no pipeline', async () => {
      const { api, fake } = createAPI([jsonResponse([])])

      const pipeline = await api.getLatestPipeline('group/project', 'main')

      assert.strictEqual(pipeline, null)
      const url = fake.calls[0].url
      assert.strictEqual(
        url.startsWith(
          'https://gitlab.com/api/v4/projects/group%2Fproject/pipelines?'
        ),
        true
      )
      assert.strictEqual(searchParam(url, 'ref'), 'main')
      assert.strictEqual(searchParam(url, 'per_page'), '1')
      assert.strictEqual(searchParam(url, 'order_by'), 'id')
      assert.strictEqual(searchParam(url, 'sort'), 'desc')
    })

    it('maps the latest pipeline', async () => {
      const { api } = createAPI([
        jsonResponse([
          {
            id: 321,
            status: 'running',
            ref: 'feature/gitlab',
            sha: 'abc123',
            web_url: 'https://gitlab.com/group/project/-/pipelines/321',
          },
        ]),
      ])

      const pipeline = await api.getLatestPipeline(
        'group/project',
        'feature/gitlab'
      )

      assert.deepStrictEqual(pipeline, {
        id: 321,
        status: 'running',
        ref: 'feature/gitlab',
        sha: 'abc123',
        webUrl: 'https://gitlab.com/group/project/-/pipelines/321',
      })
    })
  })

  describe('listIssues', () => {
    it('passes the filters and maps the response', async () => {
      const { api, fake } = createAPI([
        jsonResponse([
          {
            iid: 5,
            title: 'A bug',
            state: 'opened',
            web_url: 'https://gitlab.com/group/project/-/issues/5',
          },
        ]),
      ])

      const issues = await api.listIssues('group/project', {
        state: 'opened',
        search: 'bug fix',
      })

      assert.deepStrictEqual(issues, [
        {
          iid: 5,
          title: 'A bug',
          state: 'opened',
          webUrl: 'https://gitlab.com/group/project/-/issues/5',
        },
      ])

      const url = fake.calls[0].url
      assert.strictEqual(
        url.startsWith(
          'https://gitlab.com/api/v4/projects/group%2Fproject/issues?'
        ),
        true
      )
      assert.strictEqual(searchParam(url, 'state'), 'opened')
      assert.strictEqual(searchParam(url, 'search'), 'bug fix')
      assert.strictEqual(searchParam(url, 'per_page'), '100')
    })
  })

  describe('errors', () => {
    it('throws a GitLabAPIError with the JSON message on a 404', async () => {
      const { api } = createAPI([
        jsonResponse({ message: '404 Project Not Found' }, { status: 404 }),
      ])

      await assert.rejects(api.getProject('group/missing'), error => {
        assert.ok(error instanceof GitLabAPIError)
        assert.strictEqual(error.status, 404)
        assert.strictEqual(error.message, '404 Project Not Found')
        return true
      })
    })

    it('throws a GitLabAPIError using the error field on a 401', async () => {
      const { api } = createAPI([
        jsonResponse({ error: '401 Unauthorized' }, { status: 401 }),
      ])

      await assert.rejects(api.getCurrentUser(), error => {
        assert.ok(error instanceof GitLabAPIError)
        assert.strictEqual(error.status, 401)
        assert.strictEqual(error.message, '401 Unauthorized')
        return true
      })
    })

    it('rethrows network failures unchanged', async () => {
      const networkError = new Error('network down')
      const { api } = createAPI([networkError])

      await assert.rejects(
        api.getCurrentUser(),
        error => error === networkError
      )
    })
  })
})
