/**
 * One place that turns a backend NodeStatus into colour.
 *
 * A lookup keyed by the status union rather than a chain of conditionals, so
 * adding a status to the backend enum (and to `api/types.ts`) shows up here as
 * a missing-property type error instead of a component that silently renders
 * uncoloured.
 *
 * Class names are spelled out in full because Tailwind v4 scans source text for
 * complete names -- `border-status-${status}` would compile to no CSS at all.
 */

import type { NodeStatus } from '../api/types'

export interface StatusStyle {
  /** Short label for a badge. */
  text: string
  /** One line on what this status means, for a tooltip or legend. */
  meaning: string
  /** Badge: tinted background, readable text, matching border. */
  badgeClassName: string
  /** Node outline on the canvas. */
  nodeClassName: string
  /** Fill for the utilisation bar. */
  barClassName: string
}

export const STATUS_STYLES: Record<NodeStatus, StatusStyle> = {
  healthy: {
    text: 'healthy',
    meaning: 'Comfortable. Queueing delay is negligible here.',
    badgeClassName:
      'bg-status-healthy/15 text-status-healthy border-status-healthy/40',
    nodeClassName: 'border-status-healthy/60',
    barClassName: 'bg-status-healthy',
  },
  warning: {
    text: 'warning',
    meaning: 'Past 70% busy. Queueing delay is now a real part of the latency.',
    badgeClassName:
      'bg-status-warning/15 text-status-warning border-status-warning/40',
    nodeClassName: 'border-status-warning/70',
    barClassName: 'bg-status-warning',
  },
  critical: {
    text: 'critical',
    meaning:
      'Past 85% busy. A small traffic increase now causes a large latency increase.',
    badgeClassName:
      'bg-status-critical/15 text-status-critical border-status-critical/40',
    nodeClassName: 'border-status-critical/80',
    barClassName: 'bg-status-critical',
  },
  saturated: {
    text: 'saturated',
    meaning:
      'Arrivals exceed capacity. The queue grows without bound, so latency is undefined.',
    badgeClassName:
      'bg-status-saturated/20 text-status-saturated border-status-saturated/50',
    nodeClassName: 'border-status-saturated',
    barClassName: 'bg-status-saturated',
  },
}
