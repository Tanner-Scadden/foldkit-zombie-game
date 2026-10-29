import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ARENA_LEVEL, isSolidAt } from './arena'
import { PREPARATION_MS } from './constants'
import { CRAWLER_RULES, drawSurfacingSpot } from './crawler'
import { frenzyPacksOf } from './frenzy'
import { Message, update } from './main'
import {
  type Bullet,
  Frenzy,
  GameEvent,
  type Model,
  Phase,
  Pierce,
  type PlannedSpawn,
  type Zombie,
  ZombieAction,
  ZombieState,
  initialModel,
} from './model'
import { asVeteran } from './veteran'
import { doorCounts, floorCounts, rollSpawns } from './waves'

const FRAME_MS = 16
const CENTER_X = ARENA_LEVEL.width / 2
const CENTER_Y = ARENA_LEVEL.height / 2
const CRAWLER_ID = 20

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number) => Array.makeBy(count, () => tick(FRAME_MS))

const framesFor = (ms: number): number => Math.ceil(ms / FRAME_MS)

const spawnOf = (
  kind: PlannedSpawn['kind'],
  atMs: number,
  pack: number,
): PlannedSpawn => ({
  atMs,
  kind,
  door: 'East',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation: 'Trickle',
})

const DISTANT_SPAWN = spawnOf('Shambler', 1e9, 999)

const waveWith = (
  spawns: ReadonlyArray<PlannedSpawn>,
  zombies: ReadonlyArray<Zombie> = [],
): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Wave({ wave: 7, elapsedMs: 0, spawns: [...spawns, DISTANT_SPAWN] }),
    zombies: () => zombies,
  })

const crawlerAt = (x: number, y: number, action: ZombieAction): Zombie => ({
  id: CRAWLER_ID,
  kind: 'Crawler',
  x,
  y,
  speed: 0,
  hp: 2,
  maxHp: 2,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action,
  frenzy: Frenzy.Calm(),
})

const crawlerIn = (current: Model): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, zombie => zombie.kind === 'Crawler'),
  )

const hasEvent = (current: Model, tag: GameEvent['_tag']): boolean =>
  Array.some(current.frameEvents, event => event._tag === tag)

const distanceToPlayer = (current: Model, zombie: Zombie): number =>
  Math.hypot(zombie.x - current.player.x, zombie.y - current.player.y)

const bulletInto = (zombie: Zombie): Bullet => ({
  id: 700,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 5,
  knockback: 0,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
})

