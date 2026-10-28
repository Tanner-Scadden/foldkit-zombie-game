import './harness.css'
import { Option } from 'effect'
import { Runtime } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { DECAL_MAX, PLAYER_MAX_HP } from '@game/constants'
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
  initialModel,
  type Decal,
  type DecalKind,
} from '@game/model'
import { view, sceneShapes } from '@game/view'
import { rollSpawns, startOrResume } from '@game/waves'

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
  const started = startOrResume(initialModel)
  const [rngState, spawns] = rollSpawns(started.rngState, wave)
  const gun = params.get('gun')
  let model = modifyFields(started, {
    rngState: () => rngState,
    phase: () =>
      params.get('start') === 'wave'
        ? Phase.Wave({ wave, elapsedMs: 0, spawns })
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
              spare: { kind: 'Smg', rounds: 360 },
            }),
          }
        : gun === 'shotgun'
          ? {
              ...p,
              arsenal: Arsenal.HoldingSpare({
                spare: { kind: 'Shotgun', rounds: 48 },
              }),
            }
          : p,
  })
  const crowd = num('crowd', 0)
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
        hp: kind === 'Tank' ? 14 : kind === 'Runner' ? 1 : 2,
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
  const sampleStats = {
    kills: { Shambler: 41, Runner: 17, Tank: 2, Exploder: 9 },
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
  if (params.get('device') === 'touch')
    model = modifyFields(model, { lastDevice: () => 'Touch' as const })
  const phase = params.get('phase')
  if (phase === 'victory')
    model = modifyFields(model, {
      phase: () => Phase.Victory(),
      stats: s => ({ ...s, wavesCleared: 8 }),
      score: () => 4321,
    })
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
const harnessUpdate = (model: Model, message: Message) => {
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
    model: params.has('seed')
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
