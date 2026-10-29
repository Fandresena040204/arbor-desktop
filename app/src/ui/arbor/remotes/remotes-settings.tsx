import * as React from 'react'
import { getRemotes } from '../../../lib/git'
import { IRemote } from '../../../models/remote'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { DialogContent } from '../../dialog'
import { Button } from '../../lib/button'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'
import { TextBox } from '../../lib/text-box'
import { validateRemoteName, validateRemoteUrl } from './remote-validation'

// Arbor: full remote manager for the repository settings Remote tab, which
// upstream Desktop only exposes as a single editable URL field.

interface IArborRemotesSettingsProps {
  /** The repository whose remotes are being managed. */
  readonly repository: Repository

  /** The dispatcher used to perform the git operations. */
  readonly dispatcher: Dispatcher

  /** The function to call when the user chooses to publish. */
  readonly onPublish: () => void
}

interface IArborRemotesSettingsState {
  /** The remotes of the repository, as most recently read. */
  readonly remotes: ReadonlyArray<IRemote>

  /** Whether the initial load of the remotes has completed. */
  readonly loaded: boolean

  /** Whether an action (fetch, push, add, edit or remove) is in progress. */
  readonly busy: boolean

  /** Whether pushing should set the tracking upstream on the remote. */
  readonly setUpstream: boolean

  /** The name of the remote currently being edited, if any. */
  readonly editingName: string | null

  /** The name being typed in the currently edited row. */
  readonly editName: string

  /** The URL being typed in the currently edited row. */
  readonly editUrl: string

  /** The validation error for the currently edited row, if any. */
  readonly editError: string | null

  /** The name of the remote waiting for inline removal confirmation, if any. */
  readonly removePendingName: string | null

  /** The name being typed in the add remote form. */
  readonly addName: string

  /** The URL being typed in the add remote form. */
  readonly addUrl: string

  /** The validation error for the add remote form, if any. */
  readonly addError: string | null
}

export class ArborRemotesSettings extends React.Component<
  IArborRemotesSettingsProps,
  IArborRemotesSettingsState
