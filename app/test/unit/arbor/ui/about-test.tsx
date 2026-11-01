import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { ipcRenderer } from 'electron'
import { About } from '../../../../src/ui/about'
import { UpdateStatus } from '../../../../src/ui/lib/update-store'
import { render, screen } from '../../../helpers/ui/render'

const noop = () => {}

describe('arbor/ui/About', () => {
  it('says updates are off without an update feed, with no update error', () => {
    // Dialogs notify the main process when they open.
    const ipc = ipcRenderer as unknown as { send?: () => void }
    ipc.send ??= () => {}

    // Unit tests run with no update feed (__UPDATES_URL__ is ''), like Arbor
    // builds without ARBOR_UPDATES_URL.
    render(
      <About
        onDismissed={noop}
        applicationName="Arbor"
        applicationVersion="3.6.10"
        applicationArchitecture="x64"
        onCheckForNonStaggeredUpdates={noop}
        onShowAcknowledgements={noop}
        onShowTermsAndConditions={noop}
        onQuitAndInstall={noop}
        allowDevelopment={true}
        updateState={{
          status: UpdateStatus.UpdateNotChecked,
          lastSuccessfulCheck: null,
          isX64ToARM64ImmediateAutoUpdate: false,
          newReleases: null,
          prioritizeUpdate: false,
          prioritizeUpdateInfoUrl: undefined,
        }}
      />
    )

    assert.ok(screen.getByText('About Arbor'))
    assert.ok(screen.getByText('Automatic updates are turned off.'))
    assert.strictEqual(screen.queryByText('Check for Updates'), null)
    assert.strictEqual(
      screen.queryByText(/Couldn't determine the last time/),
      null
    )
    assert.strictEqual(screen.queryByText('Beta Channel'), null)
    assert.strictEqual(screen.queryByText(/running in development/), null)
    assert.ok(screen.getByText('releases page'))
  })
})
