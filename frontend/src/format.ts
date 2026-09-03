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
  // Sub-millisecond latencies are common and interesting here (a load balancer
  // at 0.025 ms), so small values need more decimals, not fewer.
  if (milliseconds < 1) {
    return `${milliseconds.toFixed(3)} ms`
  }
  if (milliseconds < 100) {
    return `${milliseconds.toFixed(2)} ms`
  }
  return `${Math.round(milliseconds)} ms`
}

/** Requests per second, with thousands separators and no spurious decimals. */
export function formatRate(requestsPerSecond: number): string {
  return `${Math.round(requestsPerSecond).toLocaleString()} rps`
}

/** Utilisation as a percentage. Values above 100% are real and worth showing. */
export function formatUtilization(utilization: number): string {
  return `${(utilization * 100).toFixed(1)}%`
}
