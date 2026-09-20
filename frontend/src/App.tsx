/**
 * Composition root: two stores, one screen.
 *
 * The design store owns what the player drew. The simulation store owns what
 * the backend last said about it. This component is the only place they meet --
 * it turns one into a request body, and publishes the other to the canvas
 * through context. Neither store imports the other.
 */

import { useCallback, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Pause, Play } from '@phosphor-icons/react'

import { DesignCanvas } from './canvas/DesignCanvas'
import { designCost } from './design/catalog'
import { buildSimulationRequest } from './design/request'
import { useDesign } from './design/useDesign'
import { describeDesignProblem } from './design/validate'
import { LEVELS, levelAt } from './game/levels'
import { assess } from './game/objectives'
import { ObjectivePanel } from './panel/ObjectivePanel'
import { PartsBin } from './sidebar/PartsBin'
import {
  NO_OUTCOMES,
  OutcomeProvider,
  type OutcomeLookup,
} from './simulation-results/outcomes'
import { useSimulation } from './simulation-results/useSimulation'

const FIRST_LEVEL_INDEX = 0

export default function App() {
  const [levelIndex, setLevelIndex] = useState(FIRST_LEVEL_INDEX)
  const level = levelAt(levelIndex)

  const design = useDesign(FIRST_LEVEL_INDEX)
  const [trafficRps, setTrafficRps] = useState(level.targetRps)

  const designProblem = useMemo(
    () => describeDesignProblem(design.nodes, design.edges),
    [design.nodes, design.edges],
  )

  // Null when the design cannot be simulated, which is what idles the live
  // loop. Letting it build a request anyway would turn every half-drawn graph
  // into a 422 and a red banner the player cannot act on.
  const request = useMemo(
    () =>
      designProblem === null
        ? buildSimulationRequest(design.nodes, design.edges, {
            requests_per_second: trafficRps,
          })
        : null,
    [designProblem, design.nodes, design.edges, trafficRps],
  )

  const simulation = useSimulation({ request })

  const costCredits = useMemo(() => designCost(design.nodes), [design.nodes])

  const assessment = useMemo(
    () =>
      assess({
        level,
        nodes: design.nodes,
        edges: design.edges,
        result: simulation.result,
        trafficRps,
        costCredits,
        designProblem,
        isRunning: simulation.isRunning,
      }),
    [
      level,
      design.nodes,
      design.edges,
      simulation.result,
      simulation.isRunning,
      trafficRps,
      costCredits,
      designProblem,
    ],
  )

  const isLive = simulation.isRunning && simulation.result !== null

  const outcomes = useMemo<OutcomeLookup>(() => {
    const result = simulation.result
    if (result === null || !simulation.isRunning) {
      return NO_OUTCOMES
    }
    return {
      byNodeId: new Map(
        result.nodes.map((nodeResult) => [nodeResult.node_id, nodeResult]),
      ),
      isLive: true,
    }
  }, [simulation.result, simulation.isRunning])

  const switchLevel = useCallback(
    (index: number) => {
      setLevelIndex(index)
      setTrafficRps(levelAt(index).targetRps)
      simulation.setRunning(false)
      design.loadLevel(index)
    },
    [design, simulation],
  )

  const bottleneckLabel = useMemo(() => {
    const id = assessment.bottleneck?.node_id
    if (id === undefined) {
      return null
    }
    return design.nodes.find((node) => node.id === id)?.data.label ?? null
  }, [assessment.bottleneck, design.nodes])

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-bg font-body text-text">
        <header
          className="flex shrink-0 flex-wrap items-center gap-x-[22px] gap-y-3 border-b
                     border-divider px-3.5 py-2.5"
        >
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-[15px] font-medium tracking-[-0.01em]">
              Saturation
            </span>
            <span className="text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
              M/M/1 sandbox
            </span>
          </div>

          <div className="flex gap-1.5">
            {LEVELS.map((candidate, index) => (
              <button
                key={candidate.kicker}
                type="button"
                onClick={() => switchLevel(index)}
                aria-current={index === levelIndex ? 'true' : undefined}
                className={`rounded-sm border px-[11px] py-[5px] font-heading text-xs
                            font-medium whitespace-nowrap transition-colors ${
                              index === levelIndex
                                ? 'border-accent-700 bg-accent-900 text-accent-200'
                                : 'border-transparent text-neutral-500 hover:bg-accent-900'
                            }`}
              >
                {candidate.name}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <span className="text-[10px] tracking-[0.14em] whitespace-nowrap text-neutral-500 uppercase">
              Traffic <span className="text-[11px] normal-case">λ</span>
            </span>
            {/* The floor is one step, not zero. `TrafficPattern.requests_per_second`
                is `Field(gt=0)`, so the far-left stop of a zero-based dial sent a
                rate the API rejects: a guaranteed 422 and a red banner reachable
                by dragging, with nothing wrong with the player's design. */}
            <input
              type="range"
              min={level.stepRps}
              max={level.maxRps}
              step={level.stepRps}
              value={trafficRps}
              aria-label="Traffic rate in requests per second"
              onChange={(event) => setTrafficRps(Number(event.target.value))}
              className="w-30 shrink-0"
            />
            <span className="min-w-[86px] text-right font-heading text-[19px] tabular-nums">
              {trafficRps.toLocaleString()} rps
            </span>
          </div>

          <button
            type="button"
            onClick={() => simulation.setRunning(!simulation.isRunning)}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent
                       px-3 py-1.5 font-heading text-sm font-medium whitespace-nowrap
                       text-accent transition-colors
                       hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
          >
            {simulation.isRunning ? <Pause size={14} /> : <Play size={14} />}
            {simulation.isRunning ? 'Stop traffic' : 'Run traffic'}
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <PartsBin onAdd={design.addNode} disabled={design.atNodeLimit} />

          <main className="min-w-0 flex-1">
            {/* The canvas reads outcomes from context; the design store never
                learns that a simulation happened. */}
            <OutcomeProvider value={outcomes}>
              <DesignCanvas design={design} outcomes={outcomes} showGrid />
            </OutcomeProvider>
          </main>

          <ObjectivePanel
            level={level}
            assessment={assessment}
            totalLatencyMs={simulation.result?.total_latency_ms ?? null}
            isLive={isLive}
            bottleneckLabel={bottleneckLabel}
            error={simulation.error}
            onReset={() => switchLevel(levelIndex)}
          />
        </div>
      </div>
    </ReactFlowProvider>
  )
}
