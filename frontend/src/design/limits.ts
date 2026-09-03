/**
 * Client-side mirrors of the backend's input guardrails.
 *
 * These duplicate values in `backend/app/simulation/constants.py`. The backend
 * is the authority -- it rejects anything past these bounds with a 422 whatever
 * this file says -- but repeating them here lets the UI stop a user before the
 * round trip and, more usefully, put a real ceiling on a number input.
 *
 * Keep them in step by hand, the same way `api/types.ts` mirrors the schemas.
 */

/** Instances of one component. Traffic splits evenly across them. */
export const MIN_REPLICAS = 1
export const MAX_REPLICAS = 1_000

/** Ceilings on design size, so one request cannot hand the server huge work. */
export const MAX_NODES = 200
export const MAX_EDGES = 1_000

/** Offered load at the entry point. */
export const MAX_TRAFFIC_RPS = 10_000_000

/** Per-instance service-rate override. */
export const MAX_SERVICE_RATE_RPS = 10_000_000

/**
 * Labels are ours alone -- they never reach the backend, which keys everything
 * on node id. The cap exists so a pasted wall of text cannot blow out the node
 * box or the results table.
 */
export const MAX_LABEL_LENGTH = 32
