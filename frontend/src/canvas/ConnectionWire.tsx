/**
 * The wire under the pointer while a connection is being drawn.
 *
 * React Flow's own is a light-grey hairline running from the *centre* of the
 * dot, over the top of it. On release it was swapped for a different line:
 * heavier, darker, leaving from the dot's rim and passing beneath it. The wire
 * changed shape, weight and both its ends at the instant it connected.
 *
 * This one is the finished wire's curve from the start -- rim to rim, at the
 * same weight -- so letting go only settles its colour and adds the arrow.
 * Until the pointer reaches a port that will take it, it follows the pointer;
 * a port that will not (it would close a loop) is marked in index.css, and the
 * wire does not snap to it.
 */

import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react'

import { portRim } from './ports'

export function ConnectionWire({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
  connectionStatus,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const start = portRim({ x: fromX, y: fromY }, fromPosition)
  // React Flow only moves the end onto a port when the connection is valid;
  // otherwise it is the pointer, which has no rim to step out to.
  const end =
    connectionStatus === 'valid'
      ? portRim({ x: toX, y: toY }, toPosition)
      : { x: toX, y: toY }

  const [path] = getBezierPath({
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: fromPosition,
    targetX: end.x,
    targetY: end.y,
    targetPosition: toPosition,
  })

  return (
    <path
      d={path}
      fill="none"
      className="react-flow__connection-path"
      style={connectionLineStyle}
    />
  )
}
