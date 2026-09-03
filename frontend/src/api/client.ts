/**
 * The only module in the app that calls fetch().
 *
 * Keeping HTTP here means components never deal with status codes, JSON
 * parsing, or the two different error shapes the backend can return -- they get
 * either a SimulationResponse or a thrown SimulationApiError with a message
 * already fit to show a user.
 */

import type { SimulationRequest, SimulationResponse } from './types'

/**
 * Overridable so a deployed build can point at the real backend. Vite inlines
 * VITE_-prefixed variables at build time, so this is baked into the bundle
 * rather than read at runtime.
 */
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

export class SimulationApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property. This template enables `erasableSyntaxOnly`, which bans TypeScript
  // syntax that emits runtime code -- parameter properties, enums, namespaces --
  // so that types can be stripped rather than compiled.
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SimulationApiError'
    this.status = status
  }
}

/** One entry in FastAPI's validation-error array. */
interface ValidationErrorItem {
  loc?: (string | number)[]
  msg?: string
}

/**
 * Turn a FastAPI error body into one readable sentence.
 *
 * The backend returns `detail` in two shapes, and they mean different things:
 * a plain string for a structurally invalid design (raised by the engine as a
 * SimulationError), or an array of per-field objects for a schema validation
 * failure. Both arrive as 422, so the shape is the only way to tell them apart.
 */
function describeError(body: unknown, status: number): string {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    return `Request failed with status ${status}.`
  }

  const detail = (body as { detail: unknown }).detail

  if (typeof detail === 'string') {
    return detail
  }

  if (Array.isArray(detail)) {
    return (
      detail
        .map((item: ValidationErrorItem) => {
          // Drop the leading "body" segment, which is noise to a reader.
          const path = (item.loc ?? []).slice(1).join('.')
          const message = item.msg ?? 'is invalid'
          return path ? `${path}: ${message}` : message
        })
        .join('; ') || `Request failed with status ${status}.`
    )
  }

  return `Request failed with status ${status}.`
}

/**
 * Run a design against a traffic rate.
 *
 * Throws SimulationApiError for anything that is not a 200, including network
 * failures, so callers have exactly one failure path to handle.
 */
export async function simulate(
  request: SimulationRequest,
  signal?: AbortSignal,
): Promise<SimulationResponse> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    })
  } catch (cause) {
    // An aborted request is the caller superseding it, not a failure worth
    // surfacing -- let it propagate untouched so callers can ignore it.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause
    }
    // fetch only rejects for network-level problems. In a browser a CORS
    // rejection looks identical to the server being down, so the message has to
    // cover both without guessing.
    throw new SimulationApiError(
      `Could not reach the simulation API at ${API_BASE_URL}. ` +
        'Check that the backend is running and that this origin is allowed.',
      0,
    )
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new SimulationApiError(describeError(body, response.status), response.status)
  }

  return (await response.json()) as SimulationResponse
}

/** Exposed so the UI can tell the user where it is pointing. */
export { API_BASE_URL }
