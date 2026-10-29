import { git } from '../../git/core'

/**
 * Lock a linked worktree so it cannot be pruned, moved or removed.
 *
 * @param repositoryPath The path of the repository the worktree belongs to.
 * @param worktreePath The path of the worktree to lock.
 * @param reason An optional human readable reason stored with the lock.
 */
export async function lockWorktree(
  repositoryPath: string,
  worktreePath: string,
  reason?: string
): Promise<void> {
  const args = ['worktree', 'lock']

  if (reason !== undefined && reason.trim().length > 0) {
    args.push('--reason', reason)
  }

  args.push('--', worktreePath)

  await git(args, repositoryPath, 'lockWorktree')
}

/**
 * Unlock a previously locked worktree.
 *
 * @param repositoryPath The path of the repository the worktree belongs to.
 * @param worktreePath The path of the worktree to unlock.
 */
export async function unlockWorktree(
  repositoryPath: string,
  worktreePath: string
): Promise<void> {
  await git(
    ['worktree', 'unlock', '--', worktreePath],
    repositoryPath,
    'unlockWorktree'
  )
}

/**
 * Remove administrative data for worktrees whose directory no longer exists.
 *
 * Worktrees which are locked are left untouched by Git.
 *
 * @param repositoryPath The path of the repository to prune worktrees for.
 */
export async function pruneWorktrees(repositoryPath: string): Promise<void> {
  await git(['worktree', 'prune'], repositoryPath, 'pruneWorktrees')
}
