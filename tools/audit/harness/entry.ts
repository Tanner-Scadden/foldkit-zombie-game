import { Effect, Layer, Option, Queue, Schema, Stream } from 'effect'

// NOTE: next, so the build's prebuilt sprite atlas is in place before any
// game module builds a sprite, as in the game's own entry.
import '@game/spriteAtlasBoot'

import './harness.css'
import { Canvas, Dom, ManagedResource, Runtime, Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  SHIRT_COLORS,
  SKIN_TONES,
  playerSprites,
} from '@game/appearance'
import { PARLOUR, levelOf, openExitIn } from '@game/arena'
import { BOSS_RULES, hasBoss, planBoss } from '@game/boss'
import { LoadSave, managedResources } from '@game/commands'
import { DECAL_MAX, PLAYER_MAX_HP, SHADOW_COLOR } from '@game/constants'
import * as CoopModel from '@game/coop/model'
import type { CoopNet } from '@game/coop/net'
import {
  CODE as COOP_CODE,
  lobbyOf,
  memberOf,
  playingSession,
  quietCoopNet,
  stagedWorld,
} from '@game/coop/testing'
import { playRoomFrame } from '@game/coopPlay'
import { withBests } from '@game/difficulty'
import { KITCHEN_EXIT } from '@game/exits'
import { sceneShapes } from '@game/layers'
import { init, update } from '@game/main'
import { Message } from '@game/message'
import {
  DifficultyCard,
  Oven,
  Trap,
  Model,
  Phase,
  Arsenal,
  BreakClock,
  MouseButton,
  RunMode,
  initialModel,
  Lesson,
  TrapHint,
  type Appearance,
  type Decal,
  type DecalKind,
  type PickupKind,
} from '@game/model'
import { raiseDebutCard } from '@game/onboarding'
import { advanceParticles } from '@game/particles'
import { LinkFlow, PlayerScopeStatus, SyncState } from '@game/playerSync'
import { FLOOR_COLOR } from '@game/room'
import { startOrResume } from '@game/runFlow'
import { STALL_BOX } from '@game/shop'
import { shedParts } from '@game/simulation'
import { frameAt, group, gunSprite } from '@game/sprite'
import { type PlayerStore, layer as PlayerStoreLayer } from '@game/store'
import { subscriptions } from '@game/subscriptions'
import { tickCoopRoom } from '@game/update/coop'
import { openProfile } from '@game/update/profile'
import { view } from '@game/view'
import { pause, planFor, rollSpawns } from '@game/waves'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER, scaledHp } from '@game/zombies'
import { Session } from '@munch/netcode'

import { type HarnessConfig, decodeHarnessConfig } from './config'
import { settle } from './readiness'

const readConfig = () => {
  try {
    return decodeHarnessConfig(location.search)
  } catch (error) {
    const root = document.getElementById('root')
    if (root !== null) {
      root.textContent = `Bad harness query: ${String(error)}`
      root.className = 'harness-error'
    }
    throw error
  }
}
const PLAYER_X = 160
const PLAYER_Y = 90

// NOTE: the scene's settings. They are module state, not constants, because
// `window.__loadScene` swaps in another scene without reloading the page.
let config: HarnessConfig = readConfig()
let gasbagRoom = 0
let px = PLAYER_X
let py = PLAYER_Y
let god = false
let instrument = false
let freezeAfter = Infinity
const useConfig = (next: HarnessConfig) => {
  config = next
  gasbagRoom = next.gasroom
  px = next.px ?? PLAYER_X
  py = next.py ?? PLAYER_Y
  god = next.god
  instrument = next.instrument
  freezeAfter = next.tick !== undefined ? 0 : (next.freeze ?? Infinity)
}
useConfig(config)
const ROAMING = { _tag: 'Roaming' as const }
const CALM = { _tag: 'Calm' as const }

const KINDS: ReadonlyArray<DecalKind> = [
  'Blood',
  'Meat',
  'Rot',
  'Shell',
  'Bone',
  'Hide',
  'Goo',
  'Scorch',
  'Wood',
]

const makeDecals = (count: number): Array<Decal> => {
  const out: Array<Decal> = []
  let s = 12345
  const r = () => (s = (s * 1103515245 + 12345) >>> 0) / 0xffffffff
  for (let i = 0; i < count; i++) {
    out.push({
      kind: KINDS[i % KINDS.length]!,
      x: Math.round(24 + r() * 272),
      y: Math.round(24 + r() * 132),
      width: 2 + Math.round(r() * 5),
      height: 1 + Math.round(r() * 3),
    })
  }
  return out
}

