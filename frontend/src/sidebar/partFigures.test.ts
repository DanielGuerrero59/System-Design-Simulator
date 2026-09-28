import { describe, expect, it } from 'vitest'

import { partFigures } from './partFigures'

describe('partFigures', () => {
  it('counts a scalable part per replica', () => {
    expect(
      partFigures({ defaultServiceRateRps: 2_000, credits: 2, isScalable: true }),
    ).toEqual({ serves: 'μ 2,000 rps per replica', costs: '2 credits per replica' })
  })

  it('leaves "per replica" off a part that has only one instance', () => {
    expect(
      partFigures({ defaultServiceRateRps: 50_000, credits: 3, isScalable: false }),
    ).toEqual({ serves: 'μ 50,000 rps · one instance', costs: '3 credits' })
  })

  it('does not print "1 credits"', () => {
    expect(
      partFigures({ defaultServiceRateRps: 100, credits: 1, isScalable: true }).costs,
    ).toBe('1 credit per replica')
  })
})
