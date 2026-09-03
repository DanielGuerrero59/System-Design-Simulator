/**
 * The palette: what each component type is called, and how it is drawn.
 *
 * This is presentation metadata only. The simulation numbers all come from the
 * backend -- the service rates below are mirrors of the defaults in
 * `backend/app/simulation/constants.py`, shown to the user as placeholder text
 * so they can see what they are overriding. Nothing here is ever sent to the
 * API; the wire format carries the `ComponentType` string and nothing else.
 *
 * Tailwind class names are written out in full rather than assembled from
 * fragments. Tailwind v4 scans source text for complete class names, so a
 * template literal like `bg-${accent}-500` produces no CSS at all.
 */

import type { ComponentType } from '../api/types'

export interface ComponentDefinition {
  type: ComponentType
  /** Human name, used in the palette and as a new node's starting label. */
  label: string
  /** Two or three characters for the node's badge. */
  abbreviation: string
  /** One line on what this component does to traffic. */
  blurb: string
  /**
   * Per-instance default service rate, mirroring DEFAULT_SERVICE_RATES_RPS.
   * Display only: omitting the override makes the backend apply its own value.
   */
  defaultServiceRateRps: number
  /** Stem for generated node ids, e.g. "db" -> "db-1". */
  idPrefix: string
  /** Badge colour. Identity only -- health colouring is layered on top. */
  badgeClassName: string
}

/**
 * Keyed by ComponentType, so adding a type to the backend enum and then to
 * `api/types.ts` surfaces here as a missing-property error rather than as an
 * undefined lookup at runtime.
 */
export const COMPONENT_CATALOG: Record<ComponentType, ComponentDefinition> = {
  load_balancer: {
    type: 'load_balancer',
    label: 'Load balancer',
    abbreviation: 'LB',
    blurb: 'Spreads incoming traffic across everything downstream.',
    defaultServiceRateRps: 50_000,
    idPrefix: 'lb',
    badgeClassName: 'bg-sky-100 text-sky-700',
  },
  app_server: {
    type: 'app_server',
    label: 'App server',
    abbreviation: 'APP',
    blurb: 'Runs your business logic. The slowest tier, and the easiest to replicate.',
    defaultServiceRateRps: 2_000,
    idPrefix: 'api',
    badgeClassName: 'bg-violet-100 text-violet-700',
  },
  cache: {
    type: 'cache',
    label: 'Cache',
    abbreviation: 'CACHE',
    blurb: 'Answers most reads itself, so only the misses continue downstream.',
    defaultServiceRateRps: 100_000,
    idPrefix: 'cache',
    badgeClassName: 'bg-amber-100 text-amber-700',
  },
  database: {
    type: 'database',
    label: 'Database',
    abbreviation: 'DB',
    blurb: 'Durable storage. Hard to scale out, so usually the first real wall.',
    defaultServiceRateRps: 5_000,
    idPrefix: 'db',
    badgeClassName: 'bg-emerald-100 text-emerald-700',
  },
  message_queue: {
    type: 'message_queue',
    label: 'Message queue',
    abbreviation: 'MQ',
    blurb: 'Append-only log. Cheap sequential writes, so rarely the constraint.',
    defaultServiceRateRps: 20_000,
    idPrefix: 'queue',
    badgeClassName: 'bg-rose-100 text-rose-700',
  },
}

/** Palette order: roughly the order traffic meets them in a typical design. */
export const PALETTE_ORDER: ComponentType[] = [
  'load_balancer',
  'app_server',
  'cache',
  'database',
  'message_queue',
]

/**
 * Narrow an untrusted string to a ComponentType.
 *
 * Used on the drag-and-drop payload. A drop event can carry text from anywhere
 * -- another tab, a text editor, a crafted page -- so the string that arrives is
 * checked against the catalog before it is allowed to become a node, rather
 * than trusted because it came through our own drag handler.
 */
export function isComponentType(value: unknown): value is ComponentType {
  return typeof value === 'string' && Object.hasOwn(COMPONENT_CATALOG, value)
}
