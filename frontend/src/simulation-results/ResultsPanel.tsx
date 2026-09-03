/**
 * The numbers behind the colours on the canvas.
 *
 * The nodes carry the headline -- outline, utilisation bar, contributed latency
 * -- and this panel carries what a diagram cannot: exact arrival rates, exact
 * capacity, and the one-line verdict on whether the design holds at all.
 *
 * It reads the design only for labels. Every figure comes from the response.
 */

import type { SimulationResponse } from '../api/types'
import type { DesignNode } from '../design/types'
import { formatLatency, formatRate, formatUtilization } from '../format'
import { STATUS_STYLES } from './statusStyles'

interface ResultsPanelProps {
  result: SimulationResponse | null
  error: string | null
  isStale: boolean
  hasRun: boolean
  nodes: readonly DesignNode[]
}

/** Shown before the first run, and again after the panel is cleared. */
function EmptyState() {
  return (
    <p className="px-4 py-6 text-sm text-slate-500">
      Draw a design, choose a traffic rate, and hit Simulate. Components are
      coloured by how busy they are; the slowest path becomes the end-to-end
      latency.
    </p>
  )
}

export function ResultsPanel({
  result,
  error,
  isStale,
  hasRun,
  nodes,
}: ResultsPanelProps) {
  if (!hasRun) {
    return <EmptyState />
  }

  if (error !== null) {
    return (
      <p
        role="alert"
        className="m-4 rounded-md border border-red-300 bg-red-50 px-4 py-3
                   text-sm text-red-800"
      >
        {error}
      </p>
    )
  }

  if (result === null) {
    return <EmptyState />
  }

  // Built once per render rather than a find() per row: the table is small
  // today, but a linear scan inside a map is the kind of quadratic that only
  // shows up once someone draws a hundred components.
  const labelOf = new Map(nodes.map((node) => [node.id, node.data.label]))
  const nameFor = (nodeId: string) => labelOf.get(nodeId) ?? nodeId

  return (
    <div className="p-4">
      {isStale && (
        <p
          role="status"
          className="mb-3 rounded-md border border-slate-300 bg-slate-100 px-3
                     py-2 text-xs text-slate-700"
        >
          The design has changed since this ran. These numbers describe the
          earlier version — simulate again to refresh them.
        </p>
      )}

      <div
        className={`mb-4 rounded-md border px-4 py-3 text-sm ${
          result.is_stable
            ? 'border-status-healthy/40 bg-status-healthy/10'
            : 'border-status-saturated/50 bg-status-saturated/10'
        }`}
      >
        {result.is_stable ? (
          <>
            <strong>System holds.</strong> End-to-end latency along the slowest
            path is {formatLatency(result.total_latency_ms)}.
            {result.bottleneck_node_id !== null && (
              <> Busiest component: {nameFor(result.bottleneck_node_id)}.</>
            )}
          </>
        ) : (
          <>
            <strong>System overloaded.</strong> At least one component cannot
            keep up, so its queue grows without bound and end-to-end latency is
            undefined rather than merely large.
            {result.bottleneck_node_id !== null && (
              <> Fix {nameFor(result.bottleneck_node_id)} first.</>
            )}
          </>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Per-component simulation results
          </caption>
          <thead>
            <tr className="border-b border-slate-300 text-left text-slate-500">
              <th scope="col" className="py-2 pr-3 font-medium">
                Component
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Incoming
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Capacity
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Utilisation
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Latency
              </th>
              <th scope="col" className="py-2 font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {result.nodes.map((node) => {
              const style = STATUS_STYLES[node.status]
              return (
                <tr key={node.node_id} className="border-b border-slate-100">
                  <th
                    scope="row"
                    className="py-2 pr-3 text-left font-medium text-slate-900"
                  >
                    {nameFor(node.node_id)}
                    {node.node_id === result.bottleneck_node_id && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        bottleneck
                      </span>
                    )}
                  </th>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatRate(node.arrival_rate_rps)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatRate(node.service_rate_rps)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatUtilization(node.utilization)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatLatency(node.latency_ms)}
                  </td>
                  <td className="py-2">
                    <span
                      title={style.meaning}
                      className={`rounded border px-2 py-0.5 text-xs font-medium
                                  ${style.badgeClassName}`}
                    >
                      {style.text}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