const roomModel = (): Model => {
  const wave = config.wave
  if (wave === 0) return initialModel
  const mode =
    config.mode === 'endless' ? RunMode.Endless() : RunMode.Campaign()
  const begun = startOrResume(initialModel, mode)
  const started = config.kitchen
    ? modifyFields(begun, {
        level: level => openExitIn(level, KITCHEN_EXIT),
      })
    : begun
  const [rngState, spawns] = rollSpawns(
    started.rngState,
    wave,
    levelOf(started).doorIds,
  )
  const gun = config.gun
  const smgRounds = config.rounds ?? 360
  const shotgunRounds = config.rounds ?? 48
  let model: Model = modifyFields(started, {
    rngState: () => rngState,
    phase: () =>
      config.start === 'wave'
        ? Phase.Wave({ wave, elapsedMs: config.elapsed, spawns })
        : Phase.Preparation({
            wave,
            remainingMs: config.prep,
            durationMs: 20000,
            spawns,
            clock:
              config.break === 'open'
                ? BreakClock.Waiting({ elapsedMs: config.breakMs })
                : BreakClock.Counting(),
          }),
    wallet: w => ({
      ...w,
      balance: config.money,
      shown: config.money,
      earned: config.money,
    }),
    decals: () => (config.fill ? makeDecals(DECAL_MAX) : []),
    trapStock: () => ({
      Barricade: config.barricades,
      Turret: config.turrets,
    }),
    player: p =>
      gun === 'smg'
        ? {
            ...p,
            arsenal: Arsenal.HoldingSpare({
              spare: {
                kind: 'Smg',
                rounds: smgRounds,
                loaded: Math.min(config.loaded, smgRounds),
                tier: config.tier,
              },
            }),
          }
        : gun === 'shotgun'
          ? {
              ...p,
              arsenal: Arsenal.HoldingSpare({
                spare: {
                  kind: 'Shotgun',
                  rounds: shotgunRounds,
                  loaded: Math.min(6, shotgunRounds),
                  tier: config.tier,
                },
              }),
            }
          : p,
  })
  const crowd = config.crowd ?? gasbagRoom
  const toughness = config.tough ? 40 : 1
  if (crowd > 0) {
    const kinds = [
      'Shambler',
      'Runner',
      'Shambler',
      'Exploder',
      'Shambler',
      'Runner',
      'Shambler',
    ] as const
    const spots: ReadonlyArray<readonly [number, number]> = [
      [40, 40],
      [280, 40],
      [40, 140],
      [250, 120],
      [160, 30],
      [160, 150],
      [30, 90],
      [290, 90],
    ]
    const zombies = Array.from({ length: crowd }, (_, i) => {
      const kind =
        gasbagRoom > 0 ? 'Exploder' : i < 4 ? 'Tank' : kinds[i % kinds.length]!
      const [sx, sy] = spots[i % spots.length]!
      return {
        id: 1000 + i,
        kind,
        x: sx + ((i * 7) % 13) - 6,
        y: sy + ((i * 5) % 11) - 5,
        speed: kind === 'Runner' ? 46 : kind === 'Tank' ? 12 : 22,
        hp: (kind === 'Tank' ? 14 : kind === 'Runner' ? 1 : 2) * toughness,
        maxHp: (kind === 'Tank' ? 30 : kind === 'Runner' ? 2 : 3) * toughness,
        knockback: { x: 0, y: 0 },
        hitRemainingMs: 0,
        state: { _tag: 'Walking' },
        action: ROAMING,
        frenzy: CALM,
      }
    })
    model = modifyFields(model, {
      zombies: () => zombies as any,
      nextEntityId: () => 2000,
    })
  }
  const lineup = config.lineup
  const stageHp = (kind: LineupKind, maxHp: number, stage: number) =>
    stage === 0
      ? maxHp
      : Math.max(
          1,
          Math.floor(maxHp * ZOMBIE_KINDS[kind].wear[stage - 1]!.below),
        )
  type LineupKind =
    | 'Shambler'
    | 'Runner'
    | 'Tank'
    | 'Exploder'
    | 'Thrower'
    | 'Crawler'
    | 'Boss'
  const standing = (
    id: number,
    kind: LineupKind,
    x: number,
    y: number,
    maxHp: number,
    stage: number,
  ) => ({
    id,
    kind,
    x,
    y,
    speed: 0,
    hp: stageHp(kind, maxHp, stage),
    maxHp,
    knockback: { x: 0, y: 0 },
    hitRemainingMs: 0,
    state: { _tag: 'Walking' as const },
    action: ROAMING,
    frenzy: CALM,
  })
  if (lineup === 'wear') {
    const rows: Array<[LineupKind, number, number, number]> = [
      ['Shambler', 4, 50, 50],
      ['Runner', 2, 50, 72],
      ['Exploder', 7, 50, 96],
      ['Tank', 36, 180, 64],
      ['Thrower', 15, 180, 100],
      ['Crawler', 2, 50, 118],
    ]
    const zombies = rows.flatMap(([kind, maxHp, left, y], row) =>
      Array.from({ length: ZOMBIE_KINDS[kind].wear.length + 1 }, (_, stage) =>
        standing(
          1000 + row * 10 + stage,
          kind,
          left + stage * (kind === 'Tank' ? 30 : 28),
          y,
          maxHp,
          stage,
        ),
      ),
    )
    model = modifyFields(model, {
      zombies: () => zombies as any,
      nextEntityId: () => 2000,
    })
  }
  if (lineup === 'sizes') {
    const kinds: Array<[LineupKind, number]> = [
      ['Crawler', 2],
      ['Runner', 2],
      ['Shambler', 4],
      ['Exploder', 7],
      ['Thrower', 15],
      ['Tank', 36],
    ]
    const zombies = kinds.map(([kind, maxHp], index) =>
      standing(1000 + index, kind, 70 + index * 24, 100, maxHp, 0),
    )
    model = modifyFields(model, {
      zombies: () => zombies as any,
      nextEntityId: () => 2000,
    })
  }
  if (lineup === 'armor') {
    const stages = ZOMBIE_KINDS.Tank.wear.length + 1
    const at = (stage: number) => ({ x: 70 + stage * 50, y: 90 })
    const fresh = Array.from({ length: stages }, (_, stage) =>
      standing(1000 + stage, 'Tank', at(stage).x, at(stage).y, 36, 0),
    )
    const worn = Array.from({ length: stages }, (_, stage) =>
      standing(1000 + stage, 'Tank', at(stage).x, at(stage).y, 36, stage),
    )
    const before = modifyFields(model, { zombies: () => fresh as any })
    const after = modifyFields(model, { zombies: () => worn as any })
    model = modifyFields(
      advanceParticles(
        { ...after, ...shedParts(before, after) },
        1 / 60,
        1000 / 60,
      ),
      { nextEntityId: () => 2000 },
    )
  }
  if (lineup === 'boss') {
    const zombies = Array.from({ length: 5 }, (_, stage) =>
      standing(1100 + stage, 'Boss', 48 + stage * 56, 80, 99, stage),
    )
    model = modifyFields(model, {
      zombies: () => zombies as any,
      nextEntityId: () => 2000,
    })
  }
  const bossParam = config.boss
  if (bossParam !== undefined) {
    const bossMaxHp = scaledHp(ZOMBIE_KINDS.Boss.hp, planFor(8).hpScale)
    const bossHp = Math.round(bossMaxHp * config.bosshp)
    const { bx, by } = config
    const bossZombie = {
      ...standing(1500, 'Boss', bx, by, bossMaxHp, 0),
      hp: bossHp,
      speed: 10,
    }
    const door = config.door ?? 'East'
    const target = { x: config.tx, y: config.ty }
    const toTarget = Math.hypot(target.x - bx, target.y - by) || 1
    const direction = {
      x: (target.x - bx) / toTarget,
      y: (target.y - by) / toTarget,
    }
    const windMs = config.windMs
    const puddles = (config.puddles ?? []).map(([x, y]) => ({
      _tag: 'Pooled' as const,
      at: { x, y },
      remainingMs: config.puddleMs,
      durationMs: BOSS_RULES.puddleMs,
    }))
    const flying =
      bossParam === 'spit'
        ? [
            {
              _tag: 'Flying' as const,
              from: { x: bx, y: by },
              to: target,
              remainingMs: config.globMs,
              durationMs: BOSS_RULES.spitFlightMs,
            },
          ]
        : []
    const moves: Record<string, () => unknown> = {
      stomp: () => ({
        _tag: 'WindingUp',
        attack: 'Stomp',
        remainingMs: windMs,
        durationMs: 1000,
      }),
      belch: () => ({
        _tag: 'WindingUp',
        attack: 'Belch',
        remainingMs: windMs,
        durationMs: 1000,
      }),
      charge: () => ({
        _tag: 'Bracing',
        target,
        remainingMs: windMs,
        durationMs: BOSS_RULES.windUpMs.Charge,
      }),
      rush: () => ({
        _tag: 'Rushing',
        direction,
        remainingPx: toTarget + BOSS_RULES.chargeOvershootPx,
      }),
      dazed: () => ({
        _tag: 'Dazed',
        remainingMs: windMs,
        durationMs: BOSS_RULES.dazedMs,
      }),
    }
    const moveFor = () =>
      (
        moves[bossParam] ??
        (() => ({ _tag: 'Stalking', cooldownMs: config.cooldownMs }))
      )()
    const bossState =
      bossParam === 'arriving'
        ? {
            _tag: 'Arriving' as const,
            door,
            hp: bossMaxHp,
            remainingMs: config.arriveMs,
            durationMs: 2600,
          }
        : {
            _tag: 'Fighting' as const,
            id: 1500,
            standingMs: 4000,
            move: moveFor(),
            mood: config.enraged ? 'Enraged' : 'Calm',
            nextFar: 'Charge',
            belchMs: 60_000,
            globs: [...puddles, ...flying],
          }
    model = modifyFields(model, {
      boss: () => bossState as any,
      zombies: zombies =>
        bossParam === 'arriving' ? zombies : ([...zombies, bossZombie] as any),
      nextEntityId: () => 2000,
    })
  } else if (hasBoss(wave)) {
    const spawns =
      model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'
        ? model.phase.spawns
        : []
    const [bossRng, planned] = planBoss(
      levelOf(model).doorIds,
      model.rngState,
      wave,
      spawns,
    )
    model = modifyFields(model, {
      boss: () => planned,
      rngState: () => bossRng,
    })
  }
  const staged: Array<unknown> = []
  const stagedZombie = (
    id: number,
    kind: LineupKind,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) => ({
    ...standing(id, kind, x, y, ZOMBIE_KINDS[kind].hp, 0),
    speed: 20,
    ...extra,
  })
  if (config.gasbags) {
    staged.push(
      stagedZombie(1700, 'Exploder', 70, 60),
      stagedZombie(1701, 'Exploder', px + 22, py - 4, {
        hp: 1,
      }),
      stagedZombie(1702, 'Exploder', 240, 120, {
        hp: 0,
        state: { _tag: 'Fusing', remainingMs: config.fuseMs },
      }),
    )
  }
  if (config.frenzy) {
    const pack = 4242
    const kinds: Array<LineupKind> = [
      'Shambler',
      'Shambler',
      'Runner',
      'Shambler',
      'Exploder',
    ]
    kinds.forEach((kind, index) =>
      staged.push(
        stagedZombie(
          1720 + index,
          kind,
          50 + (index % 3) * 10,
          80 + Math.floor(index / 3) * 12 + (index % 2) * 3,
          {
            frenzy: { _tag: 'Frenzied', pack, apartMs: 0 },
          },
        ),
      ),
    )
    staged.push(
      stagedZombie(1730, 'Shambler', 120, 150, {
        frenzy: { _tag: 'Fading', pack, remainingMs: 500 },
      }),
    )
    model = modifyFields(model, {
      popups: () => [
        {
          kind: 'Horde' as const,
          value: 0,
          x: 40,
          y: 72,
          velocityX: 0,
          ageMs: config.hordeAge,
        },
        ...(config.wipe
          ? [
              {
                kind: 'Wipe' as const,
                value: 5,
                x: 200,
                y: 80,
                velocityX: 0,
                ageMs: 400,
              },
            ]
          : []),
      ],
    })
  }
  const chucker = config.chucker
  if (chucker === 'heft') {
    staged.push(
      stagedZombie(1740, 'Thrower', config.cx ?? 230, config.cy ?? 70, {
        action: {
          _tag: 'Hefting',
          victimId: 1741,
          remainingMs: config.heftMs,
          durationMs: 900,
        },
      }),
      stagedZombie(1741, 'Shambler', config.cx ?? 230, config.cy ?? 70, {
        action: { _tag: 'Carried', byId: 1740 },
      }),
    )
  }
  if (chucker === 'throw') {
    const from = { x: config.cx ?? 240, y: config.cy ?? 60 }
    const to = { x: px, y: py }
    const durationMs = 900
    const remainingMs = config.flyMs
    const progress = 1 - remainingMs / durationMs
    staged.push(
      stagedZombie(1750, 'Thrower', from.x, from.y, {
        action: { _tag: 'Winded', remainingMs: 2000 },
      }),
      stagedZombie(
        1751,
        'Shambler',
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        {
          action: { _tag: 'Flying', from, to, remainingMs, durationMs },
        },
      ),
    )
  }
  if (chucker === 'taunt') {
    staged.push(
      stagedZombie(1755, 'Thrower', config.cx ?? 230, config.cy ?? 70, {
        action: { _tag: 'Winded', remainingMs: 3100 },
      }),
    )
  }
  if (chucker === 'shield') {
    const at = { x: config.cx ?? 200, y: config.cy ?? 80 }
    const aim = Math.atan2(py - at.y, px - at.x)
    staged.push(
      stagedZombie(1790, 'Thrower', at.x, at.y, {
        action: {
          _tag: 'Shielding',
          victimId: 1791,
          remainingMs: config.shieldMs,
          aim,
        },
      }),
      stagedZombie(
        1791,
        'Shambler',
        at.x + Math.cos(aim) * 7,
        at.y + Math.sin(aim) * 7,
        {
          action: { _tag: 'Shielded', byId: 1790 },
        },
      ),
    )
  }
  if (chucker === 'dazed') {
    staged.push(
      stagedZombie(1760, 'Shambler', px + 14, py + 4, {
        action: { _tag: 'Dazed', remainingMs: 700, durationMs: 1000 },
      }),
    )
  }
  const crawler = config.crawler
  if (crawler === 'surfacing') {
    staged.push(
      stagedZombie(1770, 'Crawler', config.wx, config.wy, {
        action: {
          _tag: 'Burrowed',
          remainingMs: config.surfMs,
          durationMs: 1500,
        },
      }),
      stagedZombie(1771, 'Crawler', 230, 50, {
        action: { _tag: 'Burrowed', remainingMs: 1100, durationMs: 1500 },
      }),
    )
  }
  if (crawler === 'cling') {
    staged.push(
      stagedZombie(1780, 'Crawler', px, py + 2, {
        action: { _tag: 'Clinging', remainingMs: 800 },
      }),
      stagedZombie(1781, 'Crawler', px + 40, py + 20),
    )
  }
  if (staged.length > 0)
    model = modifyFields(model, {
      zombies: zombies => [...zombies, ...staged] as any,
      nextEntityId: () => 3000,
    })
  const sampleStats = {
    kills: {
      Shambler: 41,
      Runner: 17,
      Tank: 2,
      Exploder: 9,
      Thrower: 2,
      Crawler: 3,
      Boss: 0,
    },
    wavesCleared: Math.max(0, wave - 1),
    shotsFired: 1240,
    shotsHit: 532,
    heartsLost: 7,
    trapsPlaced: 3,
    runMs: 371_000,
  }
  if (config.stats)
    model = modifyFields(model, {
      stats: s => ({ ...s, ...sampleStats }),
      wallet: w => ({ ...w, earned: 615 }),
    })
  if (config.py !== undefined)
    model = modifyFields(model, {
      player: p => ({ ...p, x: config.px ?? p.x, y: py }),
      hintBand: () => (py < 70 ? 'Bottom' : 'Top'),
    })
  const { best, pistol, aim, card } = config
  if (best !== undefined)
    model = withBests(model, bests => ({
      ...bests,
      maybeBestEndlessWave: Option.some(best),
    }))
  if (pistol !== undefined)
    model = modifyFields(model, {
      player: p => ({ ...p, pistolTier: pistol }),
    })
  if (aim !== undefined) {
    const [aimX, aimY] = aim
    model = modifyFields(model, {
      input: input => ({
        ...input,
        mouseButton: MouseButton.Held({ pointerId: 1 }),
        maybeMouseInView: Option.some({ x: aimX, y: aimY }),
      }),
    })
  }
  if (config.device === 'touch')
    model = modifyFields(model, { lastDevice: () => 'Touch' as const })
  const seen = config.seen
  if (seen !== undefined)
    model = raiseDebutCard(
      modifyFields(model, {
        introducedKinds: () => (seen === 'all' ? ZOMBIE_KIND_ORDER : seen),
      }),
    )
  const debutCard = model.debutCard
  if (card !== undefined && debutCard._tag === 'Showing')
    model = modifyFields(model, {
      debutCard: () => ({ ...debutCard, ageMs: card }),
    })
  const PICKUP_KINDS: ReadonlyArray<PickupKind> = [
    'RapidFire',
    'Damage',
    'Speed',
    'Pierce',
    'Burp',
    'Heart',
  ]
  const kindsOf = (
    picked: 'all' | ReadonlyArray<PickupKind> | undefined,
  ): ReadonlyArray<PickupKind> =>
    picked === undefined ? [] : picked === 'all' ? PICKUP_KINDS : picked
  const pickupKinds = kindsOf(config.pickups)
  if (pickupKinds.length > 0) {
    const pickupY = config.pickupY
    model = modifyFields(model, {
      pickups: () =>
        pickupKinds.map((kind, index) => ({
          id: 3000 + index,
          kind,
          x: Math.round(160 + (index - (pickupKinds.length - 1) / 2) * 26),
          y: pickupY,
          ageMs: config.pickupAge + index * 170,
        })),
    })
  }
  const seenPowerUps = kindsOf(config.seenpowerups)
  if (seenPowerUps.length > 0)
    model = modifyFields(model, { seenPowerUps: () => seenPowerUps })
  const boostKinds = kindsOf(config.boosts).filter(
    kind => kind !== 'Burp' && kind !== 'Heart',
  )
  if (boostKinds.length > 0) {
    const boostMs = config.boostMs
    model = modifyFields(model, {
      boosts: boosts => {
        const next: Record<string, unknown> = { ...boosts }
        boostKinds.forEach((kind, index) => {
          next[kind] = {
            _tag: 'On',
            remainingMs: Math.max(1, boostMs - index * 2200),
            durationMs: 8000,
          }
        })
        return next as typeof boosts
      },
    })
  }
  const calloutKind = config.callout
  if (calloutKind !== undefined)
    model = modifyFields(model, {
      callouts: () => [
        {
          kind: calloutKind,
          look: config.calloutLook ?? 'Explained',
          x: model.player.x,
          y: model.player.y,
          ageMs: config.calloutAge,
        },
      ],
    })
  if (config.bounty)
    model = modifyFields(model, {
      popups: () => [
        {
          kind: 'Kill' as const,
          value: 3,
          x: 90,
          y: 80,
          velocityX: 0,
          ageMs: 50,
        },
        {
          kind: 'Kill' as const,
          value: 20,
          x: 150,
          y: 80,
          velocityX: 0,
          ageMs: 400,
        },
        {
          kind: 'Payday' as const,
          value: 35,
          x: 225,
          y: 80,
          velocityX: 0,
          ageMs: 600,
        },
      ],
    })
  const phase = config.phase
  if (phase === 'victory')
    model = modifyFields(model, {
      phase: () => Phase.Victory(),
      stats: s => ({
        ...s,
        wavesCleared: 8,
        kills: { ...s.kills, Shambler: s.kills.Shambler + 432 },
      }),
    })
  if (phase === 'paused') model = pause(model)
  if (phase === 'gameover')
    model = modifyFields(model, {
      phase: () => Phase.GameOver({ wave }),
      stats: s => ({
        ...s,
        kills: { ...s.kills, Shambler: s.kills.Shambler + 123 },
      }),
    })
  return model
}

