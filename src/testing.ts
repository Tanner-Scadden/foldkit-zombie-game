import { Array, Option } from 'effect'
import { Scene, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog, DialogBlock } from '@foldkit/ui'

import { levelOf, openExitIn } from './arena'
import { ApplicationComposition } from './composition'
import { SCORE_PER_ZOMBIE, ZOMBIE_MAX_HP } from './constants'
import { KITCHEN_EXIT } from './exits'
import { fridgeBoxOf, pickPrize, prizeWeights } from './leftovers'
import { update } from './main'
import { Message } from './message'
import {
  type Bullet,
  Frenzy,
  type FridgePrize,
  GameEvent,
  Lesson,
  type Model,
  Phase,
  Pierce,
  type PlannedSpawn,
  type RunStats,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { MeasureGameSurface } from './mount'
import { nextRandom } from './prng'
import { freshRun } from './runReset'
import { subscriptions } from './subscriptions'
import { asVeteran } from './veteran'
import { view } from './view'
import { STARTING_PISTOL, gunsOf, mapGuns, maybeCarried } from './weapons'
import { Arsenal, type CarriedGun, type Player } from './worldSchema'
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
  Story.Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  )

// NOTE: the root's Subscriptions, its children's included, so a Scene can
// emit a Message from one of them (Scene.Subscription.emit).
export const SCENE_SUBSCRIPTIONS = Scene.subscriptions(
  ApplicationComposition,
  subscriptions,
)

// NOTE: what every root Scene runs: the root's update, view, and
// Subscriptions.
export const ROOT = { update, view, subscriptions: SCENE_SUBSCRIPTIONS }

export const emitPressedKey = (code: string) =>
  Scene.Subscription.emit(
    SCENE_SUBSCRIPTIONS.keyboard,
    Message.PressedKey({ code }),
  )

export const measureSurface = Scene.Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface(SURFACE),
)

export const showDialogInScene = () => [
  Scene.Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  ),
]

export const manorButton = Scene.role('button', { name: /^More:/ })

// NOTE: deals the MANOR hand on the home menu.
export const openHandInScene = () => [
  Scene.click(manorButton),
  ...showDialogInScene(),
]

// NOTE: a card puts the hand away, then opens its own dialog.
export const pickCardInScene = (name: string | RegExp) => [
  Scene.click(Scene.role('button', { name })),
  Scene.Command.resolve(
    Dialog.test.CloseDialog,
    DialogBlock.Message.CompletedCloseDialog(),
  ),
  Scene.Command.resolve(
    Dialog.test.ShowDialog,
    DialogBlock.Message.SucceededShowDialog(),
  ),
]

// NOTE: past the first break's lesson, so a Plank Pile has its price (a
// new save's first one is free, see isFirstPlankFree in src/shop.ts).
export const pastFirstBreak = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
  })

