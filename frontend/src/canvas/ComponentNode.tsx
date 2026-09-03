/**
 * One box on the canvas.
 *
 * Before a simulation it shows identity only: what the component is, what it is
 * called, how many replicas it runs. After one it also carries the verdict --
 * outline colour, a utilisation bar, and the latency it contributes -- so the
 * answer is painted on the diagram the user drew rather than only in a table
 * somewhere else on screen.
 *
 * The verdict is read from context, not from node data. See
 * `simulation-results/outcomes.ts` for why.
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

import { COMPONENT_CATALOG } from '../design/catalog'
import type { DesignNode } from '../design/types'
import { formatLatency, formatUtilization } from '../format'
import { useNodeOutcome, useOutcomesAreStale } from '../simulation-results/outcomes'
import { STATUS_STYLES } from '../simulation-results/statusStyles'

/** How much of the bar a utilisation fills. Past 100% it simply pins full. */
const FULL_BAR_PERCENT = 100

function ComponentNodeView({ id, data, selected }: NodeProps<DesignNode>) {
  const definition = COMPONENT_CATALOG[data.componentType]
  const outcome = useNodeOutcome(id)
  const isStale = useOutcomesAreStale()

  const status = outcome ? STATUS_STYLES[outcome.result.status] : null
  const barPercent = outcome
    ? Math.min(outcome.result.utilization * 100, FULL_BAR_PERCENT)
    : 0

  // An unsimulated node reads as neutral rather than as "fine": absence of a
  // verdict is not a healthy verdict.
  const outlineClassName = status ? status.nodeClassName : 'border-slate-300'

  return (
    <div
      className={`w-52 rounded-lg border-2 bg-white shadow-sm transition-opacity
                  ${outlineClassName}
                  ${selected ? 'ring-2 ring-slate-900/30' : ''}
                  ${isStale ? 'opacity-60' : ''}`}
    >
      {/* Left in, right out, so a design reads the way traffic flows. */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />

      <div className="flex items-center gap-2 px-3 pt-3">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide
                      ${definition.badgeClassName}`}
        >
          {definition.abbreviation}
        </span>
        {/* min-w-0 lets truncate actually clip inside a flex row. */}
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900"
          title={data.label}
        >
          {data.label}
        </span>
        {outcome?.isBottleneck && (
          <span
            className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px]
                       font-medium text-white"
            title="Highest utilisation in this design — fix this one first."
          >
            bottleneck
          </span>
        )}
      </div>

      <p className="px-3 pt-1 text-[11px] text-slate-500">
        {definition.label}
        {data.replicas > 1 && ` × ${data.replicas}`}
      </p>

      <div className="px-3 pt-2 pb-3">
        {outcome && status ? (
          <>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
              // Exposed to assistive tech as a real meter; the visual bar pins
              // at 100% but the announced value stays truthful past it.
              role="meter"
              aria-label="Utilisation"
              aria-valuenow={Math.round(outcome.result.utilization * 100)}
              aria-valuemin={0}
              aria-valuemax={FULL_BAR_PERCENT}
            >
              <div
                className={`h-full rounded-full ${status.barClassName}`}
                style={{ width: `${barPercent}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between text-[11px]">
              <span className="font-medium text-slate-700">
                {formatUtilization(outcome.result.utilization)} busy
              </span>
              <span className="text-slate-500">
                {formatLatency(outcome.result.latency_ms)}
              </span>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-slate-400">Not simulated yet</p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />
    </div>
  )
}

/**
 * Memoised because React Flow re-renders the node layer on pan and zoom. The
 * outcome arrives through context, which bypasses memo, so a new result still
 * repaints every node.
 */
export const ComponentNode = memo(ComponentNodeView)
