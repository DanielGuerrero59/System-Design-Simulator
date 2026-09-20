/**
 * Number formatting.
 *
 * Small surface, but it earned a test: the panel headline and the objective row
 * had independent formatters and drifted, printing 0.385 and 0.38 for one
 * quantity a few inches apart on screen.
 */

import { describe, expect, it } from 'vitest'

import {
  formatLatency,
  formatQueue,
  formatRate,
  formatShortLatency,
  latencyParts,
} from './format'

describe('latencyParts', () => {
  it('keeps three decimals below a millisecond', () => {
    // A load balancer answers in fractions of a millisecond at these rates;
    // rounding here would print every healthy component as "0".
    expect(latencyParts(0.025)).toEqual({ figure: '0.025', unit: 'ms' })
    expect(latencyParts(0.385)).toEqual({ figure: '0.385', unit: 'ms' })
  })

  it('keeps two decimals in the single and double digits', () => {
    expect(latencyParts(1.6346)).toEqual({ figure: '1.63', unit: 'ms' })
    expect(latencyParts(99.999)).toEqual({ figure: '100.00', unit: 'ms' })
  })

  it('rounds to whole milliseconds once the decimals stop mattering', () => {
    expect(latencyParts(250.4)).toEqual({ figure: '250', unit: 'ms' })
    expect(latencyParts(999.4)).toEqual({ figure: '999', unit: 'ms' })
  })

  it('switches to seconds where whole milliseconds would print 1000', () => {
    // The Level 02 tail: 40,000 requests queued at a database serving 5,000
    // a second, plus the 0.5 ms steady state.
    expect(latencyParts(8_000.5)).toEqual({ figure: '8.0', unit: 's' })
    expect(latencyParts(999.5)).toEqual({ figure: '1.0', unit: 's' })
    expect(latencyParts(40_500)).toEqual({ figure: '40.5', unit: 's' })
  })

  it('drops the decimal past a hundred seconds', () => {
    expect(latencyParts(145_000)).toEqual({ figure: '145', unit: 's' })
  })
})

describe('formatLatency', () => {
  it('is the parts joined, so the headline and the row can never disagree', () => {
    expect(formatLatency(0.385)).toBe('0.385 ms')
    expect(formatLatency(8_000.5)).toBe('8.0 s')
  })

  it('renders saturation as infinity, never as a number', () => {
    // The backend sends null at rho >= 1 because the value is infinite rather
    // than large. Printing a figure here would teach the opposite of the lesson.
    expect(formatLatency(null)).toBe('∞')
  })
})

describe('formatShortLatency', () => {
  it('fits a node card: one decimal under ten, whole milliseconds above', () => {
    expect(formatShortLatency(0.385)).toBe('0.4 ms')
    expect(formatShortLatency(2)).toBe('2.0 ms')
    expect(formatShortLatency(502)).toBe('502 ms')
  })

  it('shows a tail in the same seconds the panel shows', () => {
    expect(formatShortLatency(8_000.5)).toBe(formatLatency(8_000.5))
    expect(formatShortLatency(8_000.5)).toBe('8.0 s')
  })
})

describe('formatRate', () => {
  it('groups thousands and drops spurious decimals', () => {
    expect(formatRate(30000)).toBe('30,000 rps')
    expect(formatRate(2400.4)).toBe('2,400 rps')
  })
})

describe('formatQueue', () => {
  it('counts the requests waiting', () => {
    expect(formatQueue(40_000)).toBe('40,000 queued')
    expect(formatQueue(1_000.0000001)).toBe('1,000 queued')
  })
})