// NOTE: co-op staged at one screen, with a fake network that never
// answers, so the screen holds still for a screenshot.
const coopRoom = (
  members: ReadonlyArray<ReturnType<typeof memberOf>>,
  status: 'Lobby' | 'Playing',
  extra: Partial<CoopModel.Room> = {},
): CoopModel.Room => {
  const world = stagedWorld(members.map(member => member.slot))
  return {
    code: COOP_CODE,
    slot: 0,
    maybePlayerId: Option.some('player-0'),
    maybeLobby: Option.some(lobbyOf(members, status)),
    link: 'Online',
    session: {
      ...(status === 'Playing'
        ? playingSession(world, 0)
        : Session.makeSession(0)),
      rttMs: COOP_PINGS[0] ?? 0,
      rtts: members.map(member => ({
        slot: member.slot,
        rttMs: COOP_PINGS[member.slot] ?? 0,
      })),
    },
    maybeWorld: status === 'Playing' ? Option.some(world) : Option.none(),
    frameEvents: [],
    eventsTick: 0,
    predictedShots: 0,
    tracers: [],
    tracerCount: 0,
    hits: { looked: 0, confirmed: 0 },
    presses: CoopModel.noPresses,
    share: 'Idle',
    departure: 'Staying',
    ...extra,
  }
}

