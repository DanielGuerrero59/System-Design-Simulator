/**
 * The one thing the palette and the canvas have to agree on: how a component
 * type travels inside a drag.
 *
 * A custom MIME type rather than `text/plain`, so a drag that started somewhere
 * else -- a word from another tab, a file from the desktop -- carries nothing
 * we will read. That is a convenience, not a defence: `dataTransfer` contents
 * are attacker-controllable in principle, so the value that comes out is still
 * checked against the catalog before it is allowed to become a node.
 */

import { isComponentType } from './catalog'
import type { ComponentType } from '../api/types'

const DRAG_MIME_TYPE = 'application/x-system-design-component'

export function setDragPayload(
  dataTransfer: DataTransfer,
  componentType: ComponentType,
): void {
  dataTransfer.setData(DRAG_MIME_TYPE, componentType)
  dataTransfer.effectAllowed = 'copy'
}

/**
 * The component type being dragged, or null if this drag is not ours.
 *
 * Returning null for anything unrecognised -- rather than throwing, or trusting
 * the string -- means a stray drop over the canvas is simply ignored.
 */
export function readDragPayload(
  dataTransfer: DataTransfer | null,
): ComponentType | null {
  const value = dataTransfer?.getData(DRAG_MIME_TYPE)
  return isComponentType(value) ? value : null
}

/**
 * Whether a drag in progress is one of ours.
 *
 * Read during dragover, where the spec forbids reading the actual data -- only
 * the list of types is visible -- so this is a check on `types`, not on value.
 */
export function isOwnDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(DRAG_MIME_TYPE) ?? false
}
