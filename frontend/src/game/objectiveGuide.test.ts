/**
 * The goal guides, checked against the numbers they quote.
 *
 * Expected figures are worked from the level definitions by hand: Level 02
 * idles at 9,000 / 3 = 3,000 rps, Level 03 starts at 30,000 / 3 = 10,000 rps.
 * The claims that lean on tuning kept elsewhere -- how fast the parts are,
 * what a cache costs -- are restated as facts about their sources, so the
 * retune that falsifies one fails a test instead of leaving the prose wrong.
 */

import { describe, expect, it } from 'vitest'

import { COMPONENT_CATALOG } from '../design/catalog'
import { LEVELS } from './levels'
import { guideFor } from './objectiveGuide'
import type { ObjectiveId } from './objectives'

const [HELLO, READ_STORM, BLACK_FRIDAY] = LEVELS as [
  (typeof LEVELS)[number],
  (typeof LEVELS)[number],
  (typeof LEVELS)[number],
]

const IDS: ObjectiveId[] = [
  'rate',
  'reaches-database',
  'headroom',
  'latency',
  'budget',
]

describe('every goal on every level is explained', () => {
  it.each(LEVELS.flatMap((level) => IDS.map((id) => [level.name, id, level] as const)))(
    '%s: %s',
    (_name, id, level) => {
      const guide = guideFor(id, level)
      expect(guide.meaning.length).toBeGreaterThan(0)
      expect(guide.whyItMatters.length).toBeGreaterThan(0)
      expect(guide.howToMeetIt.length).toBeGreaterThan(0)
    },
  )
})

describe('the rate goal describes the level’s own traffic', () => {
  it('holds steady on Level 1', () => {
    const guide = guideFor('rate', HELLO)
    expect(guide.meaning).toContain('a steady 2,400 rps')
    expect(guide.howToMeetIt).toContain('at least 2,400 rps')
  })

  it('bursts on Level 2, from a third of the peak', () => {
    const { meaning } = guideFor('rate', READ_STORM)
    expect(meaning).toContain('idles at 3,000 rps')
    expect(meaning).toContain('bursts to 9,000 rps for 10 s from t = 20 s')
  })

  it('climbs on Level 3, from a third of the peak', () => {
    expect(guideFor('rate', BLACK_FRIDAY).meaning).toContain(
      'from 10,000 rps to 30,000 rps over 60 s',
    )
  })
})

describe('the claims the guides make hold', () => {
  it('quotes the wait at the comfort ceiling', () => {
    // At rho = 0.85 a request spends 1 / (1 - 0.85) = 1 / 0.15 = 6.67 times
    // its service time in the part.
    const { whyItMatters } = guideFor('headroom', HELLO)
    expect(whyItMatters).toContain('At 85% busy')
    expect(whyItMatters).toContain('about 6.7×')
  })

  it('says every part works in under a millisecond, which they do', () => {
    expect(guideFor('latency', HELLO).whyItMatters).toContain(
      'under a millisecond',
    )
    // One request's work is 1 / mu seconds; under 1 ms means mu above 1,000.
    for (const part of Object.values(COMPONENT_CATALOG)) {
      expect(part.defaultServiceRateRps).toBeGreaterThan(1_000)
    }
  })

  it('names each level’s latency cap', () => {
    expect(guideFor('latency', HELLO).howToMeetIt).toContain('under 4 ms')
    expect(guideFor('latency', READ_STORM).howToMeetIt).toContain('under 6 ms')
    expect(guideFor('latency', BLACK_FRIDAY).howToMeetIt).toContain('under 8 ms')
  })

  it('prices the cache and its hit rate', () => {
    const guide = guideFor('budget', READ_STORM)
    expect(guide.meaning).toContain('a budget of 22')
    expect(guide.howToMeetIt).toContain('A Cache costs 3 credits')
    expect(guide.howToMeetIt).toContain('answers 80% of requests')
  })
})
