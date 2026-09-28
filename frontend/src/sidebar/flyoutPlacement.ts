/**
 * Where a part's info flyout sits: just outside the parts bin, level with the
 * card it describes.
 *
 * The flyout is a popover, so it renders in the browser's top layer and is
 * positioned against the viewport. That is what lets it escape the parts bin,
 * which scrolls and would otherwise clip anything wider than itself -- and it
 * is why the position has to be computed here rather than left to the layout.
 *
 * It is placed before it is shown, while it is still `display: none` and has
 * no height to measure. So instead of fitting a known size, it hangs from
 * whichever edge of the card has more of the viewport beyond it, and is
 * capped at that room: it can scroll, but it never runs off the screen.
 */

/** Between the bin's right edge and the flyout. */
export const FLYOUT_GAP_PX = 8

/** Kept free at the top and bottom of the viewport. */
export const VIEWPORT_MARGIN_PX = 8

/**
 * What the flyout lines up with, in viewport pixels. The top and bottom are
 * the card's; the right edge is the bin's, not the card's, because the card
 * sits inside the bin's padding and, when the bin scrolls, beside its
 * scrollbar -- a flyout measured from the card would land on top of both.
 */
export interface AnchorBox {
  top: number
  bottom: number
  right: number
}

/**
 * Viewport coordinates, in pixels, named after the CSS properties they set so
 * the result can be handed to `style` as it is.
 */
export type FlyoutPlacement =
  | { left: number; top: number; maxHeight: number }
  | { left: number; bottom: number; maxHeight: number }

export function placeFlyout(
  anchor: AnchorBox,
  viewportHeight: number,
): FlyoutPlacement {
  const left = anchor.right + FLYOUT_GAP_PX
  // Top-aligned with the card, the flyout grows downward; bottom-aligned, it
  // grows upward. Measured from the far edge of the card each way, so either
  // choice keeps the flyout level with the card it belongs to.
  const roomBelow = viewportHeight - VIEWPORT_MARGIN_PX - anchor.top
  const roomAbove = anchor.bottom - VIEWPORT_MARGIN_PX
  if (roomBelow >= roomAbove) {
    return { left, top: anchor.top, maxHeight: roomBelow }
  }
  return {
    left,
    bottom: viewportHeight - anchor.bottom,
    maxHeight: roomAbove,
  }
}
