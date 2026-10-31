import * as React from 'react'
import { ArborDialog } from '../../models/arbor-dialog'
import { assertNever } from '../../lib/fatal-error'
import { Dispatcher } from '../dispatcher'
import { CompareBranchesDialog } from './compare/compare-branches-dialog'
import { InteractiveRebaseDialog } from './rebase/interactive-rebase-dialog'
import { MergeToolDialog } from './conflicts/merge-tool-dialog'

interface IArborDialogHostProps {
  readonly dialog: ArborDialog
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

/** Arbor: renders the dialog of an `ArborDialog` popup. */
export function ArborDialogHost(props: IArborDialogHostProps) {
  const { dialog, dispatcher, onDismissed } = props

  switch (dialog.kind) {
    case 'compare-branches':
      return (
        <CompareBranchesDialog
          repository={dialog.repository}
          dispatcher={dispatcher}
          base={dialog.base}
          head={dialog.head}
          onDismissed={onDismissed}
        />
      )
    case 'interactive-rebase':
      return (
        <InteractiveRebaseDialog
          repository={dialog.repository}
          dispatcher={dispatcher}
          fromCommitSha={dialog.fromCommitSha}
          onDismissed={onDismissed}
        />
      )
    case 'merge-tool':
      return (
        <MergeToolDialog
          repository={dialog.repository}
          dispatcher={dispatcher}
          path={dialog.path}
          onDismissed={onDismissed}
        />
      )
    default:
      return assertNever(dialog, `Unknown Arbor dialog: ${dialog}`)
  }
}
