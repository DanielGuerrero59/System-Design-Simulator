/**
 * The info button on a parts-bin card, and the flyout it opens.
 *
 * Built on the Popover API rather than on React state and a portal, because
 * the browser then supplies the parts of an info flyout that are easy to get
 * subtly wrong by hand: the top layer, so the bin's scroll box cannot clip it;
 * light dismiss, so a click anywhere else or Escape closes it; one open at a
 * time; and the button's expanded state for assistive technology. The one
 * thing it does not supply is a position, which is `placeFlyout`'s job.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Info } from '@phosphor-icons/react'

import type { ComponentDefinition } from '../design/catalog'
import {
  placeFlyout,
  type AnchorBox,
  type FlyoutPlacement,
} from './flyoutPlacement'
import { partFigures } from './partFigures'

export interface PartInfoProps {
  part: ComponentDefinition
  /** Measures what the flyout lines up with, at the moment it opens. */
  locateAnchor: () => AnchorBox | null
  /** Positions the button. Where it sits on the card is the card's call. */
  className?: string
}

export function PartInfo({ part, locateAnchor, className = '' }: PartInfoProps) {
  const flyoutId = useId()
  const flyoutRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<FlyoutPlacement | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  // Fixed to the viewport, an open flyout would stay put while the card it
  // describes scrolled or reflowed away from it. Closing is simpler than
  // following, and the next click opens it in the right place.
  useEffect(() => {
    const flyout = flyoutRef.current
    if (!isOpen || flyout === null) {
      return
    }
    const close = (event: Event) => {
      // A flyout capped by a short viewport scrolls itself. That is reading,
      // not leaving.
      if (event.target instanceof Node && flyout.contains(event.target)) {
        return
      }
      flyout.hidePopover()
    }
    window.addEventListener('resize', close)
    // Captured, because scroll does not bubble and the bin is its own scroller.
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [isOpen])

  const Icon = part.icon
  const figures = partFigures(part)

  return (
    <>
      <button
        type="button"
        popoverTarget={flyoutId}
        aria-label={`${part.label}: what it does`}
        className={`grid size-5 place-items-center rounded-sm transition-colors
                    hover:bg-neutral-800 hover:text-text ${
                      isOpen ? 'text-accent-300' : 'text-neutral-500'
                    } ${className}`}
      >
        <Info size={13} />
      </button>

      <div
        ref={flyoutRef}
        id={flyoutId}
        popover="auto"
        onBeforeToggle={(event) => {
          const anchor = event.newState === 'open' ? locateAnchor() : null
          if (anchor === null) {
            return
          }
          // Committed now rather than on React's next render: the browser
          // shows the popover as soon as this handler returns, and one frame
          // at the default spot -- the middle of the viewport -- would flash.
          const next = placeFlyout(anchor, window.innerHeight)
          flushSync(() => setPlacement(next))
        }}
        onToggle={(event) => setIsOpen(event.newState === 'open')}
        style={{ ...placement, animation: 'nx-in 0.14s ease-out' }}
        // `inset-auto` and `m-0` undo the user-agent popover style, which
        // centres the element in the viewport; the placement sets the rest.
        className="inset-auto m-0 w-64 overflow-y-auto rounded-md border-0 bg-surface
                   p-3 text-text shadow-md"
      >
        <div className="mb-2 flex items-center gap-2">
          <Icon size={16} className="shrink-0 text-accent-400" />
          <span className="font-heading text-[13px] font-medium">{part.label}</span>
        </div>

        <p className="text-[11.5px] leading-relaxed text-neutral-300">{part.purpose}</p>

        <div className="mt-3 mb-1 text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
          In this sandbox
        </div>
        <p className="text-[11.5px] leading-relaxed text-neutral-300">
          {part.inThisSandbox}
        </p>

        <dl
          className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t
                     border-neutral-800 pt-2 text-[10.5px] tabular-nums"
        >
          <dt className="text-neutral-500">Serves</dt>
          <dd>{figures.serves}</dd>
          <dt className="text-neutral-500">Costs</dt>
          <dd>{figures.costs}</dd>
        </dl>
      </div>
    </>
  )
}
