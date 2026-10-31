import * as React from 'react'
import * as Path from 'path'
import { readFile } from 'fs/promises'
import { Repository } from '../../../models/repository'
import { git } from '../../../lib/git/core'
import {
  ConflictChoice,
  IConflictSegment,
  IParsedConflictFile,
  parseConflictFile,
  resolveConflictFile,
} from '../../../lib/arbor/conflicts/conflict-file'
import {
  getConflictVersions,
  IConflictVersions,
  writeConflictResolution,
} from '../../../lib/arbor/conflicts/conflict-versions'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../../dialog'
import { Button } from '../../lib/button'
import {
  chooseForAll,
  getAdjacentConflict,
  getConflicts,
  getResolvedLines,
  isProbablyBinary,
} from './merge-tool-state'

export interface IMergeToolDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** Repository-relative path of the conflicted file. */
  readonly path: string
  readonly onDismissed: () => void
}

type LoadedFile =
  | { readonly kind: 'conflicts'; readonly file: IParsedConflictFile }
  | { readonly kind: 'no-markers'; readonly versions: IConflictVersions }
  | { readonly kind: 'binary' }

interface IMergeToolDialogState {
  readonly loaded: LoadedFile | null
  readonly choices: ReadonlyMap<number, ConflictChoice>
  readonly active: number
  /** Index of the conflict whose result is being edited, and its text. */
  readonly editing: { readonly index: number; readonly text: string } | null
  readonly showBase: ReadonlySet<number>
  readonly busy: boolean
  readonly error: string | null
}

const ChoiceButtons: ReadonlyArray<{
  readonly label: string
  readonly choice: ConflictChoice
  readonly needsBase?: boolean
}> = [
  { label: 'Accept current', choice: 'ours' },
  { label: 'Accept incoming', choice: 'theirs' },
  { label: 'Both (current first)', choice: 'ours-then-theirs' },
  { label: 'Both (incoming first)', choice: 'theirs-then-ours' },
  { label: 'Accept base', choice: 'base', needsBase: true },
]

/**
 * Arbor: built-in 3-way merge tool. Every conflict of the file shows the
 * current and incoming sides around the chosen result; the file is written
 * and marked as resolved once every conflict has a resolution.
 */
export class MergeToolDialog extends React.Component<
  IMergeToolDialogProps,
  IMergeToolDialogState
