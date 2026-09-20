/**
 * The strip's scale, worked by hand.
 *
 * Fixture: a six-second window sampled every second, baseline 1,500 rps with a
 * two-second burst to 2,500 at t = 2 and 3. The path takes 2 ms at baseline
 * and saturates during the burst. Cap 4 ms, strip 240 x 56.
 */

import { describe, expect, it } from 'vitest'

import type { NodeStatus, TimelineStep } from '../api/types'
import { SCALE_HEADROOM, layoutTimeline, sampleIndexAt } from './timelineGeometry'

const WIDTH = 240
const HEIGHT = 56
const CAP_MS = 4

function step(
  t: number,
  offeredRps: number,
  totalLatencyMs: number | null,
  status: NodeStatus,
): TimelineStep {
  return {
    t_seconds: t,
    offered_rps: offeredRps,
    is_stable: totalLatencyMs !== null,
    total_latency_ms: totalLatencyMs,
    bottleneck_node_id: 'api',
    nodes: [
      {
        node_id: 'api',
        arrival_rate_rps: offeredRps,
        service_rate_rps: 2_000,
        utilization: offeredRps / 2_000,
        latency_ms: totalLatencyMs,
        backlog: 0,
        status,
      },
    ],
  }
}

const SPIKE: TimelineStep[] = [
  step(0, 1_500, 2, 'warning'),
  step(1, 1_500, 2, 'warning'),
  step(2, 2_500, null, 'saturated'),
  step(3, 2_500, null, 'saturated'),
  step(4, 1_500, 2, 'warning'),
  step(5, 1_500, 2, 'warning'),
  step(6, 1_500, 2, 'warning'),
]

describe('layoutTimeline', () => {
  const layout = layoutTimeline(SPIKE, 2, CAP_MS, WIDTH, HEIGHT)

  it('scales to the cap, with headroom, when the design is under it', () => {
    // max(cap 4, tallest finite 2) * 1.15
    expect(layout.scaleTopMs).toBeCloseTo(4.6, 10)
    expect(SCALE_HEADROOM).toBe(1.15)
    expect(layout.peakMs).toBe(2)
  })

  it('draws a 2 ms bar at 56 * 2 / 4.6 units', () => {
    expect(layout.samples[0]!.barHeight).toBeCloseTo(24.35, 2)
    expect(layout.samples[0]!.isSaturated).toBe(false)
  })

  it('fills the strip for a saturated second rather than inventing a height', () => {
    for (const index of [2, 3]) {
      expect(layout.samples[index]!.barHeight).toBe(HEIGHT)
      expect(layout.samples[index]!.isSaturated).toBe(true)
      expect(layout.samples[index]!.status).toBe('saturated')
    }
  })

  it('puts the cap line at 56 - 56 * 4 / 4.6', () => {
    expect(layout.capY).toBeCloseTo(7.3, 2)
  })

  it('spaces columns evenly across the width', () => {
    const columnWidth = WIDTH / 7
    layout.samples.forEach((sample, index) => {
      expect(sample.x).toBeCloseTo(index * columnWidth, 10)
      expect(sample.width).toBeCloseTo(columnWidth, 10)
    })
  })

  it('draws the offered rate against the peak', () => {
    // Baseline is 60% of the peak: the area top sits 60% of the way up.
    expect(layout.samples[0]!.rateY).toBeCloseTo(HEIGHT - HEIGHT * 0.6, 10)
    expect(layout.samples[2]!.rateY).toBe(0)
  })

  it('outlines only the worst sample', () => {
    expect(layout.samples.map((sample) => sample.isWorst)).toEqual([
      false, false, true, false, false, false, false,
    ])
  })

  it('tints each bar by the status of its own bottleneck', () => {
    expect(layout.samples[0]!.status).toBe('warning')
  })

  it('keeps the cap on-screen for a very comfortable design', () => {
    const calm = SPIKE.map((s) => step(s.t_seconds, 1_000, 1, 'healthy'))
    const calmLayout = layoutTimeline(calm, 0, CAP_MS, WIDTH, HEIGHT)

    expect(calmLayout.scaleTopMs).toBeCloseTo(4.6, 10)
    expect(calmLayout.capY).toBeCloseTo(7.3, 2)
    expect(calmLayout.samples[0]!.barHeight).toBeCloseTo(12.17, 2)
  })

  it('grows the scale when a finite latency exceeds the cap', () => {
    const slow = SPIKE.map((s) => step(s.t_seconds, 1_900, 10, 'critical'))
    const slowLayout = layoutTimeline(slow, 0, CAP_MS, WIDTH, HEIGHT)

    // max(4, 10) * 1.15
    expect(slowLayout.scaleTopMs).toBeCloseTo(11.5, 10)
    expect(slowLayout.capY).toBeCloseTo(HEIGHT - (HEIGHT * 4) / 11.5, 10)
    expect(slowLayout.samples[0]!.barHeight).toBeCloseTo((HEIGHT * 10) / 11.5, 10)
    expect(slowLayout.peakMs).toBe(10)
  })

  it('lets a recovery tail set the scale and reports it as the peak', () => {
    // Level 02's tail: 8,000.5 ms the second the burst ends, against a 6 ms
    // cap. The cap line lands within a hair of the axis; the caption names
    // the peak so the reader knows what the bars are drawn against.
    const tail = [
      step(0, 3_000, 0.5, 'healthy'),
      step(1, 9_000, null, 'saturated'),
      step(2, 3_000, 8_000.5, 'critical'),
      step(3, 3_000, 0.5, 'healthy'),
    ]
    const tailLayout = layoutTimeline(tail, 1, 6, WIDTH, HEIGHT)

    expect(tailLayout.peakMs).toBe(8_000.5)
    expect(tailLayout.scaleTopMs).toBeCloseTo(8_000.5 * 1.15, 6)
    expect(tailLayout.capY).toBeGreaterThan(HEIGHT - 0.05)
    expect(tailLayout.samples[2]!.barHeight).toBeCloseTo(HEIGHT / 1.15, 6)
  })

  it('reports no peak when every sample is saturated', () => {
    const wall = [step(0, 9_000, null, 'saturated'), step(1, 9_000, null, 'saturated')]
    expect(layoutTimeline(wall, 0, CAP_MS, WIDTH, HEIGHT).peakMs).toBe(0)
  })
})

describe('sampleIndexAt', () => {
  it('maps a fraction of the width onto a column', () => {
    // 7 columns: the second column spans [1/7, 2/7).
    expect(sampleIndexAt(1.5 / 7, 7)).toBe(1)
    expect(sampleIndexAt(0, 7)).toBe(0)
  })

  it('clamps both edges', () => {
    // A pointer on the right edge reports exactly 1.0, one column past the end.
    expect(sampleIndexAt(1, 7)).toBe(6)
    expect(sampleIndexAt(1.2, 7)).toBe(6)
    expect(sampleIndexAt(-0.1, 7)).toBe(0)
  })
})