const COOP_NAMES = ['Tanner', 'Mo', 'Pip', 'Grumbles']

// NOTE: the looks the staged teammates sent with their joins; the first
// seat is the page's own player, who wears the page's own look.
// NOTE: each staged player's round trip: good, fair, poor, good.
const COOP_PINGS = [48, 140, 260, 90]

const COOP_LOOKS = [
  '',
  'Male.Curls.Blonde.Deep.Red',
  'Female.Long.Black.Fair.Yellow',
  'Male.Crop.Pink.Medium.Purple',
]

const coopScreen = (stage: NonNullable<typeof config.coop>) => {
  const Screen = CoopModel.Screen
  const queue = (
    waiting: number,
    offer: number,
    answer: CoopModel.OfferAnswer,
  ) =>
    Screen.Queue({
      queue: {
        names: COOP_NAMES.slice(0, waiting),
        waiting,
        position: 1,
        groupSize: 4,
        offerPlayers: offer,
        accepted: answer === 'Accepted' ? 2 : 1,
        answer,
      },
    })
  const members = (count: number, readyCount = 0) =>
    COOP_NAMES.slice(0, count).map((name, slot) => ({
      ...memberOf(slot, name, slot < readyCount, COOP_LOOKS[slot] ?? ''),
      pingMs: COOP_PINGS[slot] ?? 0,
    }))
  switch (stage) {
    case 'tile':
      return Screen.Closed()
    case 'hub':
      return Screen.Hub({ maybeProblem: Option.none() })
    case 'problem':
      return Screen.Hub({ maybeProblem: Option.some('Full') })
    case 'code':
      return Screen.Code({ typed: 'MN', maybeProblem: Option.none() })
    case 'asking':
      return Screen.Asking({ request: { _tag: 'Create' } })
    case 'queue':
      return queue(2, 0, 'Unanswered')
    case 'offer':
      return queue(3, 3, 'Unanswered')
    case 'accepted':
      return queue(3, 3, 'Accepted')
    case 'lobby':
      return Screen.InRoom({ room: coopRoom(members(2), 'Lobby') })
    case 'host':
      return Screen.InRoom({ room: coopRoom(members(4, 1), 'Lobby') })
    case 'picks': {
      const room = coopRoom(members(2, 1), 'Lobby')
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            mode: 'Endless' as const,
            difficulty: 'Hard' as const,
          })),
        },
      })
    }
    case 'keep': {
      const room = coopRoom(
        members(2).map(member =>
          member.slot === 0 ? { ...member, canNightmare: true } : member,
        ),
        'Lobby',
        {
          slot: 1,
          maybePlayerId: Option.some('player-1'),
        },
      )
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            mode: 'KeepGoing' as const,
            canKeepGoing: true,
            difficulty: 'Nightmare' as const,
          })),
        },
      })
    }
    case 'ready':
      return Screen.InRoom({
        room: coopRoom(
          members(3, 3).map((member, slot) =>
            slot === 2 ? { ...member, ready: false } : member,
          ),
          'Lobby',
        ),
      })
    case 'result': {
      const room = coopRoom(members(3), 'Lobby')
      return Screen.InRoom({
        room: {
          ...room,
          maybeLobby: Option.map(room.maybeLobby, lobby => ({
            ...lobby,
            result: Option.some({
              round: 1,
              reason: 'GameOver' as const,
              ticks: 10800,
              scores: members(3).map((member, slot) => ({
                playerId: member.playerId,
                slot,
                score: [7, 12, 3][slot] ?? 0,
              })),
            }),
          })),
        },
      })
    }
    case 'arena':
      return Screen.InRoom({ room: coopRoom(members(3), 'Playing') })
    case 'away':
      return Screen.InRoom({
        room: coopRoom(members(3), 'Playing', { link: 'Reconnecting' }),
      })
    case 'ended': {
      const room = coopRoom(members(3), 'Playing')
      return Screen.InRoom({
        room: {
          ...room,
          session: {
            ...room.session,
            phase: { _tag: 'Ended', reason: 'GameOver' },
          },
        },
      })
    }
  }
}

