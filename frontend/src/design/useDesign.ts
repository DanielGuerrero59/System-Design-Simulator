/**
 * The diagram store: everything the player has drawn, and nothing else.
 *
 * Simulation results are deliberately absent -- they live in
 * `simulation-results/useSimulation.ts` and are joined to nodes at render time.
 * Staleness is decided there, by comparing the request a stored answer came
 * from against the request this design would send now.
 *
 * That comparison is why this store keeps no revision counter of its own. The
 * request body carries neither positions nor labels, so two designs that differ
 * only cosmetically serialise identically and a perfectly good answer survives
 * a node being dragged -- which is exactly the rule a hand-maintained counter
 * was there to approximate, without the risk of the two disagreeing.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react'

import type { ComponentType } from '../api/types'
import { levelAt } from '../game/levels'
import { COMPONENT_CATALOG } from './catalog'
import { buildAdjacency, canReach, dedupeEdges } from './graph'
import { MAX_EDGES, MAX_NODES, MAX_REPLICAS, MIN_REPLICAS } from './limits'
import type { DesignEdge, DesignNode, DesignNodeData } from './types'

/**
 * Where each component type lands on the canvas.
 *
 * Laid out left to right in the order traffic meets them, so a correct design
 * reads as a flow rather than as a heap the player has to untangle before they
 * can think about queueing. Caches and queues share a lane because they occupy
 * the same position in the path -- in front of the tier behind them.
 */
const LANE_X: Record<ComponentType, number> = {
  load_balancer: 0,
  app_server: 260,
  cache: 520,
  message_queue: 520,
  database: 780,
}

const LANE_ORIGIN_Y = 60
const LANE_PITCH_Y = 150

/** Edges carry an arrowhead because direction is the point: this is a request
    path, not an association. */
const EDGE_DEFAULTS = {
  markerEnd: { type: 'arrowclosed' as const, width: 16, height: 16 },
} satisfies Partial<DesignEdge>

function createNodeData(componentType: ComponentType): DesignNodeData {
  return {
    componentType,
    label: COMPONENT_CATALOG[componentType].label,
    replicas: 1,
    // Both left null so the backend applies its own defaults. The game never
    // overrides a service rate: the whole point is to design against the real
    // numbers rather than to negotiate them.
    serviceRateRps: null,
    hitRatio: null,
  }
}

/**
 * Put a new node in the first free slot of its lane.
 *
 * Counting the lane's occupants is the obvious version and it is wrong: delete
 * the middle of three databases and the count drops to two, so the next one is
 * placed at slot two -- directly on top of a card that is already there. What
 * matters is which slots are taken, not how many.
 *
 * Only slots this function itself would have chosen are considered occupied. A
 * node the player has dragged somewhere arbitrary is not on the grid any more,
 * so it cannot meaningfully reserve a slot, and treating its stray position as
 * one would push new parts into empty space for no visible reason.
 */
function nextPositionInLane(
  existing: readonly DesignNode[],
  componentType: ComponentType,
): XYPosition {
  const x = LANE_X[componentType]
  const taken = new Set(
    existing
      .filter((node) => node.position.x === x)
      .map((node) => (node.position.y - LANE_ORIGIN_Y) / LANE_PITCH_Y)
      .filter((slot) => Number.isInteger(slot) && slot >= 0),
  )

  let slot = 0
  while (taken.has(slot)) {
    slot += 1
  }
  return { x, y: LANE_ORIGIN_Y + slot * LANE_PITCH_Y }
}

function createNode(
  id: string,
  componentType: ComponentType,
  position: XYPosition,
): DesignNode {
  return {
    id,
    type: 'component',
    position,
    data: createNodeData(componentType),
  }
}

/**
 * Take the next id for a type and advance the counter.
 *
 * A free function over an explicit map rather than a hook, so the initial seed
 * can mint ids before any ref exists and `loadLevel` can mint them later from
 * the same counter -- one numbering scheme, two call sites, no duplicates.
 */
function mintIdFrom(
  counters: Map<ComponentType, number>,
  componentType: ComponentType,
): string {
  const next = (counters.get(componentType) ?? 0) + 1
  counters.set(componentType, next)
  return `${COMPONENT_CATALOG[componentType].idPrefix}-${next}`
}

