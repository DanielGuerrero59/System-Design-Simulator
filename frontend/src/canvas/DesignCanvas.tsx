/**
 * The canvas: React Flow wired to the design store.
 *
 * Holds no state of its own. Everything it renders comes from `useDesign`,
 * everything it colours comes from the outcome context, and every interaction
 * is handed straight back to the store. That is what keeps the drawing surface
 * swappable and the simulation logic somewhere a test can reach it.
 */

import { useCallback, type DragEvent } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react'

import { readDragPayload, isOwnDrag } from '../design/dragAndDrop'
import type { DesignEdge, DesignNode } from '../design/types'
import type { DesignStore } from '../design/useDesign'
import { ComponentNode } from './ComponentNode'

/**
 * Defined at module scope, not inline in the JSX. React Flow warns about, and
 * remounts every node for, a nodeTypes object with a new identity each render.
 */
const NODE_TYPES: NodeTypes = { component: ComponentNode }

/** Both keys, because "delete" is what a user reaches for on a full keyboard. */
const DELETE_KEY_CODES = ['Backspace', 'Delete']

interface DesignCanvasProps {
  design: DesignStore
  /** Which node the inspector is editing, or null for none. */
  selectedNodeId: string | null
  onSelectNode: (nodeId: string | null) => void
}

export function DesignCanvas({
  design,
  selectedNodeId,
  onSelectNode,
}: DesignCanvasProps) {
  const { screenToFlowPosition } = useReactFlow<DesignNode, DesignEdge>()

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isOwnDrag(event.dataTransfer)) {
      return
    }
    // Without preventDefault the browser refuses the drop entirely: the default
    // action for dragover is "this is not a drop target".
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const componentType = readDragPayload(event.dataTransfer)
      if (componentType === null) {
        return
      }
      event.preventDefault()
      // Screen pixels mean nothing to a pannable, zoomable canvas; this maps
      // the pointer onto the flow's own coordinate space so the node lands
      // under the cursor at any zoom level.
      design.addNode(
        componentType,
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      )
    },
    [design, screenToFlowPosition],
  )

  const handleSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams<DesignNode>) => {
      // Only a single selection drives the inspector. Editing several nodes at
      // once would need a merged form, and that is not this version.
      onSelectNode(nodes.length === 1 ? nodes[0].id : null)
    },
    [onSelectNode],
  )

  return (
    <div
      className="h-full w-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow<DesignNode, DesignEdge>
        nodes={design.nodes}
        edges={design.edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={design.onNodesChange}
        onEdgesChange={design.onEdgesChange}
        onConnect={design.onConnect}
        isValidConnection={design.isValidConnection}
        onSelectionChange={handleSelectionChange}
        deleteKeyCode={DELETE_KEY_CODES}
        fitView
        // Keeps a fitView on a two-node design from zooming in far enough that
        // the boxes look like billboards.
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: false }}
        aria-label="System design canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={2}
          // Picking out the node under edit is the only thing worth colouring
          // here; health already has a much better home on the node itself.
          nodeColor={(node) =>
            node.id === selectedNodeId ? '#0f172a' : '#cbd5e1'
          }
        />
      </ReactFlow>
    </div>
  )
}