// NOTE: a staged run draws its room's World as the game, one frame of it,
// as an online run does (src/coopPlay.ts).
const withCoop = (model: Model): Model => {
  const stage = config.coop
  if (stage === undefined) return model
  const staged = modifyFields(model, {
    lessons: lessons => ({
      ...lessons,
      openBreak: Lesson.Learned({ atMs: 0 }),
    }),
    coop: coop => ({ ...coop, screen: coopScreen(stage) }),
  })
  return playRoomFrame(0, tickCoopRoom(0))(staged).model
}

const scenarioModel = (): Model => withCoop(scenarioModelOf())

const scenarioModelOf = (): Model => {
  let model = roomModel()
  const runs = config.runs
  if (runs !== undefined)
    model = modifyFields(model, {
      bests: bests => ({ ...bests, runsPlayed: runs }),
    })
  const learned = config.learned
  if (learned !== undefined)
    model = modifyFields(model, {
      lessons: lessons => ({
        ...lessons,
        ...Object.fromEntries(
          learned.map(name => [name, Lesson.Learned({ atMs: 0 })]),
        ),
      }),
    })
  const traphint = config.traphint
  if (traphint !== undefined)
    model = modifyFields(model, {
      trapHint: () => TrapHint.Showing(),
      selectedTrap: () => traphint,
    })
  const newer = config.newer
  if (newer !== undefined)
    model = modifyFields(model, {
      maybeNewerBuild: () => Option.some(newer || 'next'),
    })
  if (config.support)
    model = modifyFields(model, {
      maybeSupportUrl: () => Option.some('https://buy.stripe.com/test_harness'),
    })
  if (config.bests)
    model = modifyFields(
      withBests(model, () => ({
        maybeBestEndlessWave: Option.some(12),
        maybeFastestWinMs: Option.some(402_000),
      })),
      { bests: bests => ({ ...bests, totalKills: 341 }) },
    )
  const kills = config.kills
  if (kills !== undefined) {
    const counts = Object.fromEntries(kills)
    model = modifyFields(model, {
      bests: bests => {
        const killsByKind = { ...bests.killsByKind, ...counts }
        return {
          ...bests,
          killsByKind,
          totalKills: Object.values(killsByKind).reduce(
            (sum, count) => sum + count,
            0,
          ),
        }
      },
    })
  }
  model = modifyFields(model, {
    home: home => ({
      ...home,
      mode: config.homemode === 'endless' ? 'Endless' : home.mode,
      maybeSeenNewsDay: config.newsseen
        ? Option.some('October 29, 2026')
        : home.maybeSeenNewsDay,
      openedEntries: config.opened ?? home.openedEntries,
      newEntries: config.newentries ?? home.newEntries,
    }),
  })
  model = modifyFields(model, {
    difficultyCard: () =>
      config.ask ? DifficultyCard.Unseen() : DifficultyCard.Seen(),
    difficulty: setting => ({
      chosen: config.difficulty ?? setting.chosen,
      nightmare: config.nightmare ?? setting.nightmare,
    }),
  })
  const ovenState = config.ovens
  if (ovenState !== undefined)
    model = modifyFields(model, {
      ovens: ovens =>
        ovens.map(() =>
          ovenState === 'belch'
            ? Oven.Belching({ remainingMs: config.ovenMs, burnedTicks: 4 })
            : Oven.Cooling({ remainingMs: config.ovenMs }),
        ),
    })
  if (config.slip)
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...[
          { x: 152, y: -62 },
          { x: 47, y: -92 },
          { x: 65, y: -32 },
        ].map((at, index) => ({
          id: 9300 + index,
          kind: 'Shambler' as const,
          x: at.x,
          y: at.y,
          speed: 20,
          hp: 3,
          maxHp: 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: { _tag: 'Dazed' as const, remainingMs: 800, durationMs: 900 },
          frenzy: CALM,
        })),
      ],
    })
  const planks = config.planks
  if (planks !== undefined)
    model = modifyFields(model, {
      traps: traps => [
        ...traps,
        ...planks.map((door, index) =>
          Trap.Barricade({
            id: 9000 + index,
            door,
            hp: config.plankhp,
            hitRemainingMs: 0,
          }),
        ),
      ],
    })
  const chewers = config.chewers
  if (chewers > 0) {
    const spots = [
      { x: 16, y: 84 },
      { x: 16, y: 96 },
      { x: 30, y: 88 },
      { x: 34, y: 100 },
      { x: 44, y: 80 },
    ]
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...spots.slice(0, chewers).map((at, index) => ({
          id: 9100 + index,
          kind: index === 4 ? ('Tank' as const) : ('Shambler' as const),
          x: at.x,
          y: at.y,
          speed: 18,
          hp: index === 4 ? 30 : 3,
          maxHp: index === 4 ? 30 : 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: ROAMING,
          frenzy: CALM,
        })),
      ],
    })
  }
  // NOTE: zombies mid-entry at every door, hurt so their bars show: two in
  // the north doorway behind the lintel, one just inside the north wall, and
  // one in each other doorway, and one in the kitchen's doorway when it is
  // open.
  if (config.doorway) {
    const spots: ReadonlyArray<
      readonly ['Shambler' | 'Runner' | 'Tank', number, number]
    > = [
      ['Tank', 216, 6],
      ['Runner', 226, -2],
      ['Shambler', 200, 22],
      ['Tank', 240, 26],
      ['Shambler', 90, 172],
      ['Shambler', 5, 88],
      ['Runner', 315, 92],
      ...(config.openexits?.includes('Kitchen') === true
        ? ([['Shambler', 70, 8]] as const)
        : []),
    ]
    model = modifyFields(model, {
      zombies: zombies => [
        ...zombies,
        ...spots.map(([kind, x, y], index) => ({
          id: 9200 + index,
          kind,
          x,
          y,
          speed: 0,
          hp: kind === 'Tank' ? 10 : 1,
          maxHp: kind === 'Tank' ? 30 : 3,
          knockback: { x: 0, y: 0 },
          hitRemainingMs: 0,
          state: { _tag: 'Walking' as const },
          action: ROAMING,
          frenzy: CALM,
        })),
      ],
    })
  }
  const openexits = config.openexits
  if (openexits !== undefined) {
    model = modifyFields(model, {
      level: level => ({ ...level, openExits: openexits }),
    })
  }
  const name = config.name
  if (name !== undefined)
    model = modifyFields(model, { playerName: () => name })
  const sync = config.sync
  if (sync !== undefined) {
    const devices = config.devices
    model = modifyFields(model, {
      syncState: () =>
        sync === 'local'
          ? SyncState.LocalOnly()
          : sync === 'connecting'
            ? SyncState.Connecting()
            : sync === 'offline'
              ? SyncState.Offline({ devices })
              : SyncState.Synced({ devices }),
      playerScopeStatus: () =>
        sync === 'broken'
          ? PlayerScopeStatus.Failed({ reason: 'harness' })
          : PlayerScopeStatus.Ready({ seq: 1, fresh: sync === 'synced' }),
    })
  }
  const link = config.link
  if (link !== undefined)
    model = modifyFields(model, {
      linkFlow: () =>
        link === 'requesting'
          ? LinkFlow.Requesting()
          : link === 'showing'
            ? LinkFlow.Showing({ code: 'KZ7QWM' })
            : link === 'entering'
              ? LinkFlow.Entering({ code: 'KZ7' })
              : link === 'redeeming'
                ? LinkFlow.Redeeming({ code: 'KZ7QWM' })
                : link === 'linked'
                  ? LinkFlow.Linked()
                  : LinkFlow.Failed({ problem: 'WrongCode' }),
    })
  const look = config.look
  if (look !== undefined) {
    const [body, hairStyle, hairColor, skinTone, shirtColor] = look
    model = modifyFields(model, {
      appearance: a => ({
        body: body || a.body,
        hairStyle: hairStyle || a.hairStyle,
        hairColor: hairColor || a.hairColor,
        skinTone: skinTone || a.skinTone,
        shirtColor: shirtColor || a.shirtColor,
      }),
    })
  }
  return model
}

