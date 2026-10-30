import { Array } from 'effect'
import type { Canvas } from 'foldkit'

import { type Level, levelOf } from './arena'
import { bossGroundShapes, bossOverheadShapes } from './bossView'
import { type Camera, sceneOffset } from './camera'
import { type Drawable, depthSortedShapes } from './depth'
import {
  airborneParticleShapes,
  blastShapes,
  bulletShapes,
  doorRattleShapes,
  gibShadow,
  groundParticleShapes,
  popupShape,
} from './effectsView'
import { type Model, Phase, ShopState, type Vector, type Zombie } from './model'
import { isBehindWall, occludersOf } from './occluders'
import {
  playerFlashShapes,
  playerFootY,
  playerShadow,
  playerShapes,
  reloadBarShapes,
} from './playerView'
import {
  auraShapes,
  burpRingShapes,
  pickupFootY,
  pickupShapes,
} from './powerupView'
import { hearthFireShapes } from './room'
import { isShopOpenFor, stallPrompt } from './shop'
import { aimSightShapes } from './sightView'
import { group } from './sprite'
import {
  STALL_FOOT_Y,
  type StallLook,
  stallGroundShapes,
  stallPromptShapes,
  stallShapes,
} from './stall'
import {
  ghostShapes,
  trapFootY,
  trapOverheadShapes,
  trapShadow,
  trapShapes,
} from './trapView'
import { isRoundActive } from './waves'
import {
  zombieFootY,
  zombieGroundShapes,
  zombieHealthBarShapes,
  zombieShadow,
  zombieShapes,
} from './zombieView'

// OFFSET

const STILL: Vector = { x: 0, y: 0 }

const shakeOffset = (model: Model): Vector =>
  isRoundActive(model.phase) && model.shakeSetting === 'On'
    ? model.shake.offset
    : STILL

export const worldOffset = (model: Model, camera: Camera): Vector =>
  sceneOffset(camera, shakeOffset(model))

// STALL

const stallLook = (model: Model): StallLook => {
  if (!isShopOpenFor(model.phase)) {
    return 'Closed'
  } else if (ShopState.isAnyOf(['Away'])(model.shop)) {
    return 'Beckoning'
  } else {
    return 'Open'
  }
}

// GROUND

const groundShapes = (
  model: Model,
  look: StallLook,
): ReadonlyArray<Canvas.Shape> => [
  ...hearthFireShapes(levelOf(model), model.elapsedMs),
  ...stallGroundShapes(look, model.elapsedMs),
  playerShadow(model.player),
  ...zombieGroundShapes(model.zombies, model.elapsedMs),
  ...Array.filterMap(model.zombies, zombieShadow),
  ...bossGroundShapes(model),
  ...Array.filterMap(model.traps, trapShadow(levelOf(model))),
  ...Array.filterMap(model.particles, gibShadow),
  ...groundParticleShapes(model.particles),
  ...ghostShapes(model),
  ...doorRattleShapes(model),
  ...aimSightShapes(model),
  ...Array.flatMap(model.bullets, bulletShapes),
]

// STANDING

const standingDrawables = (
  model: Model,
  look: StallLook,
): ReadonlyArray<Drawable> => {
  const drawZombie = zombieShapes(model.player, model.elapsedMs, model.boss)
  const level = levelOf(model)
  const drawTrap = trapShapes(level, model.elapsedMs)
  return [
    ...Array.map(occludersOf(level), ({ floorY, shapes }): Drawable => ({
      footY: floorY,
      rank: 'Wall',
      shapes,
    })),
    {
      footY: STALL_FOOT_Y,
      rank: 'Prop',
      shapes: stallShapes(look, model.elapsedMs),
    },
    ...Array.map(model.traps, (trap): Drawable => ({
      footY: trapFootY(level, trap),
      rank: 'Trap',
      shapes: drawTrap(trap),
    })),
    ...Array.map(model.pickups, (pickup): Drawable => ({
      footY: pickupFootY(pickup),
      rank: 'Pickup',
      shapes: pickupShapes(pickup),
    })),
    ...Array.map(model.zombies, (zombie): Drawable => ({
      footY: zombieFootY(zombie),
      rank: 'Zombie',
      shapes: drawZombie(zombie),
    })),
    {
      footY: playerFootY(model.player),
      rank: 'Player',
      shapes: [
        ...auraShapes(model.player, model.boosts, model.elapsedMs),
        ...playerShapes(model),
      ],
    },
  ]
}

// OVERHEAD

// NOTE: a zombie still in a doorway behind the wall's face is covered by the
// lintel, so its bar would float over the wall. It shows once it steps in.
const isInView =
  (level: Level) =>
  (zombie: Zombie): boolean =>
    !isBehindWall(level)(zombie.x, zombieFootY(zombie))

const overheadShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...playerFlashShapes(model.player),
  ...Array.flatMap(
    model.traps,
    trapOverheadShapes(levelOf(model), model.elapsedMs),
  ),
  ...Array.flatMap(
    Array.filter(model.zombies, isInView(levelOf(model))),
    zombieHealthBarShapes,
  ),
  ...Array.flatMap(model.blasts, blastShapes),
  ...Array.flatMap(model.callouts, burpRingShapes),
  ...bossOverheadShapes(model),
  ...airborneParticleShapes(model.particles),
  ...Array.map(model.popups, popupShape(camera)),
  ...reloadBarShapes(model.player),
  ...stallPromptShapes(stallPrompt(model)),
]

// WORLD

const titleWorldShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...hearthFireShapes(levelOf(model), model.screenMs),
  ...stallGroundShapes('Closed', model.screenMs),
  ...stallShapes('Closed', model.screenMs),
]

const playWorldShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => {
  const look = stallLook(model)
  return [
    ...groundShapes(model, look),
    ...depthSortedShapes(standingDrawables(model, look)),
    ...overheadShapes(model, camera),
  ]
}

const worldShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Phase.isAnyOf(['Ready'])(model.phase)
    ? titleWorldShapes(model)
    : playWorldShapes(model, camera)

export const worldLayerShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  group({
    translate: worldOffset(model, camera),
    shapes: worldShapes(model, camera),
  }),
]
