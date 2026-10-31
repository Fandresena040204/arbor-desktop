import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
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

describe('arbor/ui/graph-geometry', () => {
  describe('laneX', () => {
    it('positions lanes on a 16px grid with an 8px padding', () => {
      assert.strictEqual(laneX(0), 8)
      assert.strictEqual(laneX(1), 24)
      assert.strictEqual(laneX(3), 56)
    })
  })

  describe('laneY', () => {
    it('maps top to the top edge, center to the middle and bottom to the bottom edge', () => {
      assert.strictEqual(laneY('top'), 0)
      assert.strictEqual(laneY('center'), 14)
      assert.strictEqual(laneY('bottom'), 28)
    })

    it('honors a custom row height', () => {
      assert.strictEqual(laneY('center', 40), 20)
      assert.strictEqual(laneY('bottom', 40), 40)
    })
  })

  describe('graphSvgWidth', () => {
    it('is the lane count times the lane width', () => {
      assert.strictEqual(graphSvgWidth(4), 64)
    })
  })

  describe('laneColorVar', () => {
    it('names one CSS variable per palette color', () => {
      assert.strictEqual(laneColorVar(0), 'var(--arbor-graph-color-0)')
      assert.strictEqual(laneColorVar(7), 'var(--arbor-graph-color-7)')
    })

    it('wraps negative and overflowing indexes into the palette', () => {
      assert.strictEqual(laneColorVar(8), 'var(--arbor-graph-color-0)')
      assert.strictEqual(laneColorVar(-1), 'var(--arbor-graph-color-7)')
    })
  })

  describe('linePath', () => {
    it('draws a straight segment when both ends share a lane', () => {
      const d = linePath({
        fromLane: 1,
        fromY: 'top',
        toLane: 1,
        toY: 'bottom',
        color: 0,
      })
      assert.strictEqual(d, 'M 24 0 L 24 28')
    })

    it('draws a cubic Bézier when the lanes differ', () => {
      const d = linePath({
        fromLane: 2,
        fromY: 'top',
        toLane: 0,
        toY: 'center',
        color: 0,
      })
      assert.strictEqual(d, 'M 40 0 C 40 7 8 7 8 14')
    })

    it('draws the outgoing segment of a node to another lane', () => {
      const d = linePath({
        fromLane: 0,
        fromY: 'center',
        toLane: 1,
        toY: 'bottom',
        color: 0,
      })
      assert.strictEqual(d, 'M 8 14 C 8 21 24 21 24 28')
    })
  })

  describe('graphRowSvgPaths', () => {
    it('returns one path per row line, in order', () => {
      const { rows } = computeGraphLayout([c('C', 'B'), c('B', 'A'), c('A')])

      const paths = graphRowSvgPaths(rows[0])
      assert.strictEqual(paths.length, 1)
      assert.strictEqual(paths[0].d, 'M 8 14 L 8 28')
      // A middle row has the line coming from its child, then the one going
      // to its parent.
      const pathsOfParent = graphRowSvgPaths(rows[1])
      assert.deepStrictEqual(
        pathsOfParent.map(p => p.d),
        ['M 8 0 L 8 14', 'M 8 14 L 8 28']
      )
    })
  })

  describe('graphRowNode', () => {
    it('sits at the center of the row lane', () => {
      const { rows } = computeGraphLayout([c('A')])
      const node = graphRowNode(rows[0])

      assert.deepStrictEqual(node, {
        cx: 8,
        cy: 14,
        r: 4,
        isMerge: false,
        isHead: false,
      })
    })

    it('reports merge and HEAD decoration', () => {
      const { rows } = computeGraphLayout([c('B', 'A', 'A2'), c('A'), c('A2')])
      const node = graphRowNode(rows[0], true, true)

      assert.strictEqual(node.cx, 8)
      assert.strictEqual(node.isMerge, true)
      assert.strictEqual(node.isHead, true)
    })
  })
})
