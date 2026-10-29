import { Repository } from '../../../models/repository'
import { git } from '../../git/core'

/**
 * Rename a remote of the repository.
 *
 * Git rejects the rename when the new name is already used by another remote.
 *
 * @param repository The repository whose remote should be renamed.
 * @param oldName The current name of the remote.
 * @param newName The name the remote should be renamed to.
 */
export async function renameRemote(
  repository: Repository,
  oldName: string,
  newName: string
): Promise<void> {
  await git(
    ['remote', 'rename', '--', oldName, newName],
    repository.path,
    'renameRemote'
  )
}
