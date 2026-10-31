import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent } from '../../dialog'

export interface ICompareBranchesDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** Initial base ref, defaults to the default branch. */
  readonly base?: string
  /** Initial head ref, defaults to the current branch. */
  readonly head?: string
  readonly onDismissed: () => void
}

/** Arbor: PLACEHOLDER, to be implemented. */
export class CompareBranchesDialog extends React.Component<ICompareBranchesDialogProps> {
  public render() {
    return (
      <Dialog
        id="arbor-compare-branches"
        title="Compare branches"
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>Not implemented yet.</DialogContent>
      </Dialog>
    )
  }
}
