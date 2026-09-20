/**
 * From a level's shape and the dial to the wire, checked by hand.
 *
 * The expected bodies are the ones the level tuning was done against, so a
 * failure here means a level has stopped asking for what its worked solution
 * was built to survive.
 */

import { describe, expect, it } from 'vitest'

import { LEVELS, type Level } from './levels'
import { trafficFor } from './traffic'

const [HELLO, READ_STORM, BLACK_FRIDAY] = LEVELS as [Level, Level, Level]

describe('trafficFor', () => {
  it('01 sends the legacy steady body, with no kind', () => {
    const traffic = trafficFor(HELLO, 2_400)

    expect(traffic).toEqual({ requests_per_second: 2_400 })
    expect('kind' in traffic).toBe(false)
  })

  it('02 is a ten-second burst to the dial, from a third of it', () => {
    expect(trafficFor(READ_STORM, 9_000)).toEqual({
      kind: 'spike',
      baseline_rps: 3_000,
      peak_rps: 9_000,
      duration_seconds: 60,
      peak_start_seconds: 20,
      peak_seconds: 10,
    })
  })

  it('03 ramps to the dial over a minute, from a third of it', () => {
    expect(trafficFor(BLACK_FRIDAY, 30_000)).toEqual({
      kind: 'ramp',
      start_rps: 10_000,
      end_rps: 30_000,
      duration_seconds: 60,
    })
  })

  it('rounds the derived rate so the request key stays tidy', () => {
    // 1,000 / 3 = 333.33...; the body carries an integer, not a float tail.
    expect(trafficFor(READ_STORM, 1_000)).toMatchObject({ baseline_rps: 333 })
  })

  it.each(LEVELS.map((level) => [level.name, level] as const))(
    '%s is still a valid body at the dial floor',
    (_name, level) => {
      // The floor is one step because the API rejects a rate of zero -- and a
      // derived baseline must not round down to zero either, nor overtake the
      // peak it is a fraction of.
      const traffic = trafficFor(level, level.stepRps)

      switch (traffic.kind) {
        case 'spike':
          expect(traffic.baseline_rps).toBeGreaterThan(0)
          expect(traffic.baseline_rps).toBeLessThan(traffic.peak_rps)
          expect(Number.isInteger(traffic.baseline_rps)).toBe(true)
          break
        case 'ramp':
          expect(traffic.start_rps).toBeGreaterThan(0)
          expect(traffic.start_rps).toBeLessThan(traffic.end_rps)
          expect(Number.isInteger(traffic.start_rps)).toBe(true)
          break
        default:
          expect(traffic.requests_per_second).toBeGreaterThan(0)
      }
    },
  )
})
