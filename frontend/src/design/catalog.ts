/**
 * The parts bin: what each component type is called, how it is drawn, what it
 * is for, and what it costs to place.
 *
 * Two different kinds of number live here, and they are not interchangeable.
 *
 * `defaultServiceRateRps` and `CACHE_HIT_RATIO` are *mirrors* of constants in
 * `backend/app/simulation/constants.py`. They are shown to the user so a part
 * can be compared against another before it is placed, but they are never
 * sent: the backend applies its own values, and these copies existing does not
 * make them inputs. If the two drift, the backend is right and this file is
 * wrong.
 *
 * `credits` is a *game* number with no backend counterpart at all. It is the
 * budget pressure that makes a level a puzzle rather than an exercise in adding
 * replicas until the colours go quiet -- the thing that makes a cache worth
 * reaching for instead of a fourth database.
 *
 * Each part also carries two pieces of prose for its info button, and they
 * answer different questions. `purpose` is what the part does in a real
 * system. `inThisSandbox` is what the simulation actually does with it, which
 * is sometimes less -- a message queue here does not soak up a burst. The
 * second is the one a player acts on, so it has to stay true to
 * `backend/app/simulation/components.py`; `catalog.test.ts` checks the claims
 * in it that a retune could quietly make false.
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
import { formatPercent } from '../format'

/**
 * Mirrors DEFAULT_CACHE_HIT_RATIO. Display only -- a new cache node sends no
 * hit ratio, so the backend's own default is the one that applies.
 */
export const CACHE_HIT_RATIO = 0.8

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
  /** What the part is for in a real system. Shown behind its info button. */
  purpose: string
  /** How the simulation treats it: the behaviour a design can rely on. */
  inThisSandbox: string
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
    purpose:
      'The front door. It takes every incoming request and hands it to one of the servers behind it, so no single server has to carry the whole load.',
    // The even split is the engine's fan-out rule, not something special to
    // this class -- but a load balancer is where a player meets it.
    inThisSandbox:
      'Splits its traffic evenly across the wires leading out of it, so three app servers behind it take a third each. It runs as a single instance and is rarely the part that gives out first.',
  },
  app_server: {
    type: 'app_server',
    label: 'App server',
    defaultServiceRateRps: 2_000,
    credits: 2,
    isScalable: true,
    idPrefix: 'api',
    icon: Cpu,
    purpose:
      'Runs the application code — business logic, building responses, calling the database. It keeps no state of its own, which makes it the easiest tier to scale out.',
    inThisSandbox:
      'The slowest part per instance. Each replica is its own queue taking an equal share of the traffic, so adding replicas is how this tier keeps up.',
  },
  cache: {
    type: 'cache',
    label: 'Cache',
    defaultServiceRateRps: 100_000,
    credits: 3,
    isScalable: true,
    idPrefix: 'cache',
    icon: Lightning,
    purpose:
      'Keeps frequently read data in memory, so a repeat request is answered without a trip to the database behind it.',
    inThisSandbox: `Answers ${formatPercent(CACHE_HIT_RATIO)} of requests itself; only the ${formatPercent(1 - CACHE_HIT_RATIO)} that miss carry on to whatever is wired behind it. It still sees every request — it has to look before it can answer.`,
  },
  database: {
    type: 'database',
    label: 'Database',
    defaultServiceRateRps: 5_000,
    credits: 4,
    isScalable: true,
    idPrefix: 'db',
    icon: Database,
    purpose:
      'The system of record. It keeps the data safely on disk, and every read a cache cannot answer, and every write, ends up here.',
    inThisSandbox:
      'Replicas split its traffic evenly, but each one is the most expensive part in the bin — which is when a cache in front of it starts to pay for itself.',
  },
  message_queue: {
    type: 'message_queue',
    label: 'Message queue',
    defaultServiceRateRps: 20_000,
    credits: 2,
    isScalable: true,
    idPrefix: 'queue',
    icon: ListDashes,
    purpose:
      'A buffer between services. Producers drop messages in and move on; consumers work through them at their own pace, so a burst can wait in line instead of hitting the next service all at once.',
    // Said plainly because the purpose above promises more than the model
    // delivers: downstream traffic is the offered load, not the queue's
    // throughput, so a player who reaches for a queue to protect a database
    // should learn why it did not help from this card, not from a red node.
    inThisSandbox:
      'Modelled here as a fast pass-through: everything it receives carries straight on, so it does not shield the parts behind it from a burst.',
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
