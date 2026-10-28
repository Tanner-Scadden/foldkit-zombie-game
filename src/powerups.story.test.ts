import { Array, Option, Record } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  FIRE_INTERVAL_MS,
  PISTOL_DAMAGE,
  PISTOL_MAGAZINE,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  PREPARATION_MS,
  ZOMBIE_KNOCKBACK_SPEED,
} from './constants'
import { Message, update } from './main'
import {
  Beat,
  type BoostKind,
  BoostTimer,
  type Boosts,
  type Bullet,
  DebutCard,
  GameEvent,
  HitStop,
  type Hold,
  type Loot,
  type Model,
  Phase,
  type Pickup,
  type PickupKind,
  Pierce,
  type PlannedSpawn,
  Prize,
  Reload,
  ShopState,
  type Zombie,
  type ZombieKind,
  ZombieState,
  idleBoosts,
  initialModel,
} from './model'
import { shownHints } from './onboarding'
import { pickupShapes } from './powerupView'
import {
  BOOSTS,
  BOOST_STACK_MAX,
  BURP_DAMAGE,
  BURP_RADIUS,
  DROP_RULES,
  PICKUP_BLINK_MS,
  PICKUP_LIFETIME_MS,
  TUTORIAL_DROP,
  TUTORIAL_DROP_KILL,
} from './powerups'
import { asVeteran } from './veteran'
import { ZOMBIE_KINDS } from './zombies'

// SETUP

const FRAME_MS = 50
const SURFACE = { left: 0, top: 0, width: 800, height: 400 }

const tick = message(Message.TickedFrame({ deltaTime: FRAME_MS }))

const ticks = (count: number) => Array.makeBy(count, () => tick)

const ticksFor = (ms: number) => ticks(Math.round(ms / FRAME_MS))

const press = (code: string) => message(Message.PressedKey({ code }))
const release = (code: string) => message(Message.ReleasedKey({ code }))

const HELD_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const fightingWave = (wave: number): Model =>
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [HELD_SPAWN] }),
    pacing: pacing =>
      modifyFields(pacing, { warnedPacks: () => [HELD_SPAWN.pack] }),
  })

const fighting = fightingWave(3)

const preparing: Model = modifyFields(fighting, {
  phase: () =>
    Phase.Preparation({
      wave: 3,
      remainingMs: 15_000,
      durationMs: PREPARATION_MS,
      spawns: [HELD_SPAWN],
    }),
})

const withLoot = (base: Model, loot: Partial<Loot>): Model =>
  modifyFields(base, {
    loot: current => ({
      rngState: loot.rngState ?? current.rngState,
      dryMs: loot.dryMs ?? current.dryMs,
      prize: loot.prize ?? current.prize,
    }),
  })

const zombieAt = (
  id: number,
  kind: ZombieKind,
  x: number,
  y: number,
  hp: number,
): Zombie => ({
  id,
  kind,
  x,
  y,
  speed: 0,
  hp,
  maxHp: hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
})

const bulletInto = (zombie: Zombie): Bullet => ({
  id: zombie.id + 500,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 1,
  knockback: 0,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
})

const victimsOf = (kind: ZombieKind, count: number): ReadonlyArray<Zombie> =>
  Array.makeBy(count, index =>
    zombieAt(100 + index, kind, 30 + index * 22, 62, 1),
  )

const withKills = (base: Model, victims: ReadonlyArray<Zombie>): Model =>
  modifyFields(base, {
    zombies: () => victims,
    bullets: () => Array.map(victims, bulletInto),
  })

const pickupAt = (
  id: number,
  kind: PickupKind,
  x: number,
  y: number,
  ageMs = 0,
): Pickup => ({ id, kind, x, y, ageMs })

const withPickups = (base: Model, pickups: ReadonlyArray<Pickup>): Model =>
  modifyFields(base, { pickups: () => pickups })

const underPlayer = (base: Model, kind: PickupKind): Model =>
  withPickups(base, [pickupAt(900, kind, base.player.x, base.player.y)])

const withBoost = (base: Model, boost: BoostKind, remainingMs: number): Model =>
  modifyFields(base, {
    boosts: boosts =>
      Record.map(boosts, (timer, kind) =>
        kind === boost
          ? BoostTimer.On({ remainingMs, durationMs: remainingMs })
          : timer,
      ),
  })

