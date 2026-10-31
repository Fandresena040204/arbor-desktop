import { writeFile } from 'fs/promises'
import * as Path from 'path'
import { Repository } from '../../../models/repository'
import { git } from '../../git/core'

/** The three versions of a conflicted file, from the index stages. */
export interface IConflictVersions {
  /** Common ancestor (stage 1), null if the file didn't exist there. */
  readonly base: string | null
  /** Current branch (stage 2), null if it deleted the file. */
  readonly ours: string | null
  /** Incoming branch (stage 3), null if it deleted the file. */
  readonly theirs: string | null
}

async function readStage(
  repository: Repository,
  path: string,
  stage: 1 | 2 | 3
): Promise<string | null> {
  const result = await git(
    ['show', `:${stage}:${path}`],
    repository.path,
    'getConflictStage',
    // 128: the file has no such stage (added or deleted on one side).
    { successExitCodes: new Set([0, 128]) }
  )
  return result.exitCode === 0 ? result.stdout : null
}

/** Read the base, ours and theirs versions of a conflicted file. */
export async function getConflictVersions(
  repository: Repository,
  path: string
): Promise<IConflictVersions> {
  const relative = path.split(Path.sep).join('/')
  const [base, ours, theirs] = await Promise.all([
    readStage(repository, relative, 1),
    readStage(repository, relative, 2),
    readStage(repository, relative, 3),
  ])
  return { base, ours, theirs }
}

/**
 * Write the resolved content of a conflicted file and, by default, stage it,
 * which marks the conflict as resolved for Git.
 */
export async function writeConflictResolution(
  repository: Repository,
  path: string,
  content: string,
  stage: boolean = true
): Promise<void> {
  await writeFile(Path.join(repository.path, path), content)

  if (stage) {
    await git(
      ['add', '--', path.split(Path.sep).join('/')],
      repository.path,
      'stageConflictResolution'
    )
  }
}