/** Lay out one level's starting parts, numbering them from `counters`. */
function seedNodes(
  levelIndex: number,
  counters: Map<ComponentType, number>,
): DesignNode[] {
  const seeded: DesignNode[] = []
  for (const componentType of levelAt(levelIndex).seed) {
    seeded.push(
      createNode(
        mintIdFrom(counters, componentType),
        componentType,
        nextPositionInLane(seeded, componentType),
      ),
    )
  }
  return seeded
}

export interface DesignStore {
  nodes: DesignNode[]
  edges: DesignEdge[]
  onNodesChange: (changes: NodeChange<DesignNode>[]) => void
  onEdgesChange: (changes: EdgeChange<DesignEdge>[]) => void
  onConnect: (connection: Connection) => void
  /** Rejects self-connections and anything that would close a cycle. */
  isValidConnection: (connection: Connection | DesignEdge) => boolean
  addNode: (componentType: ComponentType) => void
  removeNode: (nodeId: string) => void
  /** Clamped to the backend's own replica bounds. */
  setReplicas: (nodeId: string, replicas: number) => void
  /** Clear the canvas and lay out the given level's starting parts. */
  loadLevel: (levelIndex: number) => void
  atNodeLimit: boolean
}

export function useDesign(initialLevelIndex: number): DesignStore {
  // Seeded through useState's lazy initialiser so it runs exactly once. Doing
  // this in a useMemo would mint ids during render -- and since minting mutates
  // the counter, a re-render React chose to discard would still have advanced
  // it, leaving gaps in the id sequence.
  const [initial] = useState(() => {
    const counters = new Map<ComponentType, number>()
    return { nodes: seedNodes(initialLevelIndex, counters), counters }
  })

  // Ids are minted from a counter that never resets within a session. Reusing
  // "db-1" after deleting a database would silently attach the dead node's
  // simulation result to the new one.
  const idCountersRef = useRef<Map<ComponentType, number>>(initial.counters)

  const mintId = useCallback((componentType: ComponentType): string => {
    return mintIdFrom(idCountersRef.current, componentType)
  }, [])

  const [nodes, setNodes, applyNodeChanges] = useNodesState<DesignNode>(
    initial.nodes,
  )
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<DesignEdge>([])
  const onNodesChange = applyNodeChanges
  const onEdgesChange = applyEdgeChanges

  // Derived once per graph change rather than per connection attempt: React
  // Flow asks isValidConnection on every pointer move while an edge is being
  // dragged around.
  const adjacency = useMemo(
    () =>
      buildAdjacency(
        nodes.map((node) => node.id),
        dedupeEdges(edges),
      ),
    [nodes, edges],
  )

  const isValidConnection = useCallback(
    (connection: Connection | DesignEdge) => {
      if (connection.source === connection.target) {
        return false
      }
      // A new source -> target edge closes a cycle exactly when the target can
      // already reach the source. Refusing it here means the player cannot draw
      // a design the engine would reject, rather than finding out on submit.
      return !canReach(adjacency, connection.target, connection.source)
    },
    [adjacency],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) {
        return
      }
      setEdges((current) =>
        current.length >= MAX_EDGES
          ? current
          : addEdge({ ...connection, ...EDGE_DEFAULTS }, current),
      )
    },
    [isValidConnection, setEdges],
  )

  const atNodeLimit = nodes.length >= MAX_NODES

  const addNode = useCallback(
    (componentType: ComponentType) => {
      setNodes((current) =>
        current.length >= MAX_NODES
          ? current
          : [
              ...current,
              createNode(
                mintId(componentType),
                componentType,
                nextPositionInLane(current, componentType),
              ),
            ],
      )
    },
    [mintId, setNodes],
  )

  const removeNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => current.filter((node) => node.id !== nodeId))
      // Dangling edges would outlive the node and then reference an id the
      // backend has never heard of, which is a 422 rather than a drawing bug.
      setEdges((current) =>
        current.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId,
        ),
      )
    },
    [setEdges, setNodes],
  )

  const setReplicas = useCallback(
    (nodeId: string, replicas: number) => {
      const clamped = Math.max(MIN_REPLICAS, Math.min(MAX_REPLICAS, replicas))
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, replicas: clamped } }
            : node,
        ),
      )
    },
    [setNodes],
  )

  const loadLevel = useCallback(
    (levelIndex: number) => {
      setNodes(seedNodes(levelIndex, idCountersRef.current))
      setEdges([])
    },
    [setEdges, setNodes],
  )

  return {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    addNode,
    removeNode,
    setReplicas,
    loadLevel,
    atNodeLimit,
  }
}
