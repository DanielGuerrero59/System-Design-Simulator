/**
 * An info button, and the flyout it opens.
 *
 * Shared by the parts bin (what a part does) and the objective panel (what a
 * goal asks for), so both explain themselves the same way. The caller supplies
 * the words and says where the button sits; this supplies everything else.
 *
 * Built on the Popover API rather than on React state and a portal, because
 * the browser then supplies the parts of an info flyout that are easy to get
 * subtly wrong by hand: the top layer, so a rail's scroll box cannot clip it;
 * light dismiss, so a click anywhere else or Escape closes it; one open at a
 * time; and the button's expanded state for assistive technology. The one
 * thing it does not supply is a position, which is `placeFlyout`'s job.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { Info, type Icon } from '@phosphor-icons/react'

import {
  placeFlyout,
  type AnchorBox,
  type FlyoutPlacement,
  type FlyoutSide,
} from './flyoutPlacement'

export interface InfoFlyoutProps {
  /** The button's accessible name, e.g. "Cache: what it does". */
  label: string
  /** The flyout's heading. */
  title: string
  icon?: Icon
  /** Which way it opens: toward the canvas, away from the rail it is in. */
  side: FlyoutSide
  /** Measures what the flyout lines up with, at the moment it opens. */
  locateAnchor: () => AnchorBox | null
  /** Positions the button. Where it sits is the caller's call. */
  className?: string
  children: ReactNode
}

export function InfoFlyout({
  label,
  title,
  icon: TitleIcon,
  side,
  locateAnchor,
  className = '',
  children,
}: InfoFlyoutProps) {
  const flyoutId = useId()
  const flyoutRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<FlyoutPlacement | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  // Fixed to the viewport, an open flyout would stay put while the row it
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
    // Captured, because scroll does not bubble and each rail is its own
    // scroller.
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        popoverTarget={flyoutId}
        aria-label={label}
        className={`grid size-5 shrink-0 place-items-center rounded-sm transition-colors
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
          // The layout viewport, not `innerWidth`: `right` is measured from
          // the edge a scrollbar would stand in front of.
          const { clientWidth, clientHeight } = document.documentElement
          const next = placeFlyout(anchor, side, {
            width: clientWidth,
            height: clientHeight,
          })
          // Committed now rather than on React's next render: the browser
          // shows the popover as soon as this handler returns, and one frame
          // at the default spot -- the middle of the viewport -- would flash.
          flushSync(() => setPlacement(next))
        }}
        onToggle={(event) => setIsOpen(event.newState === 'open')}
        style={{ ...placement, animation: 'nx-in 0.14s ease-out' }}
        // `inset-auto` and `m-0` undo the user-agent popover style, which
        // centres the element in the viewport; the placement sets the rest.
        className="inset-auto m-0 w-64 overflow-y-auto rounded-md border-0 bg-surface
                   p-3 text-left text-text shadow-md"
      >
        <div className="mb-2 flex items-center gap-2">
          {TitleIcon ? (
            <TitleIcon size={16} className="shrink-0 text-accent-400" />
          ) : null}
          <span className="font-heading text-[13px] font-medium">{title}</span>
        </div>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </>
  )
}

/** A captioned paragraph inside a flyout, so every one reads the same way. */
export function InfoSection({
  caption,
  children,
}: {
  caption?: string
  children: ReactNode
}) {
  return (
    <div>
      {caption !== undefined ? (
        <div className="mb-1 text-[10px] tracking-[0.14em] text-neutral-500 uppercase">
          {caption}
        </div>
      ) : null}
      <p className="text-[11.5px] leading-relaxed text-neutral-300">{children}</p>
    </div>
  )
}
