// The multiplayer scoping spike: a scripted run of the real game, played
// through the game's own update at a fixed 60 Hz step, measured three ways.
// It never ships. MULTIPLAYER.md ("What we measured") holds the numbers.
//
// - Time per TickedFrame update, bucketed by zombies alive.
// - The Model's serialized size, and the size of the change from one frame to
//   the next, the way a server streaming state or deltas would send it.
// - A hash of the gameplay part of the Model on every frame, so two engines
//   fed the same inputs can be compared (see crossEngine.ts).
//
// The driver is deterministic and uses no trig of its own: it aims straight
// at the nearest zombie's position, so any divergence between engines comes
// from the game, not from the driver. God mode keeps the player's hearts
// full, so a weak pistol-only player lets the room fill to the alive cap,
// which is the worst case for the frame.
//
// This file imports only the game, effect, and foldkit: no DOM, no Node, no
// Bun, so the same code runs in Bun (JavaScriptCore), Node (V8), and workerd.

import { modifyFields } from 'foldkit/struct'

import { PLAYER_MAX_HP } from '../../src/constants'
import { update } from '../../src/main'
import { Message } from '../../src/message'
import { type Model, initialModel } from '../../src/model'
import { asVeteran } from '../../src/veteran'

export const FIXED_STEP_MS = 1000 / 60

const SURFACE = { left: 0, top: 0, width: 320, height: 180 }

const MOVE_PATTERN: ReadonlyArray<ReadonlyArray<string>> = [
  ['KeyW'],
  ['KeyD'],
  ['KeyS'],
  ['KeyA'],
  ['KeyW', 'KeyD'],
  ['KeyS', 'KeyA'],
]
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD']
const FRAMES_PER_MOVE = 75
const AIM_EVERY_FRAMES = 4

export type ScenarioMode = 'Campaign' | 'Endless'

export type ScenarioOptions = Readonly<{
  seed: number
  frames: number
  mode: ScenarioMode
  // Hash the gameplay state every frame (slow; for the cross-engine check).
  hashEveryFrame: boolean
  // Measure sizes and deltas every this many frames (0 for never).
  sizeEvery: number
  now: () => number
  // Called with each frame's Model after it ticks, for dumps.
  onFrame?: (frame: number, model: Model) => void
}>

// The Model fields a server would not need to send every frame: cosmetics
// that clients can make from frameEvents, fields derived from the level and
// the player, and the home menu, save, settings, and UI state.
export const COSMETIC_OR_DERIVED: ReadonlySet<string> = new Set([
  'particles',
  'decals',
  'popups',
  'shake',
  'callouts',
  'flowField',
  'wideFlowField',
  'dustCooldownMs',
  'cameraLean',
])
export const LOCAL_ONLY: ReadonlySet<string> = new Set([
  'shopDialog',
  'shopTabs',
  'shopCategory',
  'maybeSurface',
  'lastDevice',
  'touchControls',
  'orientation',
  'lessons',
  'practice',
  'debutCard',
  'introducedKinds',
  'seenPowerUps',
  'hintBand',
  'screenMs',
  'audio',
  'soundSetting',
  'musicSetting',
  'screenFit',
  'fullscreen',
  'homeScreenTip',
  'homeScreenSteps',
  'pageVisibility',
  'maybeNewerBuild',
  'maybeSupportUrl',
  'appearance',
  'character',
  'shakeSetting',
  'rotationSetting',
  'devicesRow',
  'orientationLock',
  'shareStats',
  'maybeVisitId',
  'maybeHomeFocus',
  'panel',
  'panelDialog',
  'handDialog',
  'bests',
  'runTally',
  'loading',
  'saveStatus',
  'tutorialReset',
  'syncState',
  'writesInFlight',
  'unsavedChanges',
  'syncedSave',
  'linkFlow',
  'home',
  'difficultyCard',
  'trapHint',
  'trapNotice',
])

// The part of the Model that two peers in lockstep must agree on.
export const gameplayOf = (model: Model): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(model).filter(
      ([key]) => !COSMETIC_OR_DERIVED.has(key) && !LOCAL_ONLY.has(key),
    ),
  )

// FNV-1a over a string, 32 bits, written with Math.imul so every engine
// computes it the same way.
export const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193)
  }
  return hash >>> 0
}

// DELTAS

type Change = readonly [path: string, value: unknown]

const hasId = (value: unknown): value is { id: number } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'number'

