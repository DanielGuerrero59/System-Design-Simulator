/**
 * The info button on a parts-bin card: what the part is for, what the sandbox
 * does with it, and its two numbers. The button and flyout are `InfoFlyout`'s;
 * this file is only the words.
 */

import type { ComponentDefinition } from '../design/catalog'
import type { AnchorBox } from '../info/flyoutPlacement'
import { InfoFlyout, InfoSection } from '../info/InfoFlyout'
import { partFigures } from './partFigures'

export interface PartInfoProps {
  part: ComponentDefinition
  /** Measures what the flyout lines up with, at the moment it opens. */
  locateAnchor: () => AnchorBox | null
  /** Positions the button. Where it sits on the card is the card's call. */
  className?: string
}

export function PartInfo({ part, locateAnchor, className }: PartInfoProps) {
  const figures = partFigures(part)

  return (
    <InfoFlyout
      label={`${part.label}: what it does`}
      title={part.label}
      icon={part.icon}
      side="right"
      locateAnchor={locateAnchor}
      className={className}
    >
      <InfoSection>{part.purpose}</InfoSection>
      <InfoSection caption="In this sandbox">{part.inThisSandbox}</InfoSection>
      <dl
        className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t
                   border-neutral-800 pt-2 text-[10.5px] tabular-nums"
      >
        <dt className="text-neutral-500">Serves</dt>
        <dd>{figures.serves}</dd>
        <dt className="text-neutral-500">Costs</dt>
        <dd>{figures.costs}</dd>
      </dl>
    </InfoFlyout>
  )
}
