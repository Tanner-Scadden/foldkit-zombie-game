// The World on the wire: a snapshot reads back as the World, and a client
// that applies every diff holds what a snapshot of the room's World gives.

import { Struct } from 'effect'
import { describe, expect, test } from 'vitest'

import { makeReader, makeWriter } from '../../packages/netcode/src/Wire'
import { refreshIntent } from '../../src/frame'
import { soloInputs, stepWorld } from '../../src/stepWorld'
import { World } from '../../src/world'
import {
  applyWorldDiff,
  diffWorld,
  readWorldSnapshot,
  snapshotWorld,
} from '../../src/worldWire'
import { firstDifference } from './diff'
import { playFrame, startedRun } from './script'

const WORLD_KEYS = Struct.keys(World.fields)

const roundTrip = (world: World): World => {
  const writer = makeWriter()
  snapshotWorld(writer, world)
  return readWorldSnapshot(makeReader(writer.finish()))
}

describe('the World on the wire', () => {
  test('diffs applied every third tick hold what a snapshot holds', () => {
    const played = Array.from({ length: 600 }).reduce(
      (model: ReturnType<typeof startedRun>, _, frame) =>
        playFrame(model, frame, 'Fixed60'),
      startedRun(2, 'Campaign'),
    )
    const intended = refreshIntent(played)
    const start: World = Struct.pick(intended, WORLD_KEYS)
    const room = Array.from({ length: 180 }).reduce<
      Readonly<{ world: World; client: World }>
    >(
      ({ world, client }, _, tick) => {
        const next = stepWorld(world, soloInputs(intended.intent)).world
        if (tick % 3 !== 2) {
          return { world: next, client }
        }
        const writer = makeWriter()
        diffWorld(writer, client, next)
        return {
          world: next,
          client: applyWorldDiff(makeReader(writer.finish()), client),
        }
      },
      { world: start, client: roundTrip(start) },
    )
    expect(firstDifference(roundTrip(room.world), room.client)).toBe(undefined)
    expect(room.client.elapsedMs).toBeGreaterThan(start.elapsedMs)
  })

  test('an unchanged World diffs to nothing', () => {
    const world = Struct.pick(startedRun(1, 'Campaign'), WORLD_KEYS)
    const writer = makeWriter()
    diffWorld(writer, world, world)
    expect(writer.finish().length).toBe(1)
  })
})
