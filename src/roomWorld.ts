import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type {
  PlayerInput,
  PlayerTick,
  Reader,
  RoomDifficulty,
  RoomMode,
  World as RoomWorldOf,
  Score,
  Writer,
} from '@munch/netcode'

import { MANOR, startingLevel } from './arena'
import {
  FIRST_PREPARATION_MS,
  FIXED_STEP_MS,
  PREPARATION_MS,
} from './constants'
import { normalize } from './geometry'
import { freshOvens } from './kitchen'
import {
  focusSeat,
  forEachSeat,
  maybePlayerAt,
  playersOf,
  presenceOf,
  seatCrew,
  setPresence,
  slotsOf,
  soloSeat,
  withSeat,
} from './party'
import { flowFieldToward } from './pathing'
import { predictLeadSeat } from './simulation'
import { SeatAction, applySeatAction, stepWorld } from './stepWorld'
import { FINAL_WAVE, beginPreparation } from './waves'
import type { World } from './world'
import {
  readEvent,
  readWorld,
  readWorldDiff,
  writeEvent,
  writeWorld,
  writeWorldDiff,
} from './worldCodec'
import {
  Boss,
  DebutCard,
  type Difficulty,
  FIRST_SHOP_CATEGORY,
  FixedShopItemId,
  type GameEvent,
  type Intent,
  Lesson,
  type Lessons,
  Party,
  Phase,
  type Player,
  type PlayerSlot,
  RunMode,
  type Seat,
  ShopState,
  type Trap,
  calmPacing,
  emptyTrapStock,
  emptyWallet,
  freshLoot,
  freshStats,
  idleBoosts,
  idleIntent,
  initialHitStop,
  initialPlayer,
  noPractice,
} from './worldSchema'

// The game's World in a co-op room (MULTIPLAYER.md, Phase 2): the netcode
// `World` (packages/netcode, World.ts) over `stepWorld`. The room seats
// the lobby's players in a fresh run, turns each player's PlayerInput into
// their intent and their presses into seat actions, and steps the World
// 60 times a second; the wire is the binary codec in src/worldCodec.ts,
// with the tick's events beside each diff. A client reads it back,
// interpolates everyone else between two messages, and predicts its own
// player's walk from its own input.
//
// This module is what a room runs, so it imports no UI, art, camera,
// input, or store: `bun run world:check` bundles it and fails otherwise.

// NOTE: a room's World: the game's World, the room's tick, and the events
// of the last ticks by tick, so a diff carries every event since the one
// before it. `pressed` is the room's memory of each player's last action,
// to see a new press; a client's copy keeps it empty.
export type TickEvents = Readonly<{
  tick: number
  events: ReadonlyArray<GameEvent>
}>

export type RoomWorld = Readonly<{
  tick: number
  world: World
  events: ReadonlyArray<TickEvents>
  pressed: ReadonlyArray<readonly [slot: PlayerSlot, action: number]>
}>

// NOTE: your own part of the World, for prediction: your slot and player.
export type OwnSeat = Readonly<{ slot: PlayerSlot; player: Player }>

export type RoomSettings = Readonly<{ difficulty: Difficulty; mode: RunMode }>

// NOTE: what the lobby picked (packages/netcode, Lobby.ts) as the run's
// settings. KeepGoing plays endless, carrying on a kept run when the room
// has one.
export const roomSettingsOf = (
  mode: RoomMode,
  difficulty: RoomDifficulty,
): RoomSettings => ({
  difficulty,
  mode:
    mode === 'Endless' || mode === 'KeepGoing'
      ? RunMode.Endless()
      : RunMode.Campaign(),
})

// NOTE: events older than this many ticks are dropped from the room's
// copy; a diff goes out every 3 ticks.
const EVENT_TICKS = 60

// INPUT