export const fighting: Model = modifyFields(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

// NOTE: a spawn planned so far out that it never comes, so a wave that holds
// it stays in progress with only the zombies a test puts in the room.
export const DISTANT_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

// A wave in progress on a measured surface, with nothing coming in.
export const quietWave = (wave: number): Model =>
  modifyFields(initialModel, {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

export const withActors = (
  base: Model,
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model =>
  modifyFields(base, {
    zombies: () => zombies,
    bullets: () => bullets,
  })

// Ticks that push each frame's Model onto `frames`, for tests that look at a
// whole fight after it is played.
export const recordTicks = (
  count: number,
  deltaTime: number,
  frames: Array<Model>,
) =>
  Array.flatMap(ticks(count, deltaTime), frame => [
    frame,
    Story.model((current: Model) => {
      frames.push(current)
    }),
  ])

export const blastFrames = (
  frames: ReadonlyArray<Model>,
): ReadonlyArray<Model> =>
  Array.filter(frames, ({ frameEvents }) =>
    Array.some(frameEvents, GameEvent.guards.Exploded),
  )

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

// NOTE: a grid of up to forty spots on open floor, ten across each of four
// rows that no furniture in the parlour touches, for tests that fill the
// room with zombies.
const OPEN_FLOOR_ROWS_Y: Array.NonEmptyReadonlyArray<number> = [
  74, 89, 104, 135,
]

export const openFloorSpot = (
  index: number,
): Readonly<{ x: number; y: number }> => ({
  x: 20 + (index % 10) * 30,
  y:
    OPEN_FLOOR_ROWS_Y[Math.floor(index / 10) % OPEN_FLOOR_ROWS_Y.length] ??
    OPEN_FLOOR_ROWS_Y[0],
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

// ARSENALS

// NOTE: the arsenals tests reach for most: the pistol alone, or the pistol
// in the first slot and another gun in the second, held either way.
export const pistolOnly = (pistol: CarriedGun = STARTING_PISTOL): Arsenal =>
  Arsenal.OneGun({ first: pistol })

export const holdingSecond = (
  second: CarriedGun,
  first: CarriedGun = STARTING_PISTOL,
): Arsenal => Arsenal.HoldingSecond({ first, second })

export const holdingFirst = (
  second: CarriedGun,
  first: CarriedGun = STARTING_PISTOL,
): Arsenal => Arsenal.HoldingFirst({ first, second })

// NOTE: changes the carried Pop Pistol, wherever it sits.
export const withPistol = (
  player: Player,
  change: (pistol: CarriedGun) => CarriedGun,
): Player =>
  modifyFields(player, {
    arsenal: arsenal =>
      mapGuns(arsenal, gun => (gun.kind === 'Pistol' ? change(gun) : gun)),
  })

export const pistolOf = (player: Player): CarriedGun =>
  Option.getOrThrow(maybeCarried(player, 'Pistol'))

// NOTE: the carried gun that is not the Pop Pistol, if any: what the old
// spare slot held.
export const maybeSpareGun = (arsenal: Arsenal): Option.Option<CarriedGun> =>
  Array.findFirst(gunsOf(arsenal), gun => gun.kind !== 'Pistol')

// MYSTERY LEFTOVERS

// NOTE: a fresh run with the kitchen open and the player at the fridge's
// door in a break, for the fridge's Story tests.
export const FRIDGE_DISTANT_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

export const fridgeBox = Option.getOrThrow(
  fridgeBoxOf(
    levelOf({ level: openExitIn(freshRunModel().level, KITCHEN_EXIT) }),
  ),
)

export const AT_FRIDGE = {
  x: (fridgeBox.left + fridgeBox.right) / 2,
  y: fridgeBox.bottom + 8,
}

export function freshRunModel(): Model {
  const veteran = asVeteran(initialModel)
  return modifyFields(
    { ...veteran, ...freshRun(veteran) },
    {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    },
  )
}

export const atFridge = (balance: number, wave = 5): Model =>
  modifyFields(freshRunModel(), {
    level: level => openExitIn(level, KITCHEN_EXIT),
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 120_000,
        durationMs: 120_000,
        spawns: [FRIDGE_DISTANT_SPAWN],
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player =>
      modifyFields(player, { x: () => AT_FRIDGE.x, y: () => AT_FRIDGE.y }),
  })

// NOTE: a fridge whose stream's next draw lands on `prize`, found by trying
// seeds, so a test can ask for each prize without knowing the stream.
export const fridgeSeededFor = (current: Model, prize: FridgePrize): Model => {
  const seed = Option.getOrThrow(
    Array.findFirst(
      Array.makeBy(500, index => index + 1),
      candidate =>
        pickPrize(
          prizeWeights(current.fridge, current.player),
          nextRandom(candidate).value,
        ) === prize,
    ),
  )
  return modifyFields(current, {
    loot: loot => modifyFields(loot, { fridgeRngState: () => seed }),
  })
}
