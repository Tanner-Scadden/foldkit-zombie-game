// The balance bot: a fair, simple player that drives the game's own init
// model and update. tools/balance/simulate.ts runs it for the campaign
// reports, and the wave snapshot pass replays single waves from a typical
// run state. Nothing here ships with the game. Install a DOM (happy-dom)
// before importing this module, as simulate.ts and vitest do.

import {
  Array as EffectArray,
  Record as EffectRecord,
  Option,
  Schema,
} from 'effect'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import { boxCenter, hasLineOfSight, levelOf } from '../../src/arena'
import { BOSS_RULES } from '../../src/boss'
import { cameraFocus, cameraFor, worldWindowOf } from '../../src/camera'
import { CHUCKER_RULES, maybeShieldFor } from '../../src/chucker'
import { CRAWLER_RULES } from '../../src/crawler'
import { FRENZY_RULES } from '../../src/frenzy'
import { update } from '../../src/main'
import { Message } from '../../src/message'
import { type Difficulty, ZombieKind, initialModel } from '../../src/model'
import { DEFAULT_PORTRAIT_SCREEN } from '../../src/screen'
import { STALL_BOX, isShopOpenFor, priceFor, verdictFor } from '../../src/shop'
import { asVeteran } from '../../src/veteran'
import { beginPreparation, doorCounts } from '../../src/waves'
import {
  canReload,
  heldLoaded,
  heldStats,
  maxRounds,
  maxTier,
  maybeSpare,
} from '../../src/weapons'
import { ZOMBIE_KINDS } from '../../src/zombies'

export type Model = typeof initialModel
type GameMessage = Parameters<typeof update>[1]
type Vector = { x: number; y: number }
export type Kind = ZombieKind

export type BotMode = 'Campaign' | 'Endless'

// What the bot plays: the level, the mode, and how it shops and swaps.
// swapsBack is SWAP=1: it re-arms the spare gun before each wave while it
// has rounds, the way a player swaps back after a refill. The default bot
// never swaps, so once its spare runs dry it fights on with the pistol.
export type BotOptions = {
  difficulty: Difficulty
  mode: BotMode
  swapsBack: boolean
  noUpgrades: boolean
}

export const DEFAULT_OPTIONS: BotOptions = {
  difficulty: 'Normal',
  mode: 'Campaign',
  swapsBack: false,
  noUpgrades: false,
}

export const parseDifficulty = (raw: string | undefined): Difficulty => {
  const name = (raw ?? 'normal').toLowerCase()
  if (name === 'easy') return 'Easy'
  if (name === 'hard') return 'Hard'
  if (name === 'nightmare') return 'Nightmare'
  if (name === 'normal') return 'Normal'
  throw new Error(
    `DIFFICULTY must be easy, normal, hard, or nightmare, not ${name}`,
  )
}

export const FRAME_MS = 1000 / 30
const maxRunMs = (options: BotOptions) =>
  (options.mode === 'Endless' ? 90 : 20) * 60 * 1000
const SURFACE = { left: 0, top: 0, width: 320, height: 180 }
const ROOM_CENTER: Vector = { x: 160, y: 95 }
const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }

// The options of the run being played. play sets it before every run.
let current: BotOptions = DEFAULT_OPTIONS

export type RunResult = {
  seed: number
  cleared: number
  killedBy: Kind | undefined
  victory: boolean
  runMs: number
  moneyAfterWave: Array<number>
  hurtBy: Record<Kind, number>
  maxAlive: number
  pistolTier: number
  spareTier: number
  upgradeSpend: number
  minHp: number
  waves: Array<WaveLog>
  moneyAtVisit: Array<number | undefined>
  gnomesPlaced: number
  boughtAtVisit: Array<Array<string>>
  dropped: Record<string, number>
  grabbed: Record<string, number>
  boostedMs: number
  waveMs: number
  timelines: Array<WaveTimeline>
  boss: BossLog
  newKinds: NewKindLog
}

// What the Big Leaguer, the Ankle Biter, and frenzied packs did in a run.
export type NewKindLog = {
  throws: number
  shields: number
  throwHits: number
  grabs: number
  surfaced: number
  frenzies: number
  wipes: number
  wipeBonus: number
  heartsWhileClung: number
}

const emptyNewKinds = (): NewKindLog => ({
  throws: 0,
  shields: 0,
  throwHits: 0,
  grabs: 0,
  surfaced: 0,
  frenzies: 0,
  wipes: 0,
  wipeBonus: 0,
  heartsWhileClung: 0,
})

// Each boss wave the run reached: whether the boss walked in, whether it
// fell, how long it stood, and whether the run ended while it stood.
export type BossFight = {
  wave: number
  arrived: boolean
  felled: boolean
  fightMs: number
  diedToIt: boolean
  stomps: number
  stompHits: number
  belches: number
  charges: number
  chargeHits: number
  bonks: number
  spits: number
  spitHits: number
  enraged: boolean
  heartsLost: number
  heartsByAttack: Record<BossBlame, number>
  damageTaken: number
  aimedMs: number
}

type BossBlame = 'Stomp' | 'Charge' | 'Glob' | 'Bite'

const emptyBossBlame = (): Record<BossBlame, number> => ({
  Stomp: 0,
  Charge: 0,
  Glob: 0,
  Bite: 0,
})

export type BossLog = Array<BossFight>

// The timeline of one wave in wall time from its start: every pack as it
// walks in, and the stretches with no zombie alive. A stretch is announced
// while a warned pack still waits at its door or the dinner bell rings.
export type PackArrival = {
  atMs: number
  pack: number
  door: string
  size: number
  kinds: Array<string>
  formation: string
}

export type EmptyStretch = { fromMs: number; ms: number; announcedMs: number }

export type WaveTimeline = {
  packs: Array<PackArrival>
  empty: Array<EmptyStretch>
  restMs: Array<number>
  lengthMs: number
}

// Per wave: hearts lost, seconds with 6 or more zombies within 48 px
// (pressure), seconds with none alive (relax), seconds with none alive,
// none announced, and spawns still to come (quiet, the dead air the pacing
// rules forbid) and its longest stretch, its length, and the most alive at
// once.
export type WaveLog = {
  heartsLost: number
  pressureMs: number
  relaxMs: number
  quietMs: number
  quietRunMs: number
  longestQuietMs: number
  lengthMs: number
  peakAlive: number
}

const PRESSURE_PX = 48
const PRESSURE_CROWD = 6

const emptyWaveLog = (): WaveLog => ({
  heartsLost: 0,
  pressureMs: 0,
  relaxMs: 0,
  quietMs: 0,
  quietRunMs: 0,
  longestQuietMs: 0,
  lengthMs: 0,
  peakAlive: 0,
})