// NOTE: a PlayerInput as the room reads it (packages/netcode, Protocol.ts):
// move as whole 127ths, aim as a direction scaled to AIM_REACH and kept to
// eighths (the wire's precision), the trigger as button bit FIRE_BUTTON,
// and a press as `action`.
export const MOVE_SCALE = 127
export const AIM_REACH = 1024
export const FIRE_BUTTON = 1
const AIM_PRECISION = 8

const eighths = (value: number): number =>
  Math.round(value * AIM_PRECISION) / AIM_PRECISION

export const inputOfIntent = (intent: Intent, action: number): PlayerInput => {
  const aim = Option.getOrElse(intent.maybeAim, () => ({ x: 0, y: 0 }))
  return {
    moveX: Math.round(Math.max(-1, Math.min(1, intent.move.x)) * MOVE_SCALE),
    moveY: Math.round(Math.max(-1, Math.min(1, intent.move.y)) * MOVE_SCALE),
    aimX: eighths(aim.x * AIM_REACH),
    aimY: eighths(aim.y * AIM_REACH),
    buttons: intent.trigger === 'Held' ? FIRE_BUTTON : 0,
    action,
  }
}

const moveOf = (input: PlayerInput) => {
  const x = input.moveX / MOVE_SCALE
  const y = input.moveY / MOVE_SCALE
  const length = Math.sqrt(x * x + y * y)
  return length > 1 ? { x: x / length, y: y / length } : { x, y }
}

export const intentOfInput = (input: PlayerInput): Intent => ({
  move: moveOf(input),
  maybeAim:
    input.aimX === 0 && input.aimY === 0
      ? Option.none()
      : normalize({ x: input.aimX, y: input.aimY }),
  trigger: (input.buttons & FIRE_BUTTON) !== 0 ? 'Held' : 'Released',
})

// ACTIONS

// NOTE: a press rides in the input's 16-bit `action` as a held value, so it
// survives the room's one-input-per-tick rule: 12 bits name the action and
// 4 bits count presses, so the same press twice in a row is still a change.
// The room applies an action on the tick its value changes. A repair names
// its trap by id modulo REPAIR_SPAN; a room holds a handful of traps.
const ACTION_BITS = 12
const ACTION_SPAN = 2 ** ACTION_BITS
const PRESS_COUNTS = 15
const BUY_BASE = 16
const REPAIR_BASE = 64
const REPAIR_SPAN = ACTION_SPAN - REPAIR_BASE
const REPAIR_PREFIX = 'Repair-'

const SIMPLE_ACTIONS: ReadonlyArray<SeatAction['_tag']> = [
  'Swap',
  'Reload',
  'PlaceTrap',
  'NextTrap',
  'BuyExit',
  'LeaveCounter',
  'Ready',
]

const FIXED_ITEMS = FixedShopItemId.literals

const simpleCode = (tag: SeatAction['_tag']): number =>
  Option.getOrElse(
    Array.findFirstIndex(SIMPLE_ACTIONS, simple => simple === tag),
    () => -1,
  ) + 1

const itemCode = (item: string): number =>
  Option.match(
    Array.findFirstIndex(FIXED_ITEMS, fixed => fixed === item),
    {
      onSome: index => BUY_BASE + index,
      onNone: () =>
        REPAIR_BASE + (Number(item.slice(REPAIR_PREFIX.length)) % REPAIR_SPAN),
    },
  )

export const actionCodeOf = (action: SeatAction): number =>
  SeatAction.match(action, {
    Swap: () => simpleCode('Swap'),
    Reload: () => simpleCode('Reload'),
    PlaceTrap: () => simpleCode('PlaceTrap'),
    NextTrap: () => simpleCode('NextTrap'),
    Buy: ({ item }) => itemCode(item),
    BuyExit: () => simpleCode('BuyExit'),
    LeaveCounter: () => simpleCode('LeaveCounter'),
    Ready: () => simpleCode('Ready'),
  })

// NOTE: the held value for the `press`th press of an action: never zero.
export const heldAction = (code: number, press: number): number =>
  ((press % PRESS_COUNTS) + 1) * ACTION_SPAN + code