describe('the Ankle Biter', () => {
  test('comes up through the floor after a 1.5 s telegraph, out of reach until then', () => {
    expect(CRAWLER_RULES.surfaceMs).toBe(1500)
    story(
      update,
      given(waveWith([spawnOf('Crawler', 0, 1)])),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'CrawlerStirred')).toBe(true)
        expect(hasEvent(current, 'PackWarned')).toBe(false)
        const crawler = crawlerIn(current)
        expect(crawler.action).toEqual(
          ZombieAction.Burrowed({
            remainingMs: CRAWLER_RULES.surfaceMs,
            durationMs: CRAWLER_RULES.surfaceMs,
          }),
        )
        expect(distanceToPlayer(current, crawler)).toBeGreaterThanOrEqual(
          CRAWLER_RULES.clearPx,
        )
      }),
      ...ticks(framesFor(CRAWLER_RULES.surfaceMs) - 1),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Burrowed'])(crawlerIn(current).action),
        ).toBe(true)
      }),
      ...ticks(1),
      model(current => {
        expect(hasEvent(current, 'CrawlerSurfaced')).toBe(true)
        expect(crawlerIn(current).action).toEqual(ZombieAction.Roaming())
      }),
    )
  })

  test('a buried Ankle Biter cannot be shot', () => {
    const buried = crawlerAt(
      CENTER_X + 60,
      CENTER_Y,
      ZombieAction.Burrowed({ remainingMs: 1000, durationMs: 1500 }),
    )
    story(
      update,
      given(
        modifyFields(waveWith([], [buried]), {
          bullets: () => [bulletInto(buried)],
        }),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(crawlerIn(current).hp).toBe(2)
        expect(hasEvent(current, 'ZombieHit')).toBe(false)
      }),
    )
  })

  test('never comes up near the player, wherever the player stands', () => {
    const spots = Array.flatMap(
      Array.makeBy(40, index => index * 7919 + 3),
      seed =>
        Array.map(
          [
            { x: 40, y: 40 },
            { x: CENTER_X, y: CENTER_Y },
            { x: 280, y: 150 },
            { x: 300, y: 40 },
          ],
          player => ({
            player,
            spot: drawSurfacingSpot(seed, player, [])[1],
          }),
        ),
    )
    Array.forEach(spots, ({ player, spot }) => {
      expect(
        Math.hypot(spot.x - player.x, spot.y - player.y),
      ).toBeGreaterThanOrEqual(40)
      expect(isSolidAt(spot)).toBe(false)
    })
  })

  test('stays under the floor while the player stands on its cracks', () => {
    const ready = crawlerAt(
      CENTER_X + 10,
      CENTER_Y,
      ZombieAction.Burrowed({ remainingMs: 100, durationMs: 1500 }),
    )
    story(
      update,
      given(waveWith([], [ready])),
      ...ticks(40),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Burrowed'])(crawlerIn(current).action),
        ).toBe(true)
        expect(hasEvent(current, 'CrawlerSurfaced')).toBe(false)
      }),
      message(Message.PressedKey({ code: 'KeyA' })),
      ...ticks(50),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Roaming', 'Clinging', 'Winded'])(
            crawlerIn(current).action,
          ),
        ).toBe(true)
      }),
    )
  })

  test('grabs the player by the ankles, slowing them to half speed, then lets go', () => {
    const grabbing = crawlerAt(CENTER_X + 3, CENTER_Y, ZombieAction.Roaming())
    const walked = (start: Model, frames: number) => (current: Model) =>
      Math.abs(current.player.x - start.player.x) / frames

    const free = waveWith([], [])
    const held = waveWith([], [grabbing])
    const clingFrames = Math.floor(CRAWLER_RULES.clingMs / FRAME_MS) - 6
    const freeSpeeds: Array<number> = []
    const heldSpeeds: Array<number> = []

    story(
      update,
      given(free),
      tick(FRAME_MS),
      message(Message.PressedKey({ code: 'KeyD' })),
      ...ticks(clingFrames),
      model(current => {
        freeSpeeds.push(walked(free, clingFrames)(current))
      }),
    )

    story(
      update,
      given(held),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'AnklesGrabbed')).toBe(true)
        expect(
          ZombieAction.isAnyOf(['Clinging'])(crawlerIn(current).action),
        ).toBe(true)
        expect(current.player.hp).toBe(initialModel.player.hp)
      }),
      message(Message.PressedKey({ code: 'KeyD' })),
      ...ticks(clingFrames),
      model(current => {
        heldSpeeds.push(walked(held, clingFrames)(current))
        expect(distanceToPlayer(current, crawlerIn(current))).toBeLessThan(8)
      }),
      ...ticks(12),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Winded'])(crawlerIn(current).action),
        ).toBe(true)
      }),
    )

    const [freeSpeed] = freeSpeeds
    const [heldSpeed] = heldSpeeds
    expect(heldSpeed).toBeDefined()
    expect(freeSpeed).toBeDefined()
    expect(heldSpeed ?? 0).toBeCloseTo(
      (freeSpeed ?? 0) * CRAWLER_RULES.clingSlow,
      1,
    )
  })

  test('the preview counts Ankle Biters as FLOOR, never at a door', () => {
    Array.forEach([1, 2, 3, 99, 31337], seed => {
      const [, spawns] = rollSpawns(seed, 7)
      const crawlers = Array.filter(spawns, ({ kind }) => kind === 'Crawler')
      expect(floorCounts(spawns)).toEqual([
        { kind: 'Crawler', count: crawlers.length },
      ])
      Array.forEach(doorCounts(spawns, []), ({ kinds }) =>
        Array.forEach(kinds, ({ kind }) => expect(kind).not.toBe('Crawler')),
      )
    })
  })

  test('a wave with Ankle Biters, a Chucker, and frenzied packs replays the same from the same seed', () => {
    const play = (seed: number): Model => {
      const [rngState, spawns] = rollSpawns(seed, 7)
      const start = modifyFields(asVeteran(initialModel), {
        maybeSurface: () =>
          Option.some({ left: 0, top: 0, width: 800, height: 400 }),
        rngState: () => rngState,
        phase: () =>
          Phase.Preparation({
            wave: 7,
            remainingMs: PREPARATION_MS,
            durationMs: PREPARATION_MS,
            spawns,
          }),
        frenzyPacks: () => frenzyPacksOf(spawns),
        player: player =>
          modifyFields(player, {
            hp: () => 1e6,
          }),
      })
      const started = update(start, Message.ClickedStartWaveButton()).model
      const skipped = update(
        started,
        Message.PressedKey({ code: 'Enter' }),
      ).model
      const held = update(
        update(skipped, Message.ReleasedKey({ code: 'Enter' })).model,
        Message.PressedKey({ code: 'KeyD' }),
      ).model
      return Array.reduce(
        Array.makeBy(1800, index => index),
        held,
        (current, index) =>
          update(
            current,
            Message.TickedFrame({ deltaTime: index % 3 === 0 ? 33 : 17 }),
          ).model,
      )
    }

    const first = play(2024)
    const again = play(2024)
    expect(again.zombies).toEqual(first.zombies)
    expect(again.player).toEqual(first.player)
    expect(again.rngState).toBe(first.rngState)
    expect(again.phase).toEqual(first.phase)
    expect(again.frenzyPacks).toEqual(first.frenzyPacks)
    expect(
      Array.some(
        first.zombies,
        zombie => zombie.kind === 'Crawler' || zombie.kind === 'Thrower',
      ) || first.stats.kills.Crawler + first.stats.kills.Thrower > 0,
    ).toBe(true)
  })
})