const spawnKey = (spawn: { pack: number; offset: number; kind: string }) =>
  `${spawn.pack}:${spawn.offset}:${spawn.kind}`

const pendingSpawns = (model: Model) =>
  model.phase._tag === 'Wave' || model.phase._tag === 'Preparation'
    ? model.phase.spawns
    : []

const isAliveZombie = (zombie: Model['zombies'][number]) =>
  zombie.state._tag === 'Walking' || zombie.state._tag === 'Fusing'

const isAnnounced = (model: Model): boolean => {
  const warned = new Set(model.pacing.warnedPacks)
  return (
    model.pacing.alarm._tag === 'Ringing' ||
    model.boss._tag === 'Arriving' ||
    pendingSpawns(model).some(spawn => warned.has(spawn.pack))
  )
}

const emptyTimeline = (): WaveTimeline => ({
  packs: [],
  empty: [],
  restMs: [],
  lengthMs: 0,
})

const recordTimeline = (
  timeline: WaveTimeline,
  before: Model,
  after: Model,
) => {
  const remaining = new Set(
    after.phase._tag === 'Wave' ? after.phase.spawns.map(spawnKey) : [],
  )
  const released =
    after.phase._tag === 'Wave'
      ? pendingSpawns(before).filter(spawn => !remaining.has(spawnKey(spawn)))
      : []
  const atMs = timeline.lengthMs
  released.forEach(spawn => {
    const known = timeline.packs.find(arrival => arrival.pack === spawn.pack)
    if (known === undefined) {
      timeline.packs.push({
        atMs,
        pack: spawn.pack,
        door: spawn.door,
        size: 1,
        kinds: [spawn.kind],
        formation: spawn.formation,
      })
    } else {
      known.size += 1
      known.kinds.push(spawn.kind)
    }
  })
  timeline.lengthMs += FRAME_MS
  const isEmpty = !after.zombies.some(isAliveZombie)
  const last = timeline.empty[timeline.empty.length - 1]
  const isOngoing = last !== undefined && last.fromMs + last.ms >= atMs - 1
  if (isEmpty) {
    const stretch = isOngoing ? last : { fromMs: atMs, ms: 0, announcedMs: 0 }
    if (!isOngoing) timeline.empty.push(stretch)
    stretch.ms += FRAME_MS
    stretch.announcedMs += isAnnounced(after) ? FRAME_MS : 0
  }
  const resting = after.pacing.beat._tag === 'Resting'
  const wasResting = before.pacing.beat._tag === 'Resting'
  if (resting && !wasResting) timeline.restMs.push(0)
  if (resting) {
    timeline.restMs[timeline.restMs.length - 1] =
      (timeline.restMs[timeline.restMs.length - 1] ?? 0) + FRAME_MS
  }
}

// The longest stretch inside an empty stretch with nothing announced.
export const quietPartMs = (stretch: EmptyStretch) =>
  stretch.ms - stretch.announcedMs

const send = (model: Model, message: GameMessage): Model =>
  update(model, message).model

// The zombies standing in the room: alive, and not under the floor, held
// overhead, or in the air, so the bot can see, shoot, and flee them.
const OUT_OF_REACH = new Set(['Burrowed', 'Carried', 'Flying'])

// VIEW=portrait plays as a phone held upright would: it sees only the
// zombies inside the portrait camera's window, which follows it and leans
// toward its aim like the game's. Zombies out of view are not shot or fled.
const SEES_PORTRAIT_ONLY = process.env.VIEW === 'portrait'

const isInView = (model: Model, zombie: Model['zombies'][number]) => {
  if (!SEES_PORTRAIT_ONLY) {
    return true
  }
  const camera = cameraFor(
    levelOf(model),
    cameraFocus(model),
    worldWindowOf(DEFAULT_PORTRAIT_SCREEN),
  )
  return (
    zombie.x >= camera.x &&
    zombie.x <= camera.x + camera.width &&
    zombie.y >= camera.y &&
    zombie.y <= camera.y + camera.height
  )
}

const walking = (model: Model) =>
  model.zombies.filter(
    zombie =>
      zombie.state._tag === 'Walking' &&
      !OUT_OF_REACH.has(zombie.action._tag) &&
      isInView(model, zombie),
  )

const distance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y)

const steerToward = (from: Vector, to: Vector): Vector => {
  const length = distance(from, to)
  return length < 2
    ? { x: 0, y: 0 }
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

// Keeps its distance from the nearest zombie only once it is inside the
// comfort radius, the way a player plants their feet to shoot until
// something gets close, and drifts back toward the middle otherwise.
const FLEE_PX = Number(process.env.FLEE_PX ?? 36)

// It walks over a pickup when nothing is inside its comfort radius, the
// pickup is close, and no zombie stands near the pickup. NO_PICKUPS=1 keeps
// it from ever going for one.
const IGNORES_PICKUPS = process.env.NO_PICKUPS !== undefined
const PICKUP_SEEK_PX = Number(process.env.PICKUP_SEEK_PX ?? 90)
const PICKUP_SAFE_PX = 28

const safePickup = (model: Model): Vector | undefined => {
  if (IGNORES_PICKUPS) return undefined
  const zombies = walking(model)
  return model.pickups
    .filter(
      pickup =>
        distance(model.player, pickup) < PICKUP_SEEK_PX &&
        zombies.every(zombie => distance(zombie, pickup) > PICKUP_SAFE_PX),
    )
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))[0]
}

// It dodges the boss the way a player who has seen his tells does: out of a
// stomp ring once it winds up, sideways off a charge lane, and out of a glob
// marker or a puddle. It keeps a wider berth from the boss than from the
// horde, since the boss is wider. KITE=1 is the player who never learns the
// tells: it only runs to the far side of the room from the boss and shoots.
const DODGE_MARGIN_PX = Number(process.env.DODGE_MARGIN ?? 10)
const NO_DODGE = process.env.NO_DODGE !== undefined
const KITES = process.env.KITE !== undefined
const BOSS_BODY_PX = 12
const PLAYER_BODY_PX = 4

const bossOf = (model: Model) => {
  const { boss } = model
  return boss._tag === 'Fighting'
    ? walking(model).find(zombie => zombie.id === boss.id)
    : undefined
}

const awayFromLine = (from: Vector, direction: Vector, point: Vector) => {
  const side =
    direction.x * (point.y - from.y) - direction.y * (point.x - from.x) >= 0
      ? 1
      : -1
  return { x: -direction.y * side, y: direction.x * side }
}

