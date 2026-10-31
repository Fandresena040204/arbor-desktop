import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  computeGraphLayout,
  IGraphRow,
} from '../../../../src/lib/arbor/graph/graph-layout'

const c = (sha: string, ...parents: string[]) => ({ sha, parents })

/** Lines of a row as compact strings, e.g. `0t>1c` (lane 0 top to lane 1 center). */
function lines(row: IGraphRow) {
  return row.lines
    .map(l => `${l.fromLane}${l.fromY[0]}>${l.toLane}${l.toY[0]}`)
    .sort()
}

describe('arbor/graph/computeGraphLayout', () => {
  it('keeps a linear history in one lane', () => {
    const { rows, maxWidth } = computeGraphLayout([
      c('C', 'B'),
      c('B', 'A'),
      c('A'),
    ])

    assert.deepStrictEqual(
      rows.map(r => r.lane),
      [0, 0, 0]
    )
    assert.deepStrictEqual(lines(rows[0]), ['0c>0b'])
    assert.deepStrictEqual(lines(rows[1]), ['0c>0b', '0t>0c'])
    // The root commit has no line below it.
    assert.deepStrictEqual(lines(rows[2]), ['0t>0c'])
    assert.strictEqual(maxWidth, 1)
    assert.ok(rows.every(r => r.color === rows[0].color))
  })

  it('draws a branch and its merge', () => {
    //   M        merge of B (first parent) and F
    //   | \
    //   |  F
    //   B  |
    //   | /
    //   A
    const { rows, maxWidth } = computeGraphLayout([
      c('M', 'B', 'F'),
      c('F', 'A'),
      c('B', 'A'),
      c('A'),
    ])

    assert.deepStrictEqual(
      rows.map(r => r.lane),
      [0, 1, 0, 0]
    )
    assert.deepStrictEqual(lines(rows[0]), ['0c>0b', '0c>1b'])
    assert.deepStrictEqual(lines(rows[1]), ['0t>0b', '1c>1b', '1t>1c'])
    // B keeps its own lane although F's lane also leads to A: both meet at A.
    assert.deepStrictEqual(lines(rows[2]), ['0c>0b', '0t>0c', '1t>1b'])
    assert.deepStrictEqual(lines(rows[3]), ['0t>0c', '1t>0c'])
    assert.strictEqual(maxWidth, 2)
    assert.notStrictEqual(rows[1].color, rows[0].color)
  })

  it('gives each branch tip its own lane until they meet', () => {
    const { rows } = computeGraphLayout([c('T1', 'A'), c('T2', 'A'), c('A')])

    assert.deepStrictEqual(
      rows.map(r => r.lane),
      [0, 1, 0]
    )
    // T2 keeps its lane although lane 0 also leads to A: both meet at A.
    assert.deepStrictEqual(lines(rows[1]), ['0t>0b', '1c>1b'])
    assert.deepStrictEqual(lines(rows[2]), ['0t>0c', '1t>0c'])
  })

  it('reuses freed lanes', () => {
    const { rows } = computeGraphLayout([
      c('M', 'B', 'F'),
      c('F', 'A'),
      c('B', 'A'),
      c('A', 'R'),
      c('X', 'R'),
      c('R'),
    ])

    // After the merge collapsed at A, the X tip takes the free lane 1.
    assert.strictEqual(rows[4].lane, 1)
    assert.ok(rows.every(r => r.width <= 2))
  })

  it('never leaves holes in the lanes', () => {
    // A new tip whose first parent is already expected elsewhere, then a
    // merge parent opened to its right.
    const { rows, state } = computeGraphLayout([
      c('A', 'Z'),
      c('B', 'Z', 'Y'),
      c('Y', 'Z'),
      c('Z'),
    ])

    for (const row of rows) {
      for (const l of row.lines) {
        assert.ok(Number.isInteger(l.fromLane) && Number.isInteger(l.toLane))
      }
    }
    assert.ok(state.lanes.every(l => l === null || typeof l.sha === 'string'))
    assert.strictEqual(state.lanes.length, 0)
  })

  it('lays out pages exactly like a single pass', () => {
    const commits = [
      c('M', 'B', 'F'),
      c('F', 'E'),
      c('B', 'A'),
      c('E', 'A'),
      c('A', 'R'),
      c('R'),
    ]

    const whole = computeGraphLayout(commits)
    const first = computeGraphLayout(commits.slice(0, 3))
    const second = computeGraphLayout(commits.slice(3), first.state)

    assert.deepStrictEqual([...first.rows, ...second.rows], whole.rows)
  })
})
