/** The shell executable and arguments used by the integrated terminal. */
export interface ITerminalShell {
  readonly file: string
  readonly args: ReadonlyArray<string>
}

/**
 * Pick the shell used by the integrated terminal for the given platform.
 *
 * `ARBOR_TERMINAL_SHELL` overrides the default on every platform.
 */
export function resolveTerminalShell(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>
): ITerminalShell {
  const override = env.ARBOR_TERMINAL_SHELL
  if (override !== undefined && override.trim().length > 0) {
    return { file: override, args: [] }
  }

  if (platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'] }
  }

  const shell = env.SHELL !== undefined && env.SHELL.length > 0 ? env.SHELL : ''

  if (platform === 'darwin') {
    return { file: shell || '/bin/zsh', args: ['-l'] }
  }

  return { file: shell || '/bin/bash', args: [] }
}
