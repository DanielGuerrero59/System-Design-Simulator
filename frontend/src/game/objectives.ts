/**
 * Scoring a level: which objectives are met, whether it is cleared, and what
 * to say to a player who is stuck.
 *
 * A pure function of (level, design, result). No hooks, no fetching -- so the
 * rules a player is being judged against can be read in one sitting, and the
 * awkward cases (nothing drawn yet, a half-wired graph, a saturated node) are
 * all visible in one place rather than scattered across the components that
 * happen to render them.
 *
 * Note where the "every node under 85%" test gets its answer: from each node's
 * `status`, not from comparing `utilization` against a threshold this file
 * keeps. The backend already classifies a component as critical at rho 0.85
 * (UTILIZATION_CRITICAL_THRESHOLD), and re-deriving that boundary here would
 * create a second copy free to disagree with the first.
 */

import type { NodeResult, SimulationResponse } from '../api/types'
import { COMPONENT_CATALOG } from '../design/catalog'
import {
  buildAdjacency,
  dedupeEdges,
  findEntryPoints,
  reachableFrom,
} from '../design/graph'
import type { DesignEdge, DesignNode } from '../design/types'
import { formatLatencyFigure, formatRate } from '../format'
import type { Level } from './levels'
import { TARGET_VERB } from './traffic'

export type VerdictTone = 'cleared' | 'failing' | 'idle'

export interface Objective {
  label: string
  /** The player's current figure, or an em dash before anything has run. */
  value: string
  isMet: boolean
}

export interface Assessment {
  objectives: Objective[]
  isCleared: boolean
  verdictText: string
  verdictTone: VerdictTone
  /** One paragraph of coaching, chosen for the most pressing problem. */
  tip: string
  /** The busiest component, for the line under the latency figure. */
  bottleneck: NodeResult | null
}

/**
 * Does traffic actually flow *through* something to reach storage?
 *
 * The test is a path of at least one edge from the entry point to a database --
 * not merely "a database is present". That distinction is the whole game. With
 * the weaker check, every level cleared by pressing Run on its seeded database
 * and adding replicas: no app server, no cache, not a single wire, and the
 * panel said "It holds. Level cleared." A level has to ask for a system, and a
 * lone box with traffic pointed at it is not one.
 */
function deliversToDatabase(
  nodes: readonly DesignNode[],
  edges: readonly DesignEdge[],
): boolean {
  const nodeIds = nodes.map((node) => node.id)
  const uniqueEdges = dedupeEdges(edges)
  const entries = findEntryPoints(nodeIds, uniqueEdges)
  if (entries.length !== 1) {
    return false
  }
  const downstream = reachableFrom(
    buildAdjacency(nodeIds, uniqueEdges),
    entries[0] as string,
  )
  return nodes.some(
    (node) => node.data.componentType === 'database' && downstream.has(node.id),
  )
}

export interface AssessmentInput {
  level: Level
  nodes: readonly DesignNode[]
  edges: readonly DesignEdge[]
  /** Null until a run has produced numbers for the current design. */
  result: SimulationResponse | null
  /** What the dial is set to: the peak of the level's traffic shape. */
  peakRps: number
  costCredits: number
  /** Why the design cannot be simulated at all, from `design/validate.ts`. */
  designProblem: string | null
  isRunning: boolean
}

const IDLE = '—' // em dash

/**
 * A component is comfortable while the backend calls it healthy or warning.
 * Critical means rho has passed 0.85; saturated means it has passed 1.0.
 */
function isComfortable(node: NodeResult): boolean {
  return node.status === 'healthy' || node.status === 'warning'
}

function labelFor(nodes: readonly DesignNode[], nodeId: string | null): string {
  if (nodeId === null) {
    return 'one node'
  }
  const node = nodes.find((candidate) => candidate.id === nodeId)
  return node ? node.data.label : nodeId
}

