import * as React from 'react'
import { ITerminalOptions, Terminal as XTermTerminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getMonospaceFontFamily } from '../../get-monospace-font-family'
import { RemoteTerminalSession } from './remote-terminal-session'
import { Button } from '../../lib/button'

// Arbor: interactive terminal panel anchored to the bottom of the repository
// view. The session layer lives in app/src/lib/arbor/terminal/.

/** The default height of the terminal panel, in pixels. */
const DefaultTerminalHeight = 260

/** The minimum height the terminal panel can be resized down to. */
const MinTerminalHeight = 120

/** The proportion of the window the terminal panel may take up at most. */
const MaxTerminalHeightRatio = 0.7

interface IArborTerminalPanelProps {
  /** The path of the repository the shell should be started in. */
  readonly repositoryPath: string

  /** The function to call when the user chooses to close the panel. */
  readonly onClose: () => void
}

interface IArborTerminalPanelState {
  /** The current height of the panel, in pixels. */
  readonly height: number

  /** The shell file of the current (or last) session, if any. */
  readonly shellFile: string | null

  /** The exit code of the current (or last) session, if it has exited. */
  readonly exitCode: number | null

  /** The error which prevented the last session from starting, if any. */
  readonly startError: string | null
}

interface IDisposable {
  dispose(): void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Extract a readable message out of an error thrown while spawning. */
function getStartErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `Unable to start the terminal: ${message}`
}

export class ArborTerminalPanel extends React.Component<
  IArborTerminalPanelProps,
  IArborTerminalPanelState