// A structural diff that leans on the Model's structural sharing: an
// unchanged subtree is the same reference and is skipped at once. Arrays
// of entities with ids diff by id, so a spawn or a death is one change, not
// the whole list again.
export const diff = (
  before: unknown,
  after: unknown,
  path: string,
  out: Array<Change>,
): void => {
  if (Object.is(before, after)) return
  const isObject = (value: unknown) =>
    typeof value === 'object' && value !== null
  if (
    !isObject(before) ||
    !isObject(after) ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    out.push([path, after])
    return
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (after.every(hasId) && before.every(hasId)) {
      const old = new Map(before.map(item => [item.id, item]))
      const kept = new Set<number>()
      after.forEach(item => {
        kept.add(item.id)
        const previous = old.get(item.id)
        if (previous === undefined) out.push([`${path}+${item.id}`, item])
        else diff(previous, item, `${path}#${item.id}`, out)
      })
      before.forEach(item => {
        if (!kept.has(item.id)) out.push([`${path}-${item.id}`, null])
      })
      return
    }
    if (before.length !== after.length) {
      out.push([path, after])
      return
    }
    after.forEach((item, index) =>
      diff(before[index], item, `${path}.${index}`, out),
    )
    return
  }
  const beforeRecord = before as Record<string, unknown>
  const afterRecord = after as Record<string, unknown>
  if (beforeRecord['_tag'] !== afterRecord['_tag']) {
    out.push([path, after])
    return
  }
  Object.keys(afterRecord).forEach(key =>
    diff(beforeRecord[key], afterRecord[key], `${path}.${key}`, out),
  )
  Object.keys(beforeRecord)
    .filter(key => !(key in afterRecord))
    .forEach(key => out.push([`${path}.${key}`, null]))
}

// How many numbers a change carries, for a compact binary estimate: four
// bytes a number (float32 or a small int) plus two for the path id.
const numbersIn = (value: unknown): number =>
  typeof value === 'number'
    ? 1
    : typeof value === 'object' && value !== null
      ? Object.values(value).reduce<number>(
          (count, inner) => count + numbersIn(inner),
          0,
        )
      : typeof value === 'string' || typeof value === 'boolean'
        ? 1
        : 0

export const binaryEstimate = (changes: ReadonlyArray<Change>): number =>
  changes.reduce((bytes, [, value]) => bytes + 2 + 4 * numbersIn(value), 0)

// THE DRIVER

const send = (model: Model, message: Message, count: { messages: number }) => {
  count.messages += 1
  return update(model, message).model
}

const tapKey = (model: Model, code: string, count: { messages: number }) =>
  send(
    send(model, Message.PressedKey({ code }), count),
    Message.ReleasedKey({ code }),
    count,
  )

const holdKeys = (
  model: Model,
  wanted: ReadonlyArray<string>,
  count: { messages: number },
): Model => {
  const held = new Set(model.input.pressedKeys)
  const released = MOVE_KEYS.filter(
    key => held.has(key) && !wanted.includes(key),
  )
  const pressed = wanted.filter(key => !held.has(key))
  const afterRelease = released.reduce(
    (current, code) => send(current, Message.ReleasedKey({ code }), count),
    model,
  )
  return pressed.reduce(
    (current, code) => send(current, Message.PressedKey({ code }), count),
    afterRelease,
  )
}

const nearestZombie = (model: Model) =>
  model.zombies
    .filter(zombie => zombie.state._tag === 'Walking')
    .reduce<{ x: number; y: number; d: number } | undefined>((best, zombie) => {
      const dx = zombie.x - model.player.x
      const dy = zombie.y - model.player.y
      const d = dx * dx + dy * dy
      return best === undefined || d < best.d
        ? { x: zombie.x, y: zombie.y, d }
        : best
    }, undefined)

// The input Messages for one frame, before the frame ticks.
const drive = (
  model: Model,
  frame: number,
  count: { messages: number },
): Model => {
  if (model.phase._tag === 'Preparation') {
    const still = holdKeys(model, [], count)
    const released =
      still.input.mouseButton._tag === 'Held'
        ? send(still, Message.ReleasedPointer({ pointerId: 1 }), count)
        : still
    return released.shop._tag === 'Browsing'
      ? tapKey(released, 'Escape', count)
      : tapKey(released, 'Enter', count)
  }
  if (model.phase._tag !== 'Wave') return model
  const moved = holdKeys(
    model,
    MOVE_PATTERN[Math.floor(frame / FRAMES_PER_MOVE) % MOVE_PATTERN.length] ??
      [],
    count,
  )
  if (frame % AIM_EVERY_FRAMES !== 0) return moved
  const target = nearestZombie(moved)
  if (target === undefined) return moved
  const aimed = send(
    moved,
    Message.MovedMouse({ clientX: target.x, clientY: target.y }),
    count,
  )
  return aimed.input.mouseButton._tag === 'Held'
    ? aimed
    : send(
        aimed,
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: target.x,
          clientY: target.y,
        }),
        count,
      )
}