export function assess(input: AssessmentInput): Assessment {
  const {
    level,
    nodes,
    edges,
    result,
    peakRps,
    costCredits,
    designProblem,
    isRunning,
  } = input

  const live = isRunning && result !== null

  const hitsTarget = peakRps >= level.targetRps
  const isInBudget = costCredits <= level.budgetCredits
  const reachesDatabase = deliversToDatabase(nodes, edges)

  const allComfortable =
    result !== null &&
    result.nodes.length > 0 &&
    result.nodes.every(isComfortable)

  const isFastEnough =
    result !== null &&
    result.total_latency_ms !== null &&
    result.total_latency_ms <= level.latencyCapMs

  const bottleneck =
    result === null
      ? null
      : (result.nodes.find(
          (node) => node.node_id === result.bottleneck_node_id,
        ) ?? null)

  const isCleared =
    live &&
    hitsTarget &&
    isInBudget &&
    reachesDatabase &&
    allComfortable &&
    isFastEnough

  // Floored, not rounded. At rho 0.8462 a rounded figure reads "85%" beside a
  // green check on a row that says "under 85%" -- the display contradicting the
  // verdict next to it. Flooring keeps the printed integer below 85 for exactly
  // the values the backend still calls comfortable.
  const busiestPercent =
    live && bottleneck
      ? `${Math.floor(Math.min(999, bottleneck.utilization * 100))}%`
      : IDLE

  const latencyValue = !live
    ? IDLE
    : result.total_latency_ms === null
      ? '∞' // infinity sign
      : formatLatencyFigure(result.total_latency_ms)

  const objectives: Objective[] = [
    {
      label: `${TARGET_VERB[level.traffic.kind]} ${formatRate(level.targetRps)}`,
      value: formatRate(peakRps),
      isMet: hitsTarget,
    },
    {
      label: 'Traffic reaches the database',
      value: reachesDatabase ? 'wired' : 'no path',
      isMet: reachesDatabase,
    },
    {
      label: 'Every node under 85%',
      value: busiestPercent,
      isMet: live && allComfortable,
    },
    {
      label: `Slowest path under ${level.latencyCapMs} ms`,
      value: latencyValue,
      isMet: live && isFastEnough,
    },
    {
      label: `Budget ${level.budgetCredits} credits`,
      value: `${costCredits}`,
      isMet: isInBudget,
    },
  ]

  return {
    objectives,
    isCleared,
    bottleneck,
    verdictText: isCleared
      ? 'It holds. Level cleared.'
      : live
        ? 'Not shippable yet.'
        : 'Standing by.',
    verdictTone: isCleared ? 'cleared' : live ? 'failing' : 'idle',
    tip: coach({
      level,
      nodes,
      result,
      designProblem,
      live,
      hitsTarget,
      isInBudget,
      reachesDatabase,
      allComfortable,
      isFastEnough,
      bottleneck,
      costCredits,
    }),
  }
}

interface CoachInput {
  level: Level
  nodes: readonly DesignNode[]
  result: SimulationResponse | null
  designProblem: string | null
  live: boolean
  hitsTarget: boolean
  isInBudget: boolean
  reachesDatabase: boolean
  allComfortable: boolean
  isFastEnough: boolean
  bottleneck: NodeResult | null
  costCredits: number
}

/**
 * Pick the one thing worth saying right now.
 *
 * Ordered by how badly each problem blocks progress, and it returns the first
 * match rather than every fault: a half-drawn canvas is the normal state, and
 * listing four complaints about it reads as failure rather than as guidance.
 */
function coach(input: CoachInput): string {
  const {
    level,
    nodes,
    result,
    designProblem,
    live,
    hitsTarget,
    isInBudget,
    reachesDatabase,
    allComfortable,
    isFastEnough,
    bottleneck,
    costCredits,
  } = input

  if (nodes.length === 0) {
    return 'Drop a part in from the bin on the left.'
  }

  if (designProblem !== null) {
    return designProblem
  }

  if (!live) {
    return 'ρ = λ/μ. Below 0.7 a queue is comfortable; at 0.85 it is precarious; at 1.0 it stops being a queue and becomes a backlog.'
  }

  // The top-level figures describe the worst second of a shaped run. Naming
  // that second turns "saturated" into "saturated when the burst hits", which
  // is the thing a flat rate could never say. A steady run has one sample, and
  // "at t = 0 s" would be noise.
  const worstSecond =
    result !== null && result.traffic.kind !== 'steady'
      ? (result.timeline[result.traffic.worst_step_index]?.t_seconds ?? null)
      : null

  const saturated = result?.nodes.find((node) => node.status === 'saturated')
  if (saturated) {
    const name = labelFor(nodes, saturated.node_id)
    const when = worstSecond === null ? '' : `At t = ${worstSecond} s, `
    return `${when}${name} is saturated — λ has caught up with μ, so its queue grows without bound and the latency is genuinely ∞, not a big number. Split the load across replicas, or put a cache in front to cut what reaches it.`
  }

  if (!reachesDatabase) {
    return 'Traffic has nowhere to land. Put a database in the design and wire a path through to it.'
  }

  if (!hitsTarget) {
    return `You are under the target rate. Push λ up to ${formatRate(level.targetRps)} and see what breaks first.`
  }

  if (!isInBudget) {
    const over = costCredits - level.budgetCredits
    const cacheCost = COMPONENT_CATALOG.cache.credits
    return `Over budget by ${over} credit${over === 1 ? '' : 's'}. A cache costs ${cacheCost} and cuts what reaches the tier behind it by 80% — usually cheaper than another rack of servers.`
  }

  if (!allComfortable) {
    const name = labelFor(nodes, bottleneck?.node_id ?? null).toLowerCase()
    const when = worstSecond === null ? '' : `at t = ${worstSecond} s `
    return `Nothing has collapsed, but ${when}${name} is past 85% — at that point every extra request costs far more latency than the last. That curve is the whole lesson.`
  }

  if (!isFastEnough) {
    return 'Stable, but slow. W = 1/(μ−λ) blows up near saturation — pull the busiest node down toward 0.7 and watch the latency fall off a cliff.'
  }

  return 'Clean. Try pushing λ higher and watch which component gives out first — the bottleneck moves.'
}
