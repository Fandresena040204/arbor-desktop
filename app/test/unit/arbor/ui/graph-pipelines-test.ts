import assert from 'node:assert'
import { describe, it } from 'node:test'
import { toGraphPipelineStatus } from '../../../../src/ui/arbor/graph/graph-pipelines'

describe('arbor/ui/graph-pipelines', () => {
  it('simplifies GitLab pipeline statuses', () => {
    assert.strictEqual(toGraphPipelineStatus('success'), 'success')
    assert.strictEqual(toGraphPipelineStatus('failed'), 'failed')
    assert.strictEqual(toGraphPipelineStatus('canceled'), 'failed')
    for (const s of ['created', 'pending', 'running', 'preparing']) {
      assert.strictEqual(toGraphPipelineStatus(s), 'running')
    }
    assert.strictEqual(toGraphPipelineStatus('manual'), 'other')
    assert.strictEqual(toGraphPipelineStatus('skipped'), 'other')
  })
})
