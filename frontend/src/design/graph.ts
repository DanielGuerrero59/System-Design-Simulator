/**
 * Graph questions the UI needs to answer without asking the backend.
 *
 * The engine already enforces every rule in here (`backend/app/simulation/
 * engine.py`) and remains the authority. These exist so the canvas can refuse
 * to draw an edge that would create a cycle, and tell the user what is wrong
 * with a design before spending a round trip on a 422.
 *
 * Everything works on plain id strings so it is independent of React Flow.
 */

/** source id -> the ids it points at. */
export type Adjacency = ReadonlyMap<string, readonly string[]>

interface EdgeLike {
  source: string
  target: string
}

/**
 * Collapse repeated source -> target pairs.
 *
 * A duplicate edge would be counted twice when splitting fan-out traffic, and
 * would inflate the in-degree count below into a cycle that is not there. The
 * engine deduplicates for the same reason; doing it here keeps the two answers
 * in agreement.
 */
export function dedupeEdges<T extends EdgeLike>(edges: readonly T[]): T[] {
  const seen = new Set<string>()
  return edges.filter((edge) => {
    const key = JSON.stringify([edge.source, edge.target])
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

/** Build a successor map. Nodes with no outgoing edges are present but empty. */
export function buildAdjacency(
  nodeIds: readonly string[],
  edges: readonly EdgeLike[],
): Adjacency {
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]))
  for (const edge of edges) {
    // An edge to a node that no longer exists is skipped rather than treated as
    // an error: React Flow can hold one for a frame while a delete is applied.
    adjacency.get(edge.source)?.push(edge.target)
  }
  return adjacency
}

/**
 * Can `from` reach `to` by following edges? Breadth-first, visiting each node
 * at most once, so a dense graph costs O(nodes + edges) rather than blowing up.
 */
export function canReach(
  adjacency: Adjacency,
  from: string,
  to: string,
): boolean {
  if (from === to) {
    return true
  }
  const seen = new Set<string>([from])
  const queue: string[] = [from]

  while (queue.length > 0) {
    // Shift is O(n) on a large array; pop is O(1) and the traversal order does
    // not matter for a reachability question.
    const current = queue.pop() as string
    for (const next of adjacency.get(current) ?? []) {
      if (next === to) {
        return true
      }
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }

  return false
}

/**
 * Every node reachable from `from` by following at least one edge.
 *
 * Distinct from `canReach(adjacency, x, x)`, which is true by definition: a
 * node trivially reaches itself without any edges existing. The question here
 * is what traffic *arrives at* after leaving `from`, which is what makes a
 * design a system rather than a single box.
 */
export function reachableFrom(adjacency: Adjacency, from: string): Set<string> {
  const reached = new Set<string>()
  const queue: string[] = [from]

  while (queue.length > 0) {
    const current = queue.pop() as string
    for (const next of adjacency.get(current) ?? []) {
      if (!reached.has(next)) {
        reached.add(next)
        queue.push(next)
      }
    }
  }

  return reached
}

/**
 * Nodes with no incoming edge. The engine requires exactly one: traffic enters
 * the system at a single point.
 *
 * An edge is only counted when both of its endpoints still exist, matching
 * `buildAdjacency` and the engine's own `_build_graph`. Without that guard a
 * dangling edge left over for a frame by a delete would make its target look
 * like it still has a predecessor, and this function would disagree with the
 * other two about whether the graph has an entry point at all.
 */
export function findEntryPoints(
  nodeIds: readonly string[],
  edges: readonly EdgeLike[],
): string[] {
  const known = new Set(nodeIds)
  const hasIncoming = new Set(
    edges
      .filter((edge) => known.has(edge.source) && known.has(edge.target))
      .map((edge) => edge.target),
  )
  return nodeIds.filter((id) => !hasIncoming.has(id))
}

/**
 * Ids that sit on or behind a cycle, found the same way the engine does it:
 * Kahn's algorithm, then whatever it could not reach.
 */
export function findUnreachableFromEntries(
  nodeIds: readonly string[],
  edges: readonly EdgeLike[],
): string[] {
  const adjacency = buildAdjacency(nodeIds, edges)
  const known = new Set(nodeIds)
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]))
  for (const edge of edges) {
    // Both endpoints, for the same reason buildAdjacency skips unknown sources:
    // counting an edge here that the adjacency map dropped would leave a node's
    // in-degree permanently above zero, and Kahn's algorithm would report a
    // perfectly acyclic design as a cycle.
    if (known.has(edge.source) && known.has(edge.target)) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
    }
  }

  const queue = nodeIds.filter((id) => indegree.get(id) === 0)
  const settled = new Set<string>(queue)

  while (queue.length > 0) {
    const current = queue.pop() as string
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0 && !settled.has(next)) {
        settled.add(next)
        queue.push(next)
      }
    }
  }

  return nodeIds.filter((id) => !settled.has(id))
}
