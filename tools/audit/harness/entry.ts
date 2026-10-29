import './harness.css'
import { Option } from 'effect'
import { Canvas, Runtime } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  SHIRT_COLORS,
  SKIN_TONES,
  playerSprites,
} from '@game/appearance'
import { BOSS_RULES, hasBoss, planBoss } from '@game/boss'
import { SHADOW_COLOR } from '@game/constants'
import { DECAL_MAX, PLAYER_MAX_HP } from '@game/constants'
import { withBests } from '@game/difficulty'
import { sceneShapes } from '@game/layers'
import {
  Message,
  init,
  managedResources,
  subscriptions,
  update,
} from '@game/main'
import {
  DifficultyCard,
  Trap,
  type Difficulty,
  type DoorId,
  type NightmareLock,
  Model,
  Phase,
  Arsenal,
  BreakClock,
  MouseButton,
  RunMode,
  initialModel,
  type Appearance,
  type Decal,
  type DecalKind,
} from '@game/model'
import { raiseDebutCard } from '@game/onboarding'
import { FLOOR_COLOR } from '@game/room'
import { frameAt, group, gunSprite } from '@game/sprite'
import { view } from '@game/view'
import { pause, planFor, rollSpawns, startOrResume } from '@game/waves'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER, scaledHp } from '@game/zombies'

const params = new URLSearchParams(location.search)
const ROAMING = { _tag: 'Roaming' as const }
const CALM = { _tag: 'Calm' as const }
const num = (key: string, fallback: number) =>
  params.has(key) ? Number(params.get(key)) : fallback
const gasbagRoom = num('gasroom', 0)

const KINDS: Array<DecalKind> = [
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
      kind: KINDS[i % KINDS.length],
      x: Math.round(24 + r() * 272),
      y: Math.round(24 + r() * 132),
      width: 2 + Math.round(r() * 5),
      height: 1 + Math.round(r() * 3),
    })
  }
  return out
}

