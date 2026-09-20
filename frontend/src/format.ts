/**
 * Display formatting for simulation numbers.
 *
 * The backend deliberately returns raw floats -- `999.9999999999998` for a 90%
 * cache on 10k rps is honest IEEE-754 arithmetic, not a bug. Rounding is a
 * presentation decision, so it lives here rather than in the API layer, where
 * it would destroy precision for every future consumer.
 */

/**
 * A latency figure and the unit it is in, chosen by size.
 *
 * Milliseconds up to a second, then seconds: a recovery tail is measured in
 * seconds, and "8001 ms" makes the reader do the division that "8.0 s" has
 * already done. Kept as two parts rather than one string because the panel
 * headline sets the figure and the unit in different type sizes.
 */
export interface LatencyParts {
  figure: string
  unit: 'ms' | 's'
}

/**
 * Below this the figure stays in milliseconds. The threshold is where rounding
 * to whole milliseconds would first print "1000", which reads worse than
 * "1.0 s" would.
 */
const SECONDS_FROM_MS = 999.5

export function latencyParts(milliseconds: number): LatencyParts {
  if (milliseconds >= SECONDS_FROM_MS) {
    const seconds = milliseconds / 1000
    // One decimal keeps 8.0 s and 8.4 s apart -- a second of a draining tail
    // -- while past a hundred seconds the decimal is noise.
    return {
      figure: seconds < 99.95 ? seconds.toFixed(1) : `${Math.round(seconds)}`,
      unit: 's',
    }
  }
  // Sub-millisecond latencies are common and interesting here (a load balancer
  // at 0.025 ms), so small values need more decimals, not fewer.
  if (milliseconds < 1) {
    return { figure: milliseconds.toFixed(3), unit: 'ms' }
  }
  if (milliseconds < 100) {
    return { figure: milliseconds.toFixed(2), unit: 'ms' }
  }
  return { figure: `${Math.round(milliseconds)}`, unit: 'ms' }
}

/**
 * Latency with its unit, or the saturated case.
 *
 * Null means the component's queue grows without bound, so there is no number
 * to show. Rendering a placeholder rather than `0` or `Infinity` is the whole
 * reason the API models this field as nullable.
 *
 * Shared by the objective row and, through `latencyParts`, the panel headline.
 * Two independent formatters drifted here once: the headline showed a seeded
 * Level 01 path as "0.385" while the objective beside it said "0.38" -- the
 * same quantity, two answers, a few inches apart.
 */
export function formatLatency(milliseconds: number | null): string {
  if (milliseconds === null) {
    return '∞' // infinity sign
  }
  const { figure, unit } = latencyParts(milliseconds)
  return `${figure} ${unit}`
}

/**
 * Latency for the node card, where there is room for four characters and no
 * more. The fuller formatter above serves the panel, which can afford three
 * decimals on a sub-millisecond figure; here that would wrap. Seconds are
 * short already and use the same parts, so the card and the panel agree on a
 * tail.
 */
export function formatShortLatency(milliseconds: number): string {
  if (milliseconds >= SECONDS_FROM_MS) {
    return formatLatency(milliseconds)
  }
  if (milliseconds < 10) {
    return `${milliseconds.toFixed(1)} ms`
  }
  return `${Math.round(milliseconds)} ms`
}

/** Requests per second, with thousands separators and no spurious decimals. */
export function formatRate(requestsPerSecond: number): string {
  return `${Math.round(requestsPerSecond).toLocaleString()} rps`
}

/** A backlog, as the count of requests waiting: "40,000 queued". */
export function formatQueue(requests: number): string {
  return `${Math.round(requests).toLocaleString()} queued`
}
