/**
 * A part's two numbers, spelled out for its info flyout.
 *
 * The card in the bin already shows them as "μ 2,000 · 2 cr": compact enough
 * to compare parts at a glance, too compact to learn from. Here each one gets
 * its unit and says what it is counted per, because "per replica" is the
 * whole trade-off -- scaling out multiplies what a tier can serve and what it
 * costs by the same factor.
 */

import type { ComponentDefinition } from '../design/catalog'
import { formatRate } from '../format'

export interface PartFigures {
  /** Service rate of one instance: μ, in requests per second. */
  serves: string
  /** Budget cost, per replica for a part that has them. */
  costs: string
}

export function partFigures(
  part: Pick<ComponentDefinition, 'defaultServiceRateRps' | 'credits' | 'isScalable'>,
): PartFigures {
  const rate = `μ ${formatRate(part.defaultServiceRateRps)}`
  const credits = `${part.credits} ${part.credits === 1 ? 'credit' : 'credits'}`
  if (!part.isScalable) {
    // No replica steppers on the node, so "per replica" would describe a
    // choice the player does not have.
    return { serves: `${rate} · one instance`, costs: credits }
  }
  return { serves: `${rate} per replica`, costs: `${credits} per replica` }
}
