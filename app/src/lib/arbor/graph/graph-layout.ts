/**
 * Lane-based layout of a commit graph, as drawn by GUI Git clients.
 *
 * Commits come newest first, children before parents. Each row holds one
 * commit; lanes are the vertical tracks lines travel along. A lane "expects"
 * the SHA of the next commit it leads to.
 *
 * Each row is split at its node into a top half (from the row above to the
 * node) and a bottom half (from the node to the row below), so a renderer can
 * draw every line of a row without knowing about its neighbours.
 */

/** Where a line starts or ends vertically within a row. */
export type GraphLineY = 'top' | 'center' | 'bottom'

/** A line segment within one row, in lane units. */
export interface IGraphLine {
  readonly fromLane: number
  readonly fromY: GraphLineY
  readonly toLane: number
  readonly toY: GraphLineY
  /** Index into the renderer's palette. */
  readonly color: number
}

export interface IGraphRow {
  readonly sha: string
  /** The lane the commit's node sits in. */
  readonly lane: number
  /** Index into the renderer's palette for the node. */
  readonly color: number
  readonly lines: ReadonlyArray<IGraphLine>
  /** Number of lanes in use on this row (for the row's width). */
  readonly width: number
}

interface ILane {
  readonly sha: string
  readonly color: number
}

/** Layout state carried from one page of commits to the next. */
export interface IGraphLayoutState {
  readonly lanes: ReadonlyArray<ILane | null>
  readonly nextColor: number
}

export const EmptyGraphLayoutState: IGraphLayoutState = {
  lanes: [],
  nextColor: 0,
}

export interface IGraphLayout {
  readonly rows: ReadonlyArray<IGraphRow>
  /** Pass to the next call to lay out the following page seamlessly. */
  readonly state: IGraphLayoutState
  /** The widest row, in lanes. */
  readonly maxWidth: number
}

function firstFree(lanes: ReadonlyArray<ILane | null>): number {
  const free = lanes.indexOf(null)
  return free === -1 ? lanes.length : free
}

/** Set a lane, filling any gap with free lanes rather than array holes. */
function setLane(lanes: Array<ILane | null>, index: number, lane: ILane) {
  while (lanes.length < index) {
    lanes.push(null)
  }
  lanes[index] = lane
}

function trimEnd(lanes: Array<ILane | null>) {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop()
  }
}

/** Lay out `commits` (newest first, children before parents). */
export function computeGraphLayout(
  commits: ReadonlyArray<{
    readonly sha: string
    readonly parents: ReadonlyArray<string>
  }>,
  initialState: IGraphLayoutState = EmptyGraphLayoutState
): IGraphLayout {
  const lanes: Array<ILane | null> = [...initialState.lanes]
  let nextColor = initialState.nextColor
  const rows = new Array<IGraphRow>()
  let maxWidth = 0

  for (const commit of commits) {
    const before = [...lanes]
    const lines = new Array<IGraphLine>()

    // Lanes leading to this commit; the leftmost one gets the node.
    const incoming = new Array<number>()
    before.forEach(
      (l, i) => l !== null && l.sha === commit.sha && incoming.push(i)
    )

    let lane: number
    let color: number
    if (incoming.length > 0) {
      lane = incoming[0]
      color = before[lane]!.color
    } else {
      // A branch tip nothing above leads to.
      lane = firstFree(lanes)
      color = nextColor++
    }

    // Top half: incoming lines converge on the node, others pass through.
    for (const i of incoming) {
      lines.push({
        fromLane: i,
        fromY: 'top',
        toLane: lane,
        toY: 'center',
        color: before[i]!.color,
      })
      lanes[i] = null
    }

    // Assign the parents to lanes.
    const parentLanes = new Array<{ lane: number; color: number }>()
    commit.parents.forEach((parent, index) => {
      if (index === 0) {
        // The first parent always continues the commit's own lane and colour,
        // even if another lane already leads to it: both lines then meet at
        // the parent, which keeps the main line straight.
        setLane(lanes, lane, { sha: parent, color })
        parentLanes.push({ lane, color })
        return
      }

      const existing = lanes.findIndex(l => l !== null && l.sha === parent)
      if (existing !== -1) {
        // Another line already leads to this merge parent: join it.
        parentLanes.push({ lane: existing, color: lanes[existing]!.color })
        return
      }

      // Merge parents open a new lane, preferably to the right of the node.
      let target = lanes.findIndex((l, i) => l === null && i > lane)
      if (target === -1) {
        target = Math.max(lanes.length, lane + 1)
      }
      const parentColor = nextColor++
      setLane(lanes, target, { sha: parent, color: parentColor })
      parentLanes.push({ lane: target, color: parentColor })
    })

    // Bottom half: the node leads to each parent's lane.
    for (const p of parentLanes) {
      lines.push({
        fromLane: lane,
        fromY: 'center',
        toLane: p.lane,
        toY: 'bottom',
        color: p.color,
      })
    }

    // Lanes unrelated to this commit run straight through the row.
    before.forEach((l, i) => {
      if (l !== null && l.sha !== commit.sha) {
        lines.push({
          fromLane: i,
          fromY: 'top',
          toLane: i,
          toY: 'bottom',
          color: l.color,
        })
      }
    })

    trimEnd(lanes)
    const width = Math.max(before.length, lanes.length, lane + 1)
    maxWidth = Math.max(maxWidth, width)
    rows.push({ sha: commit.sha, lane, color, lines, width })
  }

  return { rows, state: { lanes, nextColor }, maxWidth }
}
