import { IMenuItem } from '../../../lib/menu-item'
import {
  DefaultEditorLabel,
  DefaultShellLabel,
  RevealInFileManagerLabel,
} from '../../lib/context-menu'
import { WorktreeEntry } from '../../../models/worktree'

export interface IArborWorktreeMenuConfig {
  readonly worktree: WorktreeEntry
  readonly onShowInFileManager: (path: string) => void
  readonly onOpenInShell: (path: string) => void
  readonly onOpenInEditor: (path: string) => void
  readonly onSetLocked: (path: string, locked: boolean) => void
}

/** Arbor-specific worktree context menu items, appended after upstream ones. */
export function generateArborWorktreeMenuItems(
  config: IArborWorktreeMenuConfig
): ReadonlyArray<IMenuItem> {
  const {
    worktree,
    onShowInFileManager,
    onOpenInShell,
    onOpenInEditor,
    onSetLocked,
  } = config
  const { path, type, isLocked, isPrunable } = worktree
  const items = new Array<IMenuItem>()

  // Opening the worktree folder is pointless when it no longer exists on disk.
  const canOpen = !isPrunable

  items.push({ type: 'separator' })

  items.push({
    label: RevealInFileManagerLabel,
    action: () => onShowInFileManager(path),
    enabled: canOpen,
  })

  items.push({
    label: DefaultShellLabel,
    action: () => onOpenInShell(path),
    enabled: canOpen,
  })

  items.push({
    label: DefaultEditorLabel,
    action: () => onOpenInEditor(path),
    enabled: canOpen,
  })

  items.push({ type: 'separator' })

  // The main worktree can never be locked through this menu.
  const canToggleLock = type !== 'main'

  if (isLocked) {
    items.push({
      label: __DARWIN__ ? 'Unlock Worktree' : 'Unlock worktree',
      action: () => onSetLocked(path, false),
      enabled: canToggleLock,
    })
  } else {
    items.push({
      label: __DARWIN__ ? 'Lock Worktree' : 'Lock worktree',
      action: () => onSetLocked(path, true),
      enabled: canToggleLock,
    })
  }

  return items
}

/** Menu item to prune stale worktrees (only enabled if any worktree is prunable). */
export function generatePruneWorktreesMenuItem(
  worktrees: ReadonlyArray<WorktreeEntry>,
  onPrune: () => void
): IMenuItem {
  return {
    label: __DARWIN__ ? 'Prune Stale Worktrees' : 'Prune stale worktrees',
    action: onPrune,
    enabled: worktrees.some(w => w.isPrunable),
  }
}
