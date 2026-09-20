/**
 * Layout for the latency-over-time strip: pure arithmetic, no DOM.
 *
 * Kept apart from the SVG so the scale decisions -- what a full-height bar
 * means, where the cap line sits, which sample is outlined -- can be checked
 * against hand-worked numbers rather than eyeballed in a browser.
 */

import type { NodeStatus, TimelineStep } from '../api/types'

/**
 * Headroom above the tallest thing on the scale, so neither the cap line nor
 * the highest finite bar touches the top edge and reads as clipped.
 */
export const SCALE_HEADROOM = 1.15

export interface StripSample {
  /** Left edge of the sample's column, in viewBox units. */
  x: number
  width: number
  /** Height of the latency bar; the full height when the sample is saturated. */
  barHeight: number
  /**
   * Saturated means the path's latency is null -- infinite, not large -- so the
   * bar fills the strip rather than pretending to a value.
   */
  isSaturated: boolean
  /** Status of the sample's bottleneck: the bar takes its colour from the same heat ramp as the canvas. */
  status: NodeStatus
  /** Top of the offered-rate area at this sample, in viewBox units. */
  rateY: number
  isWorst: boolean
}

export interface StripLayout {
  samples: StripSample[]
  /**
   * y of the latency-cap line. Always inside the strip, because the scale is
   * built to include the cap: a comfortable design still shows the line it is
   * comfortably under.
   */
  capY: number
  /** Latency, in milliseconds, that a full-height bar stands for. */
  scaleTopMs: number
  /**
   * The tallest finite latency in the window, in milliseconds; 0 when every
   * sample is saturated. Above the cap it is what sets the scale, and the
   * caption names it, because a multi-second tail pushes the cap line down
   * onto the axis where it no longer says what the bars are measured against.
   */
  peakMs: number
}

/**
 * Which sample a pointer is over, from its horizontal position as a fraction
 * of the strip's width. Clamped, because a pointer at the very right edge
 * reports a fraction of 1.0 and floor(1.0 * count) is one past the end.
 */
export function sampleIndexAt(fraction: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor(fraction * count)))
}

export function layoutTimeline(
  timeline: readonly TimelineStep[],
  worstIndex: number,
  capMs: number,
  width: number,
  height: number,
): StripLayout {
  const finiteLatencies = timeline
    .map((step) => step.total_latency_ms)
    .filter((latency): latency is number => latency !== null)

  const peakMs = Math.max(0, ...finiteLatencies)

  // The scale covers the cap and the worst finite latency, whichever is
  // larger, so the cap line is on-screen when the design is under it and the
  // bars are on-screen when it is over.
  const scaleTopMs = Math.max(capMs, peakMs) * SCALE_HEADROOM
  const peakRps = Math.max(...timeline.map((step) => step.offered_rps))
  const columnWidth = width / timeline.length

  const samples = timeline.map((step, index): StripSample => {
    const bottleneck = step.nodes.find(
      (node) => node.node_id === step.bottleneck_node_id,
    )
    const isSaturated = step.total_latency_ms === null
    return {
      x: index * columnWidth,
      width: columnWidth,
      barHeight: isSaturated
        ? height
        : (height * (step.total_latency_ms as number)) / scaleTopMs,
      isSaturated,
      // A saturated path always has a saturated bottleneck, so the fallback is
      // only for a malformed response; healthy is the quietest colour to fail to.
      status: bottleneck?.status ?? 'healthy',
      rateY: height - (height * step.offered_rps) / peakRps,
      isWorst: index === worstIndex,
    }
  })

  return {
    samples,
    capY: height - (height * capMs) / scaleTopMs,
    scaleTopMs,
    peakMs,
  }
}