// NOTE: `gasroom=N` keeps N Kaboomers in the room: when shots and chain bursts
// pop them, new ones walk in at the doors, so a measurement window stays full
// of fusing, bursting, and spawning Kaboomers.
const GASBAG_DOORS: ReadonlyArray<readonly [number, number]> = [
  [160, 8],
  [312, 90],
  [160, 172],
  [8, 90],
]
const topUpGasbags = (model: Model): Model => {
  const alive = model.zombies.filter(
    z => z.kind === 'Exploder' && z.state._tag === 'Walking',
  ).length
  const missing = Math.max(0, Math.min(4, gasbagRoom - alive))
  if (missing === 0 || model.phase._tag !== 'Wave') return model
  const fresh = Array.from({ length: missing }, (_, i) => {
    const [x, y] = GASBAG_DOORS[(model.nextEntityId + i) % GASBAG_DOORS.length]!
    return {
      id: model.nextEntityId + i,
      kind: 'Exploder' as const,
      x,
      y,
      speed: 22,
      hp: 3,
      maxHp: 3,
      knockback: { x: 0, y: 0 },
      hitRemainingMs: 0,
      state: { _tag: 'Walking' as const },
      action: ROAMING,
      frenzy: CALM,
    }
  })
  return modifyFields(model, {
    zombies: zombies => [...zombies, ...(fresh as any)],
    nextEntityId: id => id + missing,
  })
}
const w = window as any
w.__shapeCounts = []

const countShapes = (shapes: ReadonlyArray<any>): number =>
  shapes.reduce(
    (n, s) => n + 1 + (s._tag === 'Group' ? countShapes(s.shapes) : 0),
    0,
  )
w.__countShapes = () => countShapes(sceneShapes(w.__model))

w.__timings = { update: [] as Array<number>, view: [] as Array<number> }
const FIXED_FRAME_MS = 1000 / 60
let framesRun = 0
const QUIET_MESSAGES = new Set([
  'TickedFrame',
  'MovedPointer',
  'MovedMouse',
  'CompletedPlaySound',
  'CompletedCueMusic',
  'FailedCueMusic',
  'FailedPlaySound',
])
w.__messages = [] as Array<string>

// NOTE: the one Message the harness adds to the game's. `window.__loadScene`
// raises it, through the `harnessScenes` Subscription below, to swap in the
// scene a query string describes without reloading the page.
const HarnessMessage = defineMessageUnion({
  LoadedScene: { query: Schema.String },
})
type HarnessMessage = typeof HarnessMessage.Type
type AnyMessage = Message | HarnessMessage

type HarnessReturn = Readonly<{
  model: Model
  commands?: ReadonlyArray<any>
}>