const simpleAction = (tag: SeatAction['_tag']): Option.Option<SeatAction> => {
  if (tag === 'Swap') {
    return Option.some(SeatAction.Swap())
  } else if (tag === 'Reload') {
    return Option.some(SeatAction.Reload())
  } else if (tag === 'PlaceTrap') {
    return Option.some(SeatAction.PlaceTrap())
  } else if (tag === 'NextTrap') {
    return Option.some(SeatAction.NextTrap())
  } else if (tag === 'BuyExit') {
    return Option.some(SeatAction.BuyExit())
  } else if (tag === 'LeaveCounter') {
    return Option.some(SeatAction.LeaveCounter())
  } else if (tag === 'Ready') {
    return Option.some(SeatAction.Ready())
  } else {
    return Option.none()
  }
}

const trapId = (trap: Trap): number => trap.id

export const seatActionOf = (
  world: World,
  held: number,
): Option.Option<SeatAction> => {
  const code = held % ACTION_SPAN
  if (code >= REPAIR_BASE) {
    return pipe(
      Array.findFirst(
        world.traps,
        trap => trapId(trap) % REPAIR_SPAN === code - REPAIR_BASE,
      ),
      Option.map(trap =>
        SeatAction.Buy({ item: `${REPAIR_PREFIX}${trapId(trap)}` }),
      ),
    )
  } else if (code >= BUY_BASE) {
    return Option.map(Array.get(FIXED_ITEMS, code - BUY_BASE), item =>
      SeatAction.Buy({ item }),
    )
  } else {
    return Option.flatMap(Array.get(SIMPLE_ACTIONS, code - 1), simpleAction)
  }
}

// START

const learned = Lesson.Learned({ atMs: 0 })

const settledLessons: Lessons = {
  move: learned,
  fire: learned,
  startWave: learned,
  shop: learned,
  swap: learned,
  pickup: learned,
  timedBreaks: learned,
  openBreak: learned,
}

// NOTE: a fresh run's World with nobody seated yet, as single player's run
// reset starts one, with single player's gates settled.
export const freshWorld = (seed: number, settings: RoomSettings): World => ({
  phase: Phase.Ready(),
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  mode: settings.mode,
  difficulty: { chosen: settings.difficulty, nightmare: 'Locked' },
  player: initialPlayer,
  zombies: [],
  bullets: [],
  nextEntityId: 0,
  wallet: emptyWallet,
  elapsedMs: 0,
  frameEvents: [],
  traps: [],
  pickups: [],
  boosts: idleBoosts,
  loot: freshLoot(seed),
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  level: startingLevel,
  ovens: freshOvens(MANOR),
  laserSight: 'None',
  rngState: seed,
  intent: idleIntent,
  flowField: flowFieldToward(MANOR, initialPlayer, 'Narrow', []),
  wideFlowField: flowFieldToward(MANOR, initialPlayer, 'Wide', []),
  shop: ShopState.Away(),
  shopCategory: FIRST_SHOP_CATEGORY,
  hitStop: initialHitStop,
  lessons: settledLessons,
  practice: noPractice,
  debutCard: DebutCard.Hidden(),
  stats: freshStats,
  party: Party.Solo(),
})

const seatAt = (slot: PlayerSlot): Seat =>
  modifyFields(soloSeat, { slot: () => slot })

