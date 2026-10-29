import assert from 'node:assert'
import { describe, it } from 'node:test'
import { resolveTerminalShell } from '../../../../src/lib/arbor/terminal/shell'

describe('arbor/terminal/resolveTerminalShell', () => {
  it('uses PowerShell on Windows', () => {
    assert.deepStrictEqual(resolveTerminalShell('win32', {}), {
      file: 'powershell.exe',
      args: ['-NoLogo'],
    })
  })

  it('uses $SHELL as a login shell on macOS', () => {
    assert.deepStrictEqual(
      resolveTerminalShell('darwin', { SHELL: '/bin/fish' }),
      {
        file: '/bin/fish',
        args: ['-l'],
      }
    )
  })

  it('falls back to zsh on macOS', () => {
    assert.deepStrictEqual(resolveTerminalShell('darwin', {}), {
      file: '/bin/zsh',
      args: ['-l'],
    })
  })

  it('uses $SHELL on Linux and falls back to bash', () => {
    assert.deepStrictEqual(
      resolveTerminalShell('linux', { SHELL: '/bin/zsh' }),
      {
        file: '/bin/zsh',
        args: [],
      }
    )
    assert.deepStrictEqual(resolveTerminalShell('linux', { SHELL: '' }), {
      file: '/bin/bash',
      args: [],
    })
  })

  it('honours ARBOR_TERMINAL_SHELL on every platform', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      assert.deepStrictEqual(
        resolveTerminalShell(platform, { ARBOR_TERMINAL_SHELL: 'nu' }),
        { file: 'nu', args: [] }
      )
    }
  })

  it('ignores a blank ARBOR_TERMINAL_SHELL', () => {
    assert.strictEqual(
      resolveTerminalShell('win32', { ARBOR_TERMINAL_SHELL: '  ' }).file,
      'powershell.exe'
    )
  })
})
