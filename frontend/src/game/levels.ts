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
 *       Path 2.32 ms, 19 credits. Scaling the database instead of caching
 *       needs three replicas and lands at 24 credits -- over budget. The
 *       squeeze is what makes the cache the answer rather than an option.
 *
 *   03  app x18 -> cache -> db x2.  App rho 0.83 (W 3.00 ms), cache rho 0.30,
 *       DB sees 6,000 over two replicas, rho 0.60 (W 0.50 ms).
 *       Path 3.51 ms, 47 credits against a budget of 52.
 *
 * Note the latency caps are single-digit milliseconds. At these service rates
 * a healthy component answers in well under a millisecond, so a cap of 250 ms
 * would never bind and the objective would be free.
 */

import type { ComponentType } from '../api/types'

export interface Level {
  /** Small label above the name, e.g. "Level 01". */
  kicker: string
  name: string
  /** One or two sentences on what this level is about. Shown in the panel. */
  blurb: string
  /** Offered load the design has to carry to clear the level. */
  targetRps: number
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
      'Most of this traffic is reads. The database will melt long before the servers do — and replicating it costs more than absorbing the reads.',
    targetRps: 9_000,
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
      'More than three times the load, barely twice the budget. Every credit has to earn its place.',
    targetRps: 30_000,
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
