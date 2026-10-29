import assert from 'node:assert'
import { describe, it } from 'node:test'

import { WorktreeEntry } from '../../../src/models/worktree'
import {
  generateArborWorktreeMenuItems,
  generatePruneWorktreesMenuItem,
  IArborWorktreeMenuConfig,
} from '../../../src/ui/arbor/worktrees/worktree-context-menu-items'

function worktree(overrides: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    path: '/repo-feature',
    head: 'abc1234abc1234abc1234abc1234abc1234abc123',
    branch: 'refs/heads/feature',
    isDetached: false,
    type: 'linked',
    isLocked: false,
    isPrunable: false,
    ...overrides,
  }
}

function config(
  worktreeOverrides: Partial<WorktreeEntry> = {},
  handlers: Partial<IArborWorktreeMenuConfig> = {}
): IArborWorktreeMenuConfig {
  return {
    worktree: worktree(worktreeOverrides),
    onShowInFileManager: () => {},
    onOpenInShell: () => {},
    onOpenInEditor: () => {},
    onSetLocked: () => {},
    ...handlers,
  }
}

describe('generateArborWorktreeMenuItems', () => {
  it('labels the item Lock worktree when the worktree is not locked', () => {
    const items = generateArborWorktreeMenuItems(config({ isLocked: false }))

    const lockItem = items[items.length - 1]
    assert.equal(lockItem.label, __DARWIN__ ? 'Lock Worktree' : 'Lock worktree')
  })

  it('labels the item Unlock worktree when the worktree is locked', () => {
    const items = generateArborWorktreeMenuItems(config({ isLocked: true }))

    const unlockItem = items[items.length - 1]
    assert.equal(
      unlockItem.label,
      __DARWIN__ ? 'Unlock Worktree' : 'Unlock worktree'
    )
  })

  it('disables the lock toggle for the main worktree', () => {
    const items = generateArborWorktreeMenuItems(
      config({ type: 'main', isLocked: false })
    )

    assert.equal(items[items.length - 1].enabled, false)

    const lockedItems = generateArborWorktreeMenuItems(
      config({ type: 'main', isLocked: true })
    )

    assert.equal(lockedItems[lockedItems.length - 1].enabled, false)
  })

  it('enables the lock toggle for a linked worktree', () => {
    const items = generateArborWorktreeMenuItems(config({ type: 'linked' }))

    assert.equal(items[items.length - 1].enabled, true)
  })

  it('disables the open actions when the worktree is prunable', () => {
    const items = generateArborWorktreeMenuItems(config({ isPrunable: true }))

    // Items 1 to 3 are the file manager, shell, and editor entries.
    const openItems = items.slice(1, 4)

    assert.deepEqual(
      openItems.map(item => item.enabled),
      [false, false, false]
    )
    assert.equal(openItems.filter(item => item.action !== undefined).length, 3)
  })

  it('enables the open actions when the worktree exists on disk', () => {
    const items = generateArborWorktreeMenuItems(config({ isPrunable: false }))

    assert.deepEqual(
      items.slice(1, 4).map(item => item.enabled),
      [true, true, true]
    )
  })

  it('calls the show-in-file-manager callback with the worktree path', () => {
    const revealed = new Array<string>()
    const items = generateArborWorktreeMenuItems(
      config(worktree(), { onShowInFileManager: path => revealed.push(path) })
    )

    items[1].action?.()
    assert.deepEqual(revealed, ['/repo-feature'])
  })

  it('calls the shell callback with the worktree path', () => {
    const opened = new Array<string>()
    const items = generateArborWorktreeMenuItems(
      config(worktree(), { onOpenInShell: path => opened.push(path) })
    )

    items[2].action?.()
    assert.deepEqual(opened, ['/repo-feature'])
  })

  it('calls the editor callback with the worktree path', () => {
    const opened = new Array<string>()
    const items = generateArborWorktreeMenuItems(
      config(worktree(), { onOpenInEditor: path => opened.push(path) })
    )

    items[3].action?.()
    assert.deepEqual(opened, ['/repo-feature'])
  })

  it('requests locking through the callback when not locked', () => {
    const lockRequests = new Array<[string, boolean]>()
    const items = generateArborWorktreeMenuItems(
      config(
        { isLocked: false },
        {
          onSetLocked: (path, locked) => lockRequests.push([path, locked]),
        }
      )
    )

    items[items.length - 1].action?.()
    assert.deepEqual(lockRequests, [['/repo-feature', true]])
  })

  it('requests unlocking through the callback when locked', () => {
    const lockRequests = new Array<[string, boolean]>()
    const items = generateArborWorktreeMenuItems(
      config(
        { isLocked: true },
        {
          onSetLocked: (path, locked) => lockRequests.push([path, locked]),
        }
      )
    )

    items[items.length - 1].action?.()
    assert.deepEqual(lockRequests, [['/repo-feature', false]])
  })

  it('starts and ends with a separator', () => {
    const items = generateArborWorktreeMenuItems(config())

    assert.equal(items[0].type, 'separator')
    assert.equal(items[items.length - 2].type, 'separator')
  })
})

describe('generatePruneWorktreesMenuItem', () => {
  it('is enabled when at least one worktree is prunable', () => {
    const item = generatePruneWorktreesMenuItem(
      [worktree(), worktree({ isPrunable: true })],
      () => {}
    )

    assert.equal(
      item.label,
      __DARWIN__ ? 'Prune Stale Worktrees' : 'Prune stale worktrees'
    )
    assert.equal(item.enabled, true)
  })

  it('is disabled when no worktree is prunable', () => {
    const item = generatePruneWorktreesMenuItem(
      [worktree(), worktree()],
      () => {}
    )

    assert.equal(item.enabled, false)
  })

  it('calls the prune callback when invoked', () => {
    let pruned = 0
    const item = generatePruneWorktreesMenuItem(
      [worktree({ isPrunable: true })],
      () => {
        pruned++
      }
    )

    item.action?.()
    item.action?.()
    assert.equal(pruned, 2)
  })
})