const remainingOf = (boosts: Boosts, kind: BoostKind): number =>
  BoostTimer.match(boosts[kind], {
    Off: () => 0,
    On: ({ remainingMs }) => remainingMs,
  })

const tagsOf = (events: ReadonlyArray<GameEvent>): ReadonlyArray<string> =>
  Array.map(events, ({ _tag }) => _tag)

type Drop = Readonly<{ kind: PickupKind; x: number; y: number }>

const dropsOf = (pickups: ReadonlyArray<Pickup>): ReadonlyArray<Drop> =>
  Array.map(pickups, ({ kind, x, y }) => ({ kind, x, y }))

// DROPS

describe('drops', () => {
  const tankRoom = (rngState: number): Model =>
    withLoot(withKills(fighting, victimsOf('Tank', 6)), {
      rngState,
      dryMs: DROP_RULES.gapMs,
    })

  const dropsFor = (rngState: number): ReadonlyArray<Drop> => {
    const seen: Array<ReadonlyArray<Drop>> = []
    story(
      update,
      given(tankRoom(rngState)),
      tick,
      model(({ pickups }) => {
        seen.push(dropsOf(pickups))
      }),
    )
    return Option.getOrElse(Array.head(seen), () => [])
  }

  test('the same seed drops the same pickups, and other seeds drop differently', () => {
    const seeds = Array.makeBy(8, index => 1 + index * 7919)
    const first = Array.map(seeds, dropsFor)
    const second = Array.map(seeds, dropsFor)
    expect(second).toEqual(first)
    expect(Array.some(first, Array.isReadonlyArrayNonEmpty)).toBe(true)
    expect(
      Array.dedupeWith(first, (a, b) => JSON.stringify(a) === JSON.stringify(b))
        .length,
    ).toBeGreaterThan(1)
  })

  test('drops come from their own seeded stream and never touch the game seed', () => {
    story(
      update,
      given(withLoot(tankRoom(12345), { dryMs: DROP_RULES.pityMs })),
      tick,
      model(({ loot, pickups }) => {
        expect(pickups).toHaveLength(1)
        expect(loot.rngState).not.toBe(12345)
        expect(loot.dryMs).toBe(0)
      }),
    )
  })

  test('random drops wait out the gap after the last drop', () => {
    story(
      update,
      given(withLoot(withKills(fighting, victimsOf('Tank', 6)), { dryMs: 0 })),
      tick,
      model(({ pickups, loot, frameEvents }) => {
        expect(
          Array.filter(frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
        ).toHaveLength(6)
        expect(pickups).toEqual([])
        expect(loot.dryMs).toBe(FRAME_MS)
      }),
    )
  })

  test('the floor never holds more than the cap', () => {
    const full = Array.makeBy(DROP_RULES.floorMax, index =>
      pickupAt(800 + index, 'Speed', 60 + index * 20, 150),
    )
    story(
      update,
      given(
        withPickups(
          withLoot(withKills(fighting, victimsOf('Tank', 6)), {
            dryMs: DROP_RULES.pityMs,
            prize: Prize.Owed(),
          }),
          full,
        ),
      ),
      tick,
      model(({ pickups, loot }) => {
        expect(pickups).toHaveLength(DROP_RULES.floorMax)
        expect(loot.prize).toEqual(Prize.Owed())
        expect(loot.dryMs).toBe(DROP_RULES.pityMs + FRAME_MS)
      }),
    )
  })

  test('a dry spell ends: once the pity time passes, the next kill drops for sure', () => {
    story(
      update,
      given(withLoot(fighting, { dryMs: 0 })),
      ...ticks(10),
      model(({ loot }) => {
        expect(loot.dryMs).toBe(10 * FRAME_MS)
      }),
    )
    story(
      update,
      given(
        withLoot(withKills(fighting, victimsOf('Shambler', 1)), {
          dryMs: DROP_RULES.pityMs,
        }),
      ),
      tick,
      model(({ pickups, loot, frameEvents }) => {
        expect(pickups).toHaveLength(1)
        expect(tagsOf(frameEvents)).toContain('PickupDropped')
        expect(loot.dryMs).toBe(0)
      }),
    )
  })

  test('a peak owes a prize: the first kill after its fade begins rolls the prize odds', () => {
    const hold: Hold = { atMs: 1000, releaseBelow: 4, relaxMs: 5000 }
    const crowd = Array.makeBy(5, index =>
      zombieAt(300 + index, 'Tank', 40 + index * 20, 150, 30),
    )
    const target = zombieAt(400, 'Shambler', 120, 40, 1)
    const incoming = modifyFields(bulletInto(target), {
      x: x => x - 18,
      velocityX: () => 240,
    })
    const peakRoom = (rngState: number): Model =>
      modifyFields(withLoot(fighting, { dryMs: 0, rngState }), {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 990, spawns: [HELD_SPAWN] }),
        pacing: pacing => modifyFields(pacing, { holds: () => [hold] }),
        zombies: () => [...crowd, target],
        bullets: () => [incoming],
      })
    const seeds = Array.makeBy(40, index => 11 + index * 7919)
    const dropped = Array.map(seeds, rngState => {
      const counts: Array<number> = []
      story(
        update,
        given(peakRoom(rngState)),
        tick,
        model(({ pacing, loot, pickups }) => {
          expect(Beat.isAnyOf(['Fading'])(pacing.beat)).toBe(true)
          expect(loot.prize).toEqual(Prize.Owed())
          expect(pickups).toEqual([])
        }),
        tick,
        model(({ loot, pickups, frameEvents }) => {
          expect(tagsOf(frameEvents)).toContain('ZombieKilled')
          expect(loot.prize).toEqual(Prize.Settled())
          counts.push(pickups.length)
        }),
      )
      return Option.getOrElse(Array.head(counts), () => 0)
    })
    const share = Array.reduce(dropped, 0, (sum, count) => sum + count) / 40
    expect(share).toBeGreaterThan(DROP_RULES.prizeChance - 0.2)
    expect(share).toBeLessThan(DROP_RULES.prizeChance + 0.2)
  })

  test('wave 1 drops one Hot Sauce on its third kill and nothing else', () => {
    const victims = victimsOf('Shambler', 5)
    story(
      update,
      given(
        withLoot(withKills(fightingWave(1), victims), {
          dryMs: DROP_RULES.pityMs,
          prize: Prize.Owed(),
        }),
      ),
      tick,
      model(({ pickups }) => {
        expect(Array.map(pickups, ({ kind }) => kind)).toEqual([TUTORIAL_DROP])
        const third = Option.getOrThrow(
          Array.get(victims, TUTORIAL_DROP_KILL - 1),
        )
        expect(dropsOf(pickups)).toEqual([
          { kind: TUTORIAL_DROP, x: third.x, y: third.y },
        ])
      }),
    )
  })

  test('a pickup lands inside the room, never in a wall or a doorway', () => {
    const atDoor = zombieAt(100, 'Tank', 215, 4, 1)
    story(
      update,
      given(
        withLoot(withKills(fighting, [atDoor]), { dryMs: DROP_RULES.pityMs }),
      ),
      tick,
      model(({ pickups }) => {
        const pickup = Option.getOrThrow(Array.head(pickups))
        expect(pickup.y).toBeGreaterThanOrEqual(26)
        expect(pickup.x).toBeGreaterThan(10)
      }),
    )
  })
})

