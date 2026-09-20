/**
 * The result store: what the backend last said, and whether it still applies.
 *
 * This hook holds no opinion about what the player drew -- it takes a request
 * body and reports back. Keeping it separate from the design store is what
 * makes "these numbers describe an earlier version of your design" expressible
 * at all.
 *
 * While the traffic is running it re-simulates continuously, which is the
 * behaviour the arcade framing needs: drag the dial and the colours move. Two
 * mechanisms keep that from turning into a request storm or a lie.
 *
 *   Debounce. A burst of changes -- and dragging a slider is nothing but a
 *   burst of changes -- collapses into one request once the player pauses.
 *
 *   Keying. Every stored answer carries the exact request that produced it, and
 *   is only published while that request is still the current one. That single
 *   rule covers both an out-of-order response overwriting a newer answer, and a
 *   previous answer being re-shown as live after the design has moved on.
 *
 * Keying has one consequence that needs its own mechanism. An error is keyed
 * like an answer, so a failure to *reach* the backend -- a redeploy in
 * progress, a cold start -- would stay on screen until the design or the dial
 * changed, however quickly the backend came back. So a transient failure is
 * retried on a backoff while the traffic is running, and the banner clears
 * itself with the first answer. A rejected design is not retried: the answer
 * would be the same.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { SimulationApiError, isTransientFailure, simulate } from '../api/client'
import type { SimulationRequest, SimulationResponse } from '../api/types'

/**
 * How long to wait after the last change before asking the backend.
 *
 * Short enough that dragging the dial feels like it is driving the numbers,
 * long enough that a drag across the whole track is a handful of requests
 * rather than one per pixel.
 */
const DEBOUNCE_MS = 150

/**
 * The wait before a transient failure is tried again, doubling per
 * consecutive failure. Two seconds catches the usual case -- a deploy
 * switching over -- on the first retry; the ceiling keeps a backend that is
 * down for the afternoon from being polled like a heartbeat.
 */
const RETRY_BASE_MS = 2_000
const RETRY_MAX_MS = 30_000

/** 2 s, 4 s, 8 s, 16 s, then 30 s for as long as it keeps failing. */
export function retryDelayMs(consecutiveFailures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** consecutiveFailures)
}

/** An answer, plus the exact request it is an answer to. */
interface Outcome {
  key: string
  response: SimulationResponse | null
  error: string | null
}

export interface SimulationStore {
  result: SimulationResponse | null
  error: string | null
  isRunning: boolean
  /** Turn the live loop on or off. */
  setRunning: (running: boolean) => void
}

export interface SimulationInput {
  /** Null when the design cannot be simulated -- the loop idles instead. */
  request: SimulationRequest | null
}

export function useSimulation(input: SimulationInput): SimulationStore {
  const { request } = input

  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  // Bumped to re-run the request after a transient failure. Only ever changes
  // from inside the effect below, on the timer it arms.
  const [attempt, setAttempt] = useState(0)

  const abortRef = useRef<AbortController | null>(null)
  // Consecutive transient failures of the *current* request, for the backoff.
  // Reset on success and whenever the request changes.
  const failuresRef = useRef(0)
  const failingKeyRef = useRef<string | null>(null)

  // Serialised rather than depended on directly: `request` is a fresh object
  // every render, so using it as a dependency would restart the debounce on
  // every unrelated re-render. The JSON is also exactly what determines the
  // answer -- positions and labels are not in it -- which is what makes it a
  // sound identity for the result as well as for the effect.
  const requestKey = request === null ? null : JSON.stringify(request)

  useEffect(() => {
    if (!isRunning || requestKey === null) {
      return
    }

    if (failingKeyRef.current !== requestKey) {
      failingKeyRef.current = requestKey
      failuresRef.current = 0
    }

    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      simulate(JSON.parse(requestKey) as SimulationRequest, controller.signal)
        .then((response) => {
          failuresRef.current = 0
          setOutcome({ key: requestKey, response, error: null })
        })
        .catch((cause: unknown) => {
          // An abort is this hook superseding itself, not a failure the player
          // should ever see.
          if (cause instanceof DOMException && cause.name === 'AbortError') {
            return
          }
          setOutcome({
            key: requestKey,
            response: null,
            error:
              cause instanceof SimulationApiError
                ? cause.message
                : 'The simulation failed for an unknown reason.',
          })
          if (isTransientFailure(cause)) {
            // The banner stays up meanwhile -- it says what is wrong -- and the
            // first answer takes it down. Bumping `attempt` re-runs this effect
            // with the same key, which is what makes the retry a retry.
            retryTimer = setTimeout(
              () => setAttempt((count) => count + 1),
              retryDelayMs(failuresRef.current),
            )
            failuresRef.current += 1
          }
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
      }
    }
  }, [isRunning, requestKey, attempt])

  // Abort whatever is in flight when the component goes away.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const setRunning = useCallback((running: boolean) => {
    setIsRunning(running)
    if (!running) {
      abortRef.current?.abort()
      setOutcome(null)
    }
  }, [])

  // The one place staleness is decided, and it decides it for the error as much
  // as for the numbers. A stored answer is published only while the request that
  // produced it is still the request the design would send now -- so a late
  // response for a superseded design is dropped on arrival rather than
  // overwriting a newer one, and an error raised against a design the player has
  // since changed stops being shown instead of pinning a red banner to the panel
  // with nothing in flight that could ever clear it.
  const isCurrent = outcome !== null && outcome.key === requestKey

  return {
    result: isCurrent ? outcome.response : null,
    error: isCurrent ? outcome.error : null,
    isRunning,
    setRunning,
  }
}
