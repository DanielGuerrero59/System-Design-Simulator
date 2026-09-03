/**
 * Pre-flight checks on a design, phrased for a person rather than a parser.
 *
 * Every rule here is also enforced by the engine, which stays the authority: if
 * this file is wrong, the backend still returns a 422 and the user still sees a
 * message. What this buys is speed and tone -- the user learns that their two
 * unconnected components are the problem the moment it is true, in a sentence
 * that names them, instead of after a round trip.
 */

import {
  dedupeEdges,
  findEntryPoints,
  findUnreachableFromEntries,
} from './graph'
import { MAX_EDGES, MAX_NODES } from './limits'
import type { DesignEdge, DesignNode } from './types'

/** Join a few names readably: "a", "a and b", "a, b and c". */
function listNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? ''
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Why this design cannot be simulated, or null if it can be.
 *
 * Returns the first problem only. Reporting every fault at once reads as a
 * wall of failure on a half-drawn diagram, which is the normal state of the
 * canvas rather than an error.
 */
export function describeDesignProblem(
  nodes: readonly DesignNode[],
  edges: readonly DesignEdge[],
): string | null {
  if (nodes.length === 0) {
    return 'Add a component to get started — drag one in from the palette.'
  }
  if (nodes.length > MAX_NODES) {
    return `A design can hold at most ${MAX_NODES} components.`
  }

  const uniqueEdges = dedupeEdges(edges)
  if (uniqueEdges.length > MAX_EDGES) {
    return `A design can hold at most ${MAX_EDGES} connections.`
  }

  const nodeIds = nodes.map((node) => node.id)
  const nameOf = new Map(nodes.map((node) => [node.id, node.data.label]))
  const namesFor = (ids: string[]) =>
    listNames(ids.map((id) => nameOf.get(id) ?? id))

  const entryPoints = findEntryPoints(nodeIds, uniqueEdges)
  if (entryPoints.length === 0) {
    return (
      'Every component has something pointing at it, so there is nowhere for ' +
      'traffic to enter. That means the design loops back on itself.'
    )
  }
  if (entryPoints.length > 1) {
    return (
      `Traffic enters at one place, but ${namesFor(entryPoints)} have nothing ` +
      'pointing at them. Connect them up, or remove the extras.'
    )
  }

  const unreachable = findUnreachableFromEntries(nodeIds, uniqueEdges)
  if (unreachable.length > 0) {
    const verb = unreachable.length === 1 ? 'sits' : 'sit'
    return (
      `${namesFor(unreachable)} ${verb} on a loop. Requests have to flow ` +
      'forward through the system, so connections cannot form a cycle.'
    )
  }

  return null
}
