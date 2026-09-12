/**
 * The canvas: React Flow, dressed in Nocturne.
 *
 * React Flow owns dragging, panning, zooming and the mechanics of pulling an
 * edge from one port to another. What this module adds is the game's reading of
 * a design -- wires coloured and animated by how hard the component they feed
 * is working, so congestion is visible along the path and not only inside the
 * boxes.
 */

import { useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeTypes,
} from '@xyflow/react'

import { findEntryPoints } from '../design/graph'
import { dedupeEdges } from '../design/graph'
import type { DesignNode } from '../design/types'
import type { DesignStore } from '../design/useDesign'
import type { OutcomeLookup } from '../simulation-results/outcomes'
import { tintFor } from '../simulation-results/statusStyles'
import { ComponentNode } from './ComponentNode'
import { INGRESS_NODE_ID, INGRESS_SIZE } from './ingress'
import { IngressNode } from './IngressNode'
import { NodeCallbacksProvider } from './nodeCallbacks'

const IDLE_STROKE = 'var(--color-neutral-700)'

/** How far to the left of the entry component the traffic source sits. */
const INGRESS_OFFSET_X = 190
const INGRESS_OFFSET_Y = 18

/**
 * Defined once at module scope. React Flow compares node types by identity, so
 * a `nodeTypes` object rebuilt during render remounts every node on the canvas.
 */
const NODE_TYPES: NodeTypes = {
  component: ComponentNode,
  ingress: IngressNode,
}

/**
 * How fast the marching ants move, in seconds per cycle.
 *
 * Speed rises with utilisation, so a busy path visibly races -- except at
 * saturation, where it is deliberately slowed to a crawl. A queue that is
 * growing without bound is not moving traffic quickly; making it the fastest
 * animation on screen would say the opposite of what is happening.
 */
function flowDuration(utilization: number): number {
  if (utilization >= 1) {
    return 2.4
  }
  return Math.max(0.28, 1.1 - utilization)
}

export interface DesignCanvasProps {
  design: DesignStore
  outcomes: OutcomeLookup
  showGrid: boolean
}

