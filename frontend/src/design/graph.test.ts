/**
 * The graph questions the UI answers without asking the backend.
 *
 * The engine (`backend/app/simulation/engine.py`) remains the authority on
 * every rule here. These tests exist because this copy has to agree with it:
 * when it does not, the player is either told a valid design is broken or
 * allowed to draw one the API will reject on submit.
 */

import { describe, expect, it } from 'vitest'

import {
  buildAdjacency,
  canReach,
  dedupeEdges,
  findEntryPoints,
  findUnreachableFromEntries,
  reachableFrom,
} from './graph'

const edge = (source: string, target: string) => ({ source, target })

describe('dedupeEdges', () => {
  it('collapses a repeated hop', () => {
    // A duplicate would be counted twice when splitting fan-out traffic, and
    // would inflate an in-degree into a cycle that is not there.
    const edges = [edge('a', 'b'), edge('a', 'b'), edge('b', 'c')]

    expect(dedupeEdges(edges)).toEqual([edge('a', 'b'), edge('b', 'c')])
  })

  it('keeps hops that differ only by direction', () => {
    const edges = [edge('a', 'b'), edge('b', 'a')]

    expect(dedupeEdges(edges)).toHaveLength(2)
  })
})

describe('reachableFrom', () => {
  it('excludes the starting node when nothing points back at it', () => {
    // The distinction that makes the game a game: a lone box does not reach
    // itself through any edge, so traffic pointed at it has gone nowhere.
    const adjacency = buildAdjacency(['a'], [])

    expect(reachableFrom(adjacency, 'a').has('a')).toBe(false)
  })

  it('follows a chain to the end', () => {
    const adjacency = buildAdjacency(
      ['a', 'b', 'c'],
      [edge('a', 'b'), edge('b', 'c')],
    )

    expect([...reachableFrom(adjacency, 'a')].sort()).toEqual(['b', 'c'])
  })

  it('covers every branch of a fan-out', () => {
    const adjacency = buildAdjacency(
      ['lb', 'x', 'y', 'db'],
      [edge('lb', 'x'), edge('lb', 'y'), edge('x', 'db'), edge('y', 'db')],
    )

    expect([...reachableFrom(adjacency, 'lb')].sort()).toEqual([
      'db',
      'x',
      'y',
    ])
  })

  it('does not reach backwards along an edge', () => {
    const adjacency = buildAdjacency(['a', 'b'], [edge('a', 'b')])

    expect(reachableFrom(adjacency, 'b').size).toBe(0)
  })
})

describe('findEntryPoints', () => {
  it('finds the single node nothing points at', () => {
    expect(
      findEntryPoints(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')]),
    ).toEqual(['a'])
  })

  it('reports every unconnected chain, because the engine rejects more than one', () => {
    expect(findEntryPoints(['a', 'b', 'c'], [edge('a', 'b')])).toEqual([
      'a',
      'c',
    ])
  })

  it('ignores an edge whose source has been deleted', () => {
    // React Flow can hold a dangling edge for a frame while a delete is applied.
    // Counting it would make 'b' look like it still has a predecessor, and this
    // function would disagree with buildAdjacency about whether an entry point
    // exists at all.
    expect(findEntryPoints(['b'], [edge('gone', 'b')])).toEqual(['b'])
  })

  it('returns nothing for a closed loop', () => {
    expect(findEntryPoints(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])).toEqual(
      [],
    )
  })
})

describe('findUnreachableFromEntries', () => {
  it('is empty for a well-formed chain', () => {
    expect(
      findUnreachableFromEntries(
        ['a', 'b', 'c'],
        [edge('a', 'b'), edge('b', 'c')],
      ),
    ).toEqual([])
  })

  it('names the nodes caught in a cycle', () => {
    expect(
      findUnreachableFromEntries(
        ['a', 'b', 'c'],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'b')],
      ).sort(),
    ).toEqual(['b', 'c'])
  })

  it('does not report a cycle because of a dangling edge', () => {
    // The guard that keeps this agreeing with buildAdjacency: an edge from a
    // deleted node must not leave 'b' with an in-degree Kahn can never clear.
    expect(findUnreachableFromEntries(['b'], [edge('gone', 'b')])).toEqual([])
  })
})

describe('canReach', () => {
  it('treats a node as reaching itself', () => {
    // Deliberate, and the reason `reachableFrom` exists separately: this is the
    // right answer for the cycle guard, where "can the target already get back
    // to the source" must be true when they are the same node.
    expect(canReach(buildAdjacency(['a'], []), 'a', 'a')).toBe(true)
  })

  it('detects the edge that would close a loop', () => {
    const adjacency = buildAdjacency(
      ['a', 'b', 'c'],
      [edge('a', 'b'), edge('b', 'c')],
    )

    // Adding c -> a would create a cycle exactly because a already reaches c.
    expect(canReach(adjacency, 'a', 'c')).toBe(true)
    expect(canReach(adjacency, 'c', 'a')).toBe(false)
  })
})
