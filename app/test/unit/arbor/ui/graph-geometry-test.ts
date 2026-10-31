import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  GraphAvatarRadius,
  GraphLanePadding,
  GraphLaneWidth,
  GraphMergeRadius,
  GraphRowHeight,
  graphRowNode,
  graphRowSvgPaths,
  graphSvgWidth,
  laneColorVar,
  laneX,
  laneY,
  linePath,
} from '../../../../src/ui/arbor/graph/graph-geometry'
import { computeGraphLayout } from '../../../../src/lib/arbor/graph/graph-layout'

const c = (sha: string, ...parents: string[]) => ({ sha, parents })
const x = (lane: number) => GraphLanePadding + lane * GraphLaneWidth
const mid = GraphRowHeight / 2

describe('arbor/ui/graph-geometry', () => {
  it('positions lanes on a grid after the padding', () => {
    assert.strictEqual(laneX(0), GraphLanePadding)
    assert.strictEqual(laneX(3), GraphLanePadding + 3 * GraphLaneWidth)
  })

  it('maps row positions to y coordinates', () => {
    assert.strictEqual(laneY('top'), 0)
    assert.strictEqual(laneY('center'), mid)
    assert.strictEqual(laneY('bottom'), GraphRowHeight)
    assert.strictEqual(laneY('center', 40), 20)
  })

  it('makes the SVG wide enough for every lane and its padding', () => {
    assert.strictEqual(graphSvgWidth(1), GraphLanePadding * 2)
    assert.strictEqual(graphSvgWidth(4), x(3) + GraphLanePadding)
    assert.strictEqual(graphSvgWidth(0), GraphLanePadding * 2)
  })

  it('names one CSS variable per palette color, wrapping around', () => {
    assert.strictEqual(laneColorVar(0), 'var(--arbor-graph-color-0)')
    assert.strictEqual(laneColorVar(8), 'var(--arbor-graph-color-0)')
    assert.strictEqual(laneColorVar(-1), 'var(--arbor-graph-color-7)')
  })

  it('draws straight segments within a lane and curves across lanes', () => {
    assert.strictEqual(
      linePath({
        fromLane: 1,
        fromY: 'top',
        toLane: 1,
        toY: 'bottom',
        color: 0,
      }),
      `M ${x(1)} 0 L ${x(1)} ${GraphRowHeight}`
    )
    assert.strictEqual(
      linePath({
        fromLane: 2,
        fromY: 'top',
        toLane: 0,
        toY: 'center',
        color: 0,
      }),
      `M ${x(2)} 0 C ${x(2)} ${mid / 2} ${x(0)} ${mid / 2} ${x(0)} ${mid}`
    )
  })

  it('returns the paths of a row in order', () => {
    const { rows } = computeGraphLayout([c('C', 'B'), c('B', 'A'), c('A')])
    assert.deepStrictEqual(
      graphRowSvgPaths(rows[0]).map(p => p.d),
      [`M ${x(0)} ${mid} L ${x(0)} ${GraphRowHeight}`]
    )
    // A middle row has the line from its child, then the one to its parent.
    assert.deepStrictEqual(
      graphRowSvgPaths(rows[1]).map(p => p.d),
      [
        `M ${x(0)} 0 L ${x(0)} ${mid}`,
        `M ${x(0)} ${mid} L ${x(0)} ${GraphRowHeight}`,
      ]
    )
  })

  it('draws avatars for commits and small dots for merges', () => {
    const { rows } = computeGraphLayout([c('B', 'A', 'A2'), c('A'), c('A2')])
    assert.deepStrictEqual(graphRowNode(rows[1]), {
      cx: x(0),
      cy: mid,
      r: GraphAvatarRadius,
      isMerge: false,
      isHead: false,
    })
    const merge = graphRowNode(rows[0], true, true)
    assert.strictEqual(merge.r, GraphMergeRadius)
    assert.strictEqual(merge.isHead, true)
  })
})
