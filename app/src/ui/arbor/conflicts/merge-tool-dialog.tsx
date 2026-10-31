import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent } from '../../dialog'

export interface IMergeToolDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** Repository-relative path of the conflicted file. */
  readonly path: string
  readonly onDismissed: () => void
}

/** Arbor: PLACEHOLDER, to be implemented. */
export class MergeToolDialog extends React.Component<IMergeToolDialogProps> {
  public render() {
    return (
      <Dialog
        id="arbor-merge-tool"
        title="Merge tool"
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>Not implemented yet.</DialogContent>
      </Dialog>
    )
  }
}
