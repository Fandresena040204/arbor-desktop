import {
  GraphLineY,
  IGraphLine,
  IGraphRow,
} from '../../../lib/arbor/graph/graph-layout'

/** Height of a graph row, in pixels. */
export const GraphRowHeight = 32

/** Horizontal distance between the centers of two lanes, in pixels. */
export const GraphLaneWidth = 22

/** Horizontal padding before the first and after the last lane, in pixels. */
export const GraphLanePadding = 14

/** Radius of a commit's avatar node, in pixels. */
export const GraphAvatarRadius = 10

/** Radius of a merge commit's dot, in pixels. */
export const GraphMergeRadius = 5

/** Number of colors in the lane palette (defined as CSS variables). */
export const GraphColorCount = 8

/** Width of the graph SVG column for the given number of lanes, in pixels. */
export function graphSvgWidth(lanes: number): number {
  return GraphLanePadding * 2 + Math.max(0, lanes - 1) * GraphLaneWidth
}

/** Horizontal position, in pixels, of a lane within the graph SVG. */
export function laneX(lane: number): number {
  return GraphLanePadding + lane * GraphLaneWidth
}

/** Vertical position, in pixels, of a line attachment within a row. */
export function laneY(y: GraphLineY, height: number = GraphRowHeight): number {
  switch (y) {
    case 'top':
      return 0
    case 'center':
      return height / 2
    case 'bottom':
      return height
  }
}

/**
 * CSS variable holding the color for the given palette index. The palette
 * repeats so a very wide graph stays colored without an index gone wild.
 */
export function laneColorVar(color: number): string {
  const index = ((color % GraphColorCount) + GraphColorCount) % GraphColorCount
  return `var(--arbor-graph-color-${index})`
}

/** A path to draw in the row's SVG, along with its palette color. */
export interface IGraphSvgPath {
  /** SVG path data, as `M … L …` or a cubic Bézier `M … C …`. */
  readonly d: string
  /** Index into the lane palette, see `laneColorVar`. */
  readonly color: number
}

/**
 * SVG path data for a single line of a row. Lines between different lanes
 * bend with a cubic Bézier anchored on both lanes, so branches flow into
 * each other like in GitKraken.
 */
export function linePath(
  line: IGraphLine,
  height: number = GraphRowHeight
): string {
  const x1 = laneX(line.fromLane)
  const y1 = laneY(line.fromY, height)
  const x2 = laneX(line.toLane)
  const y2 = laneY(line.toY, height)

  if (line.fromLane === line.toLane) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  const mid = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`
}

/** All the paths to draw for a row, in draw order. */
export function graphRowSvgPaths(
  row: IGraphRow,
  height: number = GraphRowHeight
): ReadonlyArray<IGraphSvgPath> {
  return row.lines.map(line => ({
    d: linePath(line, height),
    color: line.color,
  }))
}

/** Geometry of a commit node within a row. */
export interface IGraphNode {
  readonly cx: number
  readonly cy: number
  /** Radius of the node: an avatar, or a small dot for a merge. */
  readonly r: number
  readonly isMerge: boolean
  readonly isHead: boolean
}

/** Geometry of the commit node of a row. */
export function graphRowNode(
  row: IGraphRow,
  isMerge: boolean = false,
  isHead: boolean = false,
  height: number = GraphRowHeight
): IGraphNode {
  return {
    cx: laneX(row.lane),
    cy: laneY('center', height),
    r: isMerge ? GraphMergeRadius : GraphAvatarRadius,
    isMerge,
    isHead,
  }
}
