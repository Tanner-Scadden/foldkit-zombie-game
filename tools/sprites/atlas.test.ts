import { Array, Option, Record } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'

import { levelOf } from '../../src/arena'
import { sceneShapes } from '../../src/layers'
import { type Model, Phase, initialModel } from '../../src/model'
import { fighting, withActors } from '../../src/model.fixture'
import { occludersOf } from '../../src/occluders'
import { roomShapes } from '../../src/room'
import { standInKeyOf } from '../../src/spriteAtlas'
import { SURFACE, imagesIn, openFloorSpot, zombieOf } from '../../src/testing'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from '../../src/zombies'

// NOTE: the atlas holds what ./build.ts finds: every sprite built
// as the modules load, and the ones src/spritePrecompile.ts builds. A sprite
// first built while drawing a scene would miss the atlas and be encoded on
// the main thread mid-game, so these scenes must draw only sprites the
// generator found. The generator runs in its own process, so the keys it
// lists do not depend on what other tests built.
const generatorKeys = (): ReadonlySet<string> => {
  const result = spawnSync('bun', ['tools/sprites/build.ts', '--keys'], {
    encoding: 'utf8',
  })
  expect(result.status).toBe(0)
  return new Set(JSON.parse(result.stdout))
}

const keysDrawnIn = (model: Model): ReadonlyArray<string> => {
  const level = levelOf(model)
  return Array.getSomes(
    Array.map(
      imagesIn([
        ...roomShapes(level),
        ...Array.flatMap(occludersOf(level), ({ shapes }) => shapes),
        ...sceneShapes(model),
      ]),
      ({ src }) => standInKeyOf(src),
    ),
  )
}

const measured = (model: Model): Model =>
  modifyFields(model, { maybeSurface: () => Option.some(SURFACE) })

const HEALTH_SHARES: ReadonlyArray<number> = [1, 0.7, 0.4, 0.15]

// NOTE: every kind at every wear stage, standing in the room.
const everyKindWorn: Model = withActors(
  measured(fighting),
  Array.flatMap(ZOMBIE_KIND_ORDER, (kind, kindIndex) =>
    Array.map(HEALTH_SHARES, (share, shareIndex) => {
      const id = kindIndex * HEALTH_SHARES.length + shareIndex
      const { x, y } = openFloorSpot(id)
      const maxHp = ZOMBIE_KINDS[kind].hp
      return zombieOf(kind, id, x, y, {
        hp: Math.max(1, Math.round(maxHp * share)),
        maxHp,
      })
    }),
  ),
)

const SCENES: Readonly<Record<string, Model>> = {
  home: measured(initialModel),
  fight: everyKindWorn,
  paused: modifyFields(measured(fighting), {
    phase: () =>
      Phase.Paused({
        round: { _tag: 'Wave', wave: 3, elapsedMs: 4000, spawns: [] },
      }),
  }),
  gameOver: modifyFields(measured(fighting), {
    phase: () => Phase.GameOver({ wave: 3 }),
  }),
  victory: modifyFields(measured(fighting), { phase: () => Phase.Victory() }),
  break: modifyFields(measured(initialModel), {
    phase: () =>
      Phase.Preparation({
        wave: 2,
        remainingMs: 15_000,
        durationMs: 20_000,
        spawns: [],
      }),
  }),
}

describe('the sprite atlas', () => {
  const keys = generatorKeys()

  test('finds the sprites the game builds as it loads', () => {
    expect(keys.size).toBeGreaterThan(1000)
  })

  test.each(Record.toEntries(SCENES))(
    'holds every sprite the %s scene draws',
    (_name, model) => {
      const missing = Array.filter(keysDrawnIn(model), key => !keys.has(key))
      expect(Array.dedupe(missing)).toEqual([])
    },
  )
})
