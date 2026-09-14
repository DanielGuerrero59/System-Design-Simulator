/**
 * Where a part lands when the player drops it in.
 *
 * Pure geometry, deliberately separate from the design store: placing a node is
 * a question with a right answer that can be checked without React, a canvas,
 * or a running backend.
 */

import type { XYPosition } from '@xyflow/react'

import type { ComponentType } from '../api/types'

/**
 * The lane each component type belongs to.
 *
 * Laid out left to right in the order traffic meets them, so a correct design
 * reads as a flow rather than as a heap the player has to untangle before they
 * can think about queueing. Caches and queues share a lane because they occupy
 * the same position in the path -- in front of the tier behind them.
 */
export const LANE_X: Record<ComponentType, number> = {
  load_balancer: 0,
  app_server: 260,
  cache: 520,
  message_queue: 520,
  database: 780,
}

export const LANE_ORIGIN_Y = 60
export const LANE_PITCH_Y = 150

interface Placed {
  position: XYPosition
}

/**
 * Put a new node in the first free slot of its lane.
 *
 * Counting the lane's occupants is the obvious version and it is wrong: delete
 * the middle of three databases and the count drops to two, so the next one is
 * placed at slot two -- directly on top of a card that is already there. What
 * matters is which slots are taken, not how many.
 *
 * Only slots this function itself would have chosen count as taken. A node the
 * player has dragged somewhere arbitrary is off the grid, so it cannot
 * meaningfully reserve a slot, and treating its stray position as one would
 * push new parts into empty space for no visible reason.
 */
export function nextPositionInLane(
  existing: readonly Placed[],
  lane: number,
): XYPosition {
  const taken = new Set(
    existing
      .filter((node) => node.position.x === lane)
      .map((node) => (node.position.y - LANE_ORIGIN_Y) / LANE_PITCH_Y)
      .filter((slot) => Number.isInteger(slot) && slot >= 0),
  )

  let slot = 0
  while (taken.has(slot)) {
    slot += 1
  }
  return { x: lane, y: LANE_ORIGIN_Y + slot * LANE_PITCH_Y }
}