// GRABBING

describe('grabbing', () => {
  test('walking over a pickup grabs it and announces its name', () => {
    const { x, y } = fighting.player
    story(
      update,
      given(withPickups(fighting, [pickupAt(900, 'RapidFire', x + 14, y)])),
      tick,
      model(({ pickups }) => {
        expect(pickups).toHaveLength(1)
      }),
      press('KeyD'),
      ...ticks(3),
      model(({ pickups, boosts, callouts, lessons }) => {
        expect(pickups).toEqual([])
        expect(remainingOf(boosts, 'RapidFire')).toBeGreaterThan(0)
        expect(Array.map(callouts, ({ kind }) => kind)).toEqual(['RapidFire'])
        expect(lessons.pickup._tag).toBe('Learned')
      }),
    )
  })

  test('a thumb on the move stick grabs a pickup the same way', () => {
    const { x, y } = fighting.player
    story(
      update,
      given(withPickups(fighting, [pickupAt(900, 'Speed', x + 14, y)])),
      message(
        Message.PressedPointer({
          pointerId: 7,
          device: 'Touch',
          clientX: 100,
          clientY: 300,
        }),
      ),
      message(
        Message.MovedPointer({ pointerId: 7, clientX: 160, clientY: 300 }),
      ),
      ...ticks(4),
      model(({ pickups, boosts }) => {
        expect(pickups).toEqual([])
        expect(remainingOf(boosts, 'Speed')).toBeGreaterThan(0)
      }),
    )
  })

  test('a pickup out of reach stays on the floor', () => {
    const { x, y } = fighting.player
    story(
      update,
      given(withPickups(fighting, [pickupAt(900, 'Damage', x + 20, y)])),
      ...ticks(5),
      model(({ pickups, boosts }) => {
        expect(pickups).toHaveLength(1)
        expect(boosts).toEqual(idleBoosts)
      }),
    )
  })

  test('the first pickup ever shows a hint until it is grabbed', () => {
    const { x, y } = fighting.player
    story(
      update,
      given(withPickups(fighting, [pickupAt(900, 'Damage', x + 14, y)])),
      tick,
      model(current => {
        expect(Array.map(shownHints(current), ({ id }) => id)).toContain(
          'Pickup',
        )
      }),
      press('KeyD'),
      ...ticks(3),
      release('KeyD'),
      model(current => {
        expect(Array.map(shownHints(current), ({ id }) => id)).not.toContain(
          'Pickup',
        )
      }),
    )
  })
})

