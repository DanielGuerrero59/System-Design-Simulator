/**
 * TypeScript mirrors of the backend's Pydantic schemas.
 *
 * These are hand-maintained against `backend/app/schemas.py`. If a field is
 * added or renamed there, it must be changed here too -- there is no code
 * generation step. Keeping them in one small file makes that drift easy to spot
 * during review.
 *
 * Field names are snake_case rather than the usual TypeScript camelCase because
 * they are the wire format. Renaming them here would mean a translation layer
 * whose only job is cosmetic, and every mismatch would become a silent
 * `undefined` at runtime instead of a compile error.
 */

/** Mirrors ComponentType in backend/app/simulation/constants.py. */
export type ComponentType =
  | 'load_balancer'
  | 'app_server'
  | 'database'
  | 'cache'
  | 'message_queue'

/**
 * Mirrors NodeStatus. Ordered here from healthiest to worst, which is also the
 * order the utilisation thresholds produce.
 */
export type NodeStatus = 'healthy' | 'warning' | 'critical' | 'saturated'

// --- Request ---------------------------------------------------------------

export interface NodeConfig {
  /** Instances of this component. Traffic splits evenly across them. */
  replicas?: number
  /** Overrides the type's default service rate. Omit to use the default. */
  service_rate_rps?: number | null
  /** Cache only. Fraction of requests served without hitting what's behind it. */
  hit_ratio?: number | null
}

export interface DesignNode {
  id: string
  type: ComponentType
  config?: NodeConfig
}

export interface DesignEdge {
  source: string
  target: string
}

/** Mirrors TrafficKind. */
export type TrafficKind = 'steady' | 'spike' | 'ramp'

/** One rate held for the whole run. `kind` may be omitted: steady is the default. */
export interface SteadyTraffic {
  kind?: 'steady'
  requests_per_second: number
}

/**
 * A baseline with one burst. The burst is the half-open window
 * [peak_start_seconds, peak_start_seconds + peak_seconds); the window fields
 * fall back to the backend's defaults when omitted.
 */
export interface SpikeTraffic {
  kind: 'spike'
  baseline_rps: number
  /** Must exceed baseline_rps. */
  peak_rps: number
  duration_seconds?: number
  peak_start_seconds?: number
  peak_seconds?: number
}

/** A straight line from start_rps at t = 0 to end_rps at t = duration. */
export interface RampTraffic {
  kind: 'ramp'
  start_rps: number
  end_rps: number
  duration_seconds?: number
}

export type TrafficPattern = SteadyTraffic | SpikeTraffic | RampTraffic

export interface SimulationRequest {
  nodes: DesignNode[]
  edges: DesignEdge[]
  traffic: TrafficPattern
}

// --- Response --------------------------------------------------------------

export interface NodeResult {
  node_id: string
  /** Effective lambda reaching this component, after upstream cache hits. */
  arrival_rate_rps: number
  /** Effective mu across all replicas. */
  service_rate_rps: number
  /** rho = lambda / mu. Values >= 1 mean the queue grows without bound. */
  utilization: number
  /**
   * Null when saturated. The backend deliberately never sends a number here for
   * an overloaded component, because the true value is infinite rather than
   * large -- so the UI must render "overloaded", never a figure.
   */
  latency_ms: number | null
  status: NodeStatus
}

/** What the backend concluded about the whole design at one offered rate. */
export interface StepResult {
  is_stable: boolean
  /** Null when unstable, for the same reason as NodeResult.latency_ms. */
  total_latency_ms: number | null
  bottleneck_node_id: string | null
  nodes: NodeResult[]
}

/** One sample of the timeline: the rate that arrived, and what it did. */
export interface TimelineStep extends StepResult {
  t_seconds: number
  offered_rps: number
}

export interface TrafficSummary {
  kind: TrafficKind
  /** Time of the last sample; 0 for a steady rate, which is a single sample. */
  duration_seconds: number
  peak_rps: number
  /**
   * Index into `timeline` of the sample the top-level fields describe: the one
   * whose busiest component is closest to, or furthest past, saturation.
   */
  worst_step_index: number
  saturated_seconds: number
}

/**
 * The top-level fields are the WORST sample of the timeline -- for a steady
 * rate the only one, which is why code written against the single-rate
 * contract keeps reading them unchanged. Every sample is in `timeline`, each
 * an independent steady state: no queue carries over between seconds.
 */
export interface SimulationResponse extends StepResult {
  traffic: TrafficSummary
  timeline: TimelineStep[]
}
