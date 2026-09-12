/**
 * The result store: what the backend last said, and whether it still applies.
 *
 * This hook holds no opinion about what the player drew -- it takes a request
 * body and a revision stamp, and reports back. Keeping it separate from the
 * design store is what makes "these numbers describe an earlier version of
 * your design" expressible at all.
 *
 * While the traffic is running it re-simulates continuously, which is the
 * behaviour the arcade framing needs: drag the dial and the colours move. Two
 * mechanisms keep that from turning into a request storm or a race.
 *
 *   Debounce. A burst of changes -- and dragging a slider is nothing but a
 *   burst of changes -- collapses into one request once the player pauses.
 *
 *   Supersession. Every in-flight request is aborted when a newer one starts,
 *   and each response is checked against the revision that is current when it
 *   lands. Without that second check a slow early response can arrive after a
 *   fast later one and overwrite good numbers with stale ones -- the classic
 *   out-of-order-response bug, which shows up here as colours that settle onto
 *   the wrong answer and stay there.
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
  /** Bumped by the design store whenever the numbers would change. */
  revision: number
}

export function useSimulation(input: SimulationInput): SimulationStore {
  const { request, revision } = input

  const [result, setResult] = useState<SimulationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  // The revision the newest request was built from. A response is only allowed
  // to land if this still matches what it was sent for.
  const inFlightRevisionRef = useRef<number | null>(null)

  // Serialised rather than depended on directly: `request` is a fresh object
  // every render, so using it as a dependency would restart the debounce on
  // every keystroke elsewhere in the app. The JSON is the thing that actually
  // determines the answer.
  const requestKey = request === null ? null : JSON.stringify(request)

  useEffect(() => {
    if (!isRunning || requestKey === null) {
      return
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      inFlightRevisionRef.current = revision

      simulate(JSON.parse(requestKey) as SimulationRequest, controller.signal)
        .then((response) => {
          // Landed after the player moved on: discard rather than overwrite.
          if (inFlightRevisionRef.current !== revision) {
            return
          }
          setResult(response)
          setError(null)
        })
        .catch((cause: unknown) => {
          // An abort is this hook superseding itself, not a failure the player
          // should ever see.
          if (cause instanceof DOMException && cause.name === 'AbortError') {
            return
          }
          if (inFlightRevisionRef.current !== revision) {
            return
          }
          setError(
            cause instanceof SimulationApiError
              ? cause.message
              : 'The simulation failed for an unknown reason.',
          )
          // The previous result described a design that no longer applies, so
          // it is cleared rather than left on screen looking authoritative.
          setResult(null)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [isRunning, requestKey, revision])

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
      setResult(null)
      setError(null)
    }
  }, [])

  // Derived during render rather than cleared from an effect. The moment the
  // design stops being simulatable, the last result describes a graph that no
  // longer exists -- so it is withheld immediately, in the same commit that
  // made it stale, instead of lingering for one frame while an effect catches
  // up. The stored value survives underneath: rewiring the missing edge brings
  // the numbers straight back without a round trip.
  const applicableResult = requestKey === null ? null : result

  return {
    result: applicableResult,
    error,
    isRunning,

    setRunning,
  }
}
