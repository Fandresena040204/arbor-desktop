import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Branch, BranchType } from '../../../models/branch'
import { PopupType } from '../../../models/popup'
import { git } from '../../../lib/git/core'
import { getBranches } from '../../../lib/git/for-each-ref'
import { getSymbolicRef } from '../../../lib/git/refs'
import { getCommit } from '../../../lib/git/log'
import { IMenuItem, showContextualMenu } from '../../../lib/menu-item'
import {
  getGraphCommits,
  IGraphCommit,
  IGraphRef,
} from '../../../lib/arbor/graph/graph-commits'
import {
  computeGraphLayout,
  EmptyGraphLayoutState,
  IGraphLayoutState,
  IGraphRow,
} from '../../../lib/arbor/graph/graph-layout'
import { Dispatcher } from '../../dispatcher'
import { List } from '../../lib/list'
import { Button } from '../../lib/button'
import { TextBox } from '../../lib/text-box'
import { RelativeTime } from '../../relative-time'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { writeClipboardText } from '../../main-process-proxy'
import { doesCommitMatchFilter } from './graph-filter'
import {
  GraphLaneWidth,
  GraphRowHeight,
  graphRowNode,
  graphRowSvgPaths,
  laneColorVar,
} from './graph-geometry'

export interface IArborGraphViewProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** Close the graph and go back to the repository view. */
  readonly onClose: () => void
}

/** Commits loaded per page. */
const PageSize = 300

/** Load the next page when the user scrolls this close to the end. */
const LoadMoreThreshold = 600

interface IArborGraphViewState {
  readonly commits: ReadonlyArray<IGraphCommit>
  readonly rows: ReadonlyArray<IGraphRow>
  readonly layoutState: IGraphLayoutState
  readonly maxWidth: number
  readonly loading: boolean
  readonly hasMore: boolean
  readonly error: string | null
  readonly selected: number
  readonly filter: string
  readonly currentBranch: string | null
  /** Full message of the selected commit, once loaded. */
  readonly message: string | null
}

const RefIcons: Record<IGraphRef['type'], typeof octicons.tag> = {
  head: octicons.gitCommit,
  local: octicons.gitBranch,
  remote: octicons.globe,
  tag: octicons.tag,
}

/**
 * Arbor: interactive commit graph of every branch, tag and remote, shown in
 * place of the repository view (View > Toggle graph).
 */
export class ArborGraphView extends React.Component<
  IArborGraphViewProps,
  IArborGraphViewState
