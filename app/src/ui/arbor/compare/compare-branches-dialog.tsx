import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Commit } from '../../../models/commit'
import { BranchType } from '../../../models/branch'
import { CommittedFileChange } from '../../../models/status'
import { DiffLineType, DiffType, IDiff } from '../../../models/diff'
import { getBranches } from '../../../lib/git/for-each-ref'
import { getBranchMergeBaseDiff } from '../../../lib/git/diff'
import { getSymbolicRef } from '../../../lib/git/refs'
import { mapStatus } from '../../../lib/status'
import {
  compareBranches,
  describeComparison,
  IBranchComparison,
} from '../../../lib/arbor/git/compare'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Button } from '../../lib/button'
import { Select } from '../../lib/select'
import { TabBar } from '../../tab-bar'
import { RelativeTime } from '../../relative-time'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { getInitialRefs, IComparableBranches, pluralize } from './compare-utils'

export interface ICompareBranchesDialogProps {
  readonly repository: Repository
  /** Initial base ref, defaults to the default branch. */
  readonly base?: string
  /** Initial head ref, defaults to the current branch. */
  readonly head?: string
  readonly onDismissed: () => void
}

enum CompareTab {
  Commits = 0,
  Files = 1,
}

interface ICompareBranchesDialogState {
  readonly branches: IComparableBranches
  readonly base: string | null
  readonly head: string | null
  readonly comparison: IBranchComparison | null
  readonly loading: boolean
  readonly error: string | null
  readonly tab: CompareTab
  readonly selectedFile: CommittedFileChange | null
  readonly diff: IDiff | null
  readonly diffLoading: boolean
}

/**
 * Arbor: compare any two branches — ahead/behind, the commits on each side
 * and the files the head would bring since the merge base, with their diff.
 */
export class CompareBranchesDialog extends React.Component<
  ICompareBranchesDialogProps,
  ICompareBranchesDialogState
