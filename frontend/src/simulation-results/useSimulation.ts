/**
 * The result store: what the backend last said, and whether it still applies.
 *
 * Kept apart from `useDesign` on purpose. The design is what the user drew; a
 * result is a claim about one particular version of it. Holding the revision
 * the run was made against is what lets this hook say "these numbers describe
 * an older design" instead of quietly presenting them as current.
 *
 * Concurrency is handled here rather than by disabling the button, because a
 * disabled button is not a guarantee: a slow first request can still land after
 * a fast second one and overwrite it. Every run gets a sequence number, and
 * only the newest one is allowed to write state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { SimulationApiError, simulate } from '../api/client'
import type { SimulationRequest, SimulationResponse } from '../api/types'

interface RunOutcome {
  result: SimulationResponse | null
  error: string | null
  /** The design revision this run was made against. */
  revision: number
}

export interface SimulationStore {
  result: SimulationResponse | null
  error: string | null
  isRunning: boolean
  /** True when the design has moved on since the last completed run. */
  isStale: boolean
  /** True once anything -- a result or an error -- has come back. */
  hasRun: boolean
  run: (request: SimulationRequest, revision: number) => void
  clear: () => void
}

/**
 * @param designRevision the design store's current revision, used only to
 * decide whether the last result is still current.
 */
export function useSimulation(designRevision: number): SimulationStore {
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  // Monotonic, and also the "is this run still wanted?" token. Bumping it is
  // how both a newer run and unmounting invalidate an in-flight one.
  const latestRunRef = useRef(0)

  useEffect(() => {
    return () => {
      latestRunRef.current += 1
      controllerRef.current?.abort()
    }
  }, [])

  const run = useCallback((request: SimulationRequest, revision: number) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    const runId = latestRunRef.current + 1
    latestRunRef.current = runId
    const isCurrent = () => latestRunRef.current === runId

    setIsRunning(true)

    // Deliberately not awaited: callers are event handlers, and every outcome
    // -- including failure -- is already funnelled into state below.
    void (async () => {
      try {
        const result = await simulate(request, controller.signal)
        if (isCurrent()) {
          setOutcome({ result, error: null, revision })
        }
      } catch (cause) {
        if (!isCurrent()) {
          return
        }
        setOutcome({
          result: null,
          error:
            cause instanceof SimulationApiError
              ? cause.message
              : 'Something went wrong running the simulation.',
          revision,
        })
      } finally {
        // Only the newest run owns the spinner. A superseded run clearing it
        // would report "done" while a later request is still in the air.
        if (isCurrent()) {
          setIsRunning(false)
        }
      }
    })()
  }, [])

  const clear = useCallback(() => {
    // Invalidate anything in flight too, or it would land after the clear and
    // repopulate the panel the user just emptied.
    latestRunRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setOutcome(null)
    setIsRunning(false)
  }, [])

  return {
    result: outcome?.result ?? null,
    error: outcome?.error ?? null,
    isRunning,
    isStale: outcome !== null && outcome.revision !== designRevision,
    hasRun: outcome !== null,
    run,
    clear,
  }
}