// NOTE: the lobby's players by their room slots. Even one player plays as
// a crew of one, by co-op's rules: no world pause, READY for the break.
const seatSlots = (world: World, slots: ReadonlyArray<PlayerSlot>): World => {
  const ordered = Array.sort(Array.dedupe(slots), (a: number, b: number) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  const crewed = seatCrew(world, Math.max(2, ordered.length))
  return modifyFields(crewed, {
    party: party =>
      Party.match(party, {
        Solo: () => party,
        Crew: ({ mates }) =>
          Party.Crew({
            lead: seatAt(ordered[0] ?? 0),
            mates: Array.filterMap(mates, (mate, index) =>
              Option.match(Array.get(ordered, index + 1), {
                onNone: () => Result.failVoid,
                onSome: slot => Result.succeed({ ...mate, seat: seatAt(slot) }),
              }),
            ),
          }),
      }),
  })
}

export const startRoomWorld = (
  slots: ReadonlyArray<PlayerSlot>,
  seed: number,
  settings: RoomSettings,
): RoomWorld => ({
  tick: 0,
  world: beginPreparation(
    seatSlots(freshWorld(seed, settings), slots),
    1,
    FIRST_PREPARATION_MS,
  ),
  events: [],
  pressed: [],
})

// KEEP GOING

// NOTE: a won campaign carried on into endless, as single player's KEEP
// GOING does (src/waves.ts, keepGoing): the same crew with their money,
// guns, traps, and hearts, everyone out of the shop, the first endless
// wave's break counting. The room's ticks start again from 0.
export const keepGoingWorld = (world: World): World =>
  beginPreparation(
    forEachSeat(
      modifyFields(world, { mode: () => RunMode.Endless() }),
      seatWorld => modifyFields(seatWorld, { shop: () => ShopState.Away() }),
    ),
    FINAL_WAVE + 1,
    PREPARATION_MS,
  )

export const isWonRun = (world: World): boolean =>
  Phase.isAnyOf(['Victory'])(world.phase) &&
  RunMode.isAnyOf(['Campaign'])(world.mode)

// NOTE: a kept run plays on only for the crew that won it, seat for seat.
export const canKeepGoingWith = (
  world: World,
  slots: ReadonlyArray<PlayerSlot>,
): boolean => {
  const kept = slotsOf(world)
  const sorted = Array.sort(Array.dedupe(slots), (a: number, b: number) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  return (
    isWonRun(world) &&
    kept.length === sorted.length &&
    Array.every(kept, (slot, index) => sorted[index] === slot)
  )
}

export const keepGoingRoomWorld = (world: World): RoomWorld => ({
  tick: 0,
  world: keepGoingWorld(world),
  events: [],
  pressed: [],
})

// STEP

const syncPresence = (world: World, tick: PlayerTick): World =>
  presenceOf(world, tick.slot) === tick.presence
    ? world
    : setPresence(world, tick.slot, tick.presence)

const lastPressOf = (room: RoomWorld, slot: PlayerSlot): number =>
  Option.getOrElse(
    Option.map(
      Array.findFirst(room.pressed, ([pressedSlot]) => pressedSlot === slot),
      ([, action]) => action,
    ),
    () => 0,
  )

const pressOf = (room: RoomWorld, world: World, tick: PlayerTick): World =>
  tick.input.action !== 0 && tick.input.action !== lastPressOf(room, tick.slot)
    ? Option.match(seatActionOf(world, tick.input.action), {
        onNone: () => world,
        onSome: action => applySeatAction(world, tick.slot, action),
      })
    : world

export const stepRoomWorld = (
  room: RoomWorld,
  players: ReadonlyArray<PlayerTick>,
): RoomWorld => {
  const pressedWorld = Array.reduce(players, room.world, (world, tick) =>
    pressOf(room, syncPresence(world, tick), tick),
  )
  const stepped = stepWorld(
    pressedWorld,
    new Map(Array.map(players, tick => [tick.slot, intentOfInput(tick.input)])),
  )
  const tick = room.tick + 1
  return {
    tick,
    world: stepped.world,
    events: Array.filter(
      Array.isReadonlyArrayEmpty(stepped.events)
        ? room.events
        : Array.append(room.events, { tick, events: stepped.events }),
      entry => entry.tick > tick - EVENT_TICKS,
    ),
    pressed: Array.map(players, player => [player.slot, player.input.action]),
  }
}

// THE WIRE

export const writeRoomSnapshot = (writer: Writer, room: RoomWorld): void => {
  writer.varint(room.tick)
  writeWorld(writer, room.world)
}

export const readRoomSnapshot = (reader: Reader): RoomWorld => ({
  tick: reader.varint(),
  world: readWorld(reader),
  events: [],
  pressed: [],
})

const MAX_EVENTS = 4096

export const writeRoomDiff = (
  writer: Writer,
  prev: RoomWorld,
  next: RoomWorld,
): void => {
  writer.varint(Math.max(0, next.tick - prev.tick))
  writeWorldDiff(writer, prev.world, next.world)
  const fresh = Array.filter(
    next.events,
    entry => entry.tick > prev.tick && entry.tick <= next.tick,
  )
  writer.varint(fresh.length)
  Array.forEach(fresh, entry => {
    writer.varint(entry.tick - prev.tick)
    writer.varint(entry.events.length)
    Array.forEach(entry.events, event => writeEvent(writer, event))
  })
}

const readCount = (reader: Reader): number => {
  const count = reader.varint()
  if (count > MAX_EVENTS) {
    throw new Error(`${count} events in a diff`)
  }
  return count
}

const readMany = <A>(count: number, read: () => A): ReadonlyArray<A> =>
  globalThis.Array.from({ length: count }, read)

export const readRoomDiff = (reader: Reader, prev: RoomWorld): RoomWorld => {
  const tick = prev.tick + reader.varint()
  const world = readWorldDiff(reader, prev.world)
  const events = readMany(readCount(reader), () => {
    const at = prev.tick + reader.varint()
    return {
      tick: at,
      events: readMany(readCount(reader), () => readEvent(reader)),
    }
  })
  return { tick, world, events, pressed: [] }
}

// INTERPOLATION

// NOTE: something that moved further than this between two messages was
// thrown, respawned, or swapped, so it is shown where it is.
const TELEPORT_PX = 64

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t

type Placed = Readonly<{ x: number; y: number }>

const lerpPlaced = <A extends Placed>(from: A, to: A, t: number): A =>
  Math.abs(to.x - from.x) + Math.abs(to.y - from.y) > TELEPORT_PX
    ? to
    : { ...to, x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) }

const lerpById = <A extends Placed & Readonly<{ id: number }>>(
  from: ReadonlyArray<A>,
  to: ReadonlyArray<A>,
  t: number,
): ReadonlyArray<A> => {
  const before = new Map(Array.map(from, item => [item.id, item] as const))
  return Array.map(to, item =>
    Option.match(Option.fromNullishOr(before.get(item.id)), {
      onNone: () => item,
      onSome: was => lerpPlaced(was, item, t),
    }),
  )
}

const lerpParty = (from: World, to: World, t: number): Party =>
  Party.match(to.party, {
    Solo: () => to.party,
    Crew: ({ lead, mates }) =>
      Party.Crew({
        lead,
        mates: Array.map(mates, mate =>
          Option.match(maybePlayerAt(from, mate.seat.slot), {
            onNone: () => mate,
            onSome: was => ({
              ...mate,
              player: lerpPlaced(was.player, mate.player, t),
            }),
          }),
        ),
      }),
  })

export const interpolateWorld = (from: World, to: World, t: number): World =>
  modifyFields(to, {
    player: player => lerpPlaced(from.player, player, t),
    zombies: zombies => lerpById(from.zombies, zombies, t),
    bullets: bullets => lerpById(from.bullets, bullets, t),
    party: () => lerpParty(from, to, t),
  })

// OWN PLAYER

const ownOf = (room: RoomWorld, slot: PlayerSlot): Option.Option<OwnSeat> =>
  Option.map(maybePlayerAt(room.world, slot), ({ player }) => ({
    slot,
    player,
  }))

const putOwn = (
  room: RoomWorld,
  slot: PlayerSlot,
  own: OwnSeat,
): RoomWorld => ({
  ...room,
  world: withSeat(room.world, slot, seatWorld =>
    modifyFields(seatWorld, { player: () => own.player }),
  ),
})

// NOTE: one predicted tick of your own player from your own input, against
// the newest World the room sent: its walls, traps, and boosts. It walks,
// reloads, and pulls the trigger, so the shot's cooldown, recoil, and ammo
// are predicted too; the room's answer replaces them on the next message.
export const predictOwn = (
  own: OwnSeat,
  input: PlayerInput,
  room: RoomWorld,
): OwnSeat => ({
  ...own,
  player: predictLeadSeat(
    modifyFields(focusSeat(room.world, own.slot), {
      player: () => own.player,
      intent: () => intentOfInput(input),
    }),
    FIXED_STEP_MS,
  ).player,
})

const gapOf = (a: OwnSeat, b: OwnSeat): number =>
  Math.hypot(a.player.x - b.player.x, a.player.y - b.player.y)

const blendOwn = (from: OwnSeat, to: OwnSeat, t: number): OwnSeat => ({
  ...to,
  player: {
    ...to.player,
    x: lerp(from.player.x, to.player.x, t),
    y: lerp(from.player.y, to.player.y, t),
  },
})

// THE ROOM'S WORLD

export const isRunOver = (world: World): boolean =>
  Phase.isAnyOf(['GameOver', 'Victory'])(world.phase)

const scoresOf = (world: World): ReadonlyArray<Score> =>
  Array.map(playersOf(world), ({ slot, seat }) => ({
    slot,
    score: seat.kills,
  }))

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  difficulty: 'Normal',
  mode: RunMode.Campaign(),
}