const distanceToLane = (
  point: Vector,
  from: Vector,
  direction: Vector,
  length: number,
) => {
  const along = Math.max(
    0,
    Math.min(
      length,
      (point.x - from.x) * direction.x + (point.y - from.y) * direction.y,
    ),
  )
  return distance(point, {
    x: from.x + direction.x * along,
    y: from.y + direction.y * along,
  })
}

const laneDodge = (
  model: Model,
  from: Vector,
  direction: Vector,
  length: number,
): Vector | undefined =>
  distanceToLane(model.player, from, direction, length) <
  BOSS_BODY_PX + PLAYER_BODY_PX + DODGE_MARGIN_PX
    ? awayFromLine(from, direction, model.player)
    : undefined

// Standing on a glob's mark, it steps across the boss's line of fire, to the
// side with more room from the nearest other zombie.
const clearSide = (model: Model, boss: Vector): Vector => {
  const toward = steerToward(boss, model.player)
  const across = { x: -toward.y, y: toward.x }
  const crowd = walking(model)
    .filter(zombie => zombie.kind !== 'Boss')
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))[0]
  if (crowd === undefined) return across
  const left = {
    x: model.player.x + across.x * 10,
    y: model.player.y + across.y * 10,
  }
  const right = {
    x: model.player.x - across.x * 10,
    y: model.player.y - across.y * 10,
  }
  return distance(left, crowd) >= distance(right, crowd)
    ? across
    : { x: -across.x, y: -across.y }
}

// It steps off a thrown Groaner's landing mark the way it steps off a glob's,
// and keeps clear of the cracks where an Ankle Biter is about to come up.
const LANDING_MARGIN_PX = Number(process.env.LANDING_MARGIN ?? 6)
const CRACK_BERTH_PX = Number(process.env.CRACK_BERTH ?? 8)

const landingDodge = (model: Model): Vector | undefined => {
  const mark = model.zombies.find(
    zombie =>
      zombie.action._tag === 'Flying' &&
      distance(model.player, zombie.action.to) <
        CHUCKER_RULES.landRadius + PLAYER_BODY_PX + LANDING_MARGIN_PX,
  )
  if (mark === undefined || mark.action._tag !== 'Flying') return undefined
  const center = mark.action.to
  return distance(model.player, center) < 3
    ? clearSide(model, mark.action.from)
    : steerToward(center, model.player)
}

const crackDodge = (model: Model): Vector | undefined => {
  const crack = model.zombies.find(
    zombie =>
      zombie.action._tag === 'Burrowed' &&
      distance(model.player, zombie) < CRAWLER_RULES.holdPx + CRACK_BERTH_PX,
  )
  return crack === undefined ? undefined : steerToward(crack, model.player)
}

const floorDodge = (model: Model): Vector | undefined =>
  NO_DODGE ? undefined : (landingDodge(model) ?? crackDodge(model))

const telegraphDodge = (model: Model): Vector | undefined => {
  const floor = floorDodge(model)
  if (floor !== undefined) return floor
  if (NO_DODGE || KITES || model.boss._tag !== 'Fighting') return undefined
  const boss = bossOf(model)
  const marker = model.boss.globs.find(
    glob =>
      (glob._tag === 'Flying' &&
        distance(model.player, glob.to) <
          BOSS_RULES.spitRadius + PLAYER_BODY_PX + DODGE_MARGIN_PX) ||
      (glob._tag === 'Pooled' &&
        distance(model.player, glob.at) < BOSS_RULES.puddleRadius + 2),
  )
  if (marker !== undefined) {
    const center = marker._tag === 'Flying' ? marker.to : marker.at
    return distance(model.player, center) < 3
      ? clearSide(model, boss ?? { x: center.x, y: center.y - 1 })
      : steerToward(center, model.player)
  }
  if (boss === undefined) return undefined
  const move = model.boss.move
  if (move._tag === 'WindingUp' && move.attack === 'Stomp') {
    return distance(model.player, boss) <
      BOSS_RULES.stompRadius + DODGE_MARGIN_PX
      ? steerToward(boss, model.player)
      : { x: 0, y: 0 }
  }
  if (move._tag === 'Bracing') {
    const length = distance(boss, move.target)
    const direction = steerToward(boss, move.target)
    return laneDodge(
      model,
      boss,
      direction,
      length + BOSS_RULES.chargeOvershootPx,
    )
  }
  if (move._tag === 'Rushing') {
    return laneDodge(model, boss, move.direction, move.remainingPx)
  }
  return undefined
}

const BOSS_BERTH_PX = Number(process.env.BOSS_BERTH ?? 16)

// A frenzied zombie closes the gap faster, so the bot backs off from it
// sooner, in proportion to the frenzy's extra speed.
const frenzyBerthPx = () => Math.round(FLEE_PX * (FRENZY_RULES.paceScale - 1))

// The spots a kiting player runs between: the four corners and the middle
// of each wall, a little in from the walls.
const KITE_SPOTS: Array<Vector> = [
  { x: 40, y: 40 },
  { x: 160, y: 36 },
  { x: 280, y: 40 },
  { x: 36, y: 95 },
  { x: 284, y: 95 },
  { x: 40, y: 150 },
  { x: 160, y: 154 },
  { x: 280, y: 150 },
]

const kiteAway = (model: Model, boss: Vector): Vector => {
  const spot = [...KITE_SPOTS].sort(
    (a, b) => distance(b, boss) - distance(a, boss),
  )[0]!
  return distance(model.player, spot) > 6
    ? steerToward(model.player, spot)
    : { x: 0, y: 0 }
}

// ENGAGE=1 holds the middle distance from the boss: outside his stomp
// trigger, inside his charge range. It walks into the horde to get there,
// so it does worse than the default, which holds the middle of the room.
const ENGAGES = process.env.ENGAGE !== undefined
const ENGAGE_PX = Number(process.env.ENGAGE_PX ?? 58)

const engage = (model: Model, boss: Vector): Vector => {
  const away = steerToward(boss, model.player)
  const spot = {
    x: boss.x + (away.x === 0 && away.y === 0 ? 1 : away.x) * ENGAGE_PX,
    y: boss.y + away.y * ENGAGE_PX,
  }
  return distance(model.player, spot) > 6
    ? steerToward(model.player, spot)
    : { x: 0, y: 0 }
}

