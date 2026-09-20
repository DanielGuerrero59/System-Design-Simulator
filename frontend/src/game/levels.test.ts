/**
 * The level tuning, checked against the queueing model rather than trusted.
 *
 * `levels.ts` carries a worked solution for each level in a comment. A comment
 * cannot fail, and one of them was wrong until a review caught it. These tests
 * make the same claims executable: for every level, the documented design
 * clears all four measurable constraints, and the design a player would reach
 * for first does not.
 *
 * The M/M/1 formulas are written out here rather than imported, so this is a
 * check against the model and not against another copy of the app's own
 * arithmetic. They are the same four lines as `backend/app/simulation/
 * queueing.py`, which is the authority and has 124 tests of its own:
 *
 *     rho = (lambda / replicas) / mu
 *     W   = 1 / (mu - lambda / replicas)       seconds, undefined at rho >= 1
 *
 * If the service rates in `constants.py` are retuned and the mirrors in
 * `catalog.ts` follow, these tests are what notice that a level has become
 * unwinnable -- or free.
 *
 * Every run below is at the level's target, which is the *peak* of its traffic
 * shape, as a single steady state. That is enough even though the backend
 * carries queue backlog between seconds: backlog only builds while a component
 * is saturated, and `clears` demands every component under 85% at the peak,
 * so a clearing design never queues anything and its every second is the
 * steady state at that second's rate. A failing design fails at the first
 * second something saturates, which is the peak too. The tail after a burst
 * changes what the player watches, never the verdict.
 */

import { describe, expect, it } from 'vitest'

import type { ComponentType } from '../api/types'
import { COMPONENT_CATALOG } from '../design/catalog'
import { MAX_TRAFFIC_DURATION_SECONDS } from '../design/limits'
import { LEVELS } from './levels'

/** Mirrors DEFAULT_CACHE_HIT_RATIO in backend/app/simulation/constants.py. */
const CACHE_HIT_RATIO = 0.8

/** Mirrors UTILIZATION_CRITICAL_THRESHOLD: the bar every level sets. */
const COMFORT_CEILING = 0.85

interface Stage {
  type: ComponentType
  replicas: number
}

interface Outcome {
  maxUtilization: number
  totalLatencyMs: number | null
  credits: number
}

/**
 * Walk a linear design, the way the engine walks a graph.
 *
 * Every solution below is a single chain, so the critical path is just the sum
 * of the stages. A saturated stage returns a null total: the value is infinite
 * rather than large, and the app never renders a figure in its place.
 */
function run(stages: Stage[], trafficRps: number): Outcome {
  let arriving = trafficRps
  let totalLatencyMs = 0
  let maxUtilization = 0
  let credits = 0
  let saturated = false

  for (const stage of stages) {
    const definition = COMPONENT_CATALOG[stage.type]
    const mu = definition.defaultServiceRateRps
    const perReplica = arriving / stage.replicas
    const rho = perReplica / mu

    maxUtilization = Math.max(maxUtilization, rho)
    credits += definition.credits * stage.replicas

    if (rho >= 1) {
      saturated = true
    } else {
      totalLatencyMs += 1000 / (mu - perReplica)
    }

    // Only a cache absorbs traffic; everything else passes it all downstream.
    arriving =
      stage.type === 'cache' ? arriving * (1 - CACHE_HIT_RATIO) : arriving
  }

  return {
    maxUtilization,
    totalLatencyMs: saturated ? null : totalLatencyMs,
    credits,
  }
}

function clears(outcome: Outcome, level: (typeof LEVELS)[number]): boolean {
  return (
    outcome.maxUtilization < COMFORT_CEILING &&
    outcome.totalLatencyMs !== null &&
    outcome.totalLatencyMs <= level.latencyCapMs &&
    outcome.credits <= level.budgetCredits
  )
}

describe('every level is winnable by its documented solution', () => {
  it('01 Hello, traffic — app x2 -> db', () => {
    const level = LEVELS[0]!
    const outcome = run(
      [
        { type: 'app_server', replicas: 2 },
        { type: 'database', replicas: 1 },
      ],
      level.targetRps,
    )

    // 2,400 over two app servers is 1,200 each against mu 2,000.
    expect(outcome.maxUtilization).toBeCloseTo(0.6, 10)
    // 1/(2000-1200) + 1/(5000-2400), in milliseconds.
    expect(outcome.totalLatencyMs).toBeCloseTo(1.25 + 0.3846153846, 6)
    expect(outcome.credits).toBe(8)
    expect(clears(outcome, level)).toBe(true)
  })

  it('02 Read storm — app x6 -> cache -> db', () => {
    const level = LEVELS[1]!
    const outcome = run(
      [
        { type: 'app_server', replicas: 6 },
        { type: 'cache', replicas: 1 },
        { type: 'database', replicas: 1 },
      ],
      level.targetRps,
    )

    expect(outcome.maxUtilization).toBeCloseTo(0.75, 10)
    expect(outcome.credits).toBe(19)
    expect(clears(outcome, level)).toBe(true)
  })

  it('03 Black friday — app x18 -> cache -> db x2', () => {
    const level = LEVELS[2]!
    const outcome = run(
      [
        { type: 'app_server', replicas: 18 },
        { type: 'cache', replicas: 1 },
        { type: 'database', replicas: 2 },
      ],
      level.targetRps,
    )

    // 30,000 over eighteen app servers is 1,666.67 each: the tightest stage in
    // the game, and deliberately just under the ceiling.
    expect(outcome.maxUtilization).toBeCloseTo(0.8333333333, 8)
    expect(outcome.credits).toBe(47)
    expect(clears(outcome, level)).toBe(true)
  })
})

