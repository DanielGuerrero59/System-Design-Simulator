/**
 * Flyout placement, worked by hand.
 *
 * Fixture: an 800 px viewport and a bin whose right edge is at 180 px, so
 * every flyout starts at 180 + 8 = 188 px. The 8 px margin is kept at both
 * ends of the viewport.
 */

import { describe, expect, it } from 'vitest'

import { placeFlyout } from './flyoutPlacement'

const VIEWPORT_HEIGHT = 800
const BIN_RIGHT = 180

function card(top: number, bottom: number) {
  return { top, bottom, right: BIN_RIGHT }
}

describe('placeFlyout', () => {
  it('hangs down from a card near the top', () => {
    // Below: 800 - 8 - 100 = 692. Above: 155 - 8 = 147.
    expect(placeFlyout(card(100, 155), VIEWPORT_HEIGHT)).toEqual({
      left: 188,
      top: 100,
      maxHeight: 692,
    })
  })

  it('rises from a card near the bottom', () => {
    // Below: 800 - 8 - 700 = 92. Above: 755 - 8 = 747. Anchored 800 - 755 =
    // 45 px up from the viewport's bottom edge, level with the card's.
    expect(placeFlyout(card(700, 755), VIEWPORT_HEIGHT)).toEqual({
      left: 188,
      bottom: 45,
      maxHeight: 747,
    })
  })

  it('hangs down when both ways have the same room', () => {
    // Below: 800 - 8 - 380 = 412. Above: 420 - 8 = 412.
    expect(placeFlyout(card(380, 420), VIEWPORT_HEIGHT)).toEqual({
      left: 188,
      top: 380,
      maxHeight: 412,
    })
  })
})
