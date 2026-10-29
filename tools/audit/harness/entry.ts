import './harness.css'
import { Option } from 'effect'
import { Runtime } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { hasBoss, planBoss } from '@game/boss'
import { DECAL_MAX, PLAYER_MAX_HP } from '@game/constants'
import { sceneShapes } from '@game/layers'
import {
  Message,
  init,
  managedResources,
  subscriptions,
  update,
} from '@game/main'
import {
  Model,
  Phase,
  Arsenal,
  MouseButton,
  RunMode,
  initialModel,
  type Decal,
  type DecalKind,
} from '@game/model'
import { raiseDebutCard } from '@game/onboarding'
import { view } from '@game/view'
import { pause, rollSpawns, startOrResume } from '@game/waves'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from '@game/zombies'

const params = new URLSearchParams(location.search)
const num = (key: string, fallback: number) =>
  params.has(key) ? Number(params.get(key)) : fallback

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

const scenarioModel = (): Model => {
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
                loaded: Math.min(30, num('rounds', 360)),
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
  const crowd = num('crowd', 0)
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
      const kind = i < 4 ? 'Tank' : kinds[i % kinds.length]
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
  type LineupKind = 'Shambler' | 'Runner' | 'Tank' | 'Exploder' | 'Boss'
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
  })
  if (lineup === 'wear') {
    const rows: Array<[LineupKind, number, number, number]> = [
      ['Shambler', 4, 60, 62],
      ['Runner', 2, 60, 84],
      ['Exploder', 4, 60, 102],
      ['Tank', 36, 190, 84],
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
      standing(1100 + stage, 'Boss', 48 + stage * 56, 80, 97, stage),
    )
    model = modifyFields(model, {
      zombies: () => zombies as any,
      nextEntityId: () => 2000,
    })
  }
  const bossParam = params.get('boss')
  if (bossParam !== null) {
    const bossHp = Math.round(97 * num('bosshp', 1))
    const bossZombie = {
      ...standing(1500, 'Boss', num('bx', 200), num('by', 80), 97, 0),
      hp: bossHp,
      speed: 10,
    }
    const door = (params.get('door') ?? 'East') as
      | 'North'
      | 'West'
      | 'East'
      | 'South'
    const windUp = (attack: 'Stomp' | 'Belch') => ({
      _tag: 'Fighting' as const,
      id: 1500,
      standingMs: 4000,
      move: {
        _tag: 'WindingUp' as const,
        attack,
        remainingMs: num('windMs', 1000),
        durationMs: 1000,
      },
    })
    const bossState =
      bossParam === 'arriving'
        ? {
            _tag: 'Arriving' as const,
            door,
            hp: 97,
            remainingMs: num('arriveMs', 2600),
            durationMs: 2600,
          }
        : bossParam === 'stomp'
          ? windUp('Stomp')
          : bossParam === 'belch'
            ? windUp('Belch')
            : {
                _tag: 'Fighting' as const,
                id: 1500,
                standingMs: 4000,
                move: {
                  _tag: 'Stalking' as const,
                  cooldownMs: num('cooldownMs', 60_000),
                },
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
  const sampleStats = {
    kills: { Shambler: 41, Runner: 17, Tank: 2, Exploder: 9, Boss: 0 },
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
    model = modifyFields(model, {
      maybeBestEndlessWave: () => Option.some(num('best', 0)),
    })
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

const god = params.has('god')
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
const harnessUpdate = (model: Model, incoming: Message) => {
  const isFrozenFrame =
    incoming._tag === 'TickedFrame' && framesRun >= freezeAfter
  const isFreezing = Number.isFinite(freezeAfter)
  if (isFrozenFrame) return { model }
  if (isFreezing && incoming._tag === 'CompletedGenerateSeed') return { model }
  const message =
    incoming._tag === 'TickedFrame' && isFreezing
      ? Message.TickedFrame({ deltaTime: FIXED_FRAME_MS })
      : incoming
  if (message._tag === 'TickedFrame') framesRun++
  const t0 = performance.now()
  const result = update(model, message)
  if (instrument && message._tag === 'TickedFrame')
    w.__timings.update.push(performance.now() - t0)
  const next = god
    ? {
        ...result,
        model: modifyFields(result.model, {
          player: p => ({ ...p, hp: PLAYER_MAX_HP }),
        }),
      }
    : result
  w.__model = next.model
  return next
}

const harnessInit: typeof init = (...args) => {
  const base = init(...args)
  const model = scenarioModel()
  w.__model = model
  return {
    ...base,
    model:
      params.has('seed') || Number.isFinite(freezeAfter)
        ? modifyFields(model, { rngState: () => num('seed', 1) })
        : model,
  }
}

const application = Runtime.makeApplication({
  Model,
  init: harnessInit,
  update: harnessUpdate,
  view: (model: Model, h: any) => {
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