const kite = (model: Model): Vector => {
  const { player } = model
  const dodge = telegraphDodge(model)
  if (dodge !== undefined) {
    return dodge
  }
  const reach = (zombie: Model['zombies'][number]) =>
    distance(player, zombie) -
    (zombie.kind === 'Boss' ? BOSS_BERTH_PX : 0) -
    (zombie.frenzy._tag === 'Frenzied' ? frenzyBerthPx() : 0)
  const nearest = walking(model)
    .filter(zombie => !KITES || zombie.kind !== 'Boss')
    .sort((a, b) => reach(a) - reach(b))[0]
  if (nearest !== undefined && reach(nearest) < FLEE_PX) {
    return steerToward(nearest, player)
  }
  const boss = bossOf(model)
  if (boss !== undefined && KITES) {
    return kiteAway(model, boss)
  }
  if (boss !== undefined && ENGAGES) {
    return engage(model, boss)
  }

  const pickup = safePickup(model)
  if (pickup !== undefined) {
    return steerToward(player, pickup)
  }
  return distance(player, ROOM_CENTER) > 40
    ? steerToward(player, ROOM_CENTER)
    : { x: 0, y: 0 }
}

const desiredKeys = (direction: Vector): Set<string> => {
  const keys = new Set<string>()
  const length = Math.hypot(direction.x, direction.y)
  if (length < 1e-6) {
    return keys
  }
  const x = direction.x / length
  const y = direction.y / length
  if (x > 0.38) keys.add(KEYS.right)
  if (x < -0.38) keys.add(KEYS.left)
  if (y > 0.38) keys.add(KEYS.down)
  if (y < -0.38) keys.add(KEYS.up)
  return keys
}

const pressKeys = (model: Model, wanted: Set<string>): Model => {
  const held = new Set(model.input.pressedKeys)
  const released = [...held].filter(
    key => Object.values(KEYS).includes(key) && !wanted.has(key),
  )
  const pressed = [...wanted].filter(key => !held.has(key))
  const afterRelease = released.reduce(
    (current, code) => send(current, Message.ReleasedKey({ code })),
    model,
  )
  return pressed.reduce(
    (current, code) => send(current, Message.PressedKey({ code })),
    afterRelease,
  )
}

const tapKey = (model: Model, code: string): Model =>
  send(send(model, Message.PressedKey({ code })), Message.ReleasedKey({ code }))

// The bot is a fair player, not an aimbot: it re-aims only every few
// frames, aims where the target was a moment ago, and its hand shakes.
const AIM_EVERY_FRAMES = Number(process.env.AIM_EVERY ?? 5)
const AIM_NOISE_RADIANS = Number(process.env.AIM_NOISE ?? 0.22)
const MOVE_EVERY_FRAMES = Number(process.env.MOVE_EVERY ?? 4)

let botRandom = 1
const nextBotRandom = () => {
  botRandom = (botRandom * 1103515245 + 12345) >>> 0
  return botRandom / 0xffffffff
}

// It shoots the nearest zombie it can see, but while the boss stands it
// shoots him unless something else is within FOCUS_PX, and it always shoots
// him while he is dazed.
// NO_FOCUS=1 always shoots the nearest.
const FOCUSES_BOSS = process.env.NO_FOCUS === undefined
const FOCUS_PX = Number(process.env.FOCUS_PX ?? 60)
// A Big Leaguer holding his shield toward the bot, and the zombie he holds,
// only soak up shots, so the bot shoots something else while there is
// anything else to shoot.
const isBehindShield = (model: Model, zombie: Model['zombies'][number]) => {
  if (zombie.action._tag === 'Shielded') {
    return true
  }
  const length = Math.max(1, distance(model.player, zombie))
  const toward = {
    x: (zombie.x - model.player.x) / length,
    y: (zombie.y - model.player.y) / length,
  }
  return Option.isSome(maybeShieldFor(zombie, toward))
}

const nearestVisible = (model: Model) => {
  const inSight = walking(model)
    .filter(zombie => hasLineOfSight(levelOf(model), model.player, zombie))
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))
  const open = inSight.filter(zombie => !isBehindShield(model, zombie))
  const visible = open.length > 0 ? open : inSight
  const nearest = visible[0]
  const boss = FOCUSES_BOSS
    ? visible.find(zombie => zombie.kind === 'Boss')
    : undefined
  const isDazed =
    model.boss._tag === 'Fighting' && model.boss.move._tag === 'Dazed'
  return boss !== undefined &&
    nearest !== undefined &&
    (isDazed ||
      nearest.kind === 'Boss' ||
      distance(model.player, nearest) > FOCUS_PX)
    ? boss
    : nearest
}

// Reloads when nothing is in sight and the magazine is under half, or when
// the room is empty, the way a player tops off between fights instead of
// every time a zombie ducks behind cover. An empty gun reloads on its own.
const topOff = (model: Model): Model => {
  const isLow = heldLoaded(model.player) < heldStats(model.player).magazine / 2
  return canReload(model.player) && (isLow || walking(model).length === 0)
    ? tapKey(model, 'KeyR')
    : model
}

const aimAndFire = (model: Model, frame: number): Model => {
  if (frame % AIM_EVERY_FRAMES !== 0) {
    return model
  }
  const target = nearestVisible(model)
  const isHeld = model.input.mouseButton._tag === 'Held'
  if (target === undefined) {
    return topOff(
      isHeld ? send(model, Message.ReleasedPointer({ pointerId: 1 })) : model,
    )
  }
  const angle =
    Math.atan2(target.y - model.player.y, target.x - model.player.x) +
    (nextBotRandom() + nextBotRandom() - 1) * AIM_NOISE_RADIANS
  const reach = 40
  const aimPoint = {
    x: model.player.x + Math.cos(angle) * reach,
    y: model.player.y + Math.sin(angle) * reach,
  }
  const aimed = send(
    model,
    Message.MovedMouse({ clientX: aimPoint.x, clientY: aimPoint.y }),
  )
  return isHeld
    ? aimed
    : send(
        aimed,
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: aimPoint.x,
          clientY: aimPoint.y,
        }),
      )
}

const holdFire = (model: Model): Model =>
  model.input.mouseButton._tag === 'Held'
    ? send(model, Message.ReleasedPointer({ pointerId: 1 }))
    : model

// SHOPPING

const STALL_FRONT: Vector = {
  x: (STALL_BOX.left + STALL_BOX.right) / 2,
  y: STALL_BOX.top - 3,
}

