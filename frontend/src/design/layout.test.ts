/**
 * Where a new part lands.
 *
 * The bug this guards against: counting a lane's occupants instead of its
 * occupied slots. Delete the middle of three databases and the count drops to
 * two, so the next part is placed at slot two -- directly on top of a card that
 * is already sitting there.
 */

import { describe, expect, it } from 'vitest'

import {
  LANE_ORIGIN_Y,
  LANE_PITCH_Y,
  LANE_X,
  nextPositionInLane,
} from './layout'

const at = (x: number, y: number) => ({ position: { x, y } })
const DB = LANE_X.database

describe('nextPositionInLane', () => {
  it('puts the first part of a lane at the origin', () => {
    expect(nextPositionInLane([], DB)).toEqual({ x: DB, y: LANE_ORIGIN_Y })
  })

  it('stacks the second one a full pitch below', () => {
    expect(nextPositionInLane([at(DB, LANE_ORIGIN_Y)], DB)).toEqual({
      x: DB,
      y: LANE_ORIGIN_Y + LANE_PITCH_Y,
    })
  })

  it('reuses the slot freed by a deletion instead of overlapping', () => {
    // Three databases, middle one deleted. The freed slot is 1.
    const remaining = [
      at(DB, LANE_ORIGIN_Y),
      at(DB, LANE_ORIGIN_Y + 2 * LANE_PITCH_Y),
    ]

    expect(nextPositionInLane(remaining, DB)).toEqual({
      x: DB,
      y: LANE_ORIGIN_Y + LANE_PITCH_Y,
    })
  })

  it('never returns a position a node already occupies', () => {
    const occupied = [
      at(DB, LANE_ORIGIN_Y),
      at(DB, LANE_ORIGIN_Y + LANE_PITCH_Y),
      at(DB, LANE_ORIGIN_Y + 2 * LANE_PITCH_Y),
    ]
    const placed = nextPositionInLane(occupied, DB)

    expect(
      occupied.some(
        (node) =>
          node.position.x === placed.x && node.position.y === placed.y,
      ),
    ).toBe(false)
  })

  it('ignores nodes in other lanes', () => {
    const elsewhere = [at(LANE_X.app_server, LANE_ORIGIN_Y)]

    expect(nextPositionInLane(elsewhere, DB)).toEqual({
      x: DB,
      y: LANE_ORIGIN_Y,
    })
  })

  it('ignores a node dragged off the grid', () => {
    // A part the player has moved somewhere arbitrary is not on the grid any
    // more, so it cannot reserve a slot -- otherwise a single drag would push
    // every later part into empty space for no visible reason.
    const dragged = [at(DB, LANE_ORIGIN_Y + 37)]

    expect(nextPositionInLane(dragged, DB)).toEqual({
      x: DB,
      y: LANE_ORIGIN_Y,
    })
  })

  it('places caches and queues in the same lane', () => {
    // They occupy the same position in the request path, so they share a lane
    // and must not be allowed to land on each other.
    expect(LANE_X.cache).toBe(LANE_X.message_queue)

    const withCache = [at(LANE_X.cache, LANE_ORIGIN_Y)]
    expect(nextPositionInLane(withCache, LANE_X.message_queue).y).toBe(
      LANE_ORIGIN_Y + LANE_PITCH_Y,
    )
  })
})
