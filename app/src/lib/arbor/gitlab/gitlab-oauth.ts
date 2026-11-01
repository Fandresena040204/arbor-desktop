import * as ipcRenderer from '../../ipc-renderer'
import { IGitLabOAuthTokens } from './gitlab-oauth-flow'

export { GitLabOAuthRedirectUri, IGitLabOAuthTokens } from './gitlab-oauth-flow'

/**
 * Open the browser on the instance's OAuth page and resolve with the tokens
 * once the user authorized Arbor. Rejects on timeout or denial. The flow runs
 * in the main process (see main-process/arbor/gitlab-oauth-host.ts).
 */
export async function signInWithGitLabOAuth(
  instanceUrl: string,
  applicationId: string
): Promise<IGitLabOAuthTokens> {
  const result = await ipcRenderer.invoke(
    'arbor-gitlab-oauth-start',
    instanceUrl,
    applicationId
  )
  if ('error' in result) {
    throw new Error(result.error)
  }
  return result.tokens
}

/** Exchange a refresh token for new tokens. */
export async function refreshGitLabOAuth(
  instanceUrl: string,
  applicationId: string,
  refreshToken: string
): Promise<IGitLabOAuthTokens> {
  const result = await ipcRenderer.invoke(
    'arbor-gitlab-oauth-refresh',
    instanceUrl,
    applicationId,
    refreshToken
  )
  if ('error' in result) {
    throw new Error(result.error)
  }
  return result.tokens
}
