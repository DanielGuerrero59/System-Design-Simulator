/**
 * Where an info flyout sits: just outside the rail it was opened from, level
 * with the row it describes.
 *
 * The flyout is a popover, so it renders in the browser's top layer and is
 * positioned against the viewport. That is what lets it escape the rails, which
 * scroll and would otherwise clip anything wider than themselves -- and it is
 * why the position has to be computed here rather than left to the layout.
 *
 * It opens toward the canvas: rightward from the parts bin, leftward from the
 * objective panel. It is placed before it is shown, while it is still
 * `display: none` and has no height to measure. So instead of fitting a known
 * size, it hangs from whichever edge of the row has more of the viewport
 * beyond it, and is capped at that room: it can scroll, but it never runs off
 * the screen.
 */

/** Between the rail's edge and the flyout. */
export const FLYOUT_GAP_PX = 8

/** Kept free at the top and bottom of the viewport. */
export const VIEWPORT_MARGIN_PX = 8

/** Which way the flyout opens from its rail. */
export type FlyoutSide = 'left' | 'right'

/**
 * What the flyout lines up with, in viewport pixels. The top and bottom are
 * the row's. `edge` is the rail's side facing the canvas -- the bin's right
 * edge, the panel's left -- not the row's: a row sits inside its rail's
 * padding and beside its scrollbar, and a flyout measured from the row would
 * land on top of both.
 */
export interface AnchorBox {
  top: number
  bottom: number
  edge: number
}

export interface ViewportSize {
  width: number
  height: number
}

/**
 * Viewport coordinates, in pixels, named after the CSS properties they set so
 * the result can be handed to `style` as it is.
 */
export type FlyoutPlacement = ({ left: number } | { right: number }) &
  ({ top: number } | { bottom: number }) & { maxHeight: number }

export function placeFlyout(
  anchor: AnchorBox,
  side: FlyoutSide,
  viewport: ViewportSize,
): FlyoutPlacement {
  // Opening leftward, the flyout's *right* edge is what is known, so it is set
  // with `right`, measured from the viewport's right-hand side.
  const across =
    side === 'right'
      ? { left: anchor.edge + FLYOUT_GAP_PX }
      : { right: viewport.width - anchor.edge + FLYOUT_GAP_PX }

  // Top-aligned with the row, the flyout grows downward; bottom-aligned, it
  // grows upward. Measured from the far edge of the row each way, so either
  // choice keeps the flyout level with the row it belongs to.
  const roomBelow = viewport.height - VIEWPORT_MARGIN_PX - anchor.top
  const roomAbove = anchor.bottom - VIEWPORT_MARGIN_PX
  if (roomBelow >= roomAbove) {
    return { ...across, top: anchor.top, maxHeight: roomBelow }
  }
  return {
    ...across,
    bottom: viewport.height - anchor.bottom,
    maxHeight: roomAbove,
  }
}
