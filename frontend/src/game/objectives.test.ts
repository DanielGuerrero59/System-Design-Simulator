/**
 * The rules of the game, tested as rules.
 *
 * These exist because a bug shipped that made the whole thing inert: the win
 * condition asked whether a database was *present*, which is true of every
 * level's starting canvas, so pressing Run on an untouched seed printed "It
 * holds. Level cleared." Two review passes found it; the browser tests did not,
 * because they only ever exercised designs built on purpose. The negative cases
 * below are the point of this file -- a suite that only checks the intended
 * solution can pass while the game asks for nothing at all.
 *
 * Expectations are derived from the rules, not recorded from the
 * implementation's output. Simulation responses are written by hand: this is
 * the scoring layer, and what the queueing math does with a graph is already
 * covered by 124 tests on the Python side.
 */

import { describe, expect, it } from 'vitest'

import type { NodeResult, NodeStatus, SimulationResponse, StepResult } from '../api/types'
import type { DesignEdge, DesignNode } from '../design/types'
import { assess, type AssessmentInput } from './objectives'
import { LEVELS } from './levels'

const LEVEL_ONE = LEVELS[0]!

function node(
  id: string,
  componentType: DesignNode['data']['componentType'],
  replicas = 1,
): DesignNode {
  return {
    id,
    type: 'component',
    position: { x: 0, y: 0 },
    data: {
      componentType,
      label: id,
      replicas,
      serviceRateRps: null,
      hitRatio: null,
    },
  }
}

function edge(source: string, target: string): DesignEdge {
  return { id: `${source}->${target}`, source, target }
}

function nodeResult(
  nodeId: string,
  utilization: number,
  status: NodeStatus = 'healthy',
): NodeResult {
  return {
    node_id: nodeId,
    arrival_rate_rps: 100,
    service_rate_rps: 1000,
    utilization,
    latency_ms: 1,
    status,
  }
}

/**
 * Wrap one steady-state answer the way the backend does for a steady rate: a
 * single-sample timeline whose top level is that sample. The rate itself is
 * immaterial to the objectives, which read utilisation and status.
 */
function steady(step: StepResult): SimulationResponse {
  const rps = 2_400
  return {
    ...step,
    traffic: {
      kind: 'steady',
      duration_seconds: 0,
      peak_rps: rps,
      worst_step_index: 0,
      saturated_seconds: 0,
    },
    timeline: [{ t_seconds: 0, offered_rps: rps, ...step }],
  }
}

/**
 * A three-second burst with the same answer at every second, the worst one
 * flagged at `worstIndex`. Only the flag matters to the objectives: they judge
 * the top level, and the timeline exists so the coach can name the second.
 */
function burst(step: StepResult, worstIndex: number): SimulationResponse {
  return {
    ...step,
    traffic: {
      kind: 'spike',
      duration_seconds: 2,
      peak_rps: 9_000,
      worst_step_index: worstIndex,
      saturated_seconds: 1,
    },
    timeline: [0, 1, 2].map((t) => ({
      t_seconds: t,
      offered_rps: t === worstIndex ? 9_000 : 3_000,
      ...step,
    })),
  }
}

/** A comfortable, fast answer -- so only the design under test can fail it. */
function healthyResponse(nodeIds: string[]): SimulationResponse {
  return steady({
    is_stable: true,
    total_latency_ms: 1.5,
    bottleneck_node_id: nodeIds[0] ?? null,
    nodes: nodeIds.map((id) => nodeResult(id, 0.5)),
  })
}

function input(over: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    level: LEVEL_ONE,
    nodes: [],
    edges: [],
    result: null,
    peakRps: LEVEL_ONE.targetRps,
    costCredits: 0,
    designProblem: null,
    isRunning: false,
    ...over,
  }
}

function objective(assessment: ReturnType<typeof assess>, label: string) {
  const found = assessment.objectives.find((o) => o.label.includes(label))
  if (!found) {
    throw new Error(`no objective matching ${label}`)
  }
  return found
}