// EFFECTS

describe('effects', () => {
  test('Hot Sauce tops off the magazine, fires faster, spends no rounds, and never reloads', () => {
    const loaded = modifyFields(fighting, {
      player: player => modifyFields(player, { pistolLoaded: () => 2 }),
    })
    story(
      update,
      given(withBoost(loaded, 'RapidFire', 5000)),
      press('Space'),
      ...ticksFor(2000),
      model(({ stats, player }) => {
        const plainShots = 2000 / FIRE_INTERVAL_MS
        expect(stats.shotsFired).toBeGreaterThan(plainShots * 1.6)
        expect(player.pistolLoaded).toBe(PISTOL_MAGAZINE)
        expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
      }),
    )
  })

  test('grabbing Hot Sauce mid-reload fills the magazine at once', () => {
    const reloading = modifyFields(fighting, {
      player: player =>
        modifyFields(player, {
          pistolLoaded: () => 0,
          reload: () => Reload.Reloading({ remainingMs: 700, durationMs: 800 }),
        }),
    })
    story(
      update,
      given(underPlayer(reloading, 'RapidFire')),
      tick,
      model(({ player }) => {
        expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
        expect(player.pistolLoaded).toBeGreaterThan(0)
      }),
    )
  })

  test('Mean Beans doubles the damage and adds knockback to every shot', () => {
    story(
      update,
      given(withBoost(fighting, 'Damage', 5000)),
      press('Space'),
      tick,
      model(({ bullets }) => {
        const bullet = Option.getOrThrow(Array.head(bullets))
        expect(bullet.damage).toBe(PISTOL_DAMAGE * 2)
        expect(bullet.knockback).toBe(ZOMBIE_KNOCKBACK_SPEED * 1.5)
        expect(bullet.glaze).toBe('Mean')
      }),
    )
  })

  test('Zoomy Socks make the player run faster', () => {
    const startX = fighting.player.x
    story(
      update,
      given(withBoost(fighting, 'Speed', 5000)),
      press('KeyD'),
      ...ticksFor(1000),
      model(({ player }) => {
        expect(player.x - startX).toBeCloseTo(
          PLAYER_SPEED * BOOSTS.Speed.speedScale,
          5,
        )
      }),
    )
  })

  const skewerLine = (base: Model): Model =>
    modifyFields(base, {
      zombies: () =>
        Array.makeBy(5, index =>
          zombieAt(
            200 + index,
            'Shambler',
            base.player.x + 20 + index * 10,
            base.player.y,
            1,
          ),
        ),
    })

  test('Shish Kebullets send one shot through four zombies', () => {
    story(
      update,
      given(withBoost(skewerLine(fighting), 'Pierce', 5000)),
      press('Space'),
      tick,
      release('Space'),
      ...ticks(30),
      model(({ zombies, stats }) => {
        expect(stats.shotsFired).toBe(1)
        expect(stats.kills.Shambler).toBe(1 + BOOSTS.Pierce.pierce)
        expect(Array.filter(zombies, ({ hp }) => hp > 0)).toHaveLength(1)
      }),
    )
    story(
      update,
      given(skewerLine(fighting)),
      press('Space'),
      tick,
      release('Space'),
      ...ticks(30),
      model(({ zombies, stats }) => {
        expect(stats.shotsFired).toBe(1)
        expect(stats.kills.Shambler).toBe(1)
        expect(Array.filter(zombies, ({ hp }) => hp > 0)).toHaveLength(4)
      }),
    )
  })

  test('a Big Burp blasts every zombie in reach and pays for the kills', () => {
    const { x, y } = fighting.player
    const near = zombieAt(300, 'Shambler', x + 50, y, BURP_DAMAGE)
    const far = zombieAt(301, 'Shambler', x - BURP_RADIUS - 20, y, 3)
    story(
      update,
      given(
        modifyFields(underPlayer(fighting, 'Burp'), {
          zombies: () => [near, far],
        }),
      ),
      tick,
      model(({ zombies, wallet, frameEvents, boosts }) => {
        const byId = (id: number) =>
          Option.getOrThrow(
            Array.findFirst(zombies, zombie => zombie.id === id),
          )
        expect(byId(near.id).hp).toBe(0)
        expect(byId(far.id).hp).toBe(far.hp)
        expect(wallet.earned).toBe(ZOMBIE_KINDS.Shambler.bounty)
        expect(tagsOf(frameEvents)).toEqual(
          expect.arrayContaining(['PickupGrabbed', 'Burped', 'ZombieKilled']),
        )
        expect(boosts).toEqual(idleBoosts)
      }),
    )
  })

  test('a Pickled Heart heals one heart, never past the maximum', () => {
    const hurt = modifyFields(fighting, {
      player: player => modifyFields(player, { hp: () => 2 }),
    })
    story(
      update,
      given(underPlayer(hurt, 'Heart')),
      tick,
      model(({ player }) => {
        expect(player.hp).toBe(3)
      }),
    )
    story(
      update,
      given(underPlayer(fighting, 'Heart')),
      tick,
      model(({ player, pickups }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(pickups).toEqual([])
      }),
    )
  })
})

