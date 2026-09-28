/**
 * The dots on a node's edges that wires plug into.
 *
 * React Flow attaches a finished wire to the outside of whatever box it
 * measured for the dot. So the box is the coloured dot and nothing more: the
 * canvas-coloured ring that cuts the dot out of the card's outline is drawn as
 * a shadow outside it (`index.css`), where it looks the same and measures as
 * nothing. As a border it was part of the box, and every wire stopped two
 * pixels of canvas short of the dot it was meant to touch.
 */

import type { CSSProperties } from 'react'
import { Position, type NodeHandle, type XYPosition } from '@xyflow/react'

/** Diameter of a port's coloured dot, which is the whole of its box. */
export const PORT_DIAMETER_PX = 10

const PORT_RADIUS_PX = PORT_DIAMETER_PX / 2

/** Size and colour for a `<Handle>`. The ring and the halos live in index.css. */
export function portStyle(color: string): CSSProperties {
  return { width: PORT_DIAMETER_PX, height: PORT_DIAMETER_PX, background: color }
}

/**
 * The point on a port's rim that faces the way its wire runs.
 *
 * React Flow hands a wire still being dragged the *centre* of each port, and
 * draws a finished one from the rim. Moving the dragged wire's ends out to the
 * rim is what lets it start and land where the finished wire will.
 */
export function portRim(centre: XYPosition, facing: Position): XYPosition {
  switch (facing) {
    case Position.Left:
      return { x: centre.x - PORT_RADIUS_PX, y: centre.y }
    case Position.Right:
      return { x: centre.x + PORT_RADIUS_PX, y: centre.y }
    case Position.Top:
      return { x: centre.x, y: centre.y - PORT_RADIUS_PX }
    case Position.Bottom:
      return { x: centre.x, y: centre.y + PORT_RADIUS_PX }
  }
}

/**
 * An outgoing port on a node's right edge, stated rather than measured.
 *
 * For a node React Flow cannot be relied on to measure (see IngressNode). The
 * box is where React Flow's stylesheet draws a right-hand handle: centred on
 * the node's right edge, halfway down. Coordinates are relative to the node.
 */
export function rightSourcePort(size: { width: number; height: number }): NodeHandle {
  return {
    type: 'source',
    position: Position.Right,
    x: size.width - PORT_RADIUS_PX,
    y: size.height / 2 - PORT_RADIUS_PX,
    width: PORT_DIAMETER_PX,
    height: PORT_DIAMETER_PX,
  }
}
