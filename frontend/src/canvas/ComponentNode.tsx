/**
 * One component on the canvas.
 *
 * Everything the player learns about a design at a glance is on this card: what
 * the part is, how busy it is, how long a request spends inside it, and how
 * many replicas are carrying the load. It reads its numbers from the outcome
 * context rather than from node data, so it stays a pure function of "what was
 * drawn" plus "what the backend said", with no third state of its own.
 *
 * The saturated case gets deliberate handling. The backend sends `null` for
 * latency at rho >= 1 because the value is infinite rather than large, and this
 * card prints ∞ -- never a number, never a zero. Rendering a big-looking figure
 * there would teach exactly the wrong thing about what saturation is.
 */

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Minus, Plus, X } from '@phosphor-icons/react'

import { COMPONENT_CATALOG } from '../design/catalog'
import { MAX_REPLICAS, MIN_REPLICAS } from '../design/limits'
import type { DesignNode } from '../design/types'
import { useNodeOutcome } from '../simulation-results/outcomes'
import {
  IDLE_TINT,
  isAlarming,
  tintFor,
} from '../simulation-results/statusStyles'
import { useNodeCallbacks } from './nodeCallbacks'

const NODE_WIDTH = 152

export const ComponentNode = memo(function ComponentNode({
  id,
  data,
  selected,
}: NodeProps<DesignNode>) {
  const definition = COMPONENT_CATALOG[data.componentType]
  const Icon = definition.icon
  const outcome = useNodeOutcome(id)
  const callbacks = useNodeCallbacks()

  const tint = outcome ? tintFor(outcome.status) : IDLE_TINT
  const alarming = outcome !== null && isAlarming(outcome.status)

  const readout = !outcome
    ? 'idle'
    : outcome.arrival_rate_rps <= 0
      ? 'no traffic'
      : outcome.latency_ms === null
        ? 'ρ ≥ 1 · ∞ ms'
        : `ρ ${outcome.utilization.toFixed(2)} · ${formatShortLatency(outcome.latency_ms)}`

  // Capped at 100% so a saturated component fills the bar rather than
  // overflowing it. The readout above still says rho >= 1, so nothing is lost.
  const barPercent = outcome
    ? Math.min(100, outcome.utilization * 100)
    : 0

  return (
    <div
      style={{
        width: NODE_WIDTH,
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${alarming || selected ? tint : 'var(--color-neutral-800)'}`,
        boxShadow: alarming
          ? `0 0 0 1px ${tint}, 0 0 22px -4px ${tint}`
          : 'var(--shadow-md)',
        animation: alarming
          ? 'nx-pulse 0.28s infinite steps(2, end), nx-in 0.18s ease-out'
          : 'nx-in 0.18s ease-out',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'var(--color-neutral-700)' }}
      />

      <div className="grid grid-cols-[20px_1fr_auto] items-center gap-2 px-[9px] py-2">
        <Icon size={16} color={tint} weight="regular" />
        <span className="truncate font-heading text-[11px] font-medium">
          {data.label}
        </span>
        <button
          type="button"
          aria-label={`Remove ${data.label}`}
          onClick={() => callbacks.onRemove(id)}
          className="grid size-[18px] place-items-center rounded-sm text-neutral-500
                       transition-colors hover:bg-neutral-800 hover:text-text"
        >
          <X size={12} />
        </button>
      </div>

      <div className="mx-[9px] h-[5px] overflow-hidden rounded-[3px] bg-neutral-900">
        <div
          className="h-full rounded-[3px]"
          style={{
            width: `${barPercent}%`,
            background: tint,
            transition: 'width 0.35s ease, background 0.35s ease',
          }}
        />
      </div>

      <div
        className="px-[9px] pt-1.5 text-[10.5px] tabular-nums whitespace-nowrap"
        style={{ color: tint }}
      >
        {readout}
      </div>

      {definition.isScalable ? (
        <div className="flex items-center justify-between gap-1 px-[9px] pt-[5px] pb-[7px]">
          <Stepper
            label={`Remove a replica from ${data.label}`}
            disabled={data.replicas <= MIN_REPLICAS}
            onClick={() => callbacks.onReplicasChange(id, data.replicas - 1)}
          >
            <Minus size={11} />
          </Stepper>
          <span className="text-[10.5px] text-neutral-400 tabular-nums">
            ×{data.replicas}
          </span>
          <Stepper
            label={`Add a replica to ${data.label}`}
            disabled={data.replicas >= MAX_REPLICAS}
            onClick={() => callbacks.onReplicasChange(id, data.replicas + 1)}
          >
            <Plus size={11} />
          </Stepper>
        </div>
      ) : (
        <div className="pb-[9px]" />
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'var(--color-accent-600)' }}
      />
    </div>
  )
})

function Stepper({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-[18px] place-items-center rounded-sm border border-neutral-800
                 text-text transition-colors hover:border-accent-600 hover:bg-accent-900
                 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-800
                 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

/**
 * Latency for the node card, where there is room for four characters and no
 * more. The fuller formatter in `format.ts` serves the panel, which can afford
 * three decimals on a sub-millisecond figure; here that would wrap.
 */
function formatShortLatency(milliseconds: number): string {
  if (milliseconds < 10) {
    return `${milliseconds.toFixed(1)} ms`
  }
  return `${Math.round(milliseconds)} ms`
}
