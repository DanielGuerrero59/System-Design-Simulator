/**
 * The heat ramp: one status, one colour, everywhere.
 *
 * Keyed by the backend's own NodeStatus so colouring a component is a lookup
 * rather than a chain of threshold comparisons repeated in every file that
 * draws something. The boundaries those statuses correspond to -- rho 0.70 for
 * warning, 0.85 for critical, 1.0 for saturated -- are decided in
 * `backend/app/simulation/constants.py` and are deliberately not restated here.
 *
 * The values are CSS variables rather than Tailwind class names because the
 * same colour has to reach places utilities cannot go: an SVG `stroke` on a
 * React Flow edge, and a `box-shadow` built by string concatenation.
 */

import type { NodeStatus } from '../api/types'

/** What a component is tinted while the traffic is stopped. */
export const IDLE_TINT = 'var(--color-neutral-400)'

const STATUS_TINTS: Record<NodeStatus, string> = {
  healthy: 'var(--color-status-healthy)',
  warning: 'var(--color-status-warning)',
  critical: 'var(--color-status-critical)',
  saturated: 'var(--color-status-saturated)',
}

export function tintFor(status: NodeStatus): string {
  return STATUS_TINTS[status]
}

/**
 * Whether a component should shake.
 *
 * Reserved for the two states that are genuinely alarming. A warning node is
 * busy but fine, and making every busy node judder would leave the player no
 * way to see which one is actually in trouble.
 */
export function isAlarming(status: NodeStatus): boolean {
  return status === 'critical' || status === 'saturated'
}