// NOTE: what the harness adds after every update: full health with `god`,
// and fresh Kaboomers at the doors with `gasroom`.
const keepScene = (result: HarnessReturn, message: Message): HarnessReturn => {
  const kept = god
    ? {
        ...result,
        model: modifyFields(result.model, {
          player: p => ({ ...p, hp: PLAYER_MAX_HP }),
        }),
      }
    : result
  return gasbagRoom > 0 && message._tag === 'TickedFrame'
    ? { ...kept, model: topUpGasbags(kept.model) }
    : kept
}

// NOTE: `tick=N` plays N frames of a fixed 1/60 second at once, before the
// first render, and holds the picture there. The game is deterministic, so
// this is the picture `freeze=N` waits N real frames for, with no waiting.
// The Commands those frames give, such as opening the shop's dialog, run
// once the scene is in, as they would have frame by frame.
const advance = (scene: HarnessReturn, frames: number): HarnessReturn => {
  let current = scene.model
  const commands = [...(scene.commands ?? [])]
  for (let frame = 0; frame < frames; frame++) {
    const message = Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })
    const next = keepScene(update(current, message), message)
    current = next.model
    commands.push(...(next.commands ?? []))
  }
  return { model: current, commands }
}

const gameUpdate = (model: Model, incoming: Message): HarnessReturn => {
  if (!QUIET_MESSAGES.has(incoming._tag)) {
    const chain = (message: any): Array<string> =>
      message?._tag === undefined
        ? []
        : [message._tag, ...chain(message.message)]
    w.__messages.push(chain(incoming).join(':'))
  }
  const isFrozenFrame =
    incoming._tag === 'TickedFrame' && framesRun >= freezeAfter
  const isFreezing = Number.isFinite(freezeAfter)
  if (isFrozenFrame) return { model }
  if (isFreezing && incoming._tag === 'CompletedGenerateSeed') return { model }
  // NOTE: a frozen run starts counting frames once the surface is measured,
  // so how long the first render takes cannot change which frame the
  // measurement lands on, and two builds freeze on the same picture.
  if (
    isFreezing &&
    incoming._tag === 'TickedFrame' &&
    Option.isNone(model.maybeSurface)
  )
    return { model }
  if (config.fit !== undefined && incoming._tag === 'CompletedDetectScreenFit')
    return {
      model: modifyFields(model, {
        screenFit: () => (config.fit === 'home' ? 'HomeScreen' : 'Fullscreen'),
      }),
    }
  if (
    config.sync !== undefined &&
    (incoming._tag === 'UpdatedSyncStatus' ||
      incoming._tag === 'UpdatedPlayerScopeStatus')
  )
    return { model }
  if (config.rotate && incoming._tag === 'CompletedDetectOrientationLock')
    return {
      model: modifyFields(model, { orientationLock: () => 'Supported' }),
    }
  const message =
    incoming._tag === 'TickedFrame' && isFreezing
      ? Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })
      : incoming
  if (message._tag === 'TickedFrame') framesRun++
  w.__isFrozen = framesRun >= freezeAfter
  const t0 = performance.now()
  const result = update(model, message)
  if (instrument && message._tag === 'TickedFrame')
    w.__timings.update.push(performance.now() - t0)
  const next = keepScene(result, message)
  w.__model = next.model
  return next
}

// NOTE: the scene's Model from the current config: seeded when it is frozen
// or given a seed, with the Profile opened by `picker` or `profile`, and played
// `tick` frames ahead.
const sceneOf = (model: Model): HarnessReturn => {
  const seeded =
    config.seed !== undefined || Number.isFinite(freezeAfter)
      ? modifyFields(model, { rngState: () => config.seed ?? 1 })
      : model
  const profileTab = config.profile
  const opened: HarnessReturn =
    config.picker || profileTab !== undefined
      ? openProfile(
          profileTab === 'name'
            ? 'Name'
            : profileTab === 'account'
              ? 'Account'
              : profileTab === 'settings'
                ? 'Settings'
                : 'Look',
        )(modifyFields(seeded, { screenMs: () => 99999 }))
      : { model: seeded }
  return config.tick === undefined ? opened : advance(opened, config.tick)
}

// THE READY SIGNAL

// NOTE: `window.__harnessReady` (and `data-harness-ready` on the root
// element, with the scene's number) is set once the scene has rendered with
// every image decoded, once the boot has read the save (a save read later
// could change the scene), and, with `freeze`, once the frozen frame is
// reached.
// Scripts wait for it instead of sleeping. Loading another scene clears it.
let sceneNumber = 0
const clearReady = () => {
  w.__harnessReady = false
  delete document.documentElement.dataset.harnessReady
}
const markReadyWhenSettled = (number: number) => {
  clearReady()
  void settle(
    () =>
      w.__model?.saveStatus !== 'Unread' &&
      (!Number.isFinite(freezeAfter) || framesRun >= freezeAfter),
  ).then(() => {
    if (number === sceneNumber) {
      w.__harnessReady = true
      document.documentElement.dataset.harnessReady = String(number)
    }
  })
}

// SCENE SWITCHING

const decodeScene = (query: string): HarnessConfig | undefined => {
  try {
    return decodeHarnessConfig(query)
  } catch (error) {
    w.__sceneError = String(error)
    return undefined
  }
}

// NOTE: a fresh page's boot, minus what a page does once. The Model comes
// from the query as in init. The surface's measurement carries over, since
// the page and its size are the same. The save counts as read and empty, as
// in a fresh browser context, whatever earlier scenes wrote to storage, so
// init's Commands run again without LoadSave: the seed and the device,
// screen fit, and orientation lock checks. The load steps they finish are
// already done.
const loadScene = (model: Model, query: string): HarnessReturn => {
  const next = decodeScene(query)
  if (next === undefined) {
    return { model }
  }
  w.__sceneError = undefined
  useConfig(next)
  framesRun = 0
  w.__messages.length = 0
  w.__timings = { update: [], view: [] }
  sceneNumber++
  const scene = sceneOf(
    modifyFields(scenarioModel(), {
      maybeSurface: () => model.maybeSurface,
      orientation: () => model.orientation,
      saveStatus: () => 'Read' as const,
    }),
  )
  w.__isFrozen = framesRun >= freezeAfter
  w.__model = scene.model
  markReadyWhenSettled(sceneNumber)
  return {
    model: scene.model,
    commands: [
      ...(init().commands ?? []).filter(
        command => command.name !== LoadSave.name,
      ),
      ...(scene.commands ?? []),
    ],
  }
}

const harnessUpdate = (model: Model, incoming: AnyMessage): HarnessReturn =>
  incoming._tag === 'LoadedScene'
    ? loadScene(model, incoming.query)
    : gameUpdate(model, incoming)

// NOTE: the stream behind `window.__loadScene`. While the app runs, a scene
// request goes into this queue as a LoadedScene Message.
let maybeRequestScene: ((query: string) => void) | undefined
const sceneRequests = Stream.callback<AnyMessage>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      maybeRequestScene = query =>
        Queue.offerUnsafe(queue, HarnessMessage.LoadedScene({ query }))
    }),
    () =>
      Effect.sync(() => {
        maybeRequestScene = undefined
      }),
  ).pipe(Effect.flatMap(() => Effect.never)),
)

