import type { IPty } from 'node-pty'
import { ITerminalShell, resolveTerminalShell } from './shell'

export interface ITerminalSessionOptions {
  readonly cwd: string
  readonly cols: number
  readonly rows: number
}

interface IDisposable {
  dispose(): void
}

/** An interactive shell running in a pseudo terminal. */
export class TerminalSession {
  /**
   * Spawn the default shell in `cwd`.
   *
   * node-pty is loaded lazily so the app still starts if the native module
   * is missing; in that case this throws.
   */
  public static start(options: ITerminalSessionOptions): TerminalSession {
    const shell = resolveTerminalShell(process.platform, process.env)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePty: typeof import('node-pty') = require('node-pty')

    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value
      }
    }
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'

    const pty = nodePty.spawn(shell.file, [...shell.args], {
      name: 'xterm-256color',
      cwd: options.cwd,
      cols: Math.max(1, options.cols),
      rows: Math.max(1, options.rows),
      env,
      useConpty: process.platform === 'win32' ? true : undefined,
    })

    return new TerminalSession(pty, shell)
  }

  private running = true

  private constructor(
    private readonly pty: IPty,
    public readonly shell: ITerminalShell
  ) {
    pty.onExit(() => {
      this.running = false
    })
  }

  /** Whether the shell is still running. */
  public get isRunning(): boolean {
    return this.running
  }

  /** Subscribe to output of the shell. */
  public onData(cb: (data: string) => void): IDisposable {
    return this.pty.onData(cb)
  }

  /** Subscribe to the shell exiting. */
  public onExit(cb: (exitCode: number) => void): IDisposable {
    return this.pty.onExit(e => cb(e.exitCode))
  }

  /** Send input to the shell. */
  public write(data: string): void {
    if (this.running) {
      this.pty.write(data)
    }
  }

  /** Resize the pseudo terminal. Invalid sizes are ignored. */
  public resize(cols: number, rows: number): void {
    if (!this.running || cols < 1 || rows < 1) {
      return
    }

    try {
      this.pty.resize(Math.floor(cols), Math.floor(rows))
    } catch (e) {
      // The process may have exited between the check and the resize.
      log.warn('TerminalSession: unable to resize', e)
    }
  }

  /** Stop the shell. Safe to call more than once. */
  public kill(): void {
    if (!this.running) {
      return
    }

    this.running = false
    try {
      this.pty.kill()
    } catch (e) {
      log.warn('TerminalSession: unable to kill shell', e)
    }
  }
}
