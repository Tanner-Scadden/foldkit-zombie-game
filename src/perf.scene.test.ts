import { Array, Option, pipe } from 'effect'
import type { Canvas } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { Mount, Subscription, given, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { DOOR_IDS } from './arena'
import {
  BLAST_MAX,
  BULLET_MAX,
  DECAL_MAX,
  PARTICLE_MAX,
  POPUP_MAX,
  ZOMBIE_ALIVE_MAX,
} from './constants'
import { Message, update } from './main'
import {
  Arsenal,
  type Blast,
  type Bullet,
  type Decal,
  DecalKind,
  type Model,
  type Particle,
  ParticleKind,
  Phase,
  type Popup,
  PopupKind,
  RunMode,
  Streak,
  Trap,
  TurretGun,
  type Zombie,
  ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { MeasureGameSurface, sceneShapes, view } from './view'
import { rollSpawns, startOrResume } from './waves'
import { ZOMBIE_KINDS } from './zombies'

// WORST-CASE ROOMS

const SURFACE = { left: 0, top: 0, width: 1280, height: 720 }

const cycle = <A>(items: Array.NonEmptyReadonlyArray<A>, index: number): A =>
  pipe(
    Array.get(items, index % items.length),
    Option.getOrElse(() => Array.headNonEmpty(items)),
  )

const zombieStateAt = (index: number): ZombieState => {
  if (index % 7 === 0) {
    return ZombieState.Dying({ remainingMs: 300, direction: { x: 1, y: 0 } })
  } else if (index % 5 === 0) {
    return ZombieState.Fusing({ remainingMs: 400 })
  } else {
    return ZombieState.Walking()
  }
}

const zombieAt =
  (wave: number) =>
  (index: number): Zombie => {
    const kind = cycle(ZombieKind.literals, index)
    return {
      id: 1000 + index,
      kind,
      x: 30 + ((index * 37) % 260),
      y: 30 + ((index * 23) % 120),
      speed: 20,
      hp: ZOMBIE_KINDS[kind].hp + wave,
      maxHp: ZOMBIE_KINDS[kind].hp * 2 + wave,
      knockback: { x: 0, y: 0 },
      hitRemainingMs: index % 3 === 0 ? 60 : 0,
      state: zombieStateAt(index),
    }
  }

const particleAt = (index: number): Particle => ({
  kind: cycle(ParticleKind.literals, index),
  x: 20 + ((index * 13) % 280),
  y: 20 + ((index * 7) % 140),
  z: index % 4 === 0 ? 0 : 6,
  velocityX: 10,
  velocityY: -5,
  velocityZ: 20,
  size: 1 + (index % 3),
  remainingMs: 400,
})

const decalAt = (index: number): Decal => ({
  kind: cycle(DecalKind.literals, index),
  x: 24 + ((index * 31) % 272),
  y: 24 + ((index * 17) % 132),
  width: 2 + (index % 5),
  height: 1 + (index % 3),
})

const bulletAt = (index: number): Bullet => ({
  id: 5000 + index,
  x: 40 + ((index * 11) % 240),
  y: 30 + ((index * 19) % 120),
  velocityX: 200,
  velocityY: 40,
  remainingMs: 500,
  weapon: index % 2 === 0 ? 'Smg' : 'Shotgun',
  damage: 1,
  knockback: 60,
})

const blastAt = (index: number): Blast => ({
  x: 60 + index * 30,
  y: 60 + (index % 3) * 20,
  radius: 18,
  ageMs: 40 + index * 20,
})

const popupAt = (index: number): Popup => ({
  kind: cycle(PopupKind.literals, index),
  value: 10 + index * 7,
  x: 40 + index * 25,
  y: 50 + (index % 4) * 15,
  velocityX: 4,
  ageMs: 100 + index * 30,
})

const TRAPS: ReadonlyArray<Trap> = [
  ...Array.map(Array.take(DOOR_IDS, 2), (door, index) =>
    Trap.Barricade({ id: 9000 + index, door, hp: 4, hitRemainingMs: 0 }),
  ),
  Trap.Turret({
    id: 9100,
    column: 12,
    row: 6,
    hp: 5,
    hitRemainingMs: 0,
    facing: { x: 1, y: 0 },
    gun: TurretGun.Armed(),
  }),
]

const fullRoom = (mode: RunMode, wave: number, tier: number): Model => {
  const started = startOrResume(initialModel, mode)
  const [rngState, spawns] = rollSpawns(started.rngState, wave)
  return modifyFields(started, {
    rngState: () => rngState,
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 30_000, spawns }),
    zombies: () => Array.makeBy(ZOMBIE_ALIVE_MAX, zombieAt(wave)),
    particles: () => Array.makeBy(PARTICLE_MAX, particleAt),
    decals: () => Array.makeBy(DECAL_MAX, decalAt),
    bullets: () => Array.makeBy(BULLET_MAX, bulletAt),
    blasts: () => Array.makeBy(BLAST_MAX / 2, blastAt),
    popups: () => Array.makeBy(POPUP_MAX, popupAt),
    traps: () => TRAPS,
    streak: () => Streak.Hot({ count: 12, remainingMs: 900 }),
    score: () => 98_765,
    trapStock: () => ({ Barricade: 2, Turret: 1 }),
    wallet: wallet => ({ ...wallet, balance: 1234, shown: 1234 }),
    player: player => ({
      ...player,
      arsenal: Arsenal.HoldingSpare({
        spare: { kind: 'Smg', rounds: 300, tier },
      }),
    }),
  })
}

