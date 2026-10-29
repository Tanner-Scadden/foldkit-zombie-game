// Headless balance simulation. Run it from the repo root through the heavy
// guard (tools/heavy), never directly:
//   bun run balance [runs] [firstSeed]
//   MODE=endless bun run balance [runs] [firstSeed]
//   WORKERS=4 bun run balance 200   (splits the runs over processes, capped)
//   TIMELINE=1 bun run balance 40   (adds the wave timeline audit)
//   KITE=1 bun run balance 200   (runs from the boss, never dodges)
//   NO_DODGE=1 bun run balance 200   (ignores every floor tell)
//   DIFFICULTY=hard bun run balance 200   (easy, normal, hard, or nightmare)
// It drives the game's own init model and update with a simple bot and
// prints survival per wave, run length, the money curve, and which zombie
// kinds cost the bot the most hearts. Nothing here ships with the game.

import { Window } from 'happy-dom'

const browserWindow = new Window()
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
  __BUILD_ID__: 'dev',
})

const { Message, update } = await import('../../src/main')
const { initialModel } = await import('../../src/model')
const { asVeteran } = await import('../../src/veteran')
const { THRESHOLDS, boxCenter, hasLineOfSight } =
  await import('../../src/arena')
const { STALL_BOX, isShopOpenFor, priceFor, verdictFor } =
  await import('../../src/shop')
const { FINAL_WAVE, doorCounts } = await import('../../src/waves')
const { BOSS_RULES } = await import('../../src/boss')
const { CHUCKER_RULES } = await import('../../src/chucker')
const { CRAWLER_RULES } = await import('../../src/crawler')
const { FRENZY_RULES } = await import('../../src/frenzy')
const { canReload, heldLoaded, heldStats, maxRounds, maxTier, maybeSpare } =
  await import('../../src/weapons')
const { Dialog } = await import('@foldkit/ui')
const { Option, Array: EffectArray } = await import('effect')
const { modifyFields } = await import('foldkit/struct')

// TUNE=path/to/tune.ts loads a module whose default export edits the
// tables in place before the runs, so a balance idea can be tried without
// touching src. Bake the winning numbers into src afterwards.
if (process.env.TUNE !== undefined) {
  const tunePath = process.env.TUNE.startsWith('/')
    ? process.env.TUNE
    : `${process.cwd()}/${process.env.TUNE}`
  const tune = await import(tunePath)
  tune.default({
    WAVE_PLANS: (await import('../../src/waves')).WAVE_PLANS,
    ZOMBIE_KINDS: (await import('../../src/zombies')).ZOMBIE_KINDS,
    SHOP_ITEMS: (await import('../../src/shop')).SHOP_ITEMS,
    WEAPONS: (await import('../../src/weapons')).WEAPONS,
    UPGRADE_TIERS: (await import('../../src/weapons')).UPGRADE_TIERS,
    TRAPS: (await import('../../src/traps')).TRAPS,
    DROP_CHANCE: (await import('../../src/powerups')).DROP_CHANCE,
    DROP_RULES: (await import('../../src/powerups')).DROP_RULES,
    BOOSTS: (await import('../../src/powerups')).BOOSTS,
    PICKUPS: (await import('../../src/powerups')).PICKUPS,
    BOSS_RULES: (await import('../../src/boss')).BOSS_RULES,
    CHUCKER_RULES: (await import('../../src/chucker')).CHUCKER_RULES,
    CRAWLER_RULES: (await import('../../src/crawler')).CRAWLER_RULES,
    FRENZY_RULES: (await import('../../src/frenzy')).FRENZY_RULES,
    BAIT_RULES: (await import('../../src/traps')).BAIT_RULES,
    DIFFICULTIES: (await import('../../src/difficulty')).DIFFICULTIES,
  })
}

type Model = typeof initialModel
type GameMessage = Parameters<typeof update>[1]
type Vector = { x: number; y: number }
type Kind =
  | 'Shambler'
  | 'Runner'
  | 'Tank'
  | 'Exploder'
  | 'Thrower'
  | 'Crawler'
  | 'Boss'

