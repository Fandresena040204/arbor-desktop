import { WebContents } from 'electron'
import * as ipcMain from '../ipc-main'
import * as ipcWebContents from '../ipc-webcontents'
import { TerminalSession } from '../../lib/arbor/terminal/terminal-session'

/**
 * Arbor: hosts the integrated terminal's shells in the main process.
 *
 * node-pty uses a worker thread on Windows, which Electron doesn't allow in
 * renderer processes, so the renderer drives the shells over IPC.
 */

interface IHostedSession {
  readonly session: TerminalSession
  readonly owner: WebContents
}

const sessions = new Map<number, IHostedSession>()
let nextId = 1

const watchedOwners = new WeakSet<WebContents>()

function killSession(id: number) {
  sessions.get(id)?.session.kill()
  sessions.delete(id)
}

/** Don't leave shells running when their window goes away or reloads. */
function watchOwner(owner: WebContents) {
  if (watchedOwners.has(owner)) {
    return
  }
  watchedOwners.add(owner)

  const killOwnedSessions = () => {
    for (const [id, hosted] of sessions) {
      if (hosted.owner === owner) {
        killSession(id)
      }
    }
  }
  owner.on('destroyed', killOwnedSessions)
  // Full navigations only (a reload), not in-page ones.
  owner.on('did-navigate', killOwnedSessions)
}

/** Register the IPC handlers of the integrated terminal. */
export function registerArborTerminalHost() {
  ipcMain.handle('arbor-terminal-start', async (event, cwd, cols, rows) => {
    const owner = event.sender

    let session: TerminalSession
    try {
      session = TerminalSession.start({ cwd, cols, rows })
    } catch (e) {
      log.error('Arbor: unable to start terminal session', e)
      return { error: e instanceof Error ? e.message : String(e) }
    }

    const id = nextId++
    sessions.set(id, { session, owner })

    session.onData(data => {
      if (!owner.isDestroyed()) {
        ipcWebContents.send(owner, 'arbor-terminal-data', id, data)
      }
    })
    session.onExit(exitCode => {
      sessions.delete(id)
      if (!owner.isDestroyed()) {
        ipcWebContents.send(owner, 'arbor-terminal-exit', id, exitCode)
      }
    })

    watchOwner(owner)

    return {
      id,
      shell: { file: session.shell.file, args: [...session.shell.args] },
    }
  })

  ipcMain.on('arbor-terminal-write', (event, id, data) => {
    const hosted = sessions.get(id)
    if (hosted?.owner === event.sender) {
      hosted.session.write(data)
    }
  })

  ipcMain.on('arbor-terminal-resize', (event, id, cols, rows) => {
    const hosted = sessions.get(id)
    if (hosted?.owner === event.sender) {
      hosted.session.resize(cols, rows)
    }
  })

  ipcMain.on('arbor-terminal-kill', (event, id) => {
    if (sessions.get(id)?.owner === event.sender) {
      killSession(id)
    }
  })
}