// NOTE: an open dialog holds page state outside the Model: the inert,
// hidden background, the focus trap, and the scroll lock. A dialog closed by
// swapping the Model never runs its CloseDialog Command, so this releases
// what every dialog holds, as that Command does, before the next scene.
const releaseDialogs = Effect.suspend(() =>
  Effect.forEach(
    Array.from(document.querySelectorAll('dialog[id]')),
    dialog =>
      Dom.releaseDialogResources(dialog.id).pipe(
        Effect.flatMap(isReleased =>
          isReleased ? Dom.unlockScroll : Effect.void,
        ),
      ),
    { discard: true },
  ),
)

// NOTE: `window.__loadScene('wave=3&start=wave')` swaps the scene in place.
// It resets what a new page would: open dialogs, focus, full screen, and
// scroll. Wait for
// the ready signal afterwards. `nodev` belongs to the page, not the scene.
w.__loadScene = async (query: string) => {
  if (maybeRequestScene === undefined) {
    throw new Error('the harness is not running yet')
  }
  clearReady()
  await Effect.runPromise(releaseDialogs)
  if (document.fullscreenElement !== null) {
    await document.exitFullscreen().catch(() => undefined)
  }
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  window.scrollTo(0, 0)
  maybeRequestScene(query.replace(/^\?/, ''))
}

const harnessSubscriptions = Subscription.make<Model, AnyMessage>()(() => ({
  harnessScenes: Subscription.persistentEntry(sceneRequests),
}))

// NOTE: init needs only the player store, but opening the picker runs update,
// whose Commands also need the managed audio engine.
const harnessInit: Runtime.ApplicationInit<
  Model,
  AnyMessage,
  void,
  PlayerStore | CoopNet,
  ManagedResource.ServicesOf<typeof managedResources>
> = () => {
  const base = init()
  const scene = sceneOf(scenarioModel())
  w.__isFrozen = framesRun >= freezeAfter
  w.__model = scene.model
  markReadyWhenSettled(sceneNumber)
  return {
    ...base,
    model: scene.model,
    commands: [...(base.commands ?? []), ...(scene.commands ?? [])],
  }
}

const CELL_W = 12
const CELL_H = 16
const lookSheetShapes = (): Array<Canvas.Shape> => {
  const shapes: Array<Canvas.Shape> = [
    Canvas.Rect({ x: 0, y: 0, width: 400, height: 220, fill: FLOOR_COLOR }),
  ]
  const draw = (
    appearance: Appearance,
    x: number,
    y: number,
    frames: 'walk' | 'idle',
    frame: number,
    facing: 'Left' | 'Right',
    tone: 'Normal' | 'Flash',
  ) => {
    const sprites = playerSprites(appearance)
    shapes.push(
      Canvas.Rect({
        x: x - 3,
        y: y - 1,
        width: 7,
        height: 2,
        fill: SHADOW_COLOR,
      }),
      group({
        translate: { x, y },
        shapes: frameAt(sprites[frames], frame)[tone][facing],
      }),
      group({
        translate: { x: x + (facing === 'Right' ? 2 : -2), y: y - 5 },
        shapes: gunSprite('Pistol', 0, facing === 'Right' ? 0 : Math.PI),
      }),
    )
  }
  BODIES.forEach((body, b) =>
    HAIR_STYLES.forEach((hairStyle, st) => {
      const row = b * HAIR_STYLES.length + st
      SKIN_TONES.forEach((skinTone, sk) =>
        HAIR_COLORS.forEach((hairColor, hc) => {
          const col = sk * HAIR_COLORS.length + hc
          draw(
            {
              body,
              hairStyle,
              hairColor,
              skinTone,
              shirtColor: SHIRT_COLORS[col % SHIRT_COLORS.length]!,
            },
            col * CELL_W + 8,
            row * CELL_H + 15,
            'idle',
            0,
            'Right',
            'Normal',
          )
        }),
      )
    }),
  )
  const samples: Array<Appearance> = [
    {
      body: 'Male',
      hairStyle: 'Crop',
      hairColor: 'Brown',
      skinTone: 'Light',
      shirtColor: 'Blue',
    },
    {
      body: 'Female',
      hairStyle: 'Long',
      hairColor: 'Black',
      skinTone: 'Deep',
      shirtColor: 'Yellow',
    },
    {
      body: 'Female',
      hairStyle: 'Ponytail',
      hairColor: 'Ginger',
      skinTone: 'Fair',
      shirtColor: 'Teal',
    },
    {
      body: 'Male',
      hairStyle: 'Curls',
      hairColor: 'Black',
      skinTone: 'Brown',
      shirtColor: 'Red',
    },
  ]
  samples.forEach((appearance, i) => {
    const y = 8 * CELL_H + 18 + i * CELL_H
    ;[0, 1, 2, 3].forEach(f =>
      draw(appearance, 8 + f * CELL_W, y, 'walk', f, 'Right', 'Normal'),
    )
    ;[0, 1].forEach(f =>
      draw(appearance, 8 + (4 + f) * CELL_W, y, 'idle', f, 'Right', 'Normal'),
    )
    draw(appearance, 8 + 6 * CELL_W, y, 'walk', 0, 'Left', 'Normal')
    draw(appearance, 8 + 7 * CELL_W, y, 'idle', 0, 'Left', 'Normal')
    draw(appearance, 8 + 8 * CELL_W, y, 'idle', 0, 'Right', 'Flash')
  })
  return shapes
}

const lookSheetView = (h: any) => ({
  title: 'Looks',
  body: h.div(
    [h.Style({ background: '#000', padding: '8px' })],
    [
      Canvas.view(
        {
          width: 400,
          height: 220,
          shapes: lookSheetShapes(),
          className: 'look-sheet',
        },
        h,
      ),
    ],
  ),
})

const application = Runtime.makeApplication({
  Model,
  init: harnessInit,
  update: harnessUpdate,
  view: (model: Model, h: any) => {
    if (config.looksheet) return lookSheetView(h)
    const t0 = performance.now()
    const out = view(model, h)
    if (instrument) w.__timings.view.push(performance.now() - t0)
    return out
  },
  subscriptions: Subscription.aggregate(subscriptions, harnessSubscriptions),
  managedResources,
  resources: Layer.merge(PlayerStoreLayer, quietCoopNet),
  container: document.getElementById('root'),
  ...(config.nodev ? { devTools: false as const } : {}),
})

Runtime.run(application)
w.__stall = STALL_BOX
w.__doors = PARLOUR.doors

// NOTE: for scripts after a click or a key: resolves once the page has
// rendered and every image it asked for has decoded.
w.__whenSettled = () => settle(() => true)
