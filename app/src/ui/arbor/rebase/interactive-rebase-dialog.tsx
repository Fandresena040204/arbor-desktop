import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent } from '../../dialog'

export interface IInteractiveRebaseDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** SHA of the oldest commit to rewrite; undefined lets the user pick it. */
  readonly fromCommitSha?: string
  readonly onDismissed: () => void
}

/** Arbor: PLACEHOLDER, to be implemented. */
export class InteractiveRebaseDialog extends React.Component<IInteractiveRebaseDialogProps> {
  public render() {
    return (
      <Dialog
        id="arbor-interactive-rebase"
        title="Interactive rebase"
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>Not implemented yet.</DialogContent>
      </Dialog>
    )
  }
}