// The bot shops the way a careful player would: a heart when low, the
// first gun it can afford (the cheap shotgun right after the tutorial, the
// SMG once it can), ammo below half, two Plank Piles, then upgrades and a
// Grumpy Gnome while it keeps a small reserve for a refill and a heart. It
// takes the spare to its top tier before it upgrades the pistol.
// NO_GNOME=1 keeps the old bot that never buys a gnome, and NO_PLANKS=1 a
// bot that never buys a Plank Pile, to check planks help without carrying.
const NO_GNOME = process.env.NO_GNOME !== undefined
const NO_PLANKS = process.env.NO_PLANKS !== undefined
const RESERVE = Number(process.env.RESERVE ?? 30)

type ItemId = Parameters<typeof priceFor>[1]

const wantedPurchase = (model: Model): ItemId | undefined => {
  const spare = Option.getOrUndefined(maybeSpare(model.player.arsenal))
  const isAvailable = (item: ItemId) =>
    verdictFor(model, item)._tag === 'Available'
  const canSpare = (item: ItemId) =>
    isAvailable(item) && model.wallet.balance - priceFor(model, item) >= RESERVE
  if (model.player.hp <= 3 && isAvailable('Heart')) return 'Heart'
  if (spare === undefined) {
    if (isAvailable('Smg')) return 'Smg'
    if (isAvailable('Shotgun')) return 'Shotgun'
    return undefined
  }
  if (spare.kind === 'Shotgun' && spare.tier === 0 && isAvailable('Smg')) {
    return 'Smg'
  }
  const refill = spare.kind === 'Smg' ? 'SmgRounds' : 'ShotgunShells'
  const cap = maxRounds(spare.kind, spare.tier)
  if (spare.rounds < cap / 2 && isAvailable(refill)) {
    return refill
  }
  const barricades =
    model.trapStock.Barricade +
    model.traps.filter(trap => trap._tag === 'Barricade').length
  if (!NO_PLANKS && barricades < 2 && isAvailable('Barricade')) {
    return 'Barricade'
  }
  if (model.player.hp <= 4 && isAvailable('Heart')) return 'Heart'
  if (isAvailable('RepairTraps') && priceFor(model, 'RepairTraps') <= 25) {
    return 'RepairTraps'
  }
  if (current.noUpgrades) return undefined
  const turrets =
    model.trapStock.Turret +
    model.traps.filter(trap => trap._tag === 'Turret').length
  const spareUpgrade = spare.kind === 'Smg' ? 'SmgUpgrade' : 'ShotgunUpgrade'
  if (spare.tier < 1 && canSpare(spareUpgrade)) return spareUpgrade
  if (!NO_GNOME && turrets < 1 && canSpare('Turret')) return 'Turret'
  if (spare.tier < maxTier(spare.kind) && canSpare(spareUpgrade)) {
    return spareUpgrade
  }
  if (spare.tier >= maxTier(spare.kind) && canSpare('PistolUpgrade')) {
    return 'PistolUpgrade'
  }
  if (!NO_GNOME && turrets < 2 && spare.tier >= 2 && canSpare('Turret')) {
    return 'Turret'
  }
  return undefined
}

let spentOnUpgrades = 0
let gnomeTries = 0
let gnomesPlaced = 0
let boughtLog: Array<Array<string>> = []

const shop = (model: Model): Model => {
  const item = wantedPurchase(model)
  if (item === undefined) {
    return send(
      model,
      Message.GotShopDialogMessage({
        message: Dialog.Message.RequestedClose(),
      }),
    )
  }
  const bought = send(model, Message.ClickedBuyButton({ item }))
  if (item.endsWith('Upgrade')) {
    spentOnUpgrades += model.wallet.balance - bought.wallet.balance
  }
  if (
    bought.wallet.balance !== model.wallet.balance &&
    model.phase._tag === 'Preparation'
  ) {
    ;(boughtLog[model.phase.wave] ??= []).push(item)
  }
  return bought.wallet.balance === model.wallet.balance
    ? send(
        bought,
        Message.GotShopDialogMessage({
          message: Dialog.Message.RequestedClose(),
        }),
      )
    : bought
}

const busiestDoor = (model: Model) => {
  if (model.phase._tag !== 'Preparation') return undefined
  // Counts follow the planks already up: a boarded door's packs come through
  // the next open door, so the second pile goes where they pile up.
  const counts = new Map<string, number>()
  doorCounts(model.phase.spawns, model.traps).forEach(({ door, count }) => {
    counts.set(door, count)
  })
  const boarded = new Set<string>(
    model.traps.flatMap(trap => (trap._tag === 'Barricade' ? [trap.door] : [])),
  )
  return [...counts.entries()]
    .filter(([door]) => !boarded.has(door))
    .sort((a, b) => b[1] - a[1])[0]?.[0] as
    | 'North'
    | 'West'
    | 'East'
    | 'South'
    | undefined
}

type PrepPlan = 'Shop' | 'Barricade' | 'Gnome' | 'Go'

// Gnomes go a little off the middle of the room, where the bot fights.
const GNOME_SPOTS: Array<Vector> = [
  { x: 146, y: 88 },
  { x: 176, y: 104 },
]

const gnomeSpot = (model: Model): Vector =>
  GNOME_SPOTS[
    Math.min(
      GNOME_SPOTS.length - 1,
      model.traps.filter(trap => trap._tag === 'Turret').length,
    )
  ]!

const prepPlan = (model: Model, shopped: boolean): PrepPlan => {
  if (
    isShopOpenFor(model.phase) &&
    !shopped &&
    wantedPurchase(model) !== undefined
  ) {
    return 'Shop'
  }
  if (model.trapStock.Barricade > 0 && busiestDoor(model) !== undefined) {
    return 'Barricade'
  }
  if (model.trapStock.Turret > 0 && gnomeTries < 90) {
    return 'Gnome'
  }
  return 'Go'
}

// RUN

export const KINDS: ReadonlyArray<Kind> = Object.keys(ZOMBIE_KINDS).filter(
  Schema.is(ZombieKind),
)

export const emptyHurt = (): Record<Kind, number> =>
  EffectRecord.fromIterableWith(KINDS, kind => [kind, 0])

const bossBlameOf = (after: Model): BossBlame | undefined => {
  const tags = after.frameEvents.map(event => event._tag)
  if (tags.includes('BossRammed')) return 'Charge'
  if (tags.includes('BossStomped')) return 'Stomp'
  if (tags.includes('GlobLanded')) return 'Glob'
  return undefined
}

const blamedKind = (before: Model, after: Model): Kind | undefined => {
  const burst = after.frameEvents.some(
    event =>
      event._tag === 'Exploded' &&
      Math.hypot(event.x - after.player.x, event.y - after.player.y) < 34,
  )
  if (burst) return 'Exploder'
  if (after.frameEvents.some(event => event._tag === 'ZombieLanded')) {
    return 'Thrower'
  }
  if (bossBlameOf(after) !== undefined) return 'Boss'
  return walking(before).sort(
    (a, b) => distance(before.player, a) - distance(before.player, b),
  )[0]?.kind
}

