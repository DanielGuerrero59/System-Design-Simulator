/**
 * Port geometry, worked by hand for a 10 px dot (radius 5).
 */

import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'

import { portRim, rightSourcePort } from './ports'

describe('portRim', () => {
  it('moves out from the centre by the radius, the way the port faces', () => {
    const centre = { x: 100, y: 50 }
    expect(portRim(centre, Position.Right)).toEqual({ x: 105, y: 50 })
    expect(portRim(centre, Position.Left)).toEqual({ x: 95, y: 50 })
    expect(portRim(centre, Position.Top)).toEqual({ x: 100, y: 45 })
    expect(portRim(centre, Position.Bottom)).toEqual({ x: 100, y: 55 })
  })
})

describe('rightSourcePort', () => {
  // The traffic source's size: 74 x 62.
  const port = rightSourcePort({ width: 74, height: 62 })

  it('boxes the dot centred on the middle of the right edge', () => {
    // Box corner: 74 - 5 = 69 across, 62 / 2 - 5 = 26 down.
    expect(port).toEqual({
      type: 'source',
      position: Position.Right,
      x: 69,
      y: 26,
      width: 10,
      height: 10,
    })
  })

  it('attaches a wire where a dragged wire leaves from', () => {
    // React Flow starts a finished wire at the far side of a right-hand box,
    // x + width, and a dragged one at its centre. The two must meet on the
    // rim: 69 + 10 = 79, and the centre (74, 31) moved out by 5 is (79, 31).
    const centre = { x: port.x + port.width! / 2, y: port.y + port.height! / 2 }
    expect(centre).toEqual({ x: 74, y: 31 })
    expect(portRim(centre, Position.Right)).toEqual({
      x: port.x + port.width!,
      y: centre.y,
    })
  })
})