// NOTE: the room's World for one run: a fresh run with the lobby's
// settings, or a kept run carried on when the crew is the one that won it.
export const roomWorldFor = (
  settings: RoomSettings,
  maybeKept: Option.Option<World> = Option.none(),
): RoomWorldOf<RoomWorld, OwnSeat> => ({
  name: 'MunchManor',
  start: (slots, seed) =>
    Option.match(
      Option.filter(maybeKept, kept => canKeepGoingWith(kept, slots)),
      {
        onNone: () => startRoomWorld(slots, seed, settings),
        onSome: keepGoingRoomWorld,
      },
    ),
  step: stepRoomWorld,
  removePlayer: (room, slot) => ({
    ...room,
    world: setPresence(room.world, slot, 'Away'),
  }),
  isOver: room => isRunOver(room.world),
  isWon: room => isWonRun(room.world),
  scores: room => scoresOf(room.world),
  snapshot: writeRoomSnapshot,
  readSnapshot: readRoomSnapshot,
  diff: writeRoomDiff,
  applyDiff: readRoomDiff,
  interpolate: (from, to, t) => ({
    ...to,
    world: interpolateWorld(from.world, to.world, t),
  }),
  own: {
    of: ownOf,
    put: putOwn,
    step: predictOwn,
    gap: gapOf,
    blend: blendOwn,
  },
})

