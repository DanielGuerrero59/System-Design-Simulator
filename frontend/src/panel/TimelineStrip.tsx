/**
 * Latency second by second, drawn under the headline figure.
 *
 * Pure presentation: the layout comes from `timelineGeometry.ts` and the
 * colours from the same heat ramp as the canvas, so a bar and the card it
 * describes can never disagree about how bad a second was. Inline SVG rather
 * than a chart library -- it is one row of bars, an area and a line, and a
 * dependency would be the heaviest thing in the bundle for it.
 */

import type { TimelineStep } from '../api/types'
import { tintFor } from '../simulation-results/statusStyles'
import { layoutTimeline } from './timelineGeometry'

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
  const window = `${timeline.length} seconds of traffic`
  const worst = `worst second t = ${timeline[worstIndex]?.t_seconds ?? 0} s`
  if (saturated.length === 0) {
    return `${window}, never saturated; ${worst}.`
  }
  return `${window}, saturated for ${saturated.length} s from t = ${saturated[0]!.t_seconds} s; ${worst}.`
}

export function TimelineStrip({ timeline, worstIndex, capMs }: TimelineStripProps) {
  const layout = layoutTimeline(timeline, worstIndex, capMs, WIDTH, HEIGHT)
  const lastSecond = timeline[timeline.length - 1]?.t_seconds ?? 0

  return (
    <div className="mt-2.5">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        preserveAspectRatio="none"
        role="img"
        aria-label={describe(timeline, worstIndex)}
        className="block"
      >
        <path
          d={ratePath(layout.samples)}
          fill="color-mix(in srgb, var(--color-accent) 16%, transparent)"
        />
        {layout.samples.map((sample, index) => (
          <rect
            key={index}
            x={sample.x + BAR_GAP}
            y={HEIGHT - sample.barHeight}
            width={Math.max(0, sample.width - BAR_GAP * 2)}
            height={sample.barHeight}
            fill={tintFor(sample.status)}
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
