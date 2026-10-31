import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'

export interface IArborGraphViewProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** Close the graph and go back to the repository view. */
  readonly onClose: () => void
}

/** Arbor: PLACEHOLDER, to be implemented. */
export class ArborGraphView extends React.Component<IArborGraphViewProps> {
  public render() {
    return <div className="arbor-graph-view">Not implemented yet.</div>
  }
}
