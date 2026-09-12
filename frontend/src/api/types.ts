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

export interface TrafficPattern {
  requests_per_second: number
}

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

export interface SimulationResponse {
  is_stable: boolean
  /** Null when unstable, for the same reason as NodeResult.latency_ms. */
  total_latency_ms: number | null
  bottleneck_node_id: string | null
  nodes: NodeResult[]
}
