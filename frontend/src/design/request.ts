/**
 * Turn the drawn diagram into the JSON body the /simulate endpoint expects.
 *
 * Kept as a pure function rather than a method on the design store: it is the
 * one place the canvas's vocabulary (labels, positions, React Flow ids) is
 * translated into the API's, and that translation is much easier to reason
 * about -- and to test -- with no hooks around it.
 */

import type {
  DesignEdge as WireEdge,
  DesignNode as WireNode,
  NodeConfig,
  SimulationRequest,
  TrafficPattern,
} from '../api/types'
import { dedupeEdges } from './graph'
import type { DesignEdge, DesignNode } from './types'

/**
 * Build the request body.
 *
 * Two things are deliberately dropped on the way: positions, because where a
 * box sits on screen has no effect on queueing, and labels, because the backend
 * identifies components by id and would reject an unknown field.
 *
 * The traffic arrives already in wire form. Its shape is the level's business
 * (`game/traffic.ts`), and this function's is the design; keeping the two apart
 * means a new traffic shape never touches the code that serialises a diagram.
 */
export function buildSimulationRequest(
  nodes: readonly DesignNode[],
  edges: readonly DesignEdge[],
  traffic: TrafficPattern,
): SimulationRequest {
  const wireNodes: WireNode[] = nodes.map((node) => {
    const config: NodeConfig = { replicas: node.data.replicas }

    // Omitted rather than sent as null, so the backend applies its own default
    // for the type. Sending null would work too, but omission keeps the payload
    // honest about which knobs the user actually turned.
    if (node.data.serviceRateRps !== null) {
      config.service_rate_rps = node.data.serviceRateRps
    }

    // Guarded on type, not just on the value: the schema rejects a hit_ratio on
    // anything but a cache, so a ratio left behind by an earlier edit would
    // fail the whole request rather than being quietly ignored.
    if (node.data.componentType === 'cache' && node.data.hitRatio !== null) {
      config.hit_ratio = node.data.hitRatio
    }

    return { id: node.id, type: node.data.componentType, config }
  })

  const wireEdges: WireEdge[] = dedupeEdges(edges).map((edge) => ({
    source: edge.source,
    target: edge.target,
  }))

  return {
    nodes: wireNodes,
    edges: wireEdges,
    traffic,
  }
}