// Charges the hearts lost this frame to a kind and returns that kind.
const blame = (
  before: Model,
  after: Model,
  hurtBy: Record<Kind, number>,
): Kind | undefined => {
  const lost = before.player.hp - after.player.hp
  if (lost <= 0) return undefined
  const kind = blamedKind(before, after)
  if (kind !== undefined) hurtBy[kind] += lost
  return kind
}

// The model of a fresh run on the title, already started.
export const startedRun = (seed: number, options: BotOptions): Model => {
  const ready = send(
    modifyFields(asVeteran(initialModel), {
      rngState: () => seed,
      difficulty: () => ({ chosen: options.difficulty, nightmare: 'Unlocked' }),
    }),
    Message.MeasuredGameSurface(SURFACE),
  )
  return tapKey(
    options.mode === 'Endless' ? tapKey(ready, 'KeyE') : ready,
    'Enter',
  )
}

// How far play goes: to the end of the run, to the end of the wave it
// starts in, or to the start of a wave's Preparation.
export type Stop =
  | { _tag: 'RunEnd' }
  | { _tag: 'WaveEnd' }
  | { _tag: 'WaveStart'; wave: number }

// Called with the model on the first frame of each wave's Preparation,
// before the bot shops, which is where a wave snapshot is taken.
export type OnPreparation = (wave: number, model: Model) => void

