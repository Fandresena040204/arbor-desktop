import { IpcRendererEvent } from 'electron'
import * as ipcRenderer from '../../../lib/ipc-renderer'
import { ITerminalShell } from '../../../lib/arbor/terminal/shell'

interface IDisposable {
  dispose(): void
}

/**
 * A shell of the integrated terminal, running in the main process (see
 * app/src/main-process/arbor/terminal-host.ts) and driven over IPC.
 */
export class RemoteTerminalSession {
  /** Start the default shell in `cwd`. Throws if it can't be started. */
  public static async start(options: {
    readonly cwd: string
    readonly cols: number
    readonly rows: number
  }): Promise<RemoteTerminalSession> {
    const result = await ipcRenderer.invoke(
      'arbor-terminal-start',
      options.cwd,
      Math.max(1, options.cols),
      Math.max(1, options.rows)
    )

    if ('error' in result) {
      throw new Error(result.error)
    }

    return new RemoteTerminalSession(result.id, result.shell)
  }

  private running = true
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(exitCode: number) => void>()

  private constructor(
    private readonly id: number,
    public readonly shell: ITerminalShell
  ) {
    ipcRenderer.on('arbor-terminal-data', this.onIpcData)
    ipcRenderer.on('arbor-terminal-exit', this.onIpcExit)
  }

  /** Whether the shell is still running. */
  public get isRunning(): boolean {
    return this.running
  }

  /** Subscribe to output of the shell. */
  public onData(cb: (data: string) => void): IDisposable {
    this.dataListeners.add(cb)
    return { dispose: () => this.dataListeners.delete(cb) }
  }

  /** Subscribe to the shell exiting. */
  public onExit(cb: (exitCode: number) => void): IDisposable {
    this.exitListeners.add(cb)
    return { dispose: () => this.exitListeners.delete(cb) }
  }

  /** Send input to the shell. */
  public write(data: string): void {
    if (this.running) {
      ipcRenderer.send('arbor-terminal-write', this.id, data)
    }
  }

  /** Resize the pseudo terminal. Invalid sizes are ignored. */
  public resize(cols: number, rows: number): void {
    if (this.running && cols >= 1 && rows >= 1) {
      ipcRenderer.send(
        'arbor-terminal-resize',
        this.id,
        Math.floor(cols),
        Math.floor(rows)
      )
    }
  }

  /** Stop the shell. Safe to call more than once. */
  public kill(): void {
    if (!this.running) {
      return
    }

    this.running = false
    ipcRenderer.send('arbor-terminal-kill', this.id)
    this.stopListening()
  }

  private onIpcData = (_: IpcRendererEvent, id: number, data: string) => {
    if (id === this.id) {
      this.dataListeners.forEach(cb => cb(data))
    }
  }

  private onIpcExit = (_: IpcRendererEvent, id: number, exitCode: number) => {
    if (id !== this.id) {
      return
    }

    this.running = false
    this.exitListeners.forEach(cb => cb(exitCode))
    this.stopListening()
  }

  private stopListening() {
    ipcRenderer.removeListener('arbor-terminal-data', this.onIpcData)
    ipcRenderer.removeListener('arbor-terminal-exit', this.onIpcExit)
  }
}