// TIMERS

describe('timers', () => {
  test('a boost counts down and runs out after its duration', () => {
    const durationMs = BOOSTS.Damage.durationMs
    story(
      update,
      given(underPlayer(fighting, 'Damage')),
      tick,
      model(({ boosts }) => {
        expect(remainingOf(boosts, 'Damage')).toBe(durationMs)
      }),
      ...ticksFor(durationMs - FRAME_MS),
      model(({ boosts }) => {
        expect(remainingOf(boosts, 'Damage')).toBe(FRAME_MS)
      }),
      tick,
      model(({ boosts, frameEvents }) => {
        expect(boosts.Damage).toEqual(BoostTimer.Off())
        expect(tagsOf(frameEvents)).toContain('BoostFaded')
      }),
      press('Space'),
      tick,
      model(({ bullets }) => {
        const bullet = Option.getOrThrow(Array.last(bullets))
        expect(bullet.damage).toBe(PISTOL_DAMAGE)
        expect(bullet.glaze).toBe('Plain')
      }),
    )
  })

  const timersOf = (current: Model) => ({
    remainingMs: remainingOf(current.boosts, 'RapidFire'),
    pickupAges: Array.map(current.pickups, ({ ageMs }) => ageMs),
    calloutAges: Array.map(current.callouts, ({ ageMs }) => ageMs),
  })

  const frozenRoom = (base: Model): Model =>
    modifyFields(
      withPickups(withBoost(base, 'RapidFire', 4000), [
        pickupAt(901, 'Damage', 40, 150, 2000),
      ]),
      {
        callouts: () => [{ kind: 'RapidFire', x: 100, y: 100, ageMs: 300 }],
      },
    )

  const staysFrozen = (base: Model) => {
    const before = timersOf(frozenRoom(base))
    story(
      update,
      given(frozenRoom(base)),
      ...ticks(10),
      model(current => {
        expect(timersOf(current)).toEqual(before)
      }),
    )
  }

  test('boosts, pickups, and callouts stand still while paused', () => {
    staysFrozen(
      modifyFields(fighting, {
        phase: () =>
          Phase.Paused({
            round: Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [HELD_SPAWN] }),
          }),
      }),
    )
  })

  test('boosts, pickups, and callouts stand still while the shop is open', () => {
    staysFrozen(
      modifyFields(preparing, {
        shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
      }),
    )
  })

  test('boosts, pickups, and callouts stand still during hit-stop', () => {
    staysFrozen(
      modifyFields(fighting, {
        hitStop: () => HitStop.Frozen({ remainingMs: 10 * FRAME_MS + 1 }),
      }),
    )
  })

  test('boosts, pickups, and callouts stand still under the new zombie card', () => {
    staysFrozen(
      modifyFields(fighting, {
        debutCard: () => DebutCard.Showing({ kind: 'Tank', ageMs: 0 }),
      }),
    )
  })

  test('boosts keep running through Preparation outside the shop', () => {
    story(
      update,
      given(withBoost(preparing, 'Speed', 4000)),
      ...ticks(10),
      model(({ boosts }) => {
        expect(remainingOf(boosts, 'Speed')).toBe(4000 - 10 * FRAME_MS)
      }),
    )
  })

  test('the same kind again adds its duration, up to one and a half times', () => {
    const durationMs = BOOSTS.RapidFire.durationMs
    const elapsedMs = 2000
    const secondGrab = (current: Model): Model =>
      underPlayer(current, 'RapidFire')
    story(
      update,
      given(
        secondGrab(withBoost(fighting, 'RapidFire', durationMs - elapsedMs)),
      ),
      tick,
      model(({ boosts }) => {
        expect(remainingOf(boosts, 'RapidFire')).toBe(
          durationMs * BOOST_STACK_MAX,
        )
      }),
    )
    story(
      update,
      given(secondGrab(withBoost(fighting, 'RapidFire', 1000))),
      tick,
      model(({ boosts }) => {
        expect(remainingOf(boosts, 'RapidFire')).toBe(
          1000 - FRAME_MS + durationMs,
        )
      }),
    )
  })

  test('different kinds run side by side on their own timers', () => {
    story(
      update,
      given(underPlayer(withBoost(fighting, 'Speed', 3000), 'Damage')),
      tick,
      model(({ boosts }) => {
        expect(remainingOf(boosts, 'Speed')).toBe(3000 - FRAME_MS)
        expect(remainingOf(boosts, 'Damage')).toBe(BOOSTS.Damage.durationMs)
      }),
    )
  })
})

