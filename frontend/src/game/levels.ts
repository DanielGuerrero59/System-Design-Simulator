/**
 * The levels: the only file to edit when tuning difficulty.
 *
 * Every number here was chosen against the real service rates in
 * `backend/app/simulation/constants.py` -- app servers at mu 2,000, databases
 * at 5,000, caches at 100,000 -- and each was checked two ways: that a
 * reasonable design clears it, and that the *naive* design fails it. A level
 * whose obvious first attempt already passes teaches nothing, so the failure
 * is the content.
 *
 * Worked solutions, for whoever retunes these next:
 *
 *   01  app x2 -> db.  App sees 2,400 over two replicas: rho 0.60, W 1.25 ms.
 *       DB sees 2,400: rho 0.48, W 0.38 ms. Path 1.63 ms, 8 credits.
 *       With one app replica rho is 1.2 -- saturated. That is the lesson.
 *
 *   02  app x6 -> cache -> db.  App rho 0.75 (W 2.00 ms), cache rho 0.09,
 *       DB sees 9,000 x (1 - 0.8) = 1,800, rho 0.36 (W 0.31 ms).
 *       Path 2.32 ms, 19 credits. Keeping the same six app servers and
 *       scaling the database instead needs db x3, which totals 24 credits
 *       (6 x 2 + 3 x 4) against a budget of 22. That squeeze is what makes
 *       the cache the answer rather than an option.
 *
 *   03  app x18 -> cache -> db x2.  App rho 0.83 (W 3.00 ms), cache rho 0.30,
 *       DB sees 6,000 over two replicas, rho 0.60 (W 0.50 ms).
 *       Path 3.51 ms, 47 credits against a budget of 52.
 *
 * Note the latency caps are single-digit milliseconds. At these service rates
 * a healthy component answers in well under a millisecond, so a cap of 250 ms
 * would never bind and the objective would be free.
 *
 * Each level also owns the *shape* of its traffic. The dial sets the peak, and
 * the worst second of a burst or a ramp is its peak -- which is exactly the
 * rate the arithmetic above was done at. Queue backlog carries from one second
 * to the next, but it can only build while a component is saturated, and a
 * design that clears a level keeps every component under 85% at the peak: it
 * never saturates, so nothing ever queues, and the steady state at the peak is
 * the whole story. A design that fails is judged at the first second it
 * breaks; the tail that follows is what the player gets to watch. Shapes
 * change what the player watches, not what the level demands.
 */

import type { ComponentType } from '../api/types'

/**
 * How a level's offered load moves over time. The dial always sets the peak;
 * a shape's other rates are fractions of it, so the one knob keeps working at
 * every position.
 */
export type LevelTraffic =
  | { kind: 'steady' }
  | {
      kind: 'spike'
      /** Baseline as a fraction of the peak. Strictly inside (0, 1). */
      baselineFraction: number
      durationSeconds: number
      peakStartSeconds: number
      peakSeconds: number
    }
  | {
      kind: 'ramp'
      /** Starting rate as a fraction of the end rate. Strictly inside (0, 1). */
      startFraction: number
      durationSeconds: number
    }

export interface Level {
  /** Small label above the name, e.g. "Level 01". */
  kicker: string
  name: string
  /** One or two sentences on what this level is about. Shown in the panel. */
  blurb: string
  /** Peak of the offered load the design has to carry to clear the level. */
  targetRps: number
  /** The shape the load takes over time; `targetRps` is its peak. */
  traffic: LevelTraffic
  /** Upper bound of the traffic dial, so a player can push past the target. */
  maxRps: number
  /** Dial granularity. Scaled per level so the slider stays usable at 30k. */
  stepRps: number
  /** End-to-end budget on the critical path, in milliseconds. */
  latencyCapMs: number
  /** Credit budget. Component costs live in `design/catalog.ts`. */
  budgetCredits: number
  /** Components already on the canvas when the level starts. */
  seed: ComponentType[]
}

export const LEVELS: Level[] = [
  {
    kicker: 'Level 01',
    name: 'Hello, traffic',
    blurb:
      'Two thousand four hundred requests a second. One app server tops out at two thousand — so it can never be one app server.',
    targetRps: 2_400,
    traffic: { kind: 'steady' },
    maxRps: 4_000,
    stepRps: 100,
    latencyCapMs: 4,
    budgetCredits: 12,
    seed: ['database'],
  },
  {
    kicker: 'Level 02',
    name: 'Read storm',
    blurb:
      'Most of this traffic is reads, and for ten seconds it triples. The database will melt long before the servers do — and replicating it costs more than absorbing the reads.',
    targetRps: 9_000,
    // Twenty seconds at a third of the peak, ten seconds at the peak, thirty
    // seconds back at baseline: room to see the before, the burst, and the
    // recovery. A lone database the burst saturates is 4,000 rps over capacity
    // for ten seconds and takes twenty more to work off the 40,000 requests
    // that leaves -- the tail is twice the burst, and the window shows all of it.
    traffic: {
      kind: 'spike',
      baselineFraction: 1 / 3,
      durationSeconds: 60,
      peakStartSeconds: 20,
      peakSeconds: 10,
    },
    maxRps: 15_000,
    stepRps: 250,
    latencyCapMs: 6,
    budgetCredits: 22,
    seed: ['database'],
  },
  {
    kicker: 'Level 03',
    name: 'Black friday',
    blurb:
      'The doors open and for a full minute the load climbs without pause — to more than three times the last level’s peak, on barely twice the budget. Every credit has to earn its place.',
    targetRps: 30_000,
    // A straight climb from a third of the peak. Sweeping the rate is the
    // clearest picture of the M/M/1 curve itself: the second a component
    // saturates can be read straight off the strip.
    traffic: { kind: 'ramp', startFraction: 1 / 3, durationSeconds: 60 },
    maxRps: 48_000,
    stepRps: 500,
    latencyCapMs: 8,
    budgetCredits: 52,
    seed: ['database'],
  },
]

/** Clamp an arbitrary index onto a real level, for the `startLevel` prop. */
export function levelAt(index: number): Level {
  const clamped = Math.max(0, Math.min(LEVELS.length - 1, index))
  // Non-null: `clamped` is bounded by the array's own length above, and LEVELS
  // is a non-empty literal.
  return LEVELS[clamped]!
}
