/**
 * Arbor: exercises TerminalSession outside of the unit test globals (jsdom
 * and the disabled MessageChannel prevent node-pty from starting on Windows).
 * Prints `PROBE_OK` when every check passed.
 */
import { TerminalSession } from '../../../src/lib/arbor/terminal/terminal-session'

const g = globalThis as any
g.log ??= { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} }

const session = TerminalSession.start({
  cwd: process.argv[2],
  cols: 80,
  rows: 24,
})

let output = ''
const timer = setTimeout(() => {
  console.log(`PROBE_TIMEOUT ${JSON.stringify(output)}`)
  session.kill()
  process.exit(1)
}, 15000)

session.onData(data => {
  output += data
  // The typed command is echoed back unevaluated, only the shell's output has
  // the computed number.
  if (output.includes('ARBOR_42_MARK')) {
    clearTimeout(timer)
    const running = session.isRunning
    session.kill()
    session.kill()
    session.resize(100, 30)
    console.log(running && !session.isRunning ? 'PROBE_OK' : 'PROBE_BAD_STATE')
    process.exit(0)
  }
})

const command =
  process.platform === 'win32'
    ? 'echo "ARBOR_$(40+2)_MARK"\r'
    : 'echo "ARBOR_$((40+2))_MARK"\n'
session.write(command)
