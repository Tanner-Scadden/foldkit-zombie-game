import { Array } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import { SCORE_PER_ZOMBIE, ZOMBIE_MAX_HP } from './constants'
import { Message } from './message'
import {
  type Bullet,
  Frenzy,
  type Model,
  Phase,
  Pierce,
  type RunStats,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { MeasureGameSurface } from './view'
import { ZOMBIE_KINDS } from './zombies'

// NOTE: the score is read from the kills, so a test that wants a score
// gives the run that many points of Groaners.
export const scoring =
  (score: number) =>
  (stats: RunStats): RunStats => ({
    ...stats,
    kills: {
      ...stats.kills,
      Shambler: stats.kills.Shambler + score / SCORE_PER_ZOMBIE,
    },
  })

export const SURFACE = { left: 0, top: 0, width: 800, height: 400 }

export const WIDE_SURFACE = { left: 0, top: 0, width: 1280, height: 720 }

export const tick = (deltaTime: number) =>
  Story.message(Message.TickedFrame({ deltaTime }))

export const ticks = (count: number, deltaTime: number) =>
  Array.makeBy(count, () => tick(deltaTime))

export const press = (code: string) =>
  Story.message(Message.PressedKey({ code }))

export const release = (code: string) =>
  Story.message(Message.ReleasedKey({ code }))

const FIRE_THUMB = 70

export const holdFire = Story.message(
  Message.PressedPointer({
    pointerId: FIRE_THUMB,
    device: 'Touch',
    clientX: 600,
    clientY: 200,
  }),
)

export const releaseFire = Story.message(
  Message.ReleasedPointer({ pointerId: FIRE_THUMB }),
)

// NOTE: The Foldkit rule against building a child's Messages skips *.test.ts
// files. These helpers resolve the Dialog's Commands for those tests, so it is
// off here too.
/* oxlint-disable foldkit/no-child-message-construction-in-root */

export const showDialog = () =>
  Story.Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog())

export const emitPressedKey = (code: string) =>
  Scene.Subscription.emit(Message.PressedKey({ code }))

export const measureSurface = Scene.Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface(SURFACE),
)

export const showDialogInScene = () => [
  Scene.Command.resolve(
    Dialog.ShowDialog,
    Dialog.Message.SucceededShowDialog(),
  ),
  Scene.Mount.resolve(
    Dialog.AcquireResources,
    Dialog.Message.SucceededAcquireResources(),
  ),
]

export const fighting: Model = modifyFields(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

type ZombieOptions = Readonly<{
  speed?: number
  hp?: number
  maxHp?: number
  frenzy?: Frenzy
}>

export const zombieOf = (
  kind: ZombieKind,
  id: number,
  x: number,
  y: number,
  {
    speed = 0,
    hp = ZOMBIE_KINDS[kind].hp,
    maxHp = hp,
    frenzy = Frenzy.Calm(),
  }: ZombieOptions = {},
): Zombie => ({
  id,
  kind,
  x,
  y,
  speed,
  hp,
  maxHp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy,
})

export const zombieAt = (
  id: number,
  x: number,
  y: number,
  { hp = ZOMBIE_MAX_HP, ...options }: ZombieOptions = {},
): Zombie => zombieOf('Shambler', id, x, y, { hp, ...options })

type BulletOptions = Readonly<{ damage?: number; knockback?: number }>

export const bulletInto = (
  id: number,
  { x, y }: Zombie,
  { damage = 1, knockback = 110 }: BulletOptions = {},
): Bullet => ({
  id,
  x,
  y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage,
  knockback,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
})
