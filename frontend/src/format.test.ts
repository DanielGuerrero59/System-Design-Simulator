/**
 * Number formatting.
 *
 * Small surface, but it earned a test: the panel headline and the objective row
 * had independent formatters and drifted, printing 0.385 and 0.38 for one
 * quantity a few inches apart on screen.
 */

import { describe, expect, it } from 'vitest'

import { formatLatency, formatLatencyFigure, formatRate } from './format'

describe('formatLatencyFigure', () => {
  it('keeps three decimals below a millisecond', () => {
    // A load balancer answers in fractions of a millisecond at these rates;
    // rounding here would print every healthy component as "0".
    expect(formatLatencyFigure(0.025)).toBe('0.025')
    expect(formatLatencyFigure(0.385)).toBe('0.385')
  })

  it('keeps two decimals in the single and double digits', () => {
    expect(formatLatencyFigure(1.6346)).toBe('1.63')
    expect(formatLatencyFigure(99.999)).toBe('100.00')
  })

  it('rounds to whole milliseconds once the decimals stop mattering', () => {
    expect(formatLatencyFigure(250.4)).toBe('250')
  })
})

describe('formatLatency', () => {
  it('is the figure plus a unit, so the two can never disagree', () => {
    expect(formatLatency(0.385)).toBe(`${formatLatencyFigure(0.385)} ms`)
    expect(formatLatency(1.6346)).toBe(`${formatLatencyFigure(1.6346)} ms`)
  })

  it('renders saturation as infinity, never as a number', () => {
    // The backend sends null at rho >= 1 because the value is infinite rather
    // than large. Printing a figure here would teach the opposite of the lesson.
    expect(formatLatency(null)).toBe('∞')
  })
})

describe('formatRate', () => {
  it('groups thousands and drops spurious decimals', () => {
    expect(formatRate(30000)).toBe('30,000 rps')
    expect(formatRate(2400.4)).toBe('2,400 rps')
  })
})
