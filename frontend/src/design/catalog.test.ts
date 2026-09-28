/**
 * The info copy, checked against the numbers it describes.
 *
 * A part's `inThisSandbox` sentence makes claims a player acts on -- "the
 * slowest part per instance", "the most expensive part in the bin". Prose
 * cannot fail on its own, so a retune of `constants.py` or of the credits
 * would leave it confidently wrong. Each claim is restated here as a fact
 * about the catalog, so the retune that falsifies it fails a test instead.
 */

import { describe, expect, it } from 'vitest'

import type { ComponentType } from '../api/types'
import { COMPONENT_CATALOG } from './catalog'

const OTHER_PARTS = (type: ComponentType) =>
  Object.values(COMPONENT_CATALOG).filter((part) => part.type !== type)

describe('info copy', () => {
  it('gives the cache the split it is modelled with', () => {
    // DEFAULT_CACHE_HIT_RATIO is 0.8: 80% answered, 20% carried on. Worked
    // out by hand, not through formatPercent, so a formatting slip shows.
    const note = COMPONENT_CATALOG.cache.inThisSandbox
    expect(note).toContain('Answers 80% of requests')
    expect(note).toContain('only the 20% that miss')
  })

  it('calls the app server the slowest part per instance', () => {
    const appServer = COMPONENT_CATALOG.app_server
    expect(appServer.inThisSandbox).toContain('slowest part per instance')
    for (const part of OTHER_PARTS('app_server')) {
      expect(part.defaultServiceRateRps).toBeGreaterThan(
        appServer.defaultServiceRateRps,
      )
    }
  })

  it('calls the database the most expensive part in the bin', () => {
    const database = COMPONENT_CATALOG.database
    expect(database.inThisSandbox).toContain('most expensive part in the bin')
    for (const part of OTHER_PARTS('database')) {
      expect(part.credits).toBeLessThan(database.credits)
    }
  })

  it('calls the load balancer a single instance', () => {
    const loadBalancer = COMPONENT_CATALOG.load_balancer
    expect(loadBalancer.inThisSandbox).toContain('single instance')
    expect(loadBalancer.isScalable).toBe(false)
  })
})
