/**
 * The shape of the diagram the user draws.
 *
 * Note what is *not* here: nothing about latency, utilisation or status. A
 * design node knows only what the user chose. Simulation results live in their
 * own store (`simulation-results/`) and are joined to nodes at render time, so
 * "what the user drew" and "what the backend returned" can never drift into one
 * another -- and a result can be marked stale the moment the design moves on.
 */

import type { Edge, Node } from '@xyflow/react'

import type { ComponentType } from '../api/types'

/**
 * Per-node state. A `type` alias rather than an `interface` on purpose: React
 * Flow constrains node data to `Record<string, unknown>`, and TypeScript only
 * lets a type alias satisfy that index signature implicitly.
 */
export type DesignNodeData = {
  componentType: ComponentType
  /** Display name. Ours alone -- the API keys everything on node id. */
  label: string
  /** Instances. Traffic splits evenly across them. */
  replicas: number
  /** Per-instance service rate, or null to use the type's backend default. */
  serviceRateRps: number | null
  /** Cache only. Null uses the backend default hit ratio. */
  hitRatio: number | null
}

/** One component on the canvas. The literal type maps to `nodeTypes.component`. */
export type DesignNode = Node<DesignNodeData, 'component'>

/** A directed hop. React Flow's own Edge, with no extra data of our own. */
export type DesignEdge = Edge
