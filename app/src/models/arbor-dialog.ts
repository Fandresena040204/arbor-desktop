import { Repository } from './repository'

/**
 * Arbor: the dialogs of Arbor features, shown through the single
 * `PopupType.ArborDialog` popup so upstream's popup plumbing is touched once.
 */
export type ArborDialog =
  | {
      readonly kind: 'compare-branches'
      readonly repository: Repository
      /** Initial base ref, defaults to the default branch. */
      readonly base?: string
      /** Initial head ref, defaults to the current branch. */
      readonly head?: string
    }
  | {
      readonly kind: 'interactive-rebase'
      readonly repository: Repository
      /**
       * SHA of the oldest commit to rewrite, when known (e.g. picked in the
       * graph). Undefined lets the user pick it in the dialog.
       */
      readonly fromCommitSha?: string
    }
  | {
      readonly kind: 'merge-tool'
      readonly repository: Repository
      /** Repository-relative path of the conflicted file. */
      readonly path: string
    }
