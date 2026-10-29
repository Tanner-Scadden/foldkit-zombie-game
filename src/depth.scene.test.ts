import { Array, Option } from 'effect'
import { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { type Drawable, depthSortedShapes } from './depth'
import { sceneShapes } from './layers'
import { type Model, Phase, type Zombie, initialModel } from './model'
import { playerShapes } from './playerView'
import { STALL_BOX } from './shop'
import { stallShapes } from './stall'
import { zombieOf } from './testing'
import { zombieShapes } from './zombieView'

const marker = (id: number): Canvas.Shape =>
  Canvas.Rect({ x: id, y: 0, width: 1, height: 1, fill: '#fff' })

const fightingModel = (
  player: Readonly<{ x: number; y: number }>,
  zombies: ReadonlyArray<Zombie>,
): Model =>
  modifyFields(initialModel, {
    phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
    player: current => ({ ...current, ...player }),
    zombies: () => zombies,
  })

const worldShapesOf = (current: Model): ReadonlyArray<Canvas.Shape> =>
  Option.match(Array.head(sceneShapes(current)), {
    onNone: () => [],
    onSome: world => (world._tag === 'Group' ? world.shapes : []),
  })

const indexOf = (
  shapes: ReadonlyArray<Canvas.Shape>,
  shape: Canvas.Shape,
): number => {
  const wanted = JSON.stringify(shape)
  return shapes.findIndex(candidate => JSON.stringify(candidate) === wanted)
}

const playerIndex = (current: Model): number =>
  indexOf(
    worldShapesOf(current),
    Option.getOrThrow(Array.head(playerShapes(current))),
  )

const zombieIndex = (current: Model, zombie: Zombie): number =>
  indexOf(
    worldShapesOf(current),
    Option.getOrThrow(
      Array.last(
        zombieShapes(current.player, current.elapsedMs, current.boss)(zombie),
      ),
    ),
  )

const stallIndex = (current: Model): number =>
  indexOf(
    worldShapesOf(current),
    Option.getOrThrow(Array.head(stallShapes('Closed', current.elapsedMs))),
  )

describe('Depth sort', () => {
  test('draws by foot, then by rank, and keeps arrival order for a tie', () => {
    const drawables: ReadonlyArray<Drawable> = [
      { footY: 50, rank: 'Zombie', shapes: [marker(1)] },
      { footY: 20, rank: 'Player', shapes: [marker(2)] },
      { footY: 50, rank: 'Trap', shapes: [marker(3)] },
      { footY: 50, rank: 'Zombie', shapes: [marker(4)] },
      { footY: 49.5, rank: 'Prop', shapes: [marker(5)] },
    ]
    expect(depthSortedShapes(drawables)).toEqual([
      marker(2),
      marker(5),
      marker(3),
      marker(1),
      marker(4),
    ])
  })

  test('a zombie south of the player draws in front and one north draws behind', () => {
    const south = zombieOf('Shambler', 1, 160, 100)
    const north = zombieOf('Shambler', 2, 170, 80)
    const current = fightingModel({ x: 160, y: 90 }, [south, north])
    const player = playerIndex(current)
    expect(player).toBeGreaterThanOrEqual(0)
    expect(zombieIndex(current, north)).toBeLessThan(player)
    expect(zombieIndex(current, south)).toBeGreaterThan(player)
  })

  test('a zombie with lower feet than the player draws in front at the same middle', () => {
    const tank = zombieOf('Tank', 1, 166, 90)
    const current = fightingModel({ x: 160, y: 90 }, [tank])
    expect(zombieIndex(current, tank)).toBeGreaterThan(playerIndex(current))
  })

  test('the player and a zombie behind the stall draw under it', () => {
    const behindStall = zombieOf('Shambler', 1, STALL_BOX.left + 6, 140)
    const current = fightingModel(
      { x: STALL_BOX.right - 4, y: STALL_BOX.top - 8 },
      [behindStall],
    )
    const stall = stallIndex(current)
    expect(stall).toBeGreaterThanOrEqual(0)
    expect(playerIndex(current)).toBeLessThan(stall)
    expect(zombieIndex(current, behindStall)).toBeLessThan(stall)
  })
})