const roomModel = (): Model => {
  const wave = num('wave', 0)
  if (wave === 0) return initialModel
  const mode =
    params.get('mode') === 'endless' ? RunMode.Endless() : RunMode.Campaign()
  const started = startOrResume(initialModel, mode)
  const [rngState, spawns] = rollSpawns(started.rngState, wave)
  const gun = params.get('gun')
  let model = modifyFields(started, {
    rngState: () => rngState,
    phase: () =>
      params.get('start') === 'wave'
        ? Phase.Wave({ wave, elapsedMs: num('elapsed', 0), spawns })
        : Phase.Preparation({
            wave,
            remainingMs: num('prep', 20000),
            durationMs: 20000,
            spawns,
            clock:
              params.get('break') === 'open'
                ? BreakClock.Waiting({ elapsedMs: num('breakMs', 0) })
                : BreakClock.Counting(),
          }),
    wallet: w => ({
      ...w,
      balance: num('money', 0),
      shown: num('money', 0),
      earned: num('money', 0),
    }),
    decals: () => (params.has('fill') ? makeDecals(DECAL_MAX) : []),
    trapStock: () => ({
      Barricade: num('barricades', 0),
      Turret: num('turrets', 0),
    }),
    player: p =>
      gun === 'smg'
        ? {
            ...p,
            arsenal: Arsenal.HoldingSpare({
              spare: {
                kind: 'Smg',
                rounds: num('rounds', 360),
                loaded: Math.min(num('loaded', 30), num('rounds', 360)),
                tier: num('tier', 0),
              },
            }),
          }
        : gun === 'shotgun'
          ? {
              ...p,
              arsenal: Arsenal.HoldingSpare({
                spare: {
                  kind: 'Shotgun',
                  rounds: num('rounds', 48),
                  loaded: Math.min(6, num('rounds', 48)),
                  tier: num('tier', 0),
                },
              }),
            }
          : p,
  })
  const crowd = num('crowd', gasbagRoom)
  const toughness = params.has('tough') ? 40 : 1
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
    const spots = [
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
        gasbagRoom > 0 ? 'Exploder' : i < 4 ? 'Tank' : kinds[i % kinds.length]
      const [sx, sy] = spots[i % spots.length]
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
  const lineup = params.get('lineup')
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
  if (lineup === 'boss') {
    const zombies = Array.from({ length: 5 }, (_, stage) =>
      standing(1100 + stage, 'Boss', 48 + stage * 56, 80, 99, stage),
    )
    model = modifyFields(model, {
      zombies: () => zombies as any,
      nextEntityId: () => 2000,
    })
  }
  const bossParam = params.get('boss')
  if (bossParam !== null) {
    const bossMaxHp = scaledHp(ZOMBIE_KINDS.Boss.hp, planFor(8).hpScale)
    const bossHp = Math.round(bossMaxHp * num('bosshp', 1))
    const bx = num('bx', 200)
    const by = num('by', 80)
    const bossZombie = {
      ...standing(1500, 'Boss', bx, by, bossMaxHp, 0),
      hp: bossHp,
      speed: 10,
    }
    const door = (params.get('door') ?? 'East') as
      | 'North'
      | 'West'
      | 'East'
      | 'South'
    const target = { x: num('tx', 120), y: num('ty', 120) }
    const toTarget = Math.hypot(target.x - bx, target.y - by) || 1
    const direction = {
      x: (target.x - bx) / toTarget,
      y: (target.y - by) / toTarget,
    }
    const windMs = num('windMs', 1000)
    const puddles = (params.get('puddles') ?? '')
      .split(';')
      .filter(spot => spot.length > 0)
      .map(spot => {
        const [x, y] = spot.split(',').map(Number)
        return {
          _tag: 'Pooled' as const,
          at: { x: x!, y: y! },
          remainingMs: num('puddleMs', 3000),
          durationMs: BOSS_RULES.puddleMs,
        }
      })
    const flying =
      bossParam === 'spit'
        ? [
            {
              _tag: 'Flying' as const,
              from: { x: bx, y: by },
              to: target,
              remainingMs: num('globMs', 450),
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
        (() => ({ _tag: 'Stalking', cooldownMs: num('cooldownMs', 60_000) }))
      )()
    const bossState =
      bossParam === 'arriving'
        ? {
            _tag: 'Arriving' as const,
            door,
            hp: bossMaxHp,
            remainingMs: num('arriveMs', 2600),
            durationMs: 2600,
          }
        : {
            _tag: 'Fighting' as const,
            id: 1500,
            standingMs: 4000,
            move: moveFor(),
            mood: params.has('enraged') ? 'Enraged' : 'Calm',
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
    const [bossRng, planned] = planBoss(model.rngState, wave, spawns)
    model = modifyFields(model, {
      boss: () => planned,
      rngState: () => bossRng,
    })
  }
  const staged: Array<any> = []
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
  const gasbags = params.get('gasbags')
  if (gasbags !== null) {
    staged.push(
      stagedZombie(1700, 'Exploder', 70, 60),
      stagedZombie(1701, 'Exploder', num('px', 160) + 22, num('py', 90) - 4, {
        hp: 1,
      }),
      stagedZombie(1702, 'Exploder', 240, 120, {
        hp: 0,
        state: { _tag: 'Fusing', remainingMs: num('fuseMs', 150) },
      }),
    )
  }
  if (params.has('frenzy')) {
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
          kind: 'Horde',
          value: 0,
          x: 40,
          y: 72,
          velocityX: 0,
          ageMs: num('hordeAge', 300),
        },
        ...(params.has('wipe')
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
  const chucker = params.get('chucker')
  if (chucker === 'heft') {
    staged.push(
      stagedZombie(1740, 'Thrower', num('cx', 230), num('cy', 70), {
        action: {
          _tag: 'Hefting',
          victimId: 1741,
          remainingMs: num('heftMs', 450),
          durationMs: 900,
        },
      }),
      stagedZombie(1741, 'Shambler', num('cx', 230), num('cy', 70), {
        action: { _tag: 'Carried', byId: 1740 },
      }),
    )
  }
  if (chucker === 'throw') {
    const from = { x: num('cx', 240), y: num('cy', 60) }
    const to = { x: num('px', 160), y: num('py', 90) }
    const durationMs = 900
    const remainingMs = num('flyMs', 400)
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
      stagedZombie(1755, 'Thrower', num('cx', 230), num('cy', 70), {
        action: { _tag: 'Winded', remainingMs: 3100 },
      }),
    )
  }
  if (chucker === 'shield') {
    const at = { x: num('cx', 200), y: num('cy', 80) }
    const aim = Math.atan2(num('py', 90) - at.y, num('px', 160) - at.x)
    staged.push(
      stagedZombie(1790, 'Thrower', at.x, at.y, {
        action: {
          _tag: 'Shielding',
          victimId: 1791,
          remainingMs: num('shieldMs', 3000),
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
      stagedZombie(1760, 'Shambler', num('px', 160) + 14, num('py', 90) + 4, {
        action: { _tag: 'Dazed', remainingMs: 700, durationMs: 1000 },
      }),
    )
  }
  const crawler = params.get('crawler')
  if (crawler === 'surfacing') {
    staged.push(
      stagedZombie(1770, 'Crawler', num('wx', 100), num('wy', 125), {
        action: {
          _tag: 'Burrowed',
          remainingMs: num('surfMs', 400),
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
      stagedZombie(1780, 'Crawler', num('px', 160), num('py', 90) + 2, {
        action: { _tag: 'Clinging', remainingMs: 800 },
      }),
      stagedZombie(1781, 'Crawler', num('px', 160) + 40, num('py', 90) + 20),
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
  if (params.has('stats'))
    model = modifyFields(model, {
      stats: () => sampleStats,
      wallet: w => ({ ...w, earned: 615 }),
    })
  if (params.has('py'))
    model = modifyFields(model, {
      player: p => ({ ...p, x: num('px', p.x), y: num('py', p.y) }),
      hintBand: () => (num('py', 90) < 70 ? 'Bottom' : 'Top'),
    })
  if (params.has('best'))
    model = withBests(model, bests => ({
      ...bests,
      maybeBestEndlessWave: Option.some(num('best', 0)),
    }))
  if (params.has('pistol'))
    model = modifyFields(model, {
      player: p => ({ ...p, pistolTier: num('pistol', 0) }),
    })
  if (params.has('aim')) {
    const [aimX, aimY] = (params.get('aim') ?? '160,90').split(',').map(Number)
    model = modifyFields(model, {
      input: input => ({
        ...input,
        mouseButton: MouseButton.Held({ pointerId: 1 }),
        maybeMouseInView: Option.some({ x: aimX, y: aimY }),
      }),
    })
  }
  if (params.get('device') === 'touch')
    model = modifyFields(model, { lastDevice: () => 'Touch' as const })
  const seen = params.get('seen')
  if (seen !== null)
    model = raiseDebutCard(
      modifyFields(model, {
        introducedKinds: () =>
          seen === 'all'
            ? ZOMBIE_KIND_ORDER
            : (seen.split(',') as Array<(typeof ZOMBIE_KIND_ORDER)[number]>),
      }),
    )
  if (params.has('card') && model.debutCard._tag === 'Showing')
    model = modifyFields(model, {
      debutCard: () => ({ ...model.debutCard, ageMs: num('card', 0) }),
    })
  const PICKUP_KINDS = [
    'RapidFire',
    'Damage',
    'Speed',
    'Pierce',
    'Burp',
    'Heart',
  ] as const
  type PickupKindName = (typeof PICKUP_KINDS)[number]
  const kindsParam = (key: string): Array<PickupKindName> => {
    const raw = params.get(key)
    if (raw === null) return []
    return raw === 'all'
      ? [...PICKUP_KINDS]
      : (raw.split(',') as Array<PickupKindName>)
  }
  const pickupKinds = kindsParam('pickups')
  if (pickupKinds.length > 0) {
    const pickupY = num('pickupY', 128)
    model = modifyFields(model, {
      pickups: () =>
        pickupKinds.map((kind, index) => ({
          id: 3000 + index,
          kind,
          x: Math.round(160 + (index - (pickupKinds.length - 1) / 2) * 26),
          y: pickupY,
          ageMs: num('pickupAge', 2000) + index * 170,
        })),
    })
  }
  const boostKinds = kindsParam('boosts').filter(
    kind => kind !== 'Burp' && kind !== 'Heart',
  )
  if (boostKinds.length > 0) {
    const boostMs = num('boostMs', 5000)
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
  const calloutKind = params.get('callout')
  if (calloutKind !== null)
    model = modifyFields(model, {
      callouts: () => [
        {
          kind: calloutKind as PickupKindName,
          x: model.player.x,
          y: model.player.y,
          ageMs: num('calloutAge', 400),
        },
      ],
    })
  if (params.has('bounty'))
    model = modifyFields(model, {
      popups: () => [
        { kind: 'Kill', value: 3, x: 90, y: 80, velocityX: 0, ageMs: 50 },
        { kind: 'Kill', value: 20, x: 150, y: 80, velocityX: 0, ageMs: 400 },
        { kind: 'Payday', value: 35, x: 225, y: 80, velocityX: 0, ageMs: 600 },
      ],
    })
  const phase = params.get('phase')
  if (phase === 'victory')
    model = modifyFields(model, {
      phase: () => Phase.Victory(),
      stats: s => ({ ...s, wavesCleared: 8 }),
      score: () => 4321,
    })
  if (phase === 'paused') model = pause(model)
  if (phase === 'gameover')
    model = modifyFields(model, {
      phase: () => Phase.GameOver({ wave }),
      score: () => 1234,
    })
  return model
}

const scenarioModel = (): Model => {
  let model = roomModel()
  if (params.has('newer'))
    model = modifyFields(model, {
      maybeNewerBuild: () => Option.some(params.get('newer') || 'next'),
    })
  if (params.has('bests'))
    model = modifyFields(
      withBests(model, () => ({
        maybeBestEndlessWave: Option.some(12),
        maybeFastestWinMs: Option.some(402_000),
      })),
      { bests: bests => ({ ...bests, totalKills: 341 }) },
    )
  model = modifyFields(model, {
    difficultyCard: () =>
      params.has('ask') ? DifficultyCard.Unseen() : DifficultyCard.Seen(),
    difficulty: setting => ({
      chosen: (params.get('difficulty') ?? setting.chosen) as Difficulty,
      nightmare: (params.get('nightmare') ??
        setting.nightmare) as NightmareLock,
    }),
  })
  const planks = params.get('planks')
  if (planks !== null)
    model = modifyFields(model, {
      traps: traps => [
        ...traps,
        ...planks.split(',').map((door, index) =>
          Trap.Barricade({
            id: 9000 + index,
            door: door as DoorId,
            hp: num('plankhp', 30),
            hitRemainingMs: 0,
          }),
        ),
      ],
    })
  const chewers = num('chewers', 0)
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
  const look = params.get('look')
  if (look !== null) {
    const [body, hairStyle, hairColor, skinTone, shirtColor] = look.split(',')
    model = modifyFields(model, {
      appearance: a => ({
        body: (body || a.body) as typeof a.body,
        hairStyle: (hairStyle || a.hairStyle) as typeof a.hairStyle,
        hairColor: (hairColor || a.hairColor) as typeof a.hairColor,
        skinTone: (skinTone || a.skinTone) as typeof a.skinTone,
        shirtColor: (shirtColor || a.shirtColor) as typeof a.shirtColor,
      }),
    })
  }
  return model
}

const god = params.has('god')

// NOTE: `gasroom=N` keeps N Kaboomers in the room: when shots and chain bursts
// pop them, new ones walk in at the doors, so a measurement window stays full
// of fusing, bursting, and spawning Kaboomers.
const GASBAG_DOORS = [
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
    const [x, y] = GASBAG_DOORS[(model.nextEntityId + i) % GASBAG_DOORS.length]
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
const instrument = params.has('instrument')
const freezeAfter = params.has('freeze') ? num('freeze', 0) : Infinity
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
const harnessUpdate = (model: Model, incoming: Message) => {
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
  if (params.has('fit') && incoming._tag === 'CompletedDetectScreenFit')
    return {
      model: modifyFields(model, {
        screenFit: () =>
          params.get('fit') === 'home' ? 'HomeScreen' : 'Fullscreen',
      }),
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
  const kept = god
    ? {
        ...result,
        model: modifyFields(result.model, {
          player: p => ({ ...p, hp: PLAYER_MAX_HP }),
        }),
      }
    : result
  const next =
    gasbagRoom > 0 && message._tag === 'TickedFrame'
      ? { ...kept, model: topUpGasbags(kept.model) }
      : kept
  w.__model = next.model
  return next
}

const harnessInit: typeof init = (...args) => {
  const base = init(...args)
  const model = scenarioModel()
  w.__model = model
  const seeded =
    params.has('seed') || Number.isFinite(freezeAfter)
      ? modifyFields(model, { rngState: () => num('seed', 1) })
      : model
  if (params.has('picker')) {
    const opened = update(
      modifyFields(seeded, { screenMs: () => 99999 }),
      Message.ClickedCharacterButton(),
    )
    w.__model = opened.model
    return {
      ...base,
      model: opened.model,
      commands: [...(base.commands ?? []), ...(opened.commands ?? [])],
    }
  }
  return { ...base, model: seeded }
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
              shirtColor: SHIRT_COLORS[col % SHIRT_COLORS.length],
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
    if (params.has('looksheet')) return lookSheetView(h)
    const t0 = performance.now()
    const out = view(model, h)
    if (instrument) w.__timings.view.push(performance.now() - t0)
    return out
  },
  subscriptions,
  managedResources,
  container: document.getElementById('root'),
})

Runtime.run(application)
void Option
import { DOORS } from '@game/arena'
import { STALL_BOX } from '@game/shop'
w.__stall = STALL_BOX
w.__doors = DOORS