> {
  public constructor(props: IArborRemotesSettingsProps) {
    super(props)

    this.state = {
      remotes: [],
      loaded: false,
      busy: false,
      setUpstream: false,
      editingName: null,
      editName: '',
      editUrl: '',
      editError: null,
      removePendingName: null,
      addName: '',
      addUrl: '',
      addError: null,
    }
  }

  public async componentDidMount() {
    await this.refreshRemotes()
  }

  private refreshRemotes = async () => {
    try {
      const remotes = await getRemotes(this.props.repository)
      this.setState({ remotes, loaded: true })
    } catch (e) {
      log.error(
        `ArborRemotesSettings: unable to list remotes for ${this.props.repository.path}`,
        e
      )
      this.setState({ loaded: true })
    }
  }

  private runAction = async (
    action: () => Promise<boolean>
  ): Promise<boolean> => {
    this.setState({ busy: true })

    try {
      const ok = await action()

      if (ok) {
        this.setState({ editingName: null, removePendingName: null })
        await this.refreshRemotes()
      }

      return ok
    } finally {
      this.setState({ busy: false })
    }
  }

  public render() {
    return (
      <DialogContent>
        <div className="arbor-remotes-settings">
          {this.state.loaded ? this.renderRemotes() : this.renderLoading()}
          {this.renderAddForm()}
        </div>
      </DialogContent>
    )
  }

  private renderLoading() {
    if (this.state.remotes.length > 0) {
      return this.renderRemotes()
    }

    return <div className="arbor-remotes-loading">Loading remotes…</div>
  }

  private renderRemotes() {
    if (this.state.remotes.length === 0) {
      return this.renderNoRemotes()
    }

    return (
      <div className="arbor-remotes-list">
        <div className="arbor-remotes-toolbar">
          <Button
            onClick={this.onFetchAll}
            disabled={this.state.busy}
            ariaLabel="Fetch all remotes"
          >
            Fetch all remotes
          </Button>
          <Checkbox
            label={
              __DARWIN__
                ? 'Set as Upstream When Pushing'
                : 'Set as upstream when pushing'
            }
            value={
              this.state.setUpstream ? CheckboxValue.On : CheckboxValue.Off
            }
            onChange={this.onSetUpstreamChanged}
            disabled={this.state.busy}
          />
        </div>
        {this.state.remotes.map(remote => this.renderRemoteRow(remote))}
      </div>
    )
  }

  private renderNoRemotes() {
    return (
      <div className="arbor-no-remotes">
        <p>
          This repository has no remotes. Publish your repository to GitHub to
          get started, or add a remote below.
        </p>
        <Button
          onClick={this.props.onPublish}
          disabled={this.state.busy}
          ariaLabel="Publish repository"
        >
          {__DARWIN__ ? 'Publish Repository' : 'Publish repository'}
        </Button>
      </div>
    )
  }

  private renderRemoteRow(remote: IRemote) {
    const editing = this.state.editingName === remote.name

    return (
      <div
        className="arbor-remote-row"
        data-remote={remote.name}
        key={remote.name}
      >
        {editing
          ? this.renderRemoteEditor(remote)
          : this.renderRemoteDisplay(remote)}
      </div>
    )
  }

  private renderRemoteDisplay(remote: IRemote) {
    if (this.state.removePendingName === remote.name) {
      return (
        <>
          <div className="arbor-remote-info">
            <div className="arbor-remote-name">{remote.name}</div>
            <div className="arbor-remote-url">{remote.url}</div>
          </div>
          <div className="arbor-remote-actions">
            <span className="arbor-remote-confirm">Remove {remote.name}?</span>
            <Button
              onClick={this.onRemoveConfirmed(remote.name)}
              disabled={this.state.busy}
              ariaLabel={`Remove ${remote.name}`}
            >
              Remove
            </Button>
            <Button
              onClick={this.onRemoveCancelled}
              disabled={this.state.busy}
              ariaLabel={`Keep ${remote.name}`}
            >
              Cancel
            </Button>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="arbor-remote-info">
          <div className="arbor-remote-name">{remote.name}</div>
          <div className="arbor-remote-url">{remote.url}</div>
        </div>
        <div className="arbor-remote-actions">
          <Button
            onClick={this.onRemoteFetched(remote.name)}
            disabled={this.state.busy}
            ariaLabel={`Fetch ${remote.name}`}
          >
            Fetch
          </Button>
          <Button
            onClick={this.onRemotePushed(remote.name)}
            disabled={this.state.busy}
            ariaLabel={`Push branch to ${remote.name}`}
          >
            Push here
          </Button>
          <Button
            onClick={this.onEditStarted(remote)}
            disabled={this.state.busy}
            ariaLabel={`Edit remote ${remote.name}`}
          >
            Edit
          </Button>
          <Button
            onClick={this.onRemoveRequested(remote.name)}
            disabled={this.state.busy}
            ariaLabel={`Remove remote ${remote.name}`}
          >
            Remove
          </Button>
        </div>
      </>
    )
  }

  private renderRemoteEditor(remote: IRemote) {
    return (
      <>
        <div className="arbor-remote-edit">
          <TextBox
            label={__DARWIN__ ? 'Remote Name' : 'Remote name'}
            value={this.state.editName}
            onValueChanged={this.onEditNameChanged}
            disabled={this.state.busy}
            ariaLabel={`New name for remote ${remote.name}`}
          />
          <TextBox
            label={'Remote URL'}
            value={this.state.editUrl}
            onValueChanged={this.onEditUrlChanged}
            disabled={this.state.busy}
            ariaLabel={`New URL for remote ${remote.name}`}
          />
          {this.state.editError !== null && (
            <div className="arbor-remote-error" role="alert">
              {this.state.editError}
            </div>
          )}
        </div>
        <div className="arbor-remote-actions">
          <Button
            onClick={this.onEditSaved}
            disabled={this.state.busy}
            ariaLabel={`Save remote ${remote.name}`}
          >
            Save
          </Button>
          <Button
            onClick={this.onEditCancelled}
            disabled={this.state.busy}
            ariaLabel={`Cancel editing remote ${remote.name}`}
          >
            Cancel
          </Button>
        </div>
      </>
    )
  }

  private renderAddForm() {
    return (
      // This tab lives inside the dialog's <form>, so it can't nest a form.
      <div className="arbor-add-remote">
        <div className="arbor-add-remote-title">Add remote</div>
        <TextBox
          label={__DARWIN__ ? 'Remote Name' : 'Remote name'}
          value={this.state.addName}
          onValueChanged={this.onAddNameChanged}
          disabled={this.state.busy}
          ariaLabel="Name for new remote"
        />
        <TextBox
          label={'Remote URL'}
          value={this.state.addUrl}
          onValueChanged={this.onAddUrlChanged}
          disabled={this.state.busy}
          ariaLabel="URL for new remote"
        />
        {this.state.addError !== null && (
          <div className="arbor-remote-error" role="alert">
            {this.state.addError}
          </div>
        )}
        <Button
          onClick={this.onAddRemote}
          disabled={this.state.busy}
          ariaLabel="Add remote"
        >
          Add remote
        </Button>
      </div>
    )
  }

  private onSetUpstreamChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ setUpstream: event.currentTarget.checked })
  }

  private onFetchAll = async () => {
    await this.runAction(() =>
      this.props.dispatcher.arborFetchRemotes(this.props.repository, 'all')
    )
  }

  private onRemoteFetched = (remoteName: string) => async () => {
    await this.runAction(() =>
      this.props.dispatcher.arborFetchRemotes(this.props.repository, [
        remoteName,
      ])
    )
  }

  private onRemotePushed = (remoteName: string) => async () => {
    await this.runAction(() =>
      this.props.dispatcher.arborPushToRemote(
        this.props.repository,
        remoteName,
        this.state.setUpstream
      )
    )
  }

  private onEditStarted = (remote: IRemote) => () => {
    this.setState({
      editingName: remote.name,
      editName: remote.name,
      editUrl: remote.url,
      editError: null,
      removePendingName: null,
    })
  }

  private onEditCancelled = () => {
    this.setState({ editingName: null, editError: null })
  }

  private onEditNameChanged = (name: string) => {
    this.setState({ editName: name, editError: null })
  }

  private onEditUrlChanged = (url: string) => {
    this.setState({ editUrl: url, editError: null })
  }

  private onEditSaved = async () => {
    const { repository, dispatcher } = this.props
    const { editingName, editName, editUrl, remotes } = this.state

    if (!editingName || this.state.busy) {
      return
    }

    const editing = remotes.find(remote => remote.name === editingName)

    if (!editing) {
      return
    }

    const name = editName.trim()
    const url = editUrl.trim()

    const nameError = validateRemoteName(
      name,
      remotes.map(remote => remote.name),
      editingName
    )

    if (nameError !== null) {
      this.setState({ editError: nameError })
      return
    }

    const urlError = validateRemoteUrl(url)

    if (urlError !== null) {
      this.setState({ editError: urlError })
      return
    }

    let ok = true

    if (name !== editingName) {
      ok = await this.runAction(() =>
        dispatcher.arborRenameRemote(repository, editingName, name)
      )
    }

    if (ok && url !== editing.url) {
      await this.runAction(() =>
        dispatcher.arborSetRemoteUrl(repository, name, url)
      )
    }
  }

  private onRemoveRequested = (remoteName: string) => () => {
    this.setState({ removePendingName: remoteName, editingName: null })
  }

  private onRemoveCancelled = () => {
    this.setState({ removePendingName: null })
  }

  private onRemoveConfirmed = (remoteName: string) => async () => {
    await this.runAction(() =>
      this.props.dispatcher.arborRemoveRemote(this.props.repository, remoteName)
    )
  }

  private onAddNameChanged = (name: string) => {
    this.setState({ addName: name, addError: null })
  }

  private onAddUrlChanged = (url: string) => {
    this.setState({ addUrl: url, addError: null })
  }

  private onAddRemote = async () => {
    const { repository, dispatcher } = this.props
    const { addName, addUrl, remotes } = this.state

    if (this.state.busy) {
      return
    }

    const name = addName.trim()
    const url = addUrl.trim()

    const nameError = validateRemoteName(
      name,
      remotes.map(remote => remote.name)
    )

    if (nameError !== null) {
      this.setState({ addError: nameError })
      return
    }

    const urlError = validateRemoteUrl(url)

    if (urlError !== null) {
      this.setState({ addError: urlError })
      return
    }

    const ok = await this.runAction(() =>
      dispatcher.arborAddRemote(repository, name, url)
    )

    if (ok) {
      this.setState({ addName: '', addUrl: '' })
    }
  }
}
