/**
 * The translation from "what the player drew" to "what the API accepts".
 *
 * Every rule here mirrors a constraint in `backend/app/schemas.py`. Getting one
 * wrong does not produce a wrong picture -- it produces a 422 with a red banner
 * and a design the player can see nothing wrong with.
 */

import { describe, expect, it } from 'vitest'

import type { ComponentType } from '../api/types'
import { buildSimulationRequest } from './request'
import type { DesignEdge, DesignNode } from './types'

function node(
  id: string,
  componentType: ComponentType,
  over: Partial<DesignNode['data']> = {},
): DesignNode {
  return {
    id,
    type: 'component',
    position: { x: 123, y: 456 },
    data: {
      componentType,
      label: 'A name the player chose',
      replicas: 1,
      serviceRateRps: null,
      hitRatio: null,
      ...over,
    },
  }
}

const edge = (source: string, target: string): DesignEdge => ({
  id: `${source}->${target}`,
  source,
  target,
})

describe('buildSimulationRequest', () => {
  it('sends ids, types and replicas', () => {
    const request = buildSimulationRequest(
      [node('api-1', 'app_server', { replicas: 4 })],
      [],
      1000,
    )

    expect(request.nodes).toEqual([
      { id: 'api-1', type: 'app_server', config: { replicas: 4 } },
    ])
    expect(request.traffic).toEqual({ requests_per_second: 1000 })
  })

  it('drops position and label', () => {
    // Not cosmetic pedantry: the schema rejects unknown fields, and positions
    // are also what lets a dragged node keep its numbers -- the serialised
    // request is the staleness key in `useSimulation`.
    const serialised = JSON.stringify(
      buildSimulationRequest([node('api-1', 'app_server')], [], 1000),
    )

    expect(serialised).not.toContain('123')
    expect(serialised).not.toContain('A name the player chose')
  })

  it('omits a service rate override rather than sending null', () => {
    const [first] = buildSimulationRequest(
      [node('db-1', 'database')],
      [],
      1000,
    ).nodes

    expect(first?.config && 'service_rate_rps' in first.config).toBe(false)
  })

  it('sends a hit ratio for a cache', () => {
    const [first] = buildSimulationRequest(
      [node('cache-1', 'cache', { hitRatio: 0.9 })],
      [],
      1000,
    ).nodes

    expect(first?.config?.hit_ratio).toBe(0.9)
  })

  it('never sends a hit ratio on a component that is not a cache', () => {
    // The schema rejects the whole request for this, so a ratio left behind by
    // an earlier edit would fail a design that looks perfectly fine.
    const [first] = buildSimulationRequest(
      [node('db-1', 'database', { hitRatio: 0.9 })],
      [],
      1000,
    ).nodes

    expect(first?.config && 'hit_ratio' in first.config).toBe(false)
  })

  it('deduplicates edges, as the engine does', () => {
    const request = buildSimulationRequest(
      [node('api-1', 'app_server'), node('db-1', 'database')],
      [edge('api-1', 'db-1'), edge('api-1', 'db-1')],
      1000,
    )

    expect(request.edges).toEqual([{ source: 'api-1', target: 'db-1' }])
  })
})
