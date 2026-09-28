/**
 * What each goal asks for, written for someone new to system design.
 *
 * The objective rows are terse because they have to be -- "Every node under
 * 85%" is one line -- and a newcomer can tick every one of them without
 * knowing why any of them is there. Each guide answers three questions in
 * order: what the goal measures, why a real system cares, and what in this
 * sandbox moves it.
 *
 * Built per level, because the numbers are the level's. A guide that said
 * "the target" where it could say "9,000 rps" would make the reader do the
 * lookup the guide exists to save them. The claims that depend on tuning
 * elsewhere -- a cache's price, how fast the parts are -- are checked against
 * their sources in `objectiveGuide.test.ts`.
 */

import { CACHE_HIT_RATIO, COMPONENT_CATALOG } from '../design/catalog'
import { formatPercent, formatRate } from '../format'
import type { Level } from './levels'
import { COMFORT_CEILING, type ObjectiveId } from './objectives'

export interface ObjectiveGuide {
  /** What the goal measures, with its name and symbol. */
  meaning: string
  /** Why a real system cares about it. */
  whyItMatters: string
  /** What to change in this sandbox to meet it. */
  howToMeetIt: string
}

export function guideFor(id: ObjectiveId, level: Level): ObjectiveGuide {
  switch (id) {
    case 'rate':
      return rateGuide(level)
    case 'reaches-database':
      return REACHES_DATABASE
    case 'headroom':
      return HEADROOM
    case 'latency':
      return latencyGuide(level)
    case 'budget':
      return budgetGuide(level)
  }
}

const THROUGHPUT =
  'Throughput: how many requests your design has to handle every second. That rate is λ (lambda), and the traffic dial in the header sets it.'

function rateGuide(level: Level): ObjectiveGuide {
  const peak = formatRate(level.targetRps)
  const shape = level.traffic
  // Rounded as `trafficFor` rounds them, so the guide quotes the rates the
  // request will actually carry.
  const fractionOfPeak = (fraction: number) =>
    formatRate(Math.round(level.targetRps * fraction))
  const howToMeetIt = `Drag the dial up to at least ${peak}. This goal only makes sure you test at full load — the goals below decide whether your design survives it.`

  switch (shape.kind) {
    case 'steady':
      return {
        meaning: `${THROUGHPUT} Here it holds at a steady ${peak}.`,
        whyItMatters:
          'A real service does not choose its traffic. Whatever arrives has to be answered, or users see errors.',
        howToMeetIt,
      }
    case 'spike':
      return {
        meaning: `${THROUGHPUT} Here it does not hold still: it idles at ${fractionOfPeak(shape.baselineFraction)}, then bursts to ${peak} for ${shape.peakSeconds} s from t = ${shape.peakStartSeconds} s. The dial sets that peak.`,
        whyItMatters:
          'Real traffic arrives in bursts — a sale starts, a post goes viral, everyone logs in at nine. A design sized for the quiet part breaks exactly when the most people are watching.',
        howToMeetIt: `${howToMeetIt} A burst is judged at its busiest second.`,
      }
    case 'ramp':
      return {
        meaning: `${THROUGHPUT} Here it climbs steadily from ${fractionOfPeak(shape.startFraction)} to ${peak} over ${shape.durationSeconds} s. The dial sets where it ends.`,
        whyItMatters:
          'Growth rarely arrives overnight, but it keeps arriving. A climb shows the moment each part runs out of room — and the first to run out is the one to fix.',
        howToMeetIt: `${howToMeetIt} A climb is judged at its busiest second, the last.`,
      }
  }
}

const REACHES_DATABASE: ObjectiveGuide = {
  meaning:
    'Every request has to travel along wires from where traffic enters to a Database — the part that actually keeps the data.',
  whyItMatters:
    'A request that never reaches storage was never really served: nothing was read and nothing was saved. And a database with traffic aimed straight at it is one box, not a system.',
  howToMeetIt:
    'Wire a path to a Database with at least one part in front of it. Traffic enters at the one part nothing points to — the Traffic box sits beside it.',
}

// How long a request spends in a part, as a multiple of the work itself: the
// M/M/1 time 1/(mu - lambda) divided by the service time 1/mu is 1/(1 - rho).
const WAIT_MULTIPLE_AT_CEILING = (1 / (1 - COMFORT_CEILING)).toFixed(1)

const HEADROOM: ObjectiveGuide = {
  meaning:
    'Utilisation, ρ (rho) = λ / μ: the share of a part’s capacity in use. At 50% it is busy half the time. Once traffic runs, every card shows its ρ.',
  whyItMatters: `Queues do not slow down gently. At ${formatPercent(COMFORT_CEILING)} busy, a request spends about ${WAIT_MULTIPLE_AT_CEILING}× as long in a part as the work itself takes; at 100% the queue never stops growing. Spare room is what absorbs the next surprise.`,
  howToMeetIt:
    'Take load off the busiest part: add replicas with the + on its card, so each copy takes λ ÷ N, or put a Cache in front of it so less traffic gets through.',
}

function latencyGuide(level: Level): ObjectiveGuide {
  return {
    meaning:
      'Latency: how long one request takes, start to finish. Each part adds its own time — the work plus any wait in its queue — and this goal checks the slowest route through your design, the Slowest path figure below.',
    whyItMatters:
      'Users feel the slow route, not the average: one sluggish hop makes the whole request sluggish. Every part here does its work in under a millisecond, so a slow path almost always means a queue.',
    howToMeetIt: `A part’s time is W = 1 / (μ − λ), which shoots up as it fills. Pull the busiest part back from its limit and the whole path speeds up, until it is under ${level.latencyCapMs} ms.`,
  }
}

function budgetGuide(level: Level): ObjectiveGuide {
  const cache = COMPONENT_CATALOG.cache
  return {
    meaning: `Every part costs credits, charged again for each replica. The figure is what your design costs right now, against a budget of ${level.budgetCredits}.`,
    whyItMatters:
      'Real servers cost money every hour they run. Adding more until the problem goes away always works and is rarely the answer; the skill is the cheapest design that holds.',
    howToMeetIt: `Compare what each part serves for its price — the μ and cr on its card. A Cache costs ${cache.credits} credits and answers ${formatPercent(CACHE_HIT_RATIO)} of requests itself, which often beats another Database behind it.`,
  }
}
