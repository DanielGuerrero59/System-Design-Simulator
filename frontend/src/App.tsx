/**
 * Composition root: three stores, one layout.
 *
 * The design store owns what the user drew. The simulation store owns what the
 * backend last said about it. This component is the only place they meet -- it
 * turns one into a request, and publishes the other to the canvas through
 * context. Neither store imports the other, which is what makes "your results
 * are stale" expressible at all.
 */

import { useCallback, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import { API_BASE_URL } from './api/client'
import { DesignCanvas } from './canvas/DesignCanvas'
import { MAX_TRAFFIC_RPS } from './design/limits'
import { buildSimulationRequest } from './design/request'
import { useDesign } from './design/useDesign'
import { describeDesignProblem } from './design/validate'
import { NodeInspector } from './sidebar/NodeInspector'
import { Palette } from './sidebar/Palette'
import { TrafficControls } from './sidebar/TrafficControls'
import { ResultsPanel } from './simulation-results/ResultsPanel'
import {
  NO_OUTCOMES,
  OutcomeContext,
  type OutcomeLookup,
} from './simulation-results/outcomes'
import { useSimulation } from './simulation-results/useSimulation'

/** Enough load to make the default design interesting without breaking it. */
const INITIAL_TRAFFIC_RPS = '1500'

export default function App() {
  const design = useDesign()
  const simulation = useSimulation(design.revision)

  // The raw string being typed, not a number: see the same reasoning in
  // NodeInspector. Number('') is 0, which would make the field unclearable.
  const [trafficInput, setTrafficInput] = useState(INITIAL_TRAFFIC_RPS)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const selectedNode =
    design.nodes.find((node) => node.id === selectedNodeId) ?? null

  const designProblem = useMemo(
    () => describeDesignProblem(design.nodes, design.edges),
    [design.nodes, design.edges],
  )

  const trafficRps = Number(trafficInput)
  const isTrafficValid =
    trafficInput.trim() !== '' &&
    Number.isFinite(trafficRps) &&
    trafficRps > 0 &&
    trafficRps <= MAX_TRAFFIC_RPS
  const canSimulate = isTrafficValid && designProblem === null

  const runSimulation = useCallback(() => {
    if (!canSimulate) {
      return
    }
    simulation.run(
      buildSimulationRequest(design.nodes, design.edges, trafficRps),
      // Stamped with the revision the request was built from, so a result that
      // lands after the user has moved on can identify itself as out of date.
      design.revision,
    )
  }, [canSimulate, design, simulation, trafficRps])

  const handleReset = useCallback(() => {
    design.reset()
    simulation.clear()
    setSelectedNodeId(null)
  }, [design, simulation])

  const outcomes = useMemo<OutcomeLookup>(() => {
    const result = simulation.result
    if (result === null) {
      return NO_OUTCOMES
    }
    return {
      byNodeId: new Map(
        result.nodes.map((nodeResult) => [
          nodeResult.node_id,
          {
            result: nodeResult,
            isBottleneck: nodeResult.node_id === result.bottleneck_node_id,
          },
        ]),
      ),
      isStale: simulation.isStale,
    }
  }, [simulation.result, simulation.isStale])

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col bg-slate-50">
        <header
          className="flex shrink-0 items-center justify-between gap-4 border-b
                     border-slate-200 bg-white px-5 py-3"
        >
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900">
              System Design Simulator
            </h1>
            <p className="truncate text-[11px] text-slate-500">
              M/M/1 queueing model · API at{' '}
              <code className="text-slate-600">{API_BASE_URL}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-3
                       py-1.5 text-sm font-medium text-slate-700
                       transition-colors hover:border-slate-400
                       hover:bg-slate-50 focus:outline-none
                       focus-visible:ring-2 focus-visible:ring-slate-900/40"
          >
            Reset design
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside
            className="w-72 shrink-0 space-y-5 overflow-y-auto border-r
                       border-slate-200 bg-white p-4"
          >
            <TrafficControls
              value={trafficInput}
              onChange={setTrafficInput}
              onSimulate={runSimulation}
              isRunning={simulation.isRunning}
              canSimulate={canSimulate}
              designProblem={designProblem}
            />

            <Palette onAdd={design.addNode} disabled={design.atNodeLimit} />

            {selectedNode ? (
              // Remounted per selection, so each field seeds its own text state
              // from the node it is editing rather than from the previous one.
              <NodeInspector
                key={selectedNode.id}
                node={selectedNode}
                design={design}
              />
            ) : (
              <p className="text-[11px] leading-relaxed text-slate-500">
                Select a component to change its replicas, capacity or name.
                Press Delete to remove the selected one.
              </p>
            )}
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            {/* The canvas reads outcomes from context; the design store never
                learns that a simulation happened. */}
            <OutcomeContext value={outcomes}>
              <div className="min-h-0 flex-1">
                <DesignCanvas
                  design={design}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                />
              </div>
            </OutcomeContext>

            <section
              aria-label="Simulation results"
              className="h-72 shrink-0 overflow-y-auto border-t border-slate-200
                         bg-white"
            >
              <ResultsPanel
                result={simulation.result}
                error={simulation.error}
                isStale={simulation.isStale}
                hasRun={simulation.hasRun}
                nodes={design.nodes}
              />
            </section>
          </main>
        </div>
      </div>
    </ReactFlowProvider>
  )
}
