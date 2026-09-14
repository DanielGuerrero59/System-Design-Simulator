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
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { SimulationApiError, simulate } from '../api/client'
import type { SimulationRequest, SimulationResponse } from '../api/types'

/**
 * How long to wait after the last change before asking the backend.
 *
 * Short enough that dragging the dial feels like it is driving the numbers,
 * long enough that a drag across the whole track is a handful of requests
 * rather than one per pixel.
 */
const DEBOUNCE_MS = 150

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

  const abortRef = useRef<AbortController | null>(null)

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

    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      simulate(JSON.parse(requestKey) as SimulationRequest, controller.signal)
        .then((response) => {
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
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [isRunning, requestKey])

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
