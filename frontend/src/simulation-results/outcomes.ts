/**
 * How a canvas node finds out how it did, without the design store holding on
 * to simulation results.
 *
 * The alternative -- writing each NodeResult into that node's React Flow `data`
 * -- would put backend output inside the store that describes what the user
 * drew, which is exactly the conflation this project set out to avoid. It would
 * also mean rebuilding every node object on every run just so React Flow could
 * diff them back apart.
 *
 * So results are published through context instead. `ComponentNode` reads its
 * own outcome by id; the design store never learns that a simulation happened.
 */

import { createContext, use } from 'react'

import type { NodeResult } from '../api/types'

export interface NodeOutcome {
  result: NodeResult
  /** Highest utilisation in the design -- the one worth fixing first. */
  isBottleneck: boolean
}

export interface OutcomeLookup {
  byNodeId: ReadonlyMap<string, NodeOutcome>
  /**
   * True when the design has changed since these numbers were produced. Nodes
   * stay coloured but visibly faded: erasing the last answer the moment a user
   * drags a box would take away the thing they are comparing against.
   */
  isStale: boolean
}

/** Empty, non-stale: what a node sees before the first run. */
export const NO_OUTCOMES: OutcomeLookup = {
  byNodeId: new Map(),
  isStale: false,
}

export const OutcomeContext = createContext<OutcomeLookup>(NO_OUTCOMES)

/** The verdict on one node, or null if it has none yet. */
export function useNodeOutcome(nodeId: string): NodeOutcome | null {
  return use(OutcomeContext).byNodeId.get(nodeId) ?? null
}

/** Whether the outcomes currently on screen describe an older design. */
export function useOutcomesAreStale(): boolean {
  return use(OutcomeContext).isStale
}