export const startedRun = (seed: number, mode: ScenarioMode): Model => {
  const count = { messages: 0 }
  const ready = send(
    modifyFields(asVeteran(initialModel), {
      rngState: () => seed,
      difficulty: () => ({ chosen: 'Normal', nightmare: 'Unlocked' }),
    }),
    Message.MeasuredGameSurface(SURFACE),
    count,
  )
  return tapKey(
    mode === 'Endless' ? tapKey(ready, 'KeyE', count) : ready,
    'Enter',
    count,
  )
}

const godMode = (model: Model): Model =>
  model.player.hp === PLAYER_MAX_HP
    ? model
    : modifyFields(model, {
        player: player => ({ ...player, hp: PLAYER_MAX_HP }),
      })

// THE REPORT

export type FrameTiming = Readonly<{ alive: number; ms: number }>

export type SizeSample = Readonly<{
  alive: number
  modelBytes: number
  gameplayBytes: number
  deltaChanges: number
  deltaBytes: number
  gameplayDeltaChanges: number
  gameplayDeltaBytes: number
  gameplayDeltaBinaryBytes: number
  // The full gameplay JSON, kept only for the gzip estimate in Bun or Node.
  gameplayJson: string
  gameplayDeltaJson: string
}>

export type ScenarioReport = Readonly<{
  frames: number
  inputMessages: number
  endPhase: string
  endWave: number
  peakAlive: number
  timings: ReadonlyArray<FrameTiming>
  sizes: ReadonlyArray<SizeSample>
  hashes: ReadonlyArray<number>
  finalHash: number
}>

const waveOf = (model: Model): number =>
  model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'
    ? model.phase.wave
    : model.phase._tag === 'GameOver'
      ? model.phase.wave
      : 0

export const runScenario = (options: ScenarioOptions): ScenarioReport => {
  const count = { messages: 0 }
  const timings: Array<FrameTiming> = []
  const sizes: Array<SizeSample> = []
  const hashes: Array<number> = []
  let model = startedRun(options.seed, options.mode)
  let peakAlive = 0
  let frame = 0
  for (; frame < options.frames; frame++) {
    if (model.phase._tag !== 'Preparation' && model.phase._tag !== 'Wave') {
      break
    }
    const driven = drive(model, frame, count)
    const startedAt = options.now()
    const ticked = update(
      driven,
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    ).model
    const ms = options.now() - startedAt
    const alive = ticked.zombies.filter(
      zombie => zombie.state._tag === 'Walking',
    ).length
    peakAlive = Math.max(peakAlive, alive)
    timings.push({ alive, ms })
    if (options.sizeEvery > 0 && frame % options.sizeEvery === 0) {
      const changes: Array<Change> = []
      diff(model, ticked, '', changes)
      const gameplayChanges = changes.filter(([path]) => {
        const top = path.split(/[.#+-]/)[1] ?? ''
        return !COSMETIC_OR_DERIVED.has(top) && !LOCAL_ONLY.has(top)
      })
      const gameplayJson = JSON.stringify(gameplayOf(ticked))
      const gameplayDeltaJson = JSON.stringify(gameplayChanges)
      sizes.push({
        alive,
        modelBytes: JSON.stringify(ticked).length,
        gameplayBytes: gameplayJson.length,
        deltaChanges: changes.length,
        deltaBytes: JSON.stringify(changes).length,
        gameplayDeltaChanges: gameplayChanges.length,
        gameplayDeltaBytes: gameplayDeltaJson.length,
        gameplayDeltaBinaryBytes: binaryEstimate(gameplayChanges),
        gameplayJson,
        gameplayDeltaJson,
      })
    }
    model = godMode(ticked)
    options.onFrame?.(frame, model)
    if (options.hashEveryFrame) {
      hashes.push(fnv1a(JSON.stringify(gameplayOf(model))))
    }
  }
  return {
    frames: frame,
    inputMessages: count.messages,
    endPhase: model.phase._tag,
    endWave: waveOf(model),
    peakAlive,
    timings,
    sizes,
    hashes,
    finalHash: fnv1a(JSON.stringify(gameplayOf(model))),
  }
}

// SUMMARIES

export const percentile = (
  values: ReadonlyArray<number>,
  share: number,
): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0
  )
}

export const timingSummary = (timings: ReadonlyArray<FrameTiming>) => {
  const all = timings.map(timing => timing.ms)
  const crowded = timings
    .filter(timing => timing.alive >= 15)
    .map(timing => timing.ms)
  const mean = (values: ReadonlyArray<number>) =>
    values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    frames: all.length,
    meanMs: mean(all),
    p50Ms: percentile(all, 0.5),
    p95Ms: percentile(all, 0.95),
    p99Ms: percentile(all, 0.99),
    maxMs: percentile(all, 1),
    crowdedFrames: crowded.length,
    crowdedMeanMs: mean(crowded),
    crowdedP95Ms: percentile(crowded, 0.95),
  }
}
