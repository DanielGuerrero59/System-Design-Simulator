/**
 * Vertical slice: a hardcoded design, a real API call, results on screen.
 *
 * Deliberately has no canvas and no drag-and-drop yet. The point is to prove
 * the request shape, the response shape and CORS all work together while the
 * moving parts are few enough that a failure is unambiguous. The canvas
 * replaces the design constant below; everything else here survives.
 */

import { useState } from 'react'

import { API_BASE_URL, SimulationApiError, simulate } from './api/client'
import type {
  NodeStatus,
  SimulationRequest,
  SimulationResponse,
} from './api/types'
import { formatLatency, formatRate, formatUtilization } from './format'

/** The canonical teaching design. At 10k rps the app tier falls over. */
const DESIGN: Omit<SimulationRequest, 'traffic'> = {
  nodes: [
    { id: 'lb', type: 'load_balancer' },
    { id: 'api', type: 'app_server' },
    { id: 'db', type: 'database' },
  ],
  edges: [
    { source: 'lb', target: 'api' },
    { source: 'api', target: 'db' },
  ],
}

/**
 * Status to Tailwind classes. A lookup rather than a chain of conditionals, so
 * adding a status to the backend enum surfaces here as a type error.
 */
const STATUS_STYLES: Record<NodeStatus, string> = {
  healthy: 'bg-status-healthy/15 text-status-healthy border-status-healthy/40',
  warning: 'bg-status-warning/15 text-status-warning border-status-warning/40',
  critical:
    'bg-status-critical/15 text-status-critical border-status-critical/40',
  saturated:
    'bg-status-saturated/20 text-status-saturated border-status-saturated/50',
}

export default function App() {
  // Held as the raw string being typed, not as a number. Number('') is 0, so
  // numeric state would snap the field back to "0" the instant it is cleared --
  // making it impossible to blank and retype, and letting a click on Simulate
  // post a rate the backend rejects with a 422.
  const [trafficInput, setTrafficInput] = useState('1500')
  const [result, setResult] = useState<SimulationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const trafficRps = Number(trafficInput)
  const isTrafficValid =
    trafficInput.trim() !== '' && Number.isFinite(trafficRps) && trafficRps > 0

  const runSimulation = async () => {
    setIsRunning(true)
    setError(null)
    try {
      setResult(
        await simulate({
          ...DESIGN,
          traffic: { requests_per_second: trafficRps },
        }),
      )
    } catch (cause) {
      setResult(null)
      setError(
        cause instanceof SimulationApiError
          ? cause.message
          : 'Something went wrong running the simulation.',
      )
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8 font-sans text-slate-800">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">
          System Design Simulator
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Vertical slice — hardcoded load balancer → app server → database.
          API at <code className="text-slate-600">{API_BASE_URL}</code>
        </p>
      </header>

      <section className="mb-6 flex items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            Traffic (requests / second)
          </span>
          <input
            type="number"
            min={1}
            step={100}
            value={trafficInput}
            onChange={(event) => setTrafficInput(event.target.value)}
            className="w-48 rounded-md border border-slate-300 px-3 py-2
                       focus:border-slate-500 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={runSimulation}
          disabled={isRunning || !isTrafficValid}
          className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white
                     hover:bg-slate-700 disabled:cursor-not-allowed
                     disabled:bg-slate-400"
        >
          {isRunning ? 'Simulating…' : 'Simulate'}
        </button>
      </section>

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3
                     text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {result && (
        <section>
          <div
            className={`mb-4 rounded-md border px-4 py-3 text-sm ${
              result.is_stable
                ? 'border-status-healthy/40 bg-status-healthy/10'
                : 'border-status-saturated/50 bg-status-saturated/10'
            }`}
          >
            {result.is_stable ? (
              <>
                <strong>System holds.</strong> End-to-end latency{' '}
                {formatLatency(result.total_latency_ms)}. Highest utilisation:{' '}
                <code>{result.bottleneck_node_id}</code>.
              </>
            ) : (
              <>
                <strong>System overloaded.</strong> At least one component
                cannot keep up, so end-to-end latency is unbounded. First thing
                to fix: <code>{result.bottleneck_node_id}</code>.
              </>
            )}
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="py-2 font-medium">Component</th>
                <th className="py-2 font-medium">Incoming</th>
                <th className="py-2 font-medium">Capacity</th>
                <th className="py-2 font-medium">Utilisation</th>
                <th className="py-2 font-medium">Latency</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.nodes.map((node) => (
                <tr key={node.node_id} className="border-b border-slate-100">
                  <td className="py-2 font-medium text-slate-900">
                    {node.node_id}
                    {node.node_id === result.bottleneck_node_id && (
                      <span className="ml-2 text-xs text-slate-400">
                        bottleneck
                      </span>
                    )}
                  </td>
                  <td className="py-2">{formatRate(node.arrival_rate_rps)}</td>
                  <td className="py-2">{formatRate(node.service_rate_rps)}</td>
                  <td className="py-2">
                    {formatUtilization(node.utilization)}
                  </td>
                  <td className="py-2">{formatLatency(node.latency_ms)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded border px-2 py-0.5 text-xs font-medium
                                  ${STATUS_STYLES[node.status]}`}
                    >
                      {node.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}