> {
  private isMounted = false
  /** Increases with every comparison so that stale results are dropped. */
  private comparisonRequest = 0
  private diffRequest = 0

  public constructor(props: ICompareBranchesDialogProps) {
    super(props)
    this.state = {
      branches: { local: [], remote: [] },
      base: null,
      head: null,
      comparison: null,
      loading: true,
      error: null,
      tab: CompareTab.Commits,
      selectedFile: null,
      diff: null,
      diffLoading: false,
    }
  }

  public async componentDidMount() {
    this.isMounted = true
    const { repository } = this.props

    try {
      const [all, headRef] = await Promise.all([
        getBranches(repository),
        getSymbolicRef(repository, 'HEAD'),
      ])
      const branches = {
        local: all.filter(b => b.type === BranchType.Local).map(b => b.name),
        remote: all
          .filter(b => b.type === BranchType.Remote)
          .map(b => b.name)
          // `origin/HEAD` only mirrors the remote's default branch.
          .filter(name => !name.endsWith('/HEAD')),
      }
      const current =
        headRef !== null && headRef.startsWith('refs/heads/')
          ? headRef.substring('refs/heads/'.length)
          : null
      const { base, head } = getInitialRefs(branches, current, {
        base: this.props.base,
        head: this.props.head,
      })

      if (this.isMounted) {
        this.setState({ branches, base, head }, () => this.compare())
      }
    } catch (e) {
      this.setError(e)
    }
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  private setError(e: unknown) {
    log.error(
      'Arbor: unable to compare branches',
      e instanceof Error ? e : undefined
    )
    if (this.isMounted) {
      this.setState({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  private async compare() {
    const { base, head } = this.state
    const request = ++this.comparisonRequest

    if (base === null || head === null) {
      this.setState({ loading: false, comparison: null })
      return
    }

    this.setState({ loading: true, error: null })

    try {
      const comparison = await compareBranches(
        this.props.repository,
        base,
        head
      )
      if (!this.isMounted || request !== this.comparisonRequest) {
        return
      }

      const selectedFile = comparison.changes?.files[0] ?? null
      this.setState(
        { comparison, loading: false, selectedFile, diff: null },
        () => this.loadDiff()
      )
    } catch (e) {
      if (request === this.comparisonRequest) {
        this.setError(e)
      }
    }
  }

  private async loadDiff() {
    const { base, head, selectedFile } = this.state
    const request = ++this.diffRequest

    if (selectedFile === null || base === null || head === null) {
      this.setState({ diff: null, diffLoading: false })
      return
    }

    this.setState({ diffLoading: true })

    try {
      const diff = await getBranchMergeBaseDiff(
        this.props.repository,
        selectedFile,
        base,
        head,
        false,
        head
      )
      if (this.isMounted && request === this.diffRequest) {
        this.setState({ diff, diffLoading: false })
      }
    } catch (e) {
      log.error(
        'Arbor: unable to load the comparison diff',
        e instanceof Error ? e : undefined
      )
      if (this.isMounted && request === this.diffRequest) {
        this.setState({ diff: null, diffLoading: false })
      }
    }
  }

  private onBaseChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ base: event.currentTarget.value }, () => this.compare())
  }

  private onHeadChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ head: event.currentTarget.value }, () => this.compare())
  }

  private onSwap = () => {
    this.setState(
      state => ({ base: state.head, head: state.base }),
      () => this.compare()
    )
  }

  private onTabClicked = (tab: CompareTab) => {
    this.setState({ tab })
  }

  private onFileClicked = (event: React.MouseEvent<HTMLButtonElement>) => {
    const path = event.currentTarget.dataset.path
    const file =
      this.state.comparison?.changes?.files.find(f => f.path === path) ?? null
    this.setState({ selectedFile: file }, () => this.loadDiff())
  }

  public render() {
    return (
      <Dialog
        id="arbor-compare-branches"
        title={__DARWIN__ ? 'Compare Branches' : 'Compare branches'}
        onDismissed={this.props.onDismissed}
        onSubmit={this.props.onDismissed}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        <DialogContent>
          {this.renderPickers()}
          {this.renderSummary()}
          {this.renderTabs()}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Close"
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderBranchOptions() {
    const { local, remote } = this.state.branches
    return (
      <>
        <optgroup label="Local branches">
          {local.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
        {remote.length > 0 && (
          <optgroup label="Remote branches">
            {remote.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        )}
      </>
    )
  }

  private renderPickers() {
    return (
      <div className="arbor-compare-pickers">
        <Select
          label="Base"
          className="arbor-compare-base"
          value={this.state.base ?? undefined}
          onChange={this.onBaseChanged}
        >
          {this.renderBranchOptions()}
        </Select>
        <Button
          className="arbor-compare-swap"
          onClick={this.onSwap}
          ariaLabel="Swap branches"
          tooltip="Swap branches"
        >
          <Octicon symbol={octicons.arrowSwitch} />
        </Button>
        <Select
          label="Compare"
          className="arbor-compare-head"
          value={this.state.head ?? undefined}
          onChange={this.onHeadChanged}
        >
          {this.renderBranchOptions()}
        </Select>
      </div>
    )
  }

  private renderSummary() {
    const { comparison, loading } = this.state

    if (loading) {
      return <div className="arbor-compare-summary">Comparing…</div>
    }

    if (comparison === null) {
      return (
        <div className="arbor-compare-summary">
          Choose two branches to compare.
        </div>
      )
    }

    const changes = comparison.changes
    return (
      <div className="arbor-compare-summary">
        <span className="arbor-compare-description">
          {describeComparison(comparison)}
        </span>
        <span className="arbor-compare-badge ahead">
          ↑ {comparison.ahead} ahead
        </span>
        <span className="arbor-compare-badge behind">
          ↓ {comparison.behind} behind
        </span>
        {changes !== null ? (
          <span className="arbor-compare-stats">
            {pluralize(changes.files.length, 'file')}
            <span className="added"> +{changes.linesAdded}</span>
            <span className="deleted"> −{changes.linesDeleted}</span>
          </span>
        ) : (
          <span className="arbor-compare-stats">No common history</span>
        )}
      </div>
    )
  }

  private renderTabs() {
    const { comparison, tab, loading } = this.state
    if (comparison === null || loading) {
      return null
    }

    return (
      <div className="arbor-compare-tabs">
        <TabBar selectedIndex={tab} onTabClicked={this.onTabClicked}>
          <span>Commits ({comparison.ahead + comparison.behind})</span>
          <span>
            {__DARWIN__ ? 'Files Changed' : 'Files changed'} (
            {comparison.changes?.files.length ?? 0})
          </span>
        </TabBar>
        {tab === CompareTab.Commits
          ? this.renderCommits(comparison)
          : this.renderFiles(comparison)}
      </div>
    )
  }

  private renderCommitList(
    className: string,
    title: string,
    commits: ReadonlyArray<Commit>,
    total: number
  ) {
    return (
      <section className={className}>
        <h3 className="arbor-compare-section-title">
          {title} ({total})
        </h3>
        {commits.length === 0 ? (
          <div className="arbor-compare-empty">None</div>
        ) : (
          <ul className="arbor-compare-commit-list">
            {commits.map(c => (
              <li key={c.sha} className="arbor-compare-commit">
                <span className="sha">{c.shortSha}</span>
                <span className="summary">{c.summary}</span>
                <span className="author">{c.author.name}</span>
                <span className="date">
                  <RelativeTime date={c.author.date} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {commits.length < total && (
          <div className="arbor-compare-truncated">
            Showing the latest {commits.length} of {total} commits.
          </div>
        )}
      </section>
    )
  }

  private renderCommits(comparison: IBranchComparison) {
    const { base, head } = comparison
    return (
      <div className="arbor-compare-commits">
        {this.renderCommitList(
          'arbor-compare-commits-ahead',
          `In ${head}, not in ${base}`,
          comparison.commitsAhead,
          comparison.ahead
        )}
        {this.renderCommitList(
          'arbor-compare-commits-behind',
          `In ${base}, not in ${head}`,
          comparison.commitsBehind,
          comparison.behind
        )}
      </div>
    )
  }

  private renderFiles(comparison: IBranchComparison) {
    const files = comparison.changes?.files ?? []
    if (files.length === 0) {
      return <div className="arbor-compare-empty">No changed files.</div>
    }

    const selected = this.state.selectedFile?.path
    return (
      <div className="arbor-compare-files">
        <ul className="arbor-compare-file-list" role="listbox">
          {files.map(f => (
            <li key={f.path} role="option" aria-selected={f.path === selected}>
              <button
                type="button"
                className={`arbor-compare-file${
                  f.path === selected ? ' selected' : ''
                }`}
                data-path={f.path}
                onClick={this.onFileClicked}
                aria-label={`${mapStatus(f.status)}: ${f.path}`}
              >
                <span className={`status status-${f.status.kind}`}>
                  {mapStatus(f.status).charAt(0)}
                </span>
                <span className="path">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="arbor-compare-diff">{this.renderDiff()}</div>
      </div>
    )
  }

  private renderDiff() {
    const { diff, diffLoading } = this.state
    if (diffLoading) {
      return <div className="arbor-compare-empty">Loading diff…</div>
    }
    if (diff === null) {
      return null
    }
    if (diff.kind !== DiffType.Text) {
      return (
        <div className="arbor-compare-empty">
          {diff.kind === DiffType.Binary || diff.kind === DiffType.Image
            ? 'Binary file'
            : 'This diff is too large to display.'}
        </div>
      )
    }

    return (
      <pre className="arbor-compare-diff-text">
        {diff.hunks.flatMap((hunk, h) =>
          hunk.lines.map((line, l) => (
            <div
              key={`${h}-${l}`}
              className={`line ${DiffLineType[line.type].toLowerCase()}`}
            >
              {line.text}
            </div>
          ))
        )}
      </pre>
    )
  }
}
