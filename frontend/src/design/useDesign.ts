/**
 * The diagram store: everything the user has drawn, and nothing else.
 *
 * Simulation results are deliberately absent. They live in `useSimulation`, and
 * the two are joined only at render time. The link between them is `revision`:
 * a counter this hook bumps whenever the design changes in a way that would
 * change the numbers, which is what lets a result be marked stale rather than
 * left on screen describing a design that no longer exists.
 *
 * Moving a node does not bump it. Position is pure presentation -- the request
 * body does not even carry it -- so dragging a box two pixels should not
 * invalidate a perfectly good answer.
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
import { COMPONENT_CATALOG } from './catalog'
import { buildAdjacency, canReach, dedupeEdges } from './graph'
import { MAX_EDGES, MAX_LABEL_LENGTH, MAX_NODES } from './limits'
import type { DesignEdge, DesignNode, DesignNodeData } from './types'

/** Where a click-to-add node lands, laid out in rows so they never stack. */
const GRID_COLUMNS = 4
const GRID_SPACING_X = 230
const GRID_SPACING_Y = 150
const GRID_ORIGIN: XYPosition = { x: 60, y: 60 }

/**
 * Edges carry an arrowhead because direction is the whole point: this is a
 * request path, not an association.
 */
const EDGE_DEFAULTS = {
  animated: true,
  markerEnd: { type: 'arrowclosed' as const, width: 18, height: 18 },
} satisfies Partial<DesignEdge>

function createNodeData(componentType: ComponentType): DesignNodeData {
  return {
    componentType,
    label: COMPONENT_CATALOG[componentType].label,
    replicas: 1,
    serviceRateRps: null,
    hitRatio: null,
  }
}

function createNode(
  id: string,
  componentType: ComponentType,
  position: XYPosition,
): DesignNode {
  return { id, type: 'component', position, data: createNodeData(componentType) }
}

function gridPosition(index: number): XYPosition {
  return {
    x: GRID_ORIGIN.x + (index % GRID_COLUMNS) * GRID_SPACING_X,
    y: GRID_ORIGIN.y + Math.floor(index / GRID_COLUMNS) * GRID_SPACING_Y,
  }
}

/** Counters the generated ids start from, matching the seed design below. */
function initialIdCounters(): Map<ComponentType, number> {
  return new Map([
    ['load_balancer', 1],
    ['app_server', 1],
    ['database', 1],
  ])
}

/**
 * The canonical teaching design, so the canvas is never an empty page. At
 * 1,500 rps it holds; at 10,000 the app tier falls over and the cache the user
 * has not added yet starts to look like a good idea.
 */
function initialNodes(): DesignNode[] {
  return [
    createNode('lb-1', 'load_balancer', { x: 40, y: 140 }),
    createNode('api-1', 'app_server', { x: 290, y: 140 }),
    createNode('db-1', 'database', { x: 540, y: 140 }),
  ]
}

function initialEdges(): DesignEdge[] {
  return [
    { id: 'lb-1->api-1', source: 'lb-1', target: 'api-1', ...EDGE_DEFAULTS },
    { id: 'api-1->db-1', source: 'api-1', target: 'db-1', ...EDGE_DEFAULTS },
  ]
}

/**
 * Changes React Flow reports that leave the simulation answer untouched.
 * Anything else -- add, remove, replace -- means the graph itself moved.
 */
function isCosmeticNodeChange(change: NodeChange<DesignNode>): boolean {
  return (
    change.type === 'position' ||
    change.type === 'dimensions' ||
    change.type === 'select'
  )
}

function isCosmeticEdgeChange(change: EdgeChange<DesignEdge>): boolean {
  return change.type === 'select'
}

export interface DesignStore {
  nodes: DesignNode[]
  edges: DesignEdge[]
  /** Bumped on every change that could change the simulation answer. */
  revision: number
  onNodesChange: (changes: NodeChange<DesignNode>[]) => void
  onEdgesChange: (changes: EdgeChange<DesignEdge>[]) => void
  onConnect: (connection: Connection) => void
  /** Rejects self-connections and anything that would close a cycle. */
  isValidConnection: (connection: Connection | DesignEdge) => boolean
  addNode: (componentType: ComponentType, position?: XYPosition) => void
  removeNode: (nodeId: string) => void
  /** Config edits. Bumps the revision -- these change the numbers. */
  updateNodeConfig: (
    nodeId: string,
    patch: Partial<Omit<DesignNodeData, 'componentType' | 'label'>>,
  ) => void
  /** Renames are cosmetic, so results stay valid. */
  renameNode: (nodeId: string, label: string) => void
  reset: () => void
  atNodeLimit: boolean
}

