/**
 * Which failures are worth trying again.
 *
 * The live loop retries a failure it classifies as transient and pins one it
 * does not, so this boundary decides whether a redeploy heals itself on
 * screen or leaves a red banner until the player touches the dial.
 */

import { describe, expect, it } from 'vitest'

import { SimulationApiError, isTransientFailure } from './client'
import { retryDelayMs } from '../simulation-results/useSimulation'

describe('isTransientFailure', () => {
  it('treats an unreachable backend as transient', () => {
    // Status 0 is fetch itself failing: down, restarting, or refusing the origin.
    expect(isTransientFailure(new SimulationApiError('Could not reach', 0))).toBe(true)
  })

  it('treats a 5xx as transient', () => {
    expect(isTransientFailure(new SimulationApiError('Bad gateway', 502))).toBe(true)
    expect(isTransientFailure(new SimulationApiError('Unavailable', 503))).toBe(true)
  })

  it('does not retry a rejected design', () => {
    // A 422 is the answer, not a failure to get one.
    expect(isTransientFailure(new SimulationApiError('cycle', 422))).toBe(false)
    expect(isTransientFailure(new SimulationApiError('not found', 404))).toBe(false)
  })

  it('does not retry an error it cannot classify', () => {
    expect(isTransientFailure(new Error('unknown'))).toBe(false)
    expect(isTransientFailure(undefined)).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('doubles from two seconds and stops at thirty', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(retryDelayMs)).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ])
  })
})