describe('a level cannot be cleared without a design', () => {
  it('refuses the untouched seed: one database, no wires', () => {
    // This is exactly the state every level starts in. It must not clear, or
    // the game is scoring a design the player never made.
    const nodes = [node('db-1', 'database')]
    const assessment = assess(
      input({
        nodes,
        edges: [],
        result: healthyResponse(['db-1']),
        isRunning: true,
        costCredits: 4,
      }),
    )

    expect(assessment.isCleared).toBe(false)
    expect(objective(assessment, 'reaches the database').isMet).toBe(false)
  })

  it('refuses a database scaled up but still unwired', () => {
    const nodes = [node('db-1', 'database', 8)]
    const assessment = assess(
      input({
        nodes,
        edges: [],
        result: healthyResponse(['db-1']),
        isRunning: true,
        costCredits: 32,
      }),
    )

    expect(assessment.isCleared).toBe(false)
  })

  it('refuses a design with no database at all', () => {
    const nodes = [node('api-1', 'app_server'), node('cache-1', 'cache')]
    const assessment = assess(
      input({
        nodes,
        edges: [edge('api-1', 'cache-1')],
        result: healthyResponse(['api-1', 'cache-1']),
        isRunning: true,
      }),
    )

    expect(assessment.isCleared).toBe(false)
    expect(objective(assessment, 'reaches the database').isMet).toBe(false)
  })

  it('refuses a database that traffic cannot reach', () => {
    // Two disconnected chains: the engine would reject this outright for having
    // two entry points, and it must not score as a win on the way there.
    const nodes = [
      node('api-1', 'app_server'),
      node('cache-1', 'cache'),
      node('db-1', 'database'),
    ]
    const assessment = assess(
      input({
        nodes,
        edges: [edge('api-1', 'cache-1')],
        result: healthyResponse(['api-1', 'cache-1', 'db-1']),
        isRunning: true,
      }),
    )

    expect(objective(assessment, 'reaches the database').isMet).toBe(false)
    expect(assessment.isCleared).toBe(false)
  })

  it('accepts traffic wired through to a database', () => {
    const nodes = [node('api-1', 'app_server', 2), node('db-1', 'database')]
    const assessment = assess(
      input({
        nodes,
        edges: [edge('api-1', 'db-1')],
        result: healthyResponse(['api-1', 'db-1']),
        isRunning: true,
        costCredits: 8,
      }),
    )

    expect(objective(assessment, 'reaches the database').isMet).toBe(true)
    expect(assessment.isCleared).toBe(true)
    expect(assessment.verdictText).toContain('Level cleared')
  })

  it('accepts a database reached through an intermediate hop', () => {
    const nodes = [
      node('api-1', 'app_server'),
      node('cache-1', 'cache'),
      node('db-1', 'database'),
    ]
    const assessment = assess(
      input({
        nodes,
        edges: [edge('api-1', 'cache-1'), edge('cache-1', 'db-1')],
        result: healthyResponse(['api-1', 'cache-1', 'db-1']),
        isRunning: true,
        costCredits: 9,
      }),
    )

    expect(assessment.isCleared).toBe(true)
  })
})

describe('the other win conditions', () => {
  const wired = {
    nodes: [node('api-1', 'app_server'), node('db-1', 'database')],
    edges: [edge('api-1', 'db-1')],
  }

  it('is not cleared while the traffic is stopped', () => {
    const assessment = assess(
      input({ ...wired, result: healthyResponse(['api-1', 'db-1']), isRunning: false }),
    )

    expect(assessment.isCleared).toBe(false)
    expect(assessment.verdictText).toBe('Standing by.')
  })

  it('is not cleared below the target rate', () => {
    const assessment = assess(
      input({
        ...wired,
        result: healthyResponse(['api-1', 'db-1']),
        isRunning: true,
        peakRps: LEVEL_ONE.targetRps - 1,
      }),
    )

    expect(assessment.isCleared).toBe(false)
  })

  it('is not cleared over budget', () => {
    const assessment = assess(
      input({
        ...wired,
        result: healthyResponse(['api-1', 'db-1']),
        isRunning: true,
        costCredits: LEVEL_ONE.budgetCredits + 1,
      }),
    )

    expect(assessment.isCleared).toBe(false)
  })

  it('is not cleared with a critical node, even though nothing has saturated', () => {
    const response = steady({
      is_stable: true,
      total_latency_ms: 1,
      bottleneck_node_id: 'api-1',
      nodes: [
        nodeResult('api-1', 0.9, 'critical'),
        nodeResult('db-1', 0.4, 'healthy'),
      ],
    })
    const assessment = assess(
      input({ ...wired, result: response, isRunning: true }),
    )

    expect(assessment.isCleared).toBe(false)
  })

  it('is not cleared when a node has saturated', () => {
    const response = steady({
      is_stable: false,
      // Null, not a large number: the backend never sends a figure here.
      total_latency_ms: null,
      bottleneck_node_id: 'api-1',
      nodes: [
        { ...nodeResult('api-1', 1.2, 'saturated'), latency_ms: null },
        nodeResult('db-1', 0.4, 'healthy'),
      ],
    })
    const assessment = assess(
      input({ ...wired, result: response, isRunning: true }),
    )

    expect(assessment.isCleared).toBe(false)
    expect(objective(assessment, 'Slowest path').value).toBe('∞')
    expect(assessment.tip).toContain('saturated')
  })

  it('is not cleared past the latency cap', () => {
    const response = steady({
      is_stable: true,
      total_latency_ms: LEVEL_ONE.latencyCapMs + 0.01,
      bottleneck_node_id: 'api-1',
      nodes: [nodeResult('api-1', 0.5), nodeResult('db-1', 0.4)],
    })
    const assessment = assess(
      input({ ...wired, result: response, isRunning: true }),
    )

    expect(assessment.isCleared).toBe(false)
  })
})