export const play = (
  start: Model,
  seed: number,
  options: BotOptions,
  stop: Stop,
  onPreparation: OnPreparation = () => {},
): RunResult => {
  current = options
  const hurtBy = emptyHurt()
  const moneyAfterWave: Array<number> = []
  let model = start
  let killedBy: Kind | undefined = undefined
  const startWave =
    model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'
      ? model.phase.wave
      : 0
  let preparedWave = 0
  let shoppedWave = 0
  let stuckFrames = 0
  let lastPosition: Vector = model.player
  let strafe = 1
  let frame = 0
  let maxAlive = 0
  let minHp = model.player.hp
  const waves: Array<WaveLog> = []
  const moneyAtVisit: Array<number | undefined> = []
  const dropped: Record<string, number> = {}
  const grabbed: Record<string, number> = {}
  let boostedMs = 0
  let waveMs = 0
  const timelines: Array<WaveTimeline> = []
  const bossLog: BossLog = []
  const newKinds = emptyNewKinds()
  botRandom = seed
  spentOnUpgrades = 0
  boughtLog = []
  gnomeTries = 0
  gnomesPlaced = 0
  while (
    (model.phase._tag === 'Preparation' || model.phase._tag === 'Wave') &&
    model.stats.runMs < maxRunMs(options) &&
    !(
      stop._tag === 'WaveEnd' &&
      model.phase._tag === 'Preparation' &&
      model.phase.wave !== startWave
    )
  ) {
    const wave = model.phase.wave
    if (model.phase._tag === 'Preparation' && preparedWave !== wave) {
      preparedWave = wave
      onPreparation(wave, model)
      if (stop._tag === 'WaveStart' && wave >= stop.wave) break
    }
    if (
      model.phase._tag === 'Preparation' &&
      isShopOpenFor(model.phase) &&
      moneyAtVisit[wave] === undefined
    ) {
      moneyAtVisit[wave] = model.wallet.balance
    }
    if (model.shop._tag === 'Browsing') {
      model = shop(model)
      if (model.shop._tag !== 'Browsing') shoppedWave = wave
      continue
    }
    if (model.phase._tag === 'Preparation') {
      model = holdFire(model)
      const plan = prepPlan(model, shoppedWave === wave)
      if (plan === 'Go') {
        gnomeTries = 0
        model = pressKeys(model, new Set())
        const spare = Option.getOrUndefined(maybeSpare(model.player.arsenal))
        if (
          current.swapsBack &&
          model.player.arsenal._tag === 'HoldingPistol' &&
          spare !== undefined &&
          spare.rounds > 0
        ) {
          model = tapKey(model, 'KeyQ')
        }
        model = tapKey(topOff(model), 'Enter')
        continue
      }
      const target =
        plan === 'Shop'
          ? STALL_FRONT
          : plan === 'Gnome'
            ? gnomeSpot(model)
            : boxCenter(
                levelOf(model).thresholds[busiestDoor(model) ?? 'North'].box,
              )
      if (plan === 'Gnome' && distance(model.player, target) < 6) {
        gnomeTries += 1
        const selected =
          model.selectedTrap === 'Turret' ? model : tapKey(model, 'KeyG')
        const placed = tapKey(selected, 'KeyT')
        gnomesPlaced += placed.trapStock.Turret < model.trapStock.Turret ? 1 : 0
        model = pressKeys(placed, new Set())
      } else if (plan === 'Barricade' && distance(model.player, target) < 8) {
        const placed = tapKey(model, 'KeyT')
        model =
          placed.trapStock.Barricade < model.trapStock.Barricade
            ? placed
            : pressKeys(placed, desiredKeys(steerToward(placed.player, target)))
      } else {
        const direction = steerToward(model.player, target)
        const moved = distance(model.player, lastPosition)
        stuckFrames = moved < 0.3 ? stuckFrames + 1 : 0
        if (stuckFrames > 20) {
          strafe = -strafe
          stuckFrames = 0
        }
        const sidestep =
          stuckFrames > 5
            ? { x: -direction.y * strafe, y: direction.x * strafe }
            : direction
        model = pressKeys(model, desiredKeys(sidestep))
      }
    } else {
      if (frame % MOVE_EVERY_FRAMES === 0) {
        model = pressKeys(model, desiredKeys(kite(model)))
      }
      model = aimAndFire(model, frame)
    }
    lastPosition = model.player
    frame += 1
    const before = model
    model = send(model, Message.TickedFrame({ deltaTime: FRAME_MS }))
    const blamed = blame(before, model, hurtBy)
    if (model.player.hp <= 0 && before.player.hp > 0) killedBy = blamed
    model.frameEvents.forEach(event => {
      if (event._tag === 'ZombieThrown') newKinds.throws += 1
      if (event._tag === 'ShieldRaised') newKinds.shields += 1
      if (event._tag === 'AnklesGrabbed') newKinds.grabs += 1
      if (event._tag === 'CrawlerSurfaced') newKinds.surfaced += 1
      if (event._tag === 'PackFrenzied') newKinds.frenzies += 1
      if (event._tag === 'PackWiped') {
        newKinds.wipes += 1
        newKinds.wipeBonus += event.bonus
      }
    })
    if (
      model.player.hp < before.player.hp &&
      model.frameEvents.some(event => event._tag === 'ZombieLanded')
    ) {
      newKinds.throwHits += 1
    }
    if (
      model.player.hp < before.player.hp &&
      before.zombies.some(zombie => zombie.action._tag === 'Clinging')
    ) {
      newKinds.heartsWhileClung += before.player.hp - model.player.hp
    }
    model.frameEvents.forEach(event => {
      if (event._tag === 'PickupDropped') {
        dropped[event.kind] = (dropped[event.kind] ?? 0) + 1
      }
      if (event._tag === 'PickupGrabbed') {
        grabbed[event.kind] = (grabbed[event.kind] ?? 0) + 1
      }
    })
    if (before.phase._tag === 'Wave') {
      waveMs += FRAME_MS
      if (Object.values(model.boosts).some(timer => timer._tag === 'On')) {
        boostedMs += FRAME_MS
      }
    }
    if (before.phase._tag === 'Wave') {
      const hasBoss = before.boss._tag !== 'Absent'
      const known = bossLog.find(fight => fight.wave === wave)
      const fight =
        known ??
        (hasBoss
          ? (bossLog.push({
              wave,
              arrived: false,
              felled: false,
              fightMs: 0,
              diedToIt: false,
              stomps: 0,
              stompHits: 0,
              belches: 0,
              charges: 0,
              chargeHits: 0,
              bonks: 0,
              spits: 0,
              spitHits: 0,
              enraged: false,
              heartsLost: 0,
              heartsByAttack: emptyBossBlame(),
              damageTaken: 0,
              aimedMs: 0,
            }),
            bossLog[bossLog.length - 1]!)
          : undefined)
      if (fight !== undefined) {
        if (model.boss._tag === 'Fighting') {
          fight.arrived = true
          fight.fightMs += FRAME_MS
        }
        model.frameEvents.forEach(event => {
          if (event._tag === 'ZombieKilled' && event.kind === 'Boss') {
            fight.felled = true
          }
          if (event._tag === 'BossStomped') fight.stomps += 1
          if (event._tag === 'BossBelched') fight.belches += 1
          if (event._tag === 'BossRushed') fight.charges += 1
          if (event._tag === 'BossRammed') fight.chargeHits += 1
          if (event._tag === 'BossBonked') fight.bonks += 1
          if (event._tag === 'BossSpat') fight.spits += 1
          if (event._tag === 'BossEnraged') fight.enraged = true
          if (
            (event._tag === 'ZombieHit' || event._tag === 'ZombieKilled') &&
            event.kind === 'Boss' &&
            event._tag === 'ZombieHit'
          ) {
            fight.damageTaken += event.damage
          }
        })
        if (
          model.boss._tag === 'Fighting' &&
          nearestVisible(before)?.kind === 'Boss'
        ) {
          fight.aimedMs += FRAME_MS
        }
        const lost = before.player.hp - model.player.hp
        if (lost > 0 && model.boss._tag === 'Fighting') {
          fight.heartsLost += lost
          const cause = bossBlameOf(model)
          const nearest = walking(before).sort(
            (a, b) => distance(before.player, a) - distance(before.player, b),
          )[0]
          if (cause !== undefined) {
            fight.heartsByAttack[cause] += lost
            if (cause === 'Glob') fight.spitHits += 1
          } else if (nearest?.kind === 'Boss') {
            fight.heartsByAttack.Bite += lost
          }
        }
        if (
          model.frameEvents.some(event => event._tag === 'BossStomped') &&
          model.player.hp < before.player.hp
        ) {
          fight.stompHits += 1
        }
        if (model.player.hp <= 0 && model.boss._tag === 'Fighting') {
          fight.diedToIt = true
        }
      }
    }
    maxAlive = Math.max(maxAlive, model.zombies.length)
    minHp = Math.min(minHp, model.player.hp)
    if (
      before.phase._tag === 'Wave' ||
      (before.phase._tag === 'Preparation' && model.phase._tag === 'Wave')
    ) {
      recordTimeline((timelines[wave - 1] ??= emptyTimeline()), before, model)
    }
    if (before.phase._tag === 'Wave') {
      const log = (waves[wave - 1] ??= emptyWaveLog())
      const alive = model.zombies.filter(
        zombie => zombie.state._tag !== 'Dying',
      )
      const crowd = alive.filter(
        zombie => distance(model.player, zombie) <= PRESSURE_PX,
      ).length
      log.heartsLost += Math.max(0, before.player.hp - model.player.hp)
      log.lengthMs += FRAME_MS
      log.pressureMs += crowd >= PRESSURE_CROWD ? FRAME_MS : 0
      log.relaxMs += alive.length === 0 ? FRAME_MS : 0
      const isQuiet =
        model.phase._tag === 'Wave' &&
        alive.length === 0 &&
        model.boss._tag !== 'Fighting' &&
        pendingSpawns(model).length > 0 &&
        !isAnnounced(model)
      log.quietMs += isQuiet ? FRAME_MS : 0
      log.quietRunMs = isQuiet ? log.quietRunMs + FRAME_MS : 0
      log.longestQuietMs = Math.max(log.longestQuietMs, log.quietRunMs)
      log.peakAlive = Math.max(log.peakAlive, alive.length)
    }
    if (
      process.env.BOSS_TRACE &&
      frame % 150 === 0 &&
      model.boss._tag === 'Fighting'
    ) {
      const boss = bossOf(model)
      console.log(
        'boss',
        boss?.x.toFixed(0),
        boss?.y.toFixed(0),
        model.boss.move._tag,
        'player',
        model.player.x.toFixed(0),
        model.player.y.toFixed(0),
        'alive',
        walking(model).length,
      )
    }
    if (process.env.DEBUG && frame % 150 === 0) {
      const near = walking(model).map(z => distance(model.player, z))
      console.log(
        model.phase._tag,
        wave,
        'zombies',
        near.length,
        'closest',
        Math.min(...near).toFixed(0),
        'player',
        model.player.x.toFixed(0),
        model.player.y.toFixed(0),
        'hp',
        model.player.hp,
        'shots',
        model.stats.shotsFired,
        model.stats.shotsHit,
        model.player.arsenal._tag,
      )
    }
    if (model.frameEvents.some(event => event._tag === 'WaveCleared')) {
      moneyAfterWave.push(model.wallet.earned)
    }
  }
  const finalSpare = Option.getOrUndefined(maybeSpare(model.player.arsenal))
  return {
    seed,
    cleared: model.stats.wavesCleared,
    killedBy,
    victory: model.phase._tag === 'Victory',
    runMs: model.stats.runMs,
    moneyAfterWave,
    hurtBy,
    maxAlive,
    pistolTier: model.player.pistolTier,
    spareTier: finalSpare?.tier ?? 0,
    upgradeSpend: spentOnUpgrades,
    minHp,
    waves,
    moneyAtVisit,
    gnomesPlaced,
    boughtAtVisit: boughtLog,
    dropped,
    grabbed,
    boostedMs,
    waveMs,
    timelines,
    boss: bossLog,
    newKinds,
  }
}

