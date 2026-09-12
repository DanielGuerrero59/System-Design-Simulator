/**
 * The parts bin: what each component type is called, how it is drawn, and what
 * it costs to place.
 *
 * Two different kinds of number live here, and they are not interchangeable.
 *
 * `defaultServiceRateRps` is a *mirror* of DEFAULT_SERVICE_RATES_RPS in
 * `backend/app/simulation/constants.py`. It is shown to the user so a part can
 * be compared against another before it is placed, but it is never sent: the
 * backend applies its own value, and this copy existing does not make it an
 * input. If the two drift, the backend is right and this file is wrong.
 *
 * `credits` is a *game* number with no backend counterpart at all. It is the
 * budget pressure that makes a level a puzzle rather than an exercise in adding
 * replicas until the colours go quiet -- the thing that makes a cache worth
 * reaching for instead of a fourth database.
 */

import type { Icon } from '@phosphor-icons/react'
import {
  Cpu,
  Database,
  GitFork,
  Lightning,
  ListDashes,
} from '@phosphor-icons/react'

import type { ComponentType } from '../api/types'

export interface ComponentDefinition {
  type: ComponentType
  /** Human name, used in the parts bin and as a new node's starting label. */
  label: string
  /** Mirrors DEFAULT_SERVICE_RATES_RPS. Display only -- never sent. */
  defaultServiceRateRps: number
  /** Budget cost to place one instance. Charged per replica, not per node. */
  credits: number
  /** Whether the replica steppers appear on the node. */
  isScalable: boolean
  /** Stem for generated node ids, e.g. "db" -> "db-1". */
  idPrefix: string
  icon: Icon
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
    defaultServiceRateRps: 50_000,
    credits: 3,
    // A load balancer is the thing traffic arrives at, and replicating the
    // front door is a different lesson (and a different queueing model) than
    // the one this game teaches. Left unscalable so the interesting choice
    // stays "where does the work go", not "how many doors are there".
    isScalable: false,
    idPrefix: 'lb',
    icon: GitFork,
  },
  app_server: {
    type: 'app_server',
    label: 'App server',
    defaultServiceRateRps: 2_000,
    credits: 2,
    isScalable: true,
    idPrefix: 'api',
    icon: Cpu,
  },
  cache: {
    type: 'cache',
    label: 'Cache',
    defaultServiceRateRps: 100_000,
    credits: 3,
    isScalable: true,
    idPrefix: 'cache',
    icon: Lightning,
  },
  database: {
    type: 'database',
    label: 'Database',
    defaultServiceRateRps: 5_000,
    credits: 4,
    isScalable: true,
    idPrefix: 'db',
    icon: Database,
  },
  message_queue: {
    type: 'message_queue',
    label: 'Message queue',
    defaultServiceRateRps: 20_000,
    credits: 2,
    isScalable: true,
    idPrefix: 'queue',
    icon: ListDashes,
  },
}

/** Parts-bin order: roughly the order traffic meets them in a typical design. */
export const PALETTE_ORDER: ComponentType[] = [
  'load_balancer',
  'app_server',
  'cache',
  'database',
  'message_queue',
]

/**
 * What one design costs, counting every replica.
 *
 * Replicas are charged individually because that is the trade-off the levels
 * are built around: scaling out is always *available*, and the budget is what
 * stops it from being the answer to everything.
 */
export function designCost(
  nodes: readonly { data: { componentType: ComponentType; replicas: number } }[],
): number {
  return nodes.reduce(
    (total, node) =>
      total + COMPONENT_CATALOG[node.data.componentType].credits * node.data.replicas,
    0,
  )
}