export function DesignCanvas({
  design,
  outcomes,
  showGrid,
}: DesignCanvasProps) {
  const callbacks = useMemo(
    () => ({
      onRemove: design.removeNode,
      onReplicasChange: design.setReplicas,
    }),
    [design.removeNode, design.setReplicas],
  )

  // An edge is tinted by the component it feeds, not the one it leaves: the
  // interesting question about a hop is what it is about to hit.
  const styledEdges = useMemo<Edge[]>(() => {
    return design.edges.map((edge) => {
      const outcome = outcomes.isLive
        ? outcomes.byNodeId.get(edge.target)
        : undefined

      if (!outcome) {
        return {
          ...edge,
          style: { stroke: IDLE_STROKE, strokeWidth: 1.6 },
        }
      }

      const stroke = tintFor(outcome.status)
      return {
        ...edge,
        style: {
          stroke,
          strokeWidth: 2.4,
          strokeDasharray: '6 6',
          animation: `nx-flow ${flowDuration(outcome.utilization)}s linear infinite`,
        },
        markerEnd: { ...(edge.markerEnd as object), color: stroke },
      } as Edge
    })
  }, [design.edges, outcomes])

  // The traffic source, parked to the left of whichever component the engine
  // would treat as the entry point. Appended here rather than held in the
  // design store, so it is drawn without ever becoming part of the graph that
  // gets simulated. When the design has no single entry -- nothing drawn yet,
  // or two unconnected chains -- there is nothing truthful to point at, so it
  // is left off rather than guessing.
  const entryNodeId = useMemo(() => {
    const entries = findEntryPoints(
      design.nodes.map((node) => node.id),
      dedupeEdges(design.edges),
    )
    return entries.length === 1 ? entries[0] : null
  }, [design.nodes, design.edges])

  const nodesWithIngress = useMemo(() => {
    const entry = design.nodes.find((node) => node.id === entryNodeId)
    if (!entry) {
      return design.nodes
    }
    const ingress: DesignNode = {
      id: INGRESS_NODE_ID,
      // Cast: this node is display-only and never reaches the request builder,
      // so it carries none of the component data the design type describes.
      type: 'ingress' as DesignNode['type'],
      position: {
        x: entry.position.x - INGRESS_OFFSET_X,
        y: entry.position.y + INGRESS_OFFSET_Y,
      },
      // Given explicitly rather than measured. React Flow keeps a controlled
      // node `visibility: hidden` until its measured size has round-tripped
      // back through onNodesChange -- and this node is not in the design store,
      // so that trip never completes and it would stay invisible forever.
      // Stating the size skips the measurement entirely.
      width: INGRESS_SIZE.width,
      height: INGRESS_SIZE.height,
      draggable: false,
      selectable: false,
      deletable: false,
      data: {} as DesignNode['data'],
    }
    return [ingress, ...design.nodes]
  }, [design.nodes, entryNodeId])

  // Bring newly placed parts, and the traffic source, into view.
  //
  // Two things move content outside the viewport. Parts are laid out in fixed
  // lanes, so one dropped into a lane the camera is not over lands off-screen --
  // the player clicks "App server", nothing appears, and it is really sitting
  // behind the parts bin. And the traffic source is parked to the left of the
  // entry component, so it relocates whenever the entry changes -- wiring an app
  // server in front of the database moves it a lane left, off the edge, with no
  // change in node count to notice.
  //
  // Refitting on those two events only keeps the camera still during the
  // ordinary work of wiring and dragging, and on delete, where yanking the view
  // around would be disorienting.
  const { fitView } = useReactFlow()
  const nodeCount = design.nodes.length
  const previousFitRef = useRef({ count: nodeCount, entry: entryNodeId })

  useEffect(() => {
    const previous = previousFitRef.current
    const shouldFit =
      nodeCount > previous.count || entryNodeId !== previous.entry
    previousFitRef.current = { count: nodeCount, entry: entryNodeId }
    if (!shouldFit) {
      return
    }
    // Deferred a frame: the new node has to be in the DOM before a fit that
    // includes it can be computed.
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.22, maxZoom: 1, duration: 220 })
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [nodeCount, entryNodeId, fitView])

  const edgesWithIngress = useMemo<Edge[]>(() => {
    if (entryNodeId === null) {
      return styledEdges
    }
    const outcome = outcomes.isLive
      ? outcomes.byNodeId.get(entryNodeId)
      : undefined
    const stroke = outcome ? tintFor(outcome.status) : IDLE_STROKE
    return [
      {
        id: `${INGRESS_NODE_ID}->${entryNodeId}`,
        source: INGRESS_NODE_ID,
        target: entryNodeId,
        selectable: false,
        deletable: false,
        markerEnd: {
          type: 'arrowclosed',
          width: 16,
          height: 16,
          color: stroke,
        },
        style: outcome
          ? {
              stroke,
              strokeWidth: 2.4,
              strokeDasharray: '6 6',
              animation: `nx-flow ${flowDuration(outcome.utilization)}s linear infinite`,
            }
          : { stroke: IDLE_STROKE, strokeWidth: 1.6 },
      } as Edge,
      ...styledEdges,
    ]
  }, [styledEdges, entryNodeId, outcomes])

  return (
    <NodeCallbacksProvider value={callbacks}>
      <ReactFlow
        nodes={nodesWithIngress}
        edges={edgesWithIngress}
        nodeTypes={NODE_TYPES}
        onNodesChange={design.onNodesChange}
        onEdgesChange={design.onEdgesChange}
        onConnect={design.onConnect}
        isValidConnection={design.isValidConnection}
        // Clicking a wire selects it; Backspace then cuts it. The design calls for
        // "click a wire to cut it", and this is that with a confirmation keystroke
        // -- a stray click on a path should not silently redesign the system.
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: false }}
        className="bg-bg"
      >
        {showGrid ? (
          // Colour given as a literal rather than a token: React Flow writes it
          // into an SVG `fill` on a <pattern>, and a var() there resolves
          // against the pattern element, which sits outside the tree the theme
          // variables are defined on. The value is --color-neutral-800.
          <Background
            variant={BackgroundVariant.Dots}
            gap={26}
            size={1.4}
            color="#3f424d"
          />
        ) : null}
        <Controls showInteractive={false} />
      </ReactFlow>
    </NodeCallbacksProvider>
  )
}
