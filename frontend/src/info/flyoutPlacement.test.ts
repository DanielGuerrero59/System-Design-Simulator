/**
 * Flyout placement, worked by hand.
 *
 * Fixture: a 1280 x 800 viewport. The parts bin's right edge is at 180 px, so
 * a flyout opening rightward starts at 180 + 8 = 188 px. The objective panel's
 * left edge is at 992 px, so one opening leftward ends 8 px short of it:
 * 1280 - 992 + 8 = 296 px in from the viewport's right side. The 8 px margin
 * is kept at both ends of the viewport.
 */

import { describe, expect, it } from 'vitest'

import { placeFlyout } from './flyoutPlacement'

const VIEWPORT = { width: 1280, height: 800 }
const BIN_EDGE = 180
const PANEL_EDGE = 992

function row(top: number, bottom: number, edge: number) {
  return { top, bottom, edge }
}

describe('placeFlyout', () => {
  it('hangs down from a row near the top', () => {
    // Below: 800 - 8 - 100 = 692. Above: 155 - 8 = 147.
    expect(placeFlyout(row(100, 155, BIN_EDGE), 'right', VIEWPORT)).toEqual({
      left: 188,
      top: 100,
      maxHeight: 692,
    })
  })

  it('rises from a row near the bottom', () => {
    // Below: 800 - 8 - 700 = 92. Above: 755 - 8 = 747. Anchored 800 - 755 =
    // 45 px up from the viewport's bottom edge, level with the row's.
    expect(placeFlyout(row(700, 755, BIN_EDGE), 'right', VIEWPORT)).toEqual({
      left: 188,
      bottom: 45,
      maxHeight: 747,
    })
  })

  it('hangs down when both ways have the same room', () => {
    // Below: 800 - 8 - 380 = 412. Above: 420 - 8 = 412.
    expect(placeFlyout(row(380, 420, BIN_EDGE), 'right', VIEWPORT)).toEqual({
      left: 188,
      top: 380,
      maxHeight: 412,
    })
  })

  it('opens leftward from the objective panel, measured from the right', () => {
    // An objective row at 230-262. Below: 800 - 8 - 230 = 562. Above: 254.
    expect(placeFlyout(row(230, 262, PANEL_EDGE), 'left', VIEWPORT)).toEqual({
      right: 296,
      top: 230,
      maxHeight: 562,
    })
  })

  it('rises leftward from a low row', () => {
    // Below: 800 - 8 - 600 = 192. Above: 632 - 8 = 624. Bottom: 800 - 632 = 168.
    expect(placeFlyout(row(600, 632, PANEL_EDGE), 'left', VIEWPORT)).toEqual({
      right: 296,
      bottom: 168,
      maxHeight: 624,
    })
  })
})
