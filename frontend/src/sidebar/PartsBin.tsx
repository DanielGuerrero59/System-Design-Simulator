/**
 * The parts bin.
 *
 * Each row shows the two numbers that decide whether a part is worth placing:
 * what it can serve (mu) and what it costs. Showing them before the click is
 * the point -- the level is a budgeting problem, and a player who has to place
 * a component to find out its price is guessing rather than designing.
 */

import { COMPONENT_CATALOG, PALETTE_ORDER } from '../design/catalog'
import type { ComponentType } from '../api/types'

export interface PartsBinProps {
  onAdd: (componentType: ComponentType) => void
  disabled: boolean
}

export function PartsBin({ onAdd, disabled }: PartsBinProps) {
  return (
    <aside
      className="flex w-46 shrink-0 flex-col gap-2 overflow-y-auto border-r border-divider
                 px-3 py-3.5"
    >
      <div className="mb-0.5 text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
        Parts bin
      </div>

      {PALETTE_ORDER.map((componentType) => {
        const definition = COMPONENT_CATALOG[componentType]
        const Icon = definition.icon
        return (
          <button
            key={componentType}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(componentType)}
            className="grid grid-cols-[26px_1fr] items-center gap-[9px] rounded-md border
                       border-neutral-800 bg-surface px-2.5 py-[9px] text-left
                       transition-colors hover:border-accent-700 hover:bg-accent-900
                       disabled:cursor-not-allowed disabled:opacity-45
                       disabled:hover:border-neutral-800 disabled:hover:bg-surface"
          >
            <Icon size={19} className="justify-self-center text-accent-400" />
            <span className="flex min-w-0 flex-col gap-px">
              <span className="font-heading text-[12.5px] font-medium">
                {definition.label}
              </span>
              <span className="text-[10.5px] text-neutral-500 tabular-nums">
                μ {definition.defaultServiceRateRps.toLocaleString()} ·{' '}
                {definition.credits} cr
              </span>
            </span>
          </button>
        )
      })}

      <p className="mt-auto pt-3 text-[10.5px] leading-relaxed text-neutral-500">
        Click a part to drop it in. Drag from the right dot of one node to the
        left dot of another to wire them. Select a wire and press Backspace to
        cut it.
      </p>
    </aside>
  )
}
