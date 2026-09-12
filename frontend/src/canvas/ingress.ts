/**
 * Constants for the decorative traffic source.
 *
 * Split from the component itself so that file exports a component and nothing
 * else, which is what lets fast refresh swap it without reloading the page.
 */

export const INGRESS_NODE_ID = '__ingress'

/**
 * Stated on the node rather than measured.
 *
 * React Flow keeps a controlled node at `visibility: hidden` until its measured
 * size has round-tripped back through `onNodesChange`. The ingress node is not
 * in the design store, so that trip never completes -- and without an explicit
 * size it stays invisible forever.
 */
export const INGRESS_SIZE = { width: 74, height: 62 }
