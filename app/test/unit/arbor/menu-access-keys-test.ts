import assert from 'node:assert'
import { describe, it } from 'node:test'
import { buildDefaultMenuTemplate } from '../../../src/main-process/menu/build-default-menu'

type Item = Electron.MenuItemConstructorOptions

/** The access key of a label (the letter after `&`), lowercased. */
function accessKey(label: string | undefined): string | null {
  const match = /&([^&])/.exec(label ?? '')
  return match === null ? null : match[1].toLowerCase()
}

function duplicates(items: ReadonlyArray<Item>, path: string): string[] {
  const seen = new Map<string, string>()
  const found = new Array<string>()

  for (const item of items) {
    if (item.visible === false) {
      continue
    }
    const key = accessKey(item.label)
    if (key !== null) {
      const other = seen.get(key)
      if (other !== undefined) {
        found.push(`${path}: '${key}' in "${other}" and "${item.label}"`)
      }
      seen.set(key, item.label ?? '')
    }
    if (Array.isArray(item.submenu)) {
      found.push(...duplicates(item.submenu, `${path} > ${item.label}`))
    }
  }
  return found
}

/**
 * Arbor: development builds refuse to start when a menu has two items with
 * the same access key (see `menuFromElectronMenu`), which production builds
 * and the e2e tests don't check. Guard every menu here.
 */
describe('arbor/menu access keys', () => {
  for (const isChangesFilterVisible of [true, false]) {
    for (const isStashedChangesVisible of [true, false]) {
      it(`are unique (filter ${isChangesFilterVisible}, stash ${isStashedChangesVisible})`, () => {
        const template = buildDefaultMenuTemplate({
          selectedExternalEditor: null,
          selectedShell: null,
          askForConfirmationOnForcePush: false,
          askForConfirmationOnRepositoryRemoval: false,
          isChangesFilterVisible,
          isStashedChangesVisible,
        })
        assert.deepStrictEqual(duplicates(template, 'menu'), [])
      })
    }
  }
})