> {
  private isMounted = false
  private readonly conflictElements = new Map<number, HTMLElement>()

  public constructor(props: IMergeToolDialogProps) {
    super(props)
    this.state = {
      loaded: null,
      choices: new Map(),
      active: 0,
      editing: null,
      showBase: new Set(),
      busy: false,
      error: null,
    }
  }

  public async componentDidMount() {
    this.isMounted = true
    const { repository, path } = this.props

    try {
      const content = await readFile(
        Path.join(repository.path, path),
        'utf8'
      ).catch(() => null)
      let loaded: LoadedFile

      if (content !== null && isProbablyBinary(content)) {
        loaded = { kind: 'binary' }
      } else {
        const file = content === null ? null : parseConflictFile(content)
        loaded =
          file !== null && file.conflictCount > 0
            ? { kind: 'conflicts', file }
            : {
                kind: 'no-markers',
                versions: await getConflictVersions(repository, path),
              }
      }

      if (this.isMounted) {
        this.setState({ loaded })
      }
    } catch (e) {
      this.setError(e)
    }
  }

  public componentWillUnmount() {
    this.isMounted = false
  }

  private setError(e: unknown) {
    log.error('Arbor: merge tool failed', e instanceof Error ? e : undefined)
    if (this.isMounted) {
      this.setState({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  private get file(): IParsedConflictFile | null {
    const { loaded } = this.state
    return loaded !== null && loaded.kind === 'conflicts' ? loaded.file : null
  }

  private getResolution() {
    const file = this.file
    return file === null ? null : resolveConflictFile(file, this.state.choices)
  }

  private setChoice(index: number, choice: ConflictChoice | null) {
    this.setState(state => {
      const choices = new Map(state.choices)
      if (choice === null) {
        choices.delete(index)
      } else {
        choices.set(index, choice)
      }
      return { choices, active: index, editing: null }
    })
  }

  private goTo(index: number) {
    this.setState({ active: index })
    this.conflictElements
      .get(index)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  private onPrevious = () => {
    const file = this.file
    if (file !== null) {
      this.goTo(getAdjacentConflict(file, this.state.active, 'previous'))
    }
  }

  private onNext = () => {
    const file = this.file
    if (file !== null) {
      this.goTo(getAdjacentConflict(file, this.state.active, 'next'))
    }
  }

  private onAcceptAllCurrent = () => {
    const file = this.file
    if (file !== null) {
      this.setState({ choices: chooseForAll(file, 'ours'), editing: null })
    }
  }

  private onAcceptAllIncoming = () => {
    const file = this.file
    if (file !== null) {
      this.setState({ choices: chooseForAll(file, 'theirs'), editing: null })
    }
  }

  private onSave = () => this.save(true)
  private onSaveWithoutStaging = () => this.save(false)

  private async save(stage: boolean) {
    const resolution = this.getResolution()
    if (resolution === null || this.state.busy) {
      return
    }

    this.setState({ busy: true, error: null })
    try {
      const { repository, path, dispatcher } = this.props
      await writeConflictResolution(repository, path, resolution.text, stage)
      await dispatcher.refreshRepository(repository)
      this.props.onDismissed()
    } catch (e) {
      this.setError(e)
    }
  }

  private async runGit(args: ReadonlyArray<string>) {
    this.setState({ busy: true, error: null })
    try {
      const { repository, dispatcher } = this.props
      await git([...args], repository.path, 'arborMergeToolResolve')
      await dispatcher.refreshRepository(repository)
      this.props.onDismissed()
    } catch (e) {
      this.setError(e)
    }
  }

  private onKeepFile = () => this.runGit(['add', '--', this.gitPath])
  private onDeleteFile = () => this.runGit(['rm', '--', this.gitPath])

  private get gitPath() {
    return this.props.path.split(Path.sep).join('/')
  }

  private onOpenInEditor = () => {
    const { repository, path, dispatcher } = this.props
    dispatcher.openInExternalEditor(Path.join(repository.path, path))
  }

  private onChoiceClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const { index, choice } = event.currentTarget.dataset
    const button = ChoiceButtons.find(b => b.choice === choice)
    if (index !== undefined && button !== undefined) {
      this.setChoice(parseInt(index, 10), button.choice)
    }
  }

  private onResetClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = event.currentTarget.dataset.index
    if (index !== undefined) {
      this.setChoice(parseInt(index, 10), null)
    }
  }

  private onEditClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = parseInt(event.currentTarget.dataset.index ?? '', 10)
    const conflict = this.file && getConflicts(this.file)[index]
    if (!conflict) {
      return
    }
    const choice = this.state.choices.get(index) ?? 'ours-then-theirs'
    this.setState({
      active: index,
      editing: { index, text: getResolvedLines(conflict, choice).join('\n') },
    })
  }

  private onEditTextChanged = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const { editing } = this.state
    if (editing !== null) {
      this.setState({
        editing: { ...editing, text: event.currentTarget.value },
      })
    }
  }

  private onEditDone = () => {
    const { editing } = this.state
    if (editing !== null) {
      const custom = editing.text.length === 0 ? [] : editing.text.split('\n')
      this.setChoice(editing.index, { custom })
    }
  }

  private onToggleBase = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = parseInt(event.currentTarget.dataset.index ?? '', 10)
    this.setState(state => {
      const showBase = new Set(state.showBase)
      if (!showBase.delete(index)) {
        showBase.add(index)
      }
      return { showBase }
    })
  }

  private onConflictRef = (element: HTMLElement | null) => {
    const index = element?.dataset.index
    if (element !== null && index !== undefined) {
      this.conflictElements.set(parseInt(index, 10), element)
    }
  }

  public render() {
    return (
      <Dialog
        id="arbor-merge-tool"
        title={`${__DARWIN__ ? 'Merge Tool' : 'Merge tool'}: ${
          this.props.path
        }`}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSave}
        loading={this.state.busy}
        disabled={this.state.busy}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        <DialogContent>{this.renderContent()}</DialogContent>
        <DialogFooter>{this.renderFooter()}</DialogFooter>
      </Dialog>
    )
  }

  private renderContent() {
    const { loaded } = this.state
    if (loaded === null) {
      return <div className="arbor-merge-message">Loading…</div>
    }

    switch (loaded.kind) {
      case 'binary':
        return (
          <div className="arbor-merge-message">
            This file looks binary and can't be merged here.
          </div>
        )
      case 'no-markers':
        return this.renderNoMarkers(loaded.versions)
      case 'conflicts':
        return this.renderConflicts(loaded.file)
    }
  }

  private renderNoMarkers(versions: IConflictVersions) {
    const deleted =
      versions.ours === null
        ? 'The current branch deleted this file.'
        : versions.theirs === null
        ? 'The incoming branch deleted this file.'
        : null
    return (
      <div className="arbor-merge-message">
        {deleted ?? 'This file has no conflict markers left.'} Choose how to
        resolve it.
      </div>
    )
  }

  private renderConflicts(file: IParsedConflictFile) {
    const resolution = this.getResolution()
    const resolved = file.conflictCount - (resolution?.unresolvedCount ?? 0)

    return (
      <>
        <div className="arbor-merge-toolbar">
          <span className="arbor-merge-progress">
            {resolved} of {file.conflictCount} conflicts resolved
          </span>
          <Button onClick={this.onPrevious} ariaLabel="Previous conflict">
            ↑ Previous
          </Button>
          <Button onClick={this.onNext} ariaLabel="Next conflict">
            ↓ Next
          </Button>
          <span className="arbor-merge-toolbar-spacer" />
          <Button onClick={this.onAcceptAllCurrent}>Accept all current</Button>
          <Button onClick={this.onAcceptAllIncoming}>
            Accept all incoming
          </Button>
        </div>
        <div className="arbor-merge-document">
          {file.segments.map((segment, i) =>
            segment.kind === 'common' ? (
              <pre key={i} className="arbor-merge-common">
                {segment.lines.join('\n')}
              </pre>
            ) : (
              this.renderConflict(segment)
            )
          )}
        </div>
      </>
    )
  }

  private renderConflict(conflict: IConflictSegment) {
    const { index } = conflict
    const choice = this.state.choices.get(index)
    const editing = this.state.editing?.index === index
    const className = [
      'arbor-merge-conflict',
      this.state.active === index ? 'active' : '',
      choice === undefined ? 'unresolved' : 'resolved',
    ].join(' ')

    return (
      <section
        key={`conflict-${index}`}
        className={className}
        data-index={index}
        ref={this.onConflictRef}
        aria-label={`Conflict ${index + 1}`}
      >
        <div className="arbor-merge-conflict-actions">
          <span className="arbor-merge-conflict-title">
            Conflict {index + 1}
          </span>
          {ChoiceButtons.filter(
            b => !b.needsBase || conflict.base !== null
          ).map(b => (
            <button
              type="button"
              key={b.label}
              onClick={this.onChoiceClick}
              className={`button-component arbor-merge-choice${
                choice === b.choice ? ' selected' : ''
              }`}
              aria-label={`${b.label} for conflict ${index + 1}`}
              data-index={index}
              data-choice={b.choice}
            >
              {b.label}
            </button>
          ))}
          <button
            type="button"
            className="button-component"
            onClick={this.onEditClick}
            aria-label={`Edit result of conflict ${index + 1}`}
            data-index={index}
          >
            Edit
          </button>
          <button
            type="button"
            className="button-component"
            onClick={this.onResetClick}
            aria-label={`Reset conflict ${index + 1}`}
            data-index={index}
            disabled={choice === undefined}
          >
            Reset
          </button>
          {conflict.base !== null && (
            <button
              type="button"
              className="button-component"
              onClick={this.onToggleBase}
              data-index={index}
            >
              {this.state.showBase.has(index) ? 'Hide base' : 'Show base'}
            </button>
          )}
        </div>
        <div className="arbor-merge-columns">
          <div className="arbor-merge-ours">
            <div className="arbor-merge-column-title">
              Current{conflict.oursLabel ? ` (${conflict.oursLabel})` : ''}
            </div>
            <pre>{conflict.ours.join('\n')}</pre>
          </div>
          <div className="arbor-merge-result">
            <div className="arbor-merge-column-title">Result</div>
            {editing ? (
              <div className="arbor-merge-editor">
                <textarea
                  value={this.state.editing?.text}
                  onChange={this.onEditTextChanged}
                  aria-label={`Result of conflict ${index + 1}`}
                  spellCheck={false}
                />
                <Button onClick={this.onEditDone}>Done</Button>
              </div>
            ) : choice === undefined ? (
              <div className="arbor-merge-unresolved">Unresolved</div>
            ) : (
              <pre>{getResolvedLines(conflict, choice).join('\n')}</pre>
            )}
          </div>
          <div className="arbor-merge-theirs">
            <div className="arbor-merge-column-title">
              Incoming
              {conflict.theirsLabel ? ` (${conflict.theirsLabel})` : ''}
            </div>
            <pre>{conflict.theirs.join('\n')}</pre>
          </div>
        </div>
        {conflict.base !== null && this.state.showBase.has(index) && (
          <div className="arbor-merge-base">
            <div className="arbor-merge-column-title">Base</div>
            <pre>{conflict.base.join('\n')}</pre>
          </div>
        )}
      </section>
    )
  }

  private renderFooter() {
    const { loaded, busy } = this.state
    const cancel = (
      <Button onClick={this.props.onDismissed} disabled={busy}>
        Cancel
      </Button>
    )

    if (loaded === null || loaded.kind === 'binary') {
      return (
        <div className="arbor-merge-footer">
          {cancel}
          <Button onClick={this.onOpenInEditor}>
            {__DARWIN__ ? 'Open in External Editor' : 'Open in external editor'}
          </Button>
        </div>
      )
    }

    if (loaded.kind === 'no-markers') {
      return (
        <div className="arbor-merge-footer">
          {cancel}
          <Button onClick={this.onDeleteFile} disabled={busy}>
            {__DARWIN__ ? 'Delete File' : 'Delete file'}
          </Button>
          <Button onClick={this.onKeepFile} disabled={busy}>
            {__DARWIN__ ? 'Keep File' : 'Keep file'}
          </Button>
        </div>
      )
    }

    const unresolved = this.getResolution()?.unresolvedCount ?? 1
    return (
      <div className="arbor-merge-footer">
        {cancel}
        <Button onClick={this.onSaveWithoutStaging} disabled={busy}>
          {__DARWIN__ ? 'Save Without Staging' : 'Save without staging'}
        </Button>
        <Button
          type="submit"
          className="arbor-merge-save"
          disabled={busy || unresolved > 0 || this.state.editing !== null}
        >
          {__DARWIN__ ? 'Save and Mark Resolved' : 'Save and mark resolved'}
        </Button>
      </div>
    )
  }
}
