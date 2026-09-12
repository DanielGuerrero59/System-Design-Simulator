/**
 * Where the two stores meet.
 *
 * The canvas needs to colour a node by how busy it is, but the design store
 * must not learn that a simulation ever happened -- otherwise "what the player
 * drew" and "what the backend returned" fuse into one object and the staleness
 * distinction dies. So results reach nodes through context instead of through
 * node data: a lookup the node reads at render time and owns no part of.
 */

import { createContext, use } from 'react'

import type { NodeResult } from '../api/types'

export interface OutcomeLookup {
  byNodeId: Map<string, NodeResult>
  /** False while the traffic is stopped, so nodes render their idle state. */
  isLive: boolean
}

export const NO_OUTCOMES: OutcomeLookup = {
  byNodeId: new Map(),
  isLive: false,
}

const OutcomeContext = createContext<OutcomeLookup>(NO_OUTCOMES)

export const OutcomeProvider = OutcomeContext.Provider

/** Read the result for one node, or null if the traffic is not running. */
export function useNodeOutcome(nodeId: string): NodeResult | null {
  const lookup = use(OutcomeContext)
  if (!lookup.isLive) {
    return null
  }
  return lookup.byNodeId.get(nodeId) ?? null
}
