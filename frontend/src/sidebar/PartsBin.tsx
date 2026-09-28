/**
 * The parts bin.
 *
 * Each row shows the two numbers that decide whether a part is worth placing:
 * what it can serve (mu) and what it costs. Showing them before the click is
 * the point -- the level is a budgeting problem, and a player who has to place
 * a component to find out its price is guessing rather than designing. The
 * info button in each row's corner says what the part is for, and what the
 * simulation does with it.
 */

import { useRef, type RefObject } from 'react'

import {
  COMPONENT_CATALOG,
  PALETTE_ORDER,
  type ComponentDefinition,
} from '../design/catalog'
import type { ComponentType } from '../api/types'
import type { AnchorBox } from '../info/flyoutPlacement'
import { PartInfo } from './PartInfo'

export interface PartsBinProps {
  onAdd: (componentType: ComponentType) => void
  disabled: boolean
}

export function PartsBin({ onAdd, disabled }: PartsBinProps) {
  const binRef = useRef<HTMLElement>(null)

  return (
    <aside
      ref={binRef}
      className="flex w-46 shrink-0 flex-col gap-2 overflow-y-auto border-r border-divider
                 px-3 py-3.5"
    >
      <div className="mb-0.5 text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
        Parts bin
      </div>

      {PALETTE_ORDER.map((componentType) => (
        <PartCard
          key={componentType}
          part={COMPONENT_CATALOG[componentType]}
          binRef={binRef}
          onAdd={onAdd}
          disabled={disabled}
        />
      ))}

      <p className="mt-auto pt-3 text-[10.5px] leading-relaxed text-neutral-500">
        Click a part to drop it in. Drag from the right dot of one node to the
        left dot of another to wire them. Select a wire and press Backspace to
        cut it.
      </p>
    </aside>
  )
}

interface PartCardProps {
  part: ComponentDefinition
  /** The bin whose edge the info flyout opens against. */
  binRef: RefObject<HTMLElement | null>
  onAdd: (componentType: ComponentType) => void
  disabled: boolean
}

function PartCard({ part, binRef, onAdd, disabled }: PartCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const Icon = part.icon

  const locateAnchor = (): AnchorBox | null => {
    const card = cardRef.current
    const bin = binRef.current
    if (card === null || bin === null) {
      return null
    }
    const { top, bottom } = card.getBoundingClientRect()
    return { top, bottom, edge: bin.getBoundingClientRect().right }
  }

  return (
    // The info button is laid over the add button rather than put inside it:
    // a button cannot contain another one, and a click on the info would
    // otherwise also drop the part on the canvas. It stays enabled at the node
    // limit, when adding is not possible but reading still is.
    <div ref={cardRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onAdd(part.type)}
        className="grid w-full grid-cols-[26px_1fr] items-center gap-x-[9px] gap-y-px
                   rounded-md border border-neutral-800 bg-surface px-2.5 py-[9px]
                   text-left transition-colors hover:border-accent-700 hover:bg-accent-900
                   disabled:cursor-not-allowed disabled:opacity-45
                   disabled:hover:border-neutral-800 disabled:hover:bg-surface"
      >
        <Icon size={19} className="justify-self-center text-accent-400" />
        <span className="min-w-0 font-heading text-[12.5px] font-medium">
          {part.label}
        </span>
        {/* Second row, second column. The cell before it is left empty for
            the info button. */}
        <span className="col-start-2 text-[10.5px] text-neutral-500 tabular-nums">
          μ {part.defaultServiceRateRps.toLocaleString()} · {part.credits} cr
        </span>
      </button>

      {/* Centred on the add button's empty bottom-left cell. Left 14px: the
          1px border, the 10px padding, and 3px to centre 20px in the 26px
          column. Bottom 8px: the 1px border, the 9px padding, less the 2px
          the 20px button overhangs the 16px row at each edge. */}
      <PartInfo
        part={part}
        locateAnchor={locateAnchor}
        className="absolute bottom-2 left-3.5"
      />
    </div>
  )
}