// NOTE: the seat a client draws itself as: its own player in the World's
// per-player fields (src/party.ts, focusSeat).
export const ownWorldOf = (room: RoomWorld, slot: PlayerSlot): World =>
  focusSeat(room.world, slot)

export const isRoomSlot = (room: RoomWorld, slot: PlayerSlot): boolean =>
  Option.isSome(maybePlayerAt(room.world, slot))

// NOTE: the events of the ticks after `afterTick` up to `untilTick`, oldest
// first, from every message a client holds.
export const eventsBetween = (
  frames: ReadonlyArray<Readonly<{ world: RoomWorld }>>,
  afterTick: number,
  untilTick: number,
): ReadonlyArray<GameEvent> =>
  pipe(
    frames,
    Array.flatMap(frame => frame.world.events),
    Array.filter(entry => entry.tick > afterTick && entry.tick <= untilTick),
    Array.sort((a: TickEvents, b: TickEvents) =>
      a.tick < b.tick ? -1 : a.tick > b.tick ? 1 : 0,
    ),
    Array.flatMap(entry => entry.events),
  )

export const maybeSeatOf = (
  world: World,
  slot: PlayerSlot,
): Option.Option<Seat> =>
  Option.map(maybePlayerAt(world, slot), ({ seat }) => seat)
