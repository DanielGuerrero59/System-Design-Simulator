/**
 * Latency second by second, drawn under the headline figure.
 *
 * Pure presentation: the layout comes from `timelineGeometry.ts` and the
 * colours from the same heat ramp as the canvas, so a bar and the card it
 * describes can never disagree about how bad a second was. Inline SVG rather
 * than a chart library -- it is one row of bars, an area and a line, and a
 * dependency would be the heaviest thing in the bundle for it.
 */

import type { MouseEvent } from 'react'

import type { TimelineStep } from '../api/types'
import { tintFor } from '../simulation-results/statusStyles'
import { layoutTimeline, sampleIndexAt } from './timelineGeometry'

/** ViewBox size. The SVG stretches to the card's width; the height is fixed. */
const WIDTH = 240
const HEIGHT = 56

/** Gap either side of a bar, in viewBox units, so adjacent seconds read as separate. */
const BAR_GAP = 0.6

export interface TimelineStripProps {
  timeline: readonly TimelineStep[]
  worstIndex: number
  /** The level's latency cap, drawn as a dashed line. */
  capMs: number
  /** The second under the pointer, or null when the pointer is elsewhere. */
  focusedIndex: number | null
  /**
   * Hovering a second replays it: the canvas and the headline figure show that
   * sample instead of the worst one. Called with null when the pointer leaves.
   */
  onScrub: (index: number | null) => void
}

/**
 * The offered-rate area as a staircase: each second is a flat tread, so a
 * burst reads as a block and a ramp as a climb, rather than both smearing
 * into slopes between samples.
 */
function ratePath(samples: ReturnType<typeof layoutTimeline>['samples']): string {
  const treads = samples
    .map((s) => `L ${s.x} ${s.rateY} L ${s.x + s.width} ${s.rateY}`)
    .join(' ')
  return `M 0 ${HEIGHT} ${treads} L ${WIDTH} ${HEIGHT} Z`
}

function describe(timeline: readonly TimelineStep[], worstIndex: number): string {
  const saturated = timeline.filter((step) => step.total_latency_ms === null)
  const recovering = timeline.filter(
    (step) =>
      step.total_latency_ms !== null && step.nodes.some((node) => node.backlog > 0),
  )
  const window = `${timeline.length} seconds of traffic`
  const worst = `worst second t = ${timeline[worstIndex]?.t_seconds ?? 0} s`
  if (saturated.length === 0) {
    return `${window}, never saturated; ${worst}.`
  }
  const tail =
    recovering.length === 0 ? '' : `, then draining for ${recovering.length} s`
  return `${window}, saturated for ${saturated.length} s from t = ${saturated[0]!.t_seconds} s${tail}; ${worst}.`
}

export function TimelineStrip({
  timeline,
  worstIndex,
  capMs,
  focusedIndex,
  onScrub,
}: TimelineStripProps) {
  const layout = layoutTimeline(timeline, worstIndex, capMs, WIDTH, HEIGHT)
  const lastSecond = timeline[timeline.length - 1]?.t_seconds ?? 0
  const focused = focusedIndex === null ? null : layout.samples[focusedIndex]

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const index = sampleIndexAt(
      (event.clientX - bounds.left) / bounds.width,
      timeline.length,
    )
    // Only report crossings: mousemove fires many times per column, and each
    // call re-renders the canvas.
    if (index !== focusedIndex) {
      onScrub(index)
    }
  }

  return (
    <div className="mt-2.5">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        preserveAspectRatio="none"
        role="img"
        aria-label={describe(timeline, worstIndex)}
        className="block cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => onScrub(null)}
      >
        <path
          d={ratePath(layout.samples)}
          fill="color-mix(in srgb, var(--color-accent) 16%, transparent)"
        />
        {focused ? (
          <rect
            x={focused.x}
            y={0}
            width={focused.width}
            height={HEIGHT}
            fill="color-mix(in srgb, var(--color-text) 12%, transparent)"
          />
        ) : null}
        {layout.samples.map((sample, index) => (
          <rect
            key={index}
            x={sample.x + BAR_GAP}
            y={HEIGHT - sample.barHeight}
            width={Math.max(0, sample.width - BAR_GAP * 2)}
            height={sample.barHeight}
            fill={tintFor(sample.status)}
            // While one second is under the pointer the others step back, so
            // the canvas and the bar it is showing read as one thing.
            opacity={focusedIndex === null || focusedIndex === index ? 1 : 0.55}
            // The worst second is what the headline figure describes; the
            // outline ties the number to its bar.
            stroke={sample.isWorst ? 'var(--color-text)' : 'none'}
            strokeWidth={sample.isWorst ? 1 : 0}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={0}
          x2={WIDTH}
          y1={layout.capY}
          y2={layout.capY}
          stroke="var(--color-neutral-500)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-neutral-500">
        <span>0 s</span>
        <span>cap {capMs} ms</span>
        <span>{lastSecond} s</span>
      </div>
    </div>
  )
}