> {
  private isMounted = false
  /** Increases with every reload so that stale pages are dropped. */
  private loadGeneration = 0

  public constructor(props: IArborGraphViewProps) {
    super(props)
    this.state = {
      commits: [],
      rows: [],
      layoutState: EmptyGraphLayoutState,
      maxWidth: 1,
      loading: true,
      hasMore: true,
      error: null,
      selected: -1,
      filter: '',
      currentBranch: null,
      message: null,
    }
  }

  public componentDidMount() {
    this.isMounted = true
    this.reload()
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  private async reload() {
    const generation = ++this.loadGeneration
    this.setState({
      commits: [],
      rows: [],
      layoutState: EmptyGraphLayoutState,
      maxWidth: 1,
      hasMore: true,
      selected: -1,
      message: null,
      error: null,
    })

    const headRef = await getSymbolicRef(this.props.repository, 'HEAD')
    if (this.isMounted && generation === this.loadGeneration) {
      this.setState({
        currentBranch:
          headRef !== null && headRef.startsWith('refs/heads/')
            ? headRef.substring('refs/heads/'.length)
            : null,
      })
      await this.loadMore(generation)
    }
  }

  private async loadMore(generation = this.loadGeneration) {
    this.setState({ loading: true })
    try {
      const skip = this.state.commits.length
      const page = await getGraphCommits(this.props.repository, PageSize, skip)
      if (!this.isMounted || generation !== this.loadGeneration) {
        return
      }

      const layout = computeGraphLayout(page, this.state.layoutState)
      this.setState(state => ({
        commits: [...state.commits, ...page],
        rows: [...state.rows, ...layout.rows],
        layoutState: layout.state,
        maxWidth: Math.max(state.maxWidth, layout.maxWidth),
        hasMore: page.length === PageSize,
        loading: false,
        selected: state.selected === -1 && page.length > 0 ? 0 : state.selected,
      }))
      if (skip === 0 && page.length > 0) {
        this.loadMessage(page[0].sha)
      }
    } catch (e) {
      log.error(
        'Arbor: unable to load the graph',
        e instanceof Error ? e : undefined
      )
      if (this.isMounted) {
        this.setState({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  private async loadMessage(sha: string) {
    this.setState({ message: null })
    const commit = await getCommit(this.props.repository, sha)
    const selected = this.state.commits[this.state.selected]
    if (this.isMounted && selected?.sha === sha) {
      this.setState({
        message:
          commit === null
            ? ''
            : [commit.summary, commit.body]
                .filter(s => s.length > 0)
                .join('\n\n'),
      })
    }
  }

  private select(index: number) {
    const commit = this.state.commits[index]
    if (commit !== undefined) {
      this.setState({ selected: index })
      this.loadMessage(commit.sha)
    }
  }

  private onSelectedRowChanged = (row: number) => this.select(row)
  private onRowClick = (row: number) => this.select(row)

  private onScroll = (scrollTop: number, clientHeight: number) => {
    const { rows, hasMore, loading } = this.state
    const end = rows.length * GraphRowHeight
    if (
      hasMore &&
      !loading &&
      scrollTop + clientHeight > end - LoadMoreThreshold
    ) {
      this.loadMore()
    }
  }

  private onFilterChanged = (filter: string) => this.setState({ filter })
  private onRefresh = () => this.reload()

  private onParentClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const sha = event.currentTarget.dataset.sha
    const index = this.state.commits.findIndex(c => c.sha === sha)
    if (index !== -1) {
      this.select(index)
    }
  }

  private onCopySha = () => {
    const commit = this.state.commits[this.state.selected]
    if (commit !== undefined) {
      writeClipboardText(commit.sha)
    }
  }

  /** Run a repository action, then refresh the repository and the graph. */
  private async afterAction(action: () => Promise<unknown>) {
    try {
      await action()
    } finally {
      await this.props.dispatcher.refreshRepository(this.props.repository)
      if (this.isMounted) {
        this.reload()
      }
    }
  }

  private async isInCurrentBranch(sha: string) {
    const result = await git(
      ['merge-base', '--is-ancestor', sha, 'HEAD'],
      this.props.repository.path,
      'arborGraphIsAncestor',
      { successExitCodes: new Set([0, 1]) }
    )
    return result.exitCode === 0
  }

  private onRowContextMenu = async (
    row: number,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()
    const commit = this.state.commits[row]
    if (commit === undefined) {
      return
    }
    this.select(row)

    const { repository, dispatcher } = this.props
    const { currentBranch } = this.state
    const target = { sha: commit.sha, summary: commit.summary }
    const [branches, inCurrentBranch] = await Promise.all([
      getBranches(repository),
      this.isInCurrentBranch(commit.sha),
    ])
    const branchNamed = (name: string): Branch | undefined =>
      branches.find(b => b.type === BranchType.Local && b.name === name)
    const current =
      currentBranch === null ? undefined : branchNamed(currentBranch)
    const otherRefs = commit.refs.filter(
      r => r.type !== 'head' && r.name !== currentBranch
    )

    const items: Array<IMenuItem> = [
      {
        label: __DARWIN__ ? 'Create Branch Here…' : 'Create branch here…',
        action: () =>
          dispatcher.showPopup({
            type: PopupType.CreateBranch,
            repository,
            targetCommit: target,
          }),
      },
      ...commit.refs
        .filter(r => r.type === 'local' && r.name !== currentBranch)
        .map(r => ({
          label: `Checkout ${r.name}`,
          action: () => {
            const branch = branchNamed(r.name)
            if (branch !== undefined) {
              this.afterAction(() =>
                dispatcher.checkoutBranch(repository, branch)
              )
            }
          },
        })),
      {
        label: __DARWIN__ ? 'Checkout This Commit' : 'Checkout this commit',
        action: () =>
          this.afterAction(() => dispatcher.checkoutCommit(repository, target)),
      },
      { type: 'separator' },
      {
        label: __DARWIN__
          ? 'Cherry-pick onto Current Branch'
          : 'Cherry-pick onto current branch',
        enabled: current !== undefined && !inCurrentBranch,
        action: () => {
          if (current !== undefined) {
            this.afterAction(() =>
              dispatcher.cherryPick(repository, current, [target], null)
            )
          }
        },
      },
      {
        label: __DARWIN__
          ? 'Interactive Rebase from Here…'
          : 'Interactive rebase from here…',
        enabled: inCurrentBranch,
        action: () =>
          dispatcher.showPopup({
            type: PopupType.ArborDialog,
            dialog: {
              kind: 'interactive-rebase',
              repository,
              fromCommitSha: commit.sha,
            },
          }),
      },
      ...otherRefs.slice(0, 1).map(r => ({
        label: `Compare ${r.name} with ${currentBranch ?? 'HEAD'}`,
        enabled: currentBranch !== null,
        action: () =>
          dispatcher.showPopup({
            type: PopupType.ArborDialog,
            dialog: {
              kind: 'compare-branches' as const,
              repository,
              base: currentBranch ?? undefined,
              head: r.name,
            },
          }),
      })),
      { type: 'separator' },
      { label: 'Copy SHA', action: () => writeClipboardText(commit.sha) },
      {
        label: __DARWIN__ ? 'Copy Short SHA' : 'Copy short SHA',
        action: () => writeClipboardText(commit.shortSha),
      },
    ]

    showContextualMenu(items)
  }

  private renderGraphCell(row: IGraphRow, commit: IGraphCommit) {
    const width = this.state.maxWidth * GraphLaneWidth
    const node = graphRowNode(row, commit.parents.length > 1, commit.isHead)
    const color = laneColorVar(row.color)

    return (
      <svg
        className="arbor-graph-svg"
        width={width}
        height={GraphRowHeight}
        aria-hidden={true}
      >
        {graphRowSvgPaths(row).map((p, i) => (
          <path key={i} d={p.d} stroke={laneColorVar(p.color)} />
        ))}
        {node.isHead && (
          <circle
            className="head"
            cx={node.cx}
            cy={node.cy}
            r={node.r + 3}
            stroke={color}
          />
        )}
        <circle
          className={node.isMerge ? 'merge' : 'commit'}
          cx={node.cx}
          cy={node.cy}
          r={node.r}
          stroke={color}
          fill={node.isMerge ? 'var(--background-color)' : color}
        />
      </svg>
    )
  }

  private renderRow = (index: number) => {
    const commit = this.state.commits[index]
    const row = this.state.rows[index]
    if (commit === undefined || row === undefined) {
      return null
    }

    const matches = doesCommitMatchFilter(commit, this.state.filter)
    return (
      <div
        className={`arbor-graph-row${matches ? '' : ' dimmed'}`}
        data-sha={commit.sha}
      >
        {this.renderGraphCell(row, commit)}
        <span className="arbor-graph-refs">
          {commit.refs.map(r => (
            <span
              key={`${r.type}:${r.name}`}
              className={`arbor-graph-ref ${r.type}${
                r.name === this.state.currentBranch && r.type === 'local'
                  ? ' current'
                  : ''
              }`}
            >
              <Octicon symbol={RefIcons[r.type]} />
              {r.name}
            </span>
          ))}
        </span>
        <span className="arbor-graph-summary">{commit.summary}</span>
        <span className="arbor-graph-author">{commit.authorName}</span>
        <span className="arbor-graph-date">
          <RelativeTime date={new Date(commit.authorDate)} />
        </span>
        <span className="arbor-graph-sha">{commit.shortSha}</span>
      </div>
    )
  }

  private getRowAriaLabel = (index: number) => {
    const commit = this.state.commits[index]
    return commit === undefined
      ? undefined
      : `${commit.summary}, ${commit.authorName}, ${commit.shortSha}`
  }

  private renderDetails() {
    const commit = this.state.commits[this.state.selected]
    if (commit === undefined) {
      return (
        <aside className="arbor-graph-details">
          <div className="arbor-graph-empty">Select a commit.</div>
        </aside>
      )
    }

    return (
      <aside className="arbor-graph-details" aria-label="Commit details">
        <div className="arbor-graph-details-sha">
          <code>{commit.sha}</code>
          <Button
            onClick={this.onCopySha}
            ariaLabel="Copy SHA"
            tooltip="Copy SHA"
          >
            <Octicon symbol={octicons.copy} />
          </Button>
        </div>
        <div className="arbor-graph-details-author">
          {commit.authorName} &lt;{commit.authorEmail}&gt;
        </div>
        <div className="arbor-graph-details-date">
          {new Date(commit.authorDate).toLocaleString()}
        </div>
        {commit.refs.length > 0 && (
          <div className="arbor-graph-details-refs">
            {commit.refs.map(r => (
              <span
                key={`${r.type}:${r.name}`}
                className={`arbor-graph-ref ${r.type}`}
              >
                <Octicon symbol={RefIcons[r.type]} />
                {r.name}
              </span>
            ))}
          </div>
        )}
        <pre className="arbor-graph-details-message">
          {this.state.message ?? commit.summary}
        </pre>
        {commit.parents.length > 0 && (
          <div className="arbor-graph-details-parents">
            {commit.parents.length > 1 ? 'Parents' : 'Parent'}:{' '}
            {commit.parents.map(p => (
              <button
                key={p}
                type="button"
                className="link-button-component"
                data-sha={p}
                onClick={this.onParentClick}
              >
                {p.substring(0, 7)}
              </button>
            ))}
          </div>
        )}
      </aside>
    )
  }

  public render() {
    const { rows, selected, loading, error, filter } = this.state

    return (
      <div className="arbor-graph-view">
        <div className="arbor-graph-toolbar">
          <h2 className="arbor-graph-title">Graph</h2>
          <TextBox
            className="arbor-graph-filter"
            placeholder="Filter by summary, SHA, author or ref"
            value={filter}
            onValueChanged={this.onFilterChanged}
            ariaLabel="Filter commits"
          />
          <Button onClick={this.onRefresh} ariaLabel="Refresh graph">
            <Octicon symbol={octicons.sync} /> Refresh
          </Button>
          <Button onClick={this.props.onClose} ariaLabel="Close graph">
            <Octicon symbol={octicons.x} /> Close
          </Button>
        </div>
        {error !== null && <div className="arbor-graph-error">{error}</div>}
        <div className="arbor-graph-body">
          <div className="arbor-graph-list">
            {rows.length === 0 ? (
              <div className="arbor-graph-empty">
                {loading ? 'Loading history…' : 'No commits yet.'}
              </div>
            ) : (
              <List
                ariaLabel="Commit graph"
                rowCount={rows.length}
                rowHeight={GraphRowHeight}
                rowRenderer={this.renderRow}
                selectedRows={selected === -1 ? [] : [selected]}
                onSelectedRowChanged={this.onSelectedRowChanged}
                onRowClick={this.onRowClick}
                onRowContextMenu={this.onRowContextMenu}
                onScroll={this.onScroll}
                getRowAriaLabel={this.getRowAriaLabel}
                invalidationProps={{
                  rows,
                  filter,
                  currentBranch: this.state.currentBranch,
                  maxWidth: this.state.maxWidth,
                }}
              />
            )}
          </div>
          {this.renderDetails()}
        </div>
      </div>
    )
  }
}