export function useDesign(): DesignStore {
  const [nodes, setNodes, applyNodeChanges] = useNodesState<DesignNode>(
    initialNodes(),
  )
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<DesignEdge>(
    initialEdges(),
  )
  const [revision, setRevision] = useState(0)

  // Per-type counters, never decremented, so deleting "db-1" and adding another
  // database gives "db-2". Reusing an id would silently attach the deleted
  // node's simulation result to the new one.
  const idCountersRef = useRef<Map<ComponentType, number>>(initialIdCounters())

  const bumpRevision = useCallback(() => {
    setRevision((current) => current + 1)
  }, [])

  const nextNodeId = useCallback((componentType: ComponentType): string => {
    const next = (idCountersRef.current.get(componentType) ?? 0) + 1
    idCountersRef.current.set(componentType, next)
    return `${COMPONENT_CATALOG[componentType].idPrefix}-${next}`
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange<DesignNode>[]) => {
      applyNodeChanges(changes)
      if (!changes.every(isCosmeticNodeChange)) {
        bumpRevision()
      }
    },
    [applyNodeChanges, bumpRevision],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<DesignEdge>[]) => {
      applyEdgeChanges(changes)
      if (!changes.every(isCosmeticEdgeChange)) {
        bumpRevision()
      }
    },
    [applyEdgeChanges, bumpRevision],
  )

  // Derived once per graph change rather than per connection attempt, since
  // React Flow asks isValidConnection on every pointer move while a user is
  // dragging a new edge around.
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
      // already reach the source. Refusing it here means the user cannot draw a
      // design the engine would reject, rather than finding out on submit.
      return !canReach(adjacency, connection.target, connection.source)
    },
    [adjacency],
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      // React Flow already consults isValidConnection while dragging, but
      // onConnect is a public entry point of this store: checking again means a
      // programmatic caller cannot introduce a cycle behind the UI back.
      if (!isValidConnection(connection)) {
        return
      }
      setEdges((current) =>
        current.length >= MAX_EDGES
          ? current
          : addEdge({ ...connection, ...EDGE_DEFAULTS }, current),
      )
      bumpRevision()
    },
    [bumpRevision, isValidConnection, setEdges],
  )

  const atNodeLimit = nodes.length >= MAX_NODES

  const addNode = useCallback(
    (componentType: ComponentType, position?: XYPosition) => {
      if (atNodeLimit) {
        return
      }
      const id = nextNodeId(componentType)
      setNodes((current) =>
        current.length >= MAX_NODES
          ? current
          : [
              ...current,
              createNode(
                id,
                componentType,
                position ?? gridPosition(current.length),
              ),
            ],
      )
      bumpRevision()
    },
    [atNodeLimit, bumpRevision, nextNodeId, setNodes],
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
      bumpRevision()
    },
    [bumpRevision, setEdges, setNodes],
  )

  const updateNodeConfig = useCallback(
    (
      nodeId: string,
      patch: Partial<Omit<DesignNodeData, 'componentType' | 'label'>>,
    ) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, ...patch } }
            : node,
        ),
      )
      bumpRevision()
    },
    [bumpRevision, setNodes],
  )

  const renameNode = useCallback(
    (nodeId: string, label: string) => {
      const trimmed = label.slice(0, MAX_LABEL_LENGTH)
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, label: trimmed } }
            : node,
        ),
      )
      // No revision bump: a name is not an input to the queueing model, so the
      // last result still describes this design faithfully.
    },
    [setNodes],
  )

  const reset = useCallback(() => {
    idCountersRef.current = initialIdCounters()
    setNodes(initialNodes())
    setEdges(initialEdges())
    bumpRevision()
  }, [bumpRevision, setEdges, setNodes])

  return {
    nodes,
    edges,
    revision,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    addNode,
    removeNode,
    updateNodeConfig,
    renameNode,
    reset,
    atNodeLimit,
  }
}
