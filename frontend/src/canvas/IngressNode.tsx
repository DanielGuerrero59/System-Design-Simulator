/**
 * The traffic source.
 *
 * This is scenery, not a component. The backend infers the entry point from the
 * graph -- the one node nothing points at -- so there is no "traffic" node in
 * the design and none is ever sent. What this draws is the answer to a question
 * the canvas otherwise leaves unanswered: where does the load actually come in?
 * Without it a player reads a chain of boxes with no beginning.
 *
 * It is deliberately inert: not draggable, not selectable, and with no source
 * port to pull a wire from. Letting a player attach it by hand would let them
 * nominate a second entry point, which the engine rejects outright -- an error
 * message standing in for a design the UI should simply never allow.
 */

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { UsersThree } from '@phosphor-icons/react'

export const IngressNode = memo(function IngressNode() {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md
                 border border-dashed border-accent-700"
      style={{
        background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
      }}
    >
      <UsersThree size={20} className="text-accent-400" />
      <span className="text-[9.5px] tracking-[0.12em] text-accent-300 uppercase">
        Traffic
      </span>
      {/* Present only so an edge has something to leave from; the node is not
          connectable, so it can never be wired by hand. */}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={{ background: 'var(--color-accent)' }}
      />
    </div>
  )
})