describe('objective figures do not contradict the check beside them', () => {
  const wired = {
    nodes: [node('api-1', 'app_server'), node('db-1', 'database')],
    edges: [edge('api-1', 'db-1')],
  }

  it('floors utilisation so a comfortable node never reads 85%', () => {
    // 0.8462 rounds to 85, which would sit next to a green check on a row
    // reading "under 85%". The backend still calls this one a warning.
    const response = steady({
      is_stable: true,
      total_latency_ms: 1,
      bottleneck_node_id: 'api-1',
      nodes: [
        nodeResult('api-1', 0.8462, 'warning'),
        nodeResult('db-1', 0.4, 'healthy'),
      ],
    })
    const assessment = assess(
      input({ ...wired, result: response, isRunning: true }),
    )

    const row = objective(assessment, 'under 85%')
    expect(row.value).toBe('84%')
    expect(row.isMet).toBe(true)
  })

  it('shows no figure for a run-dependent objective before a run', () => {
    const assessment = assess(input({ ...wired, isRunning: false }))

    expect(objective(assessment, 'under 85%').value).toBe('—')
    expect(objective(assessment, 'under 85%').isMet).toBe(false)
    expect(objective(assessment, 'Slowest path').isMet).toBe(false)
  })

  it('prints the sub-millisecond latency the panel prints', () => {
    // The seeded Level 01 figure that drifted: the objective said 0.38 while
    // the headline said 0.385.
    const response = steady({
      is_stable: true,
      total_latency_ms: 0.385,
      bottleneck_node_id: 'db-1',
      nodes: [nodeResult('api-1', 0.5), nodeResult('db-1', 0.4)],
    })
    const assessment = assess(
      input({ ...wired, result: response, isRunning: true }),
    )

    expect(objective(assessment, 'Slowest path').value).toBe('0.385')
  })
})

describe('coaching', () => {
  it('leads with the design problem when the graph is malformed', () => {
    const assessment = assess(
      input({
        nodes: [node('db-1', 'database')],
        designProblem: 'Two entry points.',
        isRunning: true,
      }),
    )

    expect(assessment.tip).toBe('Two entry points.')
  })

  it('asks for a part when the canvas is empty', () => {
    expect(assess(input()).tip).toContain('Drop a part in')
  })

  it('names the missing path before complaining about anything else', () => {
    const assessment = assess(
      input({
        nodes: [node('db-1', 'database')],
        result: healthyResponse(['db-1']),
        isRunning: true,
        costCredits: 999,
      }),
    )

    expect(assessment.tip).toContain('wire a path through to it')
  })
})

describe('traffic shapes', () => {
  const READ_STORM = LEVELS[1]!
  const BLACK_FRIDAY = LEVELS[2]!

  const wired = {
    nodes: [node('api-1', 'app_server'), node('db-1', 'database')],
    edges: [edge('api-1', 'db-1')],
  }

  const saturatedApp: StepResult = {
    is_stable: false,
    total_latency_ms: null,
    bottleneck_node_id: 'api-1',
    nodes: [
      { ...nodeResult('api-1', 1.2, 'saturated'), latency_ms: null },
      nodeResult('db-1', 0.4, 'healthy'),
    ],
  }

  it('phrases the target by the shape of the level', () => {
    expect(objective(assess(input()), 'rps').label).toBe('Serve 2,400 rps')
    expect(
      objective(
        assess(input({ level: READ_STORM, peakRps: READ_STORM.targetRps })),
        'rps',
      ).label,
    ).toBe('Peak of 9,000 rps')
    expect(
      objective(
        assess(input({ level: BLACK_FRIDAY, peakRps: BLACK_FRIDAY.targetRps })),
        'rps',
      ).label,
    ).toBe('Ramp to 30,000 rps')
  })

  it('judges the peak the dial is set to', () => {
    const below = assess(
      input({ level: READ_STORM, peakRps: READ_STORM.targetRps - READ_STORM.stepRps }),
    )
    const at = assess(input({ level: READ_STORM, peakRps: READ_STORM.targetRps }))

    expect(objective(below, 'rps').isMet).toBe(false)
    expect(objective(at, 'rps').isMet).toBe(true)
  })

  it('names the worst second of a burst', () => {
    const assessment = assess(
      input({
        ...wired,
        level: READ_STORM,
        peakRps: READ_STORM.targetRps,
        result: burst(saturatedApp, 1),
        isRunning: true,
      }),
    )

    expect(assessment.tip).toMatch(/^At t = 1 s, api-1 is saturated/)
  })

  it('does not name a second for a steady rate', () => {
    const assessment = assess(
      input({ ...wired, result: steady(saturatedApp), isRunning: true }),
    )

    expect(assessment.tip).toMatch(/^api-1 is saturated/)
  })
})