// COUNTING PAINTER

type PaintCounts = {
  paintOps: number
  fillStyleChanges: number
  shapesPainted: number
}

const emptyCounts = (): PaintCounts => ({
  paintOps: 0,
  fillStyleChanges: 0,
  shapesPainted: 0,
})

const countingContext = (counts: PaintCounts) => {
  const savedFills: Array<string> = []
  const state = { fill: '' }
  const paint = () => {
    counts.paintOps += 1
  }
  const ignore = () => undefined
  return {
    get fillStyle() {
      return state.fill
    },
    set fillStyle(next: string) {
      if (next !== state.fill) {
        counts.fillStyleChanges += 1
      }
      state.fill = next
    },
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => {
      counts.shapesPainted += 1
      savedFills.push(state.fill)
    },
    restore: () => {
      state.fill = savedFills.pop() ?? state.fill
    },
    fillRect: paint,
    strokeRect: paint,
    fill: paint,
    stroke: paint,
    fillText: paint,
    strokeText: paint,
    clearRect: ignore,
    beginPath: ignore,
    closePath: ignore,
    arc: ignore,
    moveTo: ignore,
    lineTo: ignore,
    quadraticCurveTo: ignore,
    bezierCurveTo: ignore,
    translate: ignore,
    rotate: ignore,
    scale: ignore,
  }
}

type CanvasNode = NonNullable<Html>

const canvasNodes = (node: Html | string): ReadonlyArray<CanvasNode> => {
  if (node === null || typeof node === 'string') {
    return []
  } else if (node.sel?.startsWith('canvas') === true) {
    return [node]
  } else {
    return Array.flatMap(node.children ?? [], canvasNodes)
  }
}

// NOTE: Foldkit's Canvas paints from the canvas element's snabbdom insert and
// postpatch hooks, and snabbdom skips both when a render hands back the same
// VNode it rendered the time before. So a canvas whose VNode is new is one
// the browser repaints that frame, and running its insert hook against a
// counting context measures that frame's paint work through Foldkit's own
// painter.
const paintCanvases = (
  previous: ReadonlyArray<CanvasNode>,
  current: ReadonlyArray<CanvasNode>,
): PaintCounts => {
  const counts = emptyCounts()
  const context = countingContext(counts)
  Array.forEach(current, (node, index) => {
    if (Option.contains(Array.get(previous, index), node)) {
      return
    }
    const element = document.createElement('canvas')
    Object.defineProperty(element, 'getContext', { value: () => context })
    node.data?.hook?.insert?.({ ...node, elm: element })
  })
  return counts
}

const flatShapeCount = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  Array.reduce(
    shapes,
    0,
    (count, shape) =>
      count + 1 + (shape._tag === 'Group' ? flatShapeCount(shape.shapes) : 0),
  )

type FrameCost = Readonly<{
  shapesBuilt: number
  steadyPaintOps: number
  steadyFillStyleChanges: number
  steadyShapesPainted: number
  fullRepaintPaintOps: number
}>

const measureFrames = (model: Model): FrameCost => {
  const renders: Array<ReadonlyArray<CanvasNode>> = []
  const recordingView = (current: Model, h: HtmlBuilder<Message>) => {
    const rendered = view(current, h)
    renders.push(canvasNodes(rendered.body))
    return rendered
  }
  scene(
    { update, view: recordingView },
    given(model),
    Mount.resolve(MeasureGameSurface, Message.MeasuredGameSurface(SURFACE)),
    Subscription.emit(Message.MovedMouse({ clientX: 900, clientY: 300 })),
  )
  const last = Option.getOrElse(Array.last(renders), () => [])
  const beforeLast = Option.getOrElse(
    Array.get(renders, renders.length - 2),
    () => [],
  )
  const steady = paintCanvases(beforeLast, last)
  return {
    shapesBuilt: flatShapeCount(sceneShapes(model)),
    steadyPaintOps: steady.paintOps,
    steadyFillStyleChanges: steady.fillStyleChanges,
    steadyShapesPainted: steady.shapesPainted,
    fullRepaintPaintOps: paintCanvases([], last).paintOps,
  }
}

// BUDGETS

const BUDGET: FrameCost = {
  shapesBuilt: 2200,
  steadyPaintOps: 1500,
  steadyFillStyleChanges: 1500,
  steadyShapesPainted: 1600,
  fullRepaintPaintOps: 2550,
}

const BUDGET_KEYS: ReadonlyArray<keyof FrameCost> = [
  'shapesBuilt',
  'steadyPaintOps',
  'steadyFillStyleChanges',
  'steadyShapesPainted',
  'fullRepaintPaintOps',
]

const SCENARIOS: ReadonlyArray<Readonly<{ name: string; model: Model }>> = [
  {
    name: 'campaign wave 8 at the alive cap',
    model: fullRoom(RunMode.Campaign(), 8, 0),
  },
  {
    name: 'endless wave 15 at the alive cap',
    model: fullRoom(RunMode.Endless(), 15, 3),
  },
]

describe('Frame cost', () => {
  test.each(SCENARIOS)(
    '$name stays within the canvas work budget',
    ({ model }) => {
      const measured = measureFrames(model)
      const report = `measured ${JSON.stringify(measured)}\nbudget   ${JSON.stringify(BUDGET)}`
      Array.forEach(BUDGET_KEYS, key => {
        expect(
          measured[key],
          `${key} is over budget.\n${report}`,
        ).toBeLessThanOrEqual(BUDGET[key])
      })
    },
  )
})