> {
  private containerRef = React.createRef<HTMLDivElement>()
  private terminalRef = React.createRef<HTMLDivElement>()

  private terminal: XTermTerminal | null = null
  private fitAddon: FitAddon | null = null
  private session: RemoteTerminalSession | null = null
  private sessionSubscriptions: ReadonlyArray<IDisposable> = []
  private resizeObserver: ResizeObserver | null = null
  private startRequest = 0

  /* Drag state for the vertical resize handle. */
  private dragStartY = 0
  private dragStartHeight = 0

  public constructor(props: IArborTerminalPanelProps) {
    super(props)

    this.state = {
      height: DefaultTerminalHeight,
      shellFile: null,
      exitCode: null,
      startError: null,
    }
  }

  public componentDidMount() {
    const theme = this.getTerminalTheme()

    this.terminal = new XTermTerminal({
      fontFamily: getMonospaceFontFamily(),
      fontSize: 12,
      scrollback: 5000,
      theme,
    })

    this.fitAddon = new FitAddon()
    this.terminal.loadAddon(this.fitAddon)

    const element = this.terminalRef.current
    if (element !== null) {
      this.terminal.open(element)
    }

    this.fitAddon.fit()

    this.terminal.onData(data => this.session?.write(data))

    this.startSession()

    const container = this.containerRef.current
    if (container !== null) {
      this.resizeObserver = new ResizeObserver(() => this.resizeTerminal())
      this.resizeObserver.observe(container)
    }
  }

  public componentDidUpdate(prevProps: IArborTerminalPanelProps) {
    if (prevProps.repositoryPath !== this.props.repositoryPath) {
      this.startSession()
    }
  }

  public componentWillUnmount() {
    // Invalidate any session still starting.
    this.startRequest++
    window.removeEventListener('mousemove', this.onDragMove)
    window.removeEventListener('mouseup', this.onDragEnd)
    this.resizeObserver?.disconnect()
    this.disposeSession()
    this.terminal?.dispose()
    this.terminal = null
    this.fitAddon = null
  }

  public render() {
    const { height, shellFile, exitCode, startError } = this.state

    return (
      <div className="arbor-terminal-panel" style={{ height: `${height}px` }}>
        {/* The a11y linter is a false positive here: the separator is
        the drag affordance of the panel. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="arbor-terminal-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          onMouseDown={this.onResizeHandleMouseDown}
        />
        <div className="arbor-terminal-header">
          <span className="arbor-terminal-title">Terminal</span>
          {shellFile !== null && (
            <span className="arbor-terminal-shell">{shellFile}</span>
          )}
          <div className="arbor-terminal-header-actions">
            <Button
              onClick={this.onRestart}
              ariaLabel="Restart terminal"
              disabled={this.session === null}
            >
              Restart
            </Button>
            <Button onClick={this.props.onClose} ariaLabel="Close terminal">
              Close
            </Button>
          </div>
        </div>
        <div className="arbor-terminal-body">
          {startError !== null && (
            <div className="arbor-terminal-error" role="alert">
              <p>{startError}</p>
              <Button onClick={this.onRestart} ariaLabel="Restart terminal">
                Restart
              </Button>
            </div>
          )}
          {startError === null && exitCode !== null && (
            <div className="arbor-terminal-exited">
              <span>[Process exited with code {exitCode}]</span>
              <Button onClick={this.onRestart} ariaLabel="Restart terminal">
                Restart
              </Button>
            </div>
          )}
          <div ref={this.terminalRef} className="arbor-terminal-xterm" />
        </div>
      </div>
    )
  }

  /** Build an xterm theme out of the app's current CSS variables. */
  private getTerminalTheme(): ITerminalOptions['theme'] {
    const style = getComputedStyle(document.body)

    return {
      background: style.getPropertyValue('--background-color').trim(),
      foreground: style.getPropertyValue('--text-color').trim(),
    }
  }

  /** Stop the current session and start a new one in `repositoryPath`. */
  private async startSession() {
    const terminal = this.terminal

    if (terminal === null) {
      return
    }

    this.disposeSession()
    terminal.reset()

    // Starting is asynchronous: only the latest request may install its
    // session, any other one is stopped right away.
    const request = ++this.startRequest
    this.setState({ exitCode: null, startError: null })

    try {
      const session = await RemoteTerminalSession.start({
        cwd: this.props.repositoryPath,
        cols: terminal.cols,
        rows: terminal.rows,
      })

      if (request !== this.startRequest || this.terminal === null) {
        session.kill()
        return
      }

      this.session = session
      this.setState({ shellFile: session.shell.file })
      this.sessionSubscriptions = [
        session.onData(data => terminal.write(data)),
        session.onExit(code => this.onSessionExited(session, code)),
      ]
      // The panel may have been resized while the shell was starting.
      this.resizeTerminal()
    } catch (e) {
      if (request !== this.startRequest) {
        return
      }
      log.error('ArborTerminalPanel: unable to start terminal session', e)
      this.session = null
      this.setState({ shellFile: null, startError: getStartErrorMessage(e) })
    }
  }

  /** Stop the current session, if any, and forget about it. */
  private disposeSession() {
    for (const subscription of this.sessionSubscriptions) {
      subscription.dispose()
    }
    this.sessionSubscriptions = []

    this.session?.kill()
    this.session = null
  }

  private onSessionExited(session: RemoteTerminalSession, exitCode: number) {
    // The session may have exited because we got rid of it, in which
    // case there's nothing to report.
    if (this.session !== session) {
      return
    }

    this.setState({ exitCode })
    this.terminal?.write(`\r\n[Process exited with code ${exitCode}]`)
  }

  private resizeTerminal() {
    const { fitAddon, terminal, session } = this
    if (fitAddon === null || terminal === null) {
      return
    }

    fitAddon.fit()
    session?.resize(terminal.cols, terminal.rows)
  }

  private onResizeHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()

    this.dragStartY = e.clientY
    this.dragStartHeight = this.state.height

    window.addEventListener('mousemove', this.onDragMove)
    window.addEventListener('mouseup', this.onDragEnd)
  }

  private onDragMove = (e: MouseEvent) => {
    // The panel grows upwards as the user drags the handle up.
    const deltaY = e.clientY - this.dragStartY
    const maxHeight = Math.floor(window.innerHeight * MaxTerminalHeightRatio)

    this.setState({
      height: clamp(
        this.dragStartHeight - deltaY,
        MinTerminalHeight,
        maxHeight
      ),
    })
  }

  private onDragEnd = () => {
    window.removeEventListener('mousemove', this.onDragMove)
    window.removeEventListener('mouseup', this.onDragEnd)
  }

  private onRestart = () => {
    this.startSession()
  }
}