const IS_ENDLESS = process.env.MODE === 'endless'
const DIFFICULTY = (() => {
  const name = (process.env.DIFFICULTY ?? 'normal').toLowerCase()
  if (name === 'easy') return 'Easy'
  if (name === 'hard') return 'Hard'
  if (name === 'nightmare') return 'Nightmare'
  if (name === 'normal') return 'Normal'
  throw new Error(
    `DIFFICULTY must be easy, normal, hard, or nightmare, not ${name}`,
  )
})()
const NO_UPGRADES = process.env.NO_UPGRADES !== undefined
// SWAP=1 re-arms the spare gun before each wave while it has rounds, the
// way a player swaps back after a refill. The default bot never swaps, so
// once its spare runs dry it fights on with the pistol.
const SWAPS_BACK = process.env.SWAP !== undefined
const FRAME_MS = 1000 / 30
const MAX_RUN_MS = (IS_ENDLESS ? 90 : 20) * 60 * 1000
const SURFACE = { left: 0, top: 0, width: 320, height: 180 }
const ROOM_CENTER: Vector = { x: 160, y: 95 }
const KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' }

type RunResult = {
  seed: number
  cleared: number
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

// What the Chucker, the Ankle Biter, and frenzied packs did in a run.
type NewKindLog = {
  throws: number
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
type BossFight = {
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

type BossLog = Array<BossFight>

// The timeline of one wave in wall time from its start: every pack as it
// walks in, and the stretches with no zombie alive. A stretch is announced
// while a warned pack still waits at its door or the dinner bell rings.
type PackArrival = {
  atMs: number
  pack: number
  door: string
  size: number
  kinds: Array<string>
  formation: string
}

type EmptyStretch = { fromMs: number; ms: number; announcedMs: number }

type WaveTimeline = {
  packs: Array<PackArrival>
  empty: Array<EmptyStretch>
  restMs: Array<number>
  lengthMs: number
}

// Per wave: hearts lost, seconds with 6 or more zombies within 48 px
// (pressure), seconds with none alive (relax), its length, and the most
// alive at once.
type WaveLog = {
  heartsLost: number
  pressureMs: number
  relaxMs: number
  lengthMs: number
  peakAlive: number
}

const PRESSURE_PX = 48
const PRESSURE_CROWD = 6

const emptyWaveLog = (): WaveLog => ({
  heartsLost: 0,
  pressureMs: 0,
  relaxMs: 0,
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
const quietPartMs = (stretch: EmptyStretch) => stretch.ms - stretch.announcedMs

const send = (model: Model, message: GameMessage): Model =>
  update(model, message).model

// The zombies standing in the room: alive, and not under the floor, held
// overhead, or in the air, so the bot can see, shoot, and flee them.
const OUT_OF_REACH = new Set(['Burrowed', 'Carried', 'Flying'])

const walking = (model: Model) =>
  model.zombies.filter(
    zombie =>
      zombie.state._tag === 'Walking' && !OUT_OF_REACH.has(zombie.action._tag),
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
const FRENZY_BERTH_PX = Math.round(FLEE_PX * (FRENZY_RULES.paceScale - 1))

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
    (zombie.frenzy._tag === 'Frenzied' ? FRENZY_BERTH_PX : 0)
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
const nearestVisible = (model: Model) => {
  const visible = walking(model)
    .filter(zombie => hasLineOfSight(model.player, zombie))
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))
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
// Grumpy Gnome while it keeps a small reserve for a refill and a heart.
// NO_GNOME=1 keeps the old bot that never buys a gnome.
const NO_GNOME = process.env.NO_GNOME !== undefined
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
  if (barricades < 2 && isAvailable('Barricade')) return 'Barricade'
  if (model.player.hp <= 4 && isAvailable('Heart')) return 'Heart'
  if (isAvailable('RepairTraps') && priceFor(model, 'RepairTraps') <= 25) {
    return 'RepairTraps'
  }
  if (NO_UPGRADES) return undefined
  const turrets =
    model.trapStock.Turret +
    model.traps.filter(trap => trap._tag === 'Turret').length
  const spareUpgrade = spare.kind === 'Smg' ? 'SmgUpgrade' : 'ShotgunUpgrade'
  if (spare.tier < 1 && canSpare(spareUpgrade)) return spareUpgrade
  if (!NO_GNOME && turrets < 1 && canSpare('Turret')) return 'Turret'
  if (spare.tier < maxTier(spare.kind) && canSpare(spareUpgrade)) {
    return spareUpgrade
  }
  if (spare.tier >= 2 && canSpare('PistolUpgrade')) return 'PistolUpgrade'
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
  const boarded = new Set(
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

const emptyHurt = (): Record<Kind, number> => ({
  Shambler: 0,
  Runner: 0,
  Tank: 0,
  Exploder: 0,
  Thrower: 0,
  Crawler: 0,
  Boss: 0,
})

const bossBlameOf = (after: Model): BossBlame | undefined => {
  const tags = after.frameEvents.map(event => event._tag)
  if (tags.includes('BossRammed')) return 'Charge'
  if (tags.includes('BossStomped')) return 'Stomp'
  if (tags.includes('GlobLanded')) return 'Glob'
  return undefined
}

const blame = (before: Model, after: Model, hurtBy: Record<Kind, number>) => {
  const lost = before.player.hp - after.player.hp
  if (lost <= 0) return
  const burst = after.frameEvents.some(
    event =>
      event._tag === 'Exploded' &&
      Math.hypot(event.x - after.player.x, event.y - after.player.y) < 34,
  )
  if (burst) {
    hurtBy.Exploder += lost
    return
  }
  if (after.frameEvents.some(event => event._tag === 'ZombieLanded')) {
    hurtBy.Thrower += lost
    return
  }
  if (bossBlameOf(after) !== undefined) {
    hurtBy.Boss += lost
    return
  }
  const nearest = walking(before).sort(
    (a, b) => distance(before.player, a) - distance(before.player, b),
  )[0]
  if (nearest !== undefined) {
    hurtBy[nearest.kind as Kind] += lost
  }
}

const runOnce = (seed: number): RunResult => {
  const hurtBy = emptyHurt()
  const moneyAfterWave: Array<number> = []
  const ready = send(
    modifyFields(asVeteran(initialModel), {
      rngState: () => seed,
      difficulty: () => ({ chosen: DIFFICULTY, nightmare: 'Unlocked' }),
    }),
    Message.MeasuredGameSurface(SURFACE),
  )
  let model = tapKey(ready, IS_ENDLESS ? 'KeyE' : 'Enter')
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
    model.stats.runMs < MAX_RUN_MS
  ) {
    const wave = model.phase.wave
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
          SWAPS_BACK &&
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
            : boxCenter(THRESHOLDS[busiestDoor(model) ?? 'North'].box)
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
    blame(before, model, hurtBy)
    model.frameEvents.forEach(event => {
      if (event._tag === 'ZombieThrown') newKinds.throws += 1
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

// REPORT

const median = (values: Array<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

const runs = Number(process.argv[2] ?? 40)
const firstSeed = Number(process.argv[3] ?? 1)
const seedAt = (index: number) => firstSeed + index * 7919
const WORKERS = Math.max(1, Number(process.env.WORKERS ?? 1))
const started = performance.now()

// A worker plays one slice of the seeds and writes its results as JSON, so
// WORKERS=n gives the same report as one process, only sooner.
if (process.env.WORKER_SLICE !== undefined) {
  const [from, to] = process.env.WORKER_SLICE.split(':').map(Number)
  const slice = EffectArray.makeBy(to! - from!, offset =>
    runOnce(seedAt(from! + offset)),
  )
  await Bun.write(process.env.WORKER_OUT!, JSON.stringify(slice))
  process.exit(0)
}

const playAll = async (): Promise<Array<RunResult>> => {
  if (WORKERS === 1) {
    return EffectArray.makeBy(runs, index => runOnce(seedAt(index)))
  }
  const per = Math.ceil(runs / WORKERS)
  const slices = EffectArray.makeBy(WORKERS, index => [
    index * per,
    Math.min(runs, (index + 1) * per),
  ]).filter(([from, to]) => to! > from!)
  const outputs = await Promise.all(
    slices.map(async ([from, to], index) => {
      const out = `/tmp/simulate-${process.pid}-${index}.json`
      const child = Bun.spawn(
        [process.execPath, import.meta.path, String(runs), String(firstSeed)],
        {
          env: {
            ...process.env,
            WORKER_SLICE: `${from}:${to}`,
            WORKER_OUT: out,
          },
          stdout: 'inherit',
          stderr: 'inherit',
        },
      )
      await child.exited
      return (await Bun.file(out).json()) as Array<RunResult>
    }),
  )
  return outputs.flat()
}

const results = await playAll()
const elapsed = (performance.now() - started) / 1000

const lastWave = IS_ENDLESS
  ? Math.max(...results.map(result => result.cleared + 1))
  : FINAL_WAVE
console.log(
  `${runs} ${IS_ENDLESS ? 'endless' : 'campaign'} runs on ${DIFFICULTY} in ${elapsed.toFixed(1)} s${NO_UPGRADES ? ', no upgrades' : ''}${SWAPS_BACK ? ', swaps back to the spare' : ''}${KITES ? ', kites the boss' : ''}`,
)
console.log('\nWave  reached  cleared')
for (let wave = 1; wave <= lastWave; wave++) {
  const reached = results.filter(result => result.cleared >= wave - 1).length
  const cleared = results.filter(result => result.cleared >= wave).length
  console.log(
    `${String(wave).padStart(4)}  ${((100 * reached) / runs).toFixed(0).padStart(6)}%  ${((100 * cleared) / runs).toFixed(0).padStart(6)}%`,
  )
}
const deaths = results
  .filter(result => !result.victory)
  .map(result => result.cleared + 1)
const wins = results.filter(result => result.victory)
const mean = (values: Array<number>): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
console.log(
  '\nWave  died  hearts lost  pressure s  relax s  length s  peak alive  (means over runs that played the wave)',
)
for (let wave = 1; wave <= lastWave; wave++) {
  const logs = results.flatMap(r =>
    r.waves[wave - 1] === undefined ? [] : [r.waves[wave - 1]!],
  )
  const died = deaths.filter(death => death === wave).length
  console.log(
    `${String(wave).padStart(4)}  ${((100 * died) / runs).toFixed(0).padStart(3)}%  ${mean(
      logs.map(l => l.heartsLost),
    )
      .toFixed(2)
      .padStart(11)}  ${mean(logs.map(l => l.pressureMs / 1000))
      .toFixed(1)
      .padStart(10)}  ${mean(logs.map(l => l.relaxMs / 1000))
      .toFixed(1)
      .padStart(7)}  ${mean(logs.map(l => l.lengthMs / 1000))
      .toFixed(0)
      .padStart(8)}  ${mean(logs.map(l => l.peakAlive))
      .toFixed(1)
      .padStart(10)}`,
  )
}
console.log(`\nVictories: ${wins.length} of ${runs}`)
console.log(
  `Close calls: ${wins.filter(r => r.minHp <= 1).length} of ${wins.length} wins reached 1 heart`,
)
console.log(`Median wave of death: ${median(deaths)}`)
if (IS_ENDLESS) {
  const reached = results.map(result => result.cleared + 1)
  console.log(
    `Endless wave reached: median ${median(reached)}, best ${Math.max(...reached)}, worst ${Math.min(...reached)}`,
  )
}
console.log(
  `Upgrades at the end: spare tier median ${median(results.map(r => r.spareTier))}, pistol tier median ${median(results.map(r => r.pistolTier))}, spent median $${median(results.map(r => r.upgradeSpend))}`,
)
console.log(
  `Gnomes placed per run: median ${median(results.map(r => r.gnomesPlaced))}, most ${Math.max(...results.map(r => r.gnomesPlaced))}`,
)
console.log(
  `Median run length: ${(median(results.map(r => r.runMs)) / 60000).toFixed(2)} min`,
)
console.log(
  `Median win length: ${(median(wins.map(r => r.runMs)) / 60000).toFixed(2)} min`,
)
console.log(
  '\nMoney earned by the end of wave (median of runs that cleared it)',
)
for (let wave = 1; wave <= lastWave; wave++) {
  const values = results.flatMap(r =>
    r.moneyAfterWave[wave - 1] === undefined
      ? []
      : [r.moneyAfterWave[wave - 1]!],
  )
  if (values.length > 0) console.log(`  wave ${wave}: $${median(values)}`)
}
console.log(
  '\nShop visits: money on arrival (median, p25 to p75) and what the bot bought (share of visits)',
)
const quantile = (values: Array<number>, q: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}
for (let wave = 2; wave <= lastWave; wave++) {
  const visits = results.filter(r => r.moneyAtVisit[wave] !== undefined)
  if (visits.length === 0) continue
  const money = visits.map(r => r.moneyAtVisit[wave]!)
  const counts = new Map<string, number>()
  visits.forEach(r =>
    (r.boughtAtVisit[wave] ?? []).forEach(item =>
      counts.set(item, (counts.get(item) ?? 0) + 1),
    ),
  )
  const bought = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([item, n]) => `${item} ${((100 * n) / visits.length).toFixed(0)}%`)
    .join(', ')
  console.log(
    `  before wave ${wave}: $${median(money)} ($${quantile(money, 0.25)} to $${quantile(money, 0.75)}), n=${visits.length}: ${bought}`,
  )
}
const hurt = results.reduce((sum, r) => {
  ;(Object.keys(sum) as Array<Kind>).forEach(kind => {
    sum[kind] += r.hurtBy[kind]
  })
  return sum
}, emptyHurt())
const totalHurt = Object.values(hurt).reduce((a, b) => a + b, 0)
console.log('\nHearts lost by kind')
;(Object.keys(hurt) as Array<Kind>).forEach(kind => {
  console.log(
    `  ${kind.padEnd(9)} ${String(hurt[kind]).padStart(5)}  ${((100 * hurt[kind]) / Math.max(1, totalHurt)).toFixed(0)}%`,
  )
})

const pickupKinds = [
  ...new Set(
    results.flatMap(r => [
      ...Object.keys(r.dropped),
      ...Object.keys(r.grabbed),
    ]),
  ),
].sort()
const sumOf = (pick: (r: RunResult) => Record<string, number>, kind: string) =>
  results.reduce((sum, r) => sum + (pick(r)[kind] ?? 0), 0)
const totalDropped = pickupKinds.reduce(
  (sum, kind) => sum + sumOf(r => r.dropped, kind),
  0,
)
const totalGrabbed = pickupKinds.reduce(
  (sum, kind) => sum + sumOf(r => r.grabbed, kind),
  0,
)
console.log(
  `\nPickups: ${(totalDropped / runs).toFixed(1)} dropped and ${(totalGrabbed / runs).toFixed(1)} grabbed a run${IGNORES_PICKUPS ? ' (the bot ignores them)' : ''}, boosted ${(
    (100 * results.reduce((sum, r) => sum + r.boostedMs, 0)) /
    Math.max(
      1,
      results.reduce((sum, r) => sum + r.waveMs, 0),
    )
  ).toFixed(0)}% of wave time`,
)
pickupKinds.forEach(kind => {
  console.log(
    `  ${kind.padEnd(9)} dropped ${String(sumOf(r => r.dropped, kind)).padStart(5)}  grabbed ${String(sumOf(r => r.grabbed, kind)).padStart(5)}`,
  )
})

const fights = results.flatMap(r => r.boss)
const fightWaves = [...new Set(fights.map(fight => fight.wave))].sort(
  (a, b) => a - b,
)
console.log('\nBoss fights (per boss wave reached)')
fightWaves.forEach(bossWave => {
  const atWave = fights.filter(fight => fight.wave === bossWave)
  const arrived = atWave.filter(fight => fight.arrived)
  const felled = atWave.filter(fight => fight.felled)
  const diedTo = atWave.filter(fight => fight.diedToIt)
  const diedAtWave = results.filter(
    r => !r.victory && r.cleared + 1 === bossWave,
  ).length
  const perFight = (pick: (fight: BossFight) => number) =>
    (
      arrived.reduce((sum, fight) => sum + pick(fight), 0) /
      Math.max(1, arrived.length)
    ).toFixed(1)
  const share = (part: number, whole: number) =>
    `${((100 * part) / Math.max(1, whole)).toFixed(0)}%`
  const sum = (pick: (fight: BossFight) => number) =>
    arrived.reduce((total, fight) => total + pick(fight), 0)
  const wonKills = results
    .filter(r => r.victory || r.cleared >= bossWave)
    .flatMap(r => r.boss)
    .filter(fight => fight.wave === bossWave && fight.felled)
    .map(fight => fight.fightMs)
  const lostToBoss = sum(fight => fight.heartsLost)
  const waveHearts = results.reduce(
    (total, r) => total + (r.waves[bossWave - 1]?.heartsLost ?? 0),
    0,
  )
  console.log(
    `  wave ${bossWave}: reached ${atWave.length}, boss arrived ${arrived.length}, felled ${felled.length}, runs that died with it standing ${diedTo.length} of ${diedAtWave} deaths on the wave`,
  )
  console.log(
    `    fight: median ${(median(arrived.map(fight => fight.fightMs)) / 1000).toFixed(1)} s, kill time in runs that cleared the wave median ${(median(wonKills) / 1000).toFixed(1)} s (p25 ${(quantile(wonKills, 0.25) / 1000).toFixed(1)}, p75 ${(quantile(wonKills, 0.75) / 1000).toFixed(1)}, n=${wonKills.length}), enraged in ${share(arrived.filter(fight => fight.enraged).length, arrived.length)}`,
  )
  console.log(
    `    a fight: stomps ${perFight(fight => fight.stomps)} (${share(
      sum(fight => fight.stompHits),
      sum(fight => fight.stomps),
    )} hit), charges ${perFight(fight => fight.charges)} (${share(
      sum(fight => fight.chargeHits),
      sum(fight => fight.charges),
    )} hit, ${share(
      sum(fight => fight.bonks),
      sum(fight => fight.charges),
    )} bonked), spits ${perFight(fight => fight.spits)} (${share(
      sum(fight => fight.spitHits),
      sum(fight => fight.spits),
    )} hit), belches ${perFight(fight => fight.belches)}`,
  )
  console.log(
    `    his health taken a second of fight ${(sum(fight => fight.damageTaken) / Math.max(1, sum(fight => fight.fightMs) / 1000)).toFixed(2)}, a second aimed at him ${(sum(fight => fight.damageTaken) / Math.max(1, sum(fight => fight.aimedMs) / 1000)).toFixed(2)}, aimed at him ${share(
      sum(fight => fight.aimedMs),
      sum(fight => fight.fightMs),
    )} of the fight`,
  )
  console.log(
    `    hearts lost while he stood ${lostToBoss} (${share(lostToBoss, waveHearts)} of the wave's ${waveHearts}): stomp ${sum(fight => fight.heartsByAttack.Stomp)}, charge ${sum(fight => fight.heartsByAttack.Charge)}, glob ${sum(fight => fight.heartsByAttack.Glob)}, his bite ${sum(fight => fight.heartsByAttack.Bite)}, the rest to the crowd`,
  )
})

const newKindTotal = (pick: (log: NewKindLog) => number) =>
  results.reduce((sum, r) => sum + pick(r.newKinds), 0)
const perRun = (pick: (log: NewKindLog) => number) =>
  (newKindTotal(pick) / Math.max(1, runs)).toFixed(1)
console.log('\nNew kinds and frenzy (per run)')
console.log(
  `  Chucker throws ${perRun(log => log.throws)}, landed on the bot ${perRun(log => log.throwHits)} (${(
    (100 * newKindTotal(log => log.throwHits)) /
    Math.max(
      1,
      newKindTotal(log => log.throws),
    )
  ).toFixed(0)}%)`,
)
console.log(
  `  Ankle Biters surfaced ${perRun(log => log.surfaced)}, grabbed the bot ${perRun(log => log.grabs)}, hearts lost while held ${perRun(log => log.heartsWhileClung)}`,
)
console.log(
  `  Frenzied packs ${perRun(log => log.frenzies)}, wiped for the bonus ${perRun(log => log.wipes)}, bonus paid $${perRun(log => log.wipeBonus)}`,
)

console.log(
  `\nMost zombies on screen at once: median ${median(results.map(r => r.maxAlive))}, worst ${Math.max(...results.map(r => r.maxAlive))}`,
)

// TIMELINE

const seconds = (ms: number) => (ms / 1000).toFixed(1)

const printTimeline = (result: RunResult) => {
  console.log(
    `\nTimeline of seed ${result.seed} (wall seconds from wave start)`,
  )
  result.timelines.forEach((timeline, index) => {
    const gaps = timeline.packs
      .slice(1)
      .map((arrival, at) => arrival.atMs - timeline.packs[at]!.atMs)
    console.log(
      `  Wave ${index + 1}: ${seconds(timeline.lengthMs)} s, ${timeline.packs.length} packs, rests ${timeline.restMs.map(seconds).join(', ') || 'none'}, longest gap between packs ${seconds(Math.max(0, ...gaps))} s`,
    )
    console.log(
      `    ${timeline.packs
        .map(
          arrival =>
            `${seconds(arrival.atMs)} ${arrival.door[0]}${arrival.size}${arrival.formation === 'Squad' || arrival.formation === 'Trickle' ? '' : arrival.formation[0]}${new Set(arrival.kinds).size > 1 ? '*' : ''}`,
        )
        .join('  ')}`,
    )
    const empties = timeline.empty.filter(stretch => stretch.ms >= 1000)
    if (empties.length > 0) {
      console.log(
        `    empty room: ${empties
          .map(
            stretch =>
              `${seconds(stretch.fromMs)} for ${seconds(stretch.ms)} (quiet ${seconds(quietPartMs(stretch))})`,
          )
          .join(', ')}`,
      )
    }
  })
}

if (process.env.TIMELINE !== undefined) {
  printTimeline(results[0]!)
  console.log(
    '\nWave  first pack s  packs  sizes (min to max, distinct)  empty s  longest empty s  longest quiet s (mean, worst)  rests s',
  )
  for (let wave = 1; wave <= lastWave; wave++) {
    const timelines = results.flatMap(r =>
      r.timelines[wave - 1] === undefined ? [] : [r.timelines[wave - 1]!],
    )
    if (timelines.length === 0) continue
    const sizes = timelines.flatMap(t => t.packs.map(p => p.size))
    const distinct = mean(
      timelines.map(t => new Set(t.packs.map(p => p.size)).size),
    )
    const longestQuiet = timelines.map(t =>
      Math.max(0, ...t.empty.map(quietPartMs)),
    )
    console.log(
      `${String(wave).padStart(4)}  ${seconds(mean(timelines.map(t => t.packs[0]?.atMs ?? 0))).padStart(12)}  ${mean(
        timelines.map(t => t.packs.length),
      )
        .toFixed(1)
        .padStart(
          5,
        )}  ${`${Math.min(...sizes)} to ${Math.max(...sizes)}, ${distinct.toFixed(1)}`.padStart(29)}  ${seconds(
        mean(timelines.map(t => t.empty.reduce((sum, e) => sum + e.ms, 0))),
      ).padStart(7)}  ${seconds(
        mean(timelines.map(t => Math.max(0, ...t.empty.map(e => e.ms)))),
      ).padStart(
        15,
      )}  ${`${seconds(mean(longestQuiet))}, ${seconds(Math.max(...longestQuiet))}`.padStart(30)}  ${seconds(mean(timelines.flatMap(t => t.restMs)))}`,
    )
  }
}