export const runOnce = (seed: number, options: BotOptions): RunResult =>
  play(startedRun(seed, options), seed, options, { _tag: 'RunEnd' })

// SEEDS

export const seedAt = (firstSeed: number, index: number) =>
  firstSeed + index * 7919

// NOTE: a wave run's roll and the bot's hand both come from this seed, kept
// apart from the campaign seeds so a replayed wave never repeats the roll
// its snapshot was taken with.
export const waveSeedAt = (firstSeed: number, index: number) =>
  1_000_003 + firstSeed + index * 7919

// WAVE SNAPSHOTS

// A wave snapshot is the model on the first frame of a wave's Preparation in
// a campaign run the bot played from a seed: its money, guns, upgrades,
// traps, and hearts are what a typical run brings to that wave. Snapshots
// are derived by playing, never stored, so they always match the current
// game, and they are cached for the life of the process.
export type WaveSnapshot = { wave: number; seed: number; model: Model }

type DerivedStarts = { untilWave: number; starts: ReadonlyMap<number, Model> }

const derivedStarts = new Map<string, DerivedStarts>()

const startsKey = (seed: number, options: BotOptions) =>
  `${options.difficulty}:${options.swapsBack}:${options.noUpgrades}:${seed}`

// The models at the start of every wave the run of seed reached, up to and
// including untilWave.
export const waveStarts = (
  seed: number,
  options: BotOptions,
  untilWave: number,
): ReadonlyMap<number, Model> => {
  const key = startsKey(seed, options)
  const known = derivedStarts.get(key)
  if (known !== undefined && known.untilWave >= untilWave) return known.starts
  const campaign: BotOptions = { ...options, mode: 'Campaign' }
  const starts = new Map<number, Model>()
  play(
    startedRun(seed, campaign),
    seed,
    campaign,
    { _tag: 'WaveStart', wave: untilWave },
    (wave, model) => {
      starts.set(wave, model)
    },
  )
  derivedStarts.set(key, { untilWave, starts })
  return starts
}

// How many campaign seeds a snapshot slot tries before it gives up on a
// wave the bot rarely reaches.
export const SNAPSHOT_TRIES = 12

// Slot k of slots takes its snapshot from the first of the seeds k,
// k + slots, k + 2 slots, and so on whose run reached the wave. Every slot
// is found on its own, so workers can split the slots between them.
export const snapshotFor = (
  wave: number,
  slot: number,
  slots: number,
  options: BotOptions,
  firstSeed: number,
  untilWave: number = wave,
): WaveSnapshot | undefined =>
  EffectArray.makeBy(SNAPSHOT_TRIES, attempt =>
    seedAt(firstSeed, slot + attempt * slots),
  ).reduce<WaveSnapshot | undefined>((found, seed) => {
    if (found !== undefined) return found
    const model = waveStarts(seed, options, untilWave).get(wave)
    return model === undefined ? undefined : { wave, seed, model }
  }, undefined)

// The same wave start with the wave rolled again from waveSeed: new packs,
// doors, kinds, and boss door, the same money, gear, traps, and hearts.
export const rerolled = (model: Model, waveSeed: number): Model =>
  model.phase._tag === 'Preparation'
    ? beginPreparation(
        modifyFields(model, { rngState: () => waveSeed }),
        model.phase.wave,
        model.phase.durationMs,
        model.phase.clock,
      )
    : model

export type WaveOutcome = 'Cleared' | 'Died' | 'TimedOut'

export type WaveRun = {
  wave: number
  snapshotSeed: number
  waveSeed: number
  outcome: WaveOutcome
  heartsLost: number
  lengthMs: number
  emptyMs: number
  quietMs: number
  longestQuietMs: number
  pressureMs: number
  peakAlive: number
  killedBy: Kind | undefined
  hurtBy: Record<Kind, number>
}

export const playSnapshot = (
  snapshot: WaveSnapshot,
  waveSeed: number,
  options: BotOptions,
): WaveRun => {
  const result = play(
    rerolled(snapshot.model, waveSeed),
    waveSeed,
    { ...options, mode: 'Campaign' },
    { _tag: 'WaveEnd' },
  )
  const log = result.waves[snapshot.wave - 1] ?? emptyWaveLog()
  const outcome: WaveOutcome =
    result.victory || result.cleared >= snapshot.wave
      ? 'Cleared'
      : result.minHp <= 0
        ? 'Died'
        : 'TimedOut'
  return {
    wave: snapshot.wave,
    snapshotSeed: snapshot.seed,
    waveSeed,
    outcome,
    heartsLost: log.heartsLost,
    lengthMs: log.lengthMs,
    emptyMs: log.relaxMs,
    quietMs: log.quietMs,
    longestQuietMs: log.longestQuietMs,
    pressureMs: log.pressureMs,
    peakAlive: log.peakAlive,
    killedBy: result.killedBy,
    hurtBy: result.hurtBy,
  }
}

export type WavePass = {
  waves: ReadonlyArray<number>
  runs: number
  slots: number
  firstSeed: number
}

// Plays runs of every wave in the pass. Run i of a wave starts from slot
// i % slots and rolls its wave from waveSeedAt(i). ownsSlot picks the slots
// this process plays, so workers can split a pass by slot.
export const playWavePass = (
  pass: WavePass,
  options: BotOptions,
  ownsSlot: (slot: number) => boolean = () => true,
): Array<WaveRun> => {
  const untilWave = Math.max(...pass.waves)
  return pass.waves.flatMap(wave =>
    EffectArray.makeBy(pass.runs, index => index).flatMap(index => {
      const slot = index % pass.slots
      if (!ownsSlot(slot)) return []
      const snapshot = snapshotFor(
        wave,
        slot,
        pass.slots,
        options,
        pass.firstSeed,
        untilWave,
      )
      return snapshot === undefined
        ? []
        : [playSnapshot(snapshot, waveSeedAt(pass.firstSeed, index), options)]
    }),
  )
}
