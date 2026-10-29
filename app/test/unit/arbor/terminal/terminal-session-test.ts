import assert from 'node:assert'
import { execFile } from 'child_process'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import * as Path from 'path'
import { promisify } from 'util'
import { describe, it } from 'node:test'

const probe = Path.join(
  __dirname,
  '..',
  '..',
  '..',
  'fixtures',
  'arbor',
  'terminal-session-probe.ts'
)

describe('arbor/terminal/TerminalSession', () => {
  it('runs a command in the given folder and can be killed', async t => {
    const cwd = await mkdtemp(Path.join(tmpdir(), 'arbor-terminal-'))
    t.after(() => rm(cwd, { recursive: true, force: true }))

    // The unit test globals (jsdom, no MessageChannel) keep node-pty from
    // starting on Windows, so the session runs in a plain Node process.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', probe, cwd],
      { timeout: 30000 }
    )

    assert.match(stdout, /PROBE_OK/)
  })
})
