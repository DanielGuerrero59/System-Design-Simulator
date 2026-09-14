/**
 * Display formatting for simulation numbers.
 *
 * The backend deliberately returns raw floats -- `999.9999999999998` for a 90%
 * cache on 10k rps is honest IEEE-754 arithmetic, not a bug. Rounding is a
 * presentation decision, so it lives here rather than in the API layer, where
 * it would destroy precision for every future consumer.
 */

/**
 * Latency in milliseconds, or the saturated case.
 *
 * Null means the component's queue grows without bound, so there is no number
 * to show. Rendering a placeholder rather than `0` or `Infinity` is the whole
 * reason the API models this field as nullable.
 */
export function formatLatency(milliseconds: number | null): string {
  if (milliseconds === null) {
    return '∞' // infinity sign
  }
  return `${formatLatencyFigure(milliseconds)} ms`
}

/**
 * The bare number, with no unit.
 *
 * Shared with the objective row, which prints the figure next to a cap that
 * carries the unit already. Two independent formatters drifted here once: the
 * panel headline showed a seeded Level 01 path as "0.385" while the objective
 * beside it said "0.38" -- the same quantity, two answers, a few inches apart.
 */
export function formatLatencyFigure(milliseconds: number): string {
  // Sub-millisecond latencies are common and interesting here (a load balancer
  // at 0.025 ms), so small values need more decimals, not fewer.
  if (milliseconds < 1) {
    return milliseconds.toFixed(3)
  }
  if (milliseconds < 100) {
    return milliseconds.toFixed(2)
  }
  return `${Math.round(milliseconds)}`
}

/** Requests per second, with thousands separators and no spurious decimals. */
export function formatRate(requestsPerSecond: number): string {
  return `${Math.round(requestsPerSecond).toLocaleString()} rps`
}
