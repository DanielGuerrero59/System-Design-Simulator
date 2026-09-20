/**
 * From a level's shape and the dial's peak to the wire format.
 *
 * The level owns the shape and the player owns the peak. That split keeps the
 * dial the one knob it has always been, keeps every level's tuning intact --
 * judged one steady state per second, the worst second is the peak, which is
 * the rate the levels were balanced at -- and leaves the request builder
 * knowing nothing about shapes.
 */

import type { TrafficKind, TrafficPattern } from '../api/types'
import type { Level } from './levels'

export function trafficFor(level: Level, peakRps: number): TrafficPattern {
  const shape = level.traffic

  switch (shape.kind) {
    case 'steady':
      // No `kind`: this is the body the API accepted before shapes existed,
      // and keeping it byte-identical keeps Level 01's request -- and the
      // result key derived from it -- exactly what it was.
      return { requests_per_second: peakRps }

    case 'spike':
      return {
        kind: 'spike',
        // Rounded: the serialised request is the result's identity, and a
        // baseline of 2999.9999999999995 would make a needlessly ugly key.
        baseline_rps: Math.round(peakRps * shape.baselineFraction),
        peak_rps: peakRps,
        duration_seconds: shape.durationSeconds,
        peak_start_seconds: shape.peakStartSeconds,
        peak_seconds: shape.peakSeconds,
      }

    case 'ramp':
      return {
        kind: 'ramp',
        start_rps: Math.round(peakRps * shape.startFraction),
        end_rps: peakRps,
        duration_seconds: shape.durationSeconds,
      }
  }
}

/** How the first objective phrases the target: "Serve 2,400 rps", "Peak of 9,000 rps". */
export const TARGET_VERB: Record<TrafficKind, string> = {
  steady: 'Serve',
  spike: 'Peak of',
  ramp: 'Ramp to',
}

/** The dial's caption in the header, so the number reads as what it is. */
export const DIAL_LABEL: Record<TrafficKind, string> = {
  steady: 'Traffic',
  spike: 'Burst peak',
  ramp: 'Ramp to',
}