// FLOOR

describe('the floor', () => {
  const isDimmed = (pickup: Pickup): boolean =>
    Array.some(
      pickupShapes(pickup),
      shape => shape._tag === 'Group' && shape.opacity !== undefined,
    )

  const isDimmedAt = (ageMs: number): boolean =>
    isDimmed(pickupAt(900, 'Pierce', 40, 150, ageMs))

  test('an ungrabbed pickup blinks for its last seconds, then fizzles', () => {
    const blinkStartMs = PICKUP_LIFETIME_MS - PICKUP_BLINK_MS
    const steadyAges = Array.makeBy(blinkStartMs / 10, step => step * 10)
    const blinkingAges = Array.makeBy(
      PICKUP_BLINK_MS / 10,
      step => blinkStartMs + step * 10,
    )
    expect(Array.some(steadyAges, isDimmedAt)).toBe(false)
    expect(Array.some(blinkingAges, isDimmedAt)).toBe(true)
    expect(Array.every(blinkingAges, isDimmedAt)).toBe(false)
    story(
      update,
      given(withPickups(fighting, [pickupAt(900, 'Pierce', 40, 150)])),
      ...ticksFor(PICKUP_LIFETIME_MS - FRAME_MS),
      model(({ pickups }) => {
        expect(Array.map(pickups, ({ ageMs }) => ageMs)).toEqual([
          PICKUP_LIFETIME_MS - FRAME_MS,
        ])
      }),
      tick,
      model(({ pickups, frameEvents }) => {
        expect(pickups).toEqual([])
        expect(tagsOf(frameEvents)).toContain('PickupFizzled')
      }),
    )
  })

  test('a new run clears the floor, the boosts, and the callouts', () => {
    const over = modifyFields(
      withBoost(
        withPickups(fighting, [pickupAt(900, 'Pierce', 40, 150)]),
        'Damage',
        3000,
      ),
      {
        phase: () => Phase.GameOver({ wave: 3 }),
        screenMs: () => 5000,
        callouts: () => [{ kind: 'Damage', x: 10, y: 10, ageMs: 0 }],
      },
    )
    story(
      update,
      given(over),
      press('Enter'),
      model(({ pickups, boosts, callouts, loot }) => {
        expect(pickups).toEqual([])
        expect(boosts).toEqual(idleBoosts)
        expect(callouts).toEqual([])
        expect(loot.dryMs).toBe(0)
      }),
    )
  })
})
