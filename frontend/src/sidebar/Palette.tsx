/**
 * The component palette.
 *
 * Each entry is a real button that also happens to be draggable. Drag-and-drop
 * is the nicer gesture, but it is mouse-only: a keyboard user gets no drop
 * event at all. Making the same element clickable means "add a database" is one
 * Enter press away, and costs nothing to anyone using a mouse.
 */

import type { DragEvent } from 'react'

import type { ComponentType } from '../api/types'
import { COMPONENT_CATALOG, PALETTE_ORDER } from '../design/catalog'
import { setDragPayload } from '../design/dragAndDrop'
import { formatRate } from '../format'

interface PaletteProps {
  onAdd: (componentType: ComponentType) => void
  /** True once the design has as many components as the backend will accept. */
  disabled: boolean
}

export function Palette({ onAdd, disabled }: PaletteProps) {
  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    componentType: ComponentType,
  ) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    setDragPayload(event.dataTransfer, componentType)
  }

  return (
    <section aria-labelledby="palette-heading">
      <h2
        id="palette-heading"
        className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"
      >
        Components
      </h2>

      <ul className="space-y-1.5">
        {PALETTE_ORDER.map((componentType) => {
          const definition = COMPONENT_CATALOG[componentType]
          return (
            <li key={componentType}>
              <button
                type="button"
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(event) => handleDragStart(event, componentType)}
                onClick={() => onAdd(componentType)}
                // Named explicitly because the blurb below is a `title`, and a
                // title is what a screen reader falls back to. "Add Load
                // balancer" says what the button does; the blurb stays a
                // hover-only aside rather than becoming the button's name.
                aria-label={`Add ${definition.label}`}
                title={definition.blurb}
                className="flex w-full items-start gap-2 rounded-md border
                           border-slate-200 bg-white px-2.5 py-2 text-left
                           transition-colors hover:border-slate-400
                           hover:bg-slate-50 focus:outline-none
                           focus-visible:ring-2 focus-visible:ring-slate-900/40
                           disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px]
                              font-bold tracking-wide
                              ${definition.badgeClassName}`}
                >
                  {definition.abbreviation}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">
                    {definition.label}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {formatRate(definition.defaultServiceRateRps)} each
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {disabled
          ? 'This design is already at the maximum number of components.'
          : 'Drag onto the canvas, or click to drop one in. Join components by dragging from a right edge to a left one.'}
      </p>
    </section>
  )
}
