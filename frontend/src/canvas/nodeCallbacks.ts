/**
 * How a node card reaches the design store.
 *
 * The obvious alternatives are both worse. Putting callbacks in node `data`
 * makes handler identity part of the design, and the design is meant to be the
 * drawing alone. Building `nodeTypes` from a closure over the store rebuilds
 * the node component on every render, and React Flow treats a new component
 * type as a different type -- so every node remounts, which drops the drag
 * gesture the player is in the middle of.
 *
 * Context avoids both: one stable module-level node component, with the
 * handlers delivered underneath it.
 */

import { createContext, use } from 'react'

export interface NodeCallbacks {
  onRemove: (nodeId: string) => void
  onReplicasChange: (nodeId: string, replicas: number) => void
}

const NodeCallbacksContext = createContext<NodeCallbacks>({
  onRemove: () => {},
  onReplicasChange: () => {},
})

export const NodeCallbacksProvider = NodeCallbacksContext.Provider

export function useNodeCallbacks(): NodeCallbacks {
  return use(NodeCallbacksContext)
}