describe('the naive design fails, which is what makes a level a lesson', () => {
  it('01 — one app server saturates at the target rate', () => {
    const level = LEVELS[0]!
    const outcome = run(
      [
        { type: 'app_server', replicas: 1 },
        { type: 'database', replicas: 1 },
      ],
      level.targetRps,
    )

    // 2,400 against mu 2,000 is rho 1.2: the queue grows without bound, so
    // there is no latency to report at all.
    expect(outcome.maxUtilization).toBeGreaterThanOrEqual(1)
    expect(outcome.totalLatencyMs).toBeNull()
    expect(clears(outcome, level)).toBe(false)
  })

  it('02 — scaling the database instead of caching busts the budget', () => {
    const level = LEVELS[1]!
    const outcome = run(
      [
        { type: 'app_server', replicas: 6 },
        { type: 'database', replicas: 3 },
      ],
      level.targetRps,
    )

    // 6 x 2 + 3 x 4 = 24 against a budget of 22. The squeeze is the whole
    // reason a cache is the answer rather than an option.
    expect(outcome.credits).toBe(24)
    expect(outcome.credits).toBeGreaterThan(level.budgetCredits)
    expect(clears(outcome, level)).toBe(false)
  })

  it('02 — two database replicas are not comfortable either', () => {
    const level = LEVELS[1]!
    const outcome = run(
      [
        { type: 'app_server', replicas: 6 },
        { type: 'database', replicas: 2 },
      ],
      level.targetRps,
    )

    // 9,000 over two databases is 4,500 each against mu 5,000: rho 0.9, past
    // the ceiling. So the cheaper database route is not merely expensive, it
    // does not work.
    expect(outcome.maxUtilization).toBeCloseTo(0.9, 10)
    expect(clears(outcome, level)).toBe(false)
  })

  it('03 — no cache leaves the database over the ceiling within budget', () => {
    const level = LEVELS[2]!
    // Spending every remaining credit on databases after the eighteen app
    // servers the target demands: 52 - 36 = 16 credits, so four replicas.
    const outcome = run(
      [
        { type: 'app_server', replicas: 18 },
        { type: 'database', replicas: 4 },
      ],
      level.targetRps,
    )

    // 30,000 over four databases is 7,500 each against mu 5,000: saturated.
    expect(outcome.totalLatencyMs).toBeNull()
    expect(clears(outcome, level)).toBe(false)
  })
})

describe('level data is internally consistent', () => {
  it.each(LEVELS.map((level) => [level.name, level] as const))(
    '%s has a dial that can reach its own target',
    (_name, level) => {
      expect(level.maxRps).toBeGreaterThanOrEqual(level.targetRps)
      // The dial floors at one step, because the API rejects a rate of zero.
      expect(level.stepRps).toBeGreaterThan(0)
      // The target has to be selectable, not merely within range.
      expect(level.targetRps % level.stepRps).toBe(0)
    },
  )

  it.each(LEVELS.map((level) => [level.name, level] as const))(
    '%s has a traffic shape the backend will accept',
    (_name, level) => {
      const shape = level.traffic
      if (shape.kind === 'steady') {
        return
      }
      // Derived rates are fractions of the peak, and the API insists a burst's
      // peak exceeds its baseline: the fraction has to sit strictly inside
      // (0, 1) for that to hold at every dial position.
      const fraction =
        shape.kind === 'spike' ? shape.baselineFraction : shape.startFraction
      expect(fraction).toBeGreaterThan(0)
      expect(fraction).toBeLessThan(1)
      expect(shape.durationSeconds).toBeLessThanOrEqual(MAX_TRAFFIC_DURATION_SECONDS)
      if (shape.kind === 'spike') {
        // The API rejects a burst that runs past the end of its window.
        expect(shape.peakStartSeconds + shape.peakSeconds).toBeLessThanOrEqual(
          shape.durationSeconds,
        )
      }
    },
  )

  it.each(LEVELS.map((level) => [level.name, level] as const))(
    '%s seeds parts it has the budget to pay for',
    (_name, level) => {
      const seedCost = level.seed.reduce(
        (total, type) => total + COMPONENT_CATALOG[type].credits,
        0,
      )

      expect(seedCost).toBeLessThanOrEqual(level.budgetCredits)
    },
  )
})
