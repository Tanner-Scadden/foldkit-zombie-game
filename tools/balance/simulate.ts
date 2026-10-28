// Headless balance simulation. Run from the repo root:
//   bun tools/balance/simulate.ts [runs] [firstSeed]
// It drives the game's own init model and update with a simple bot and
// prints survival per wave, run length, the money curve, and which zombie
// kinds cost the bot the most hearts. Nothing here ships with the game.

import { Window } from 'happy-dom'

const browserWindow = new Window()
Object.assign(globalThis, {
  window: browserWindow,
  document: browserWindow.document,
})

const { Message, update } = await import('../../src/main')
const { initialModel } = await import('../../src/model')
const { THRESHOLDS, boxCenter, hasLineOfSight } =
  await import('../../src/arena')
const { STALL_BOX, isShopOpenFor, priceFor } = await import('../../src/shop')
const { FINAL_WAVE } = await import('../../src/waves')
const { maxRounds, maybeSpare } = await import('../../src/weapons')
const { Dialog } = await import('@foldkit/ui')
const { Option, Array: EffectArray } = await import('effect')
const { modifyFields } = await import('foldkit/struct')

// TUNE=path/to/tune.ts loads a module whose default export edits the
// tables in place before the runs, so a balance idea can be tried without
// touching src. Bake the winning numbers into src afterwards.
if (process.env.TUNE !== undefined) {
  const tune = await import(`${process.cwd()}/${process.env.TUNE}`)
  tune.default({
    WAVE_PLANS: (await import('../../src/waves')).WAVE_PLANS,
    ZOMBIE_KINDS: (await import('../../src/zombies')).ZOMBIE_KINDS,
    SHOP_ITEMS: (await import('../../src/shop')).SHOP_ITEMS,
    WEAPONS: (await import('../../src/weapons')).WEAPONS,
  })
}

type Model = typeof initialModel
type GameMessage = Parameters<typeof update>[1]
type Vector = { x: number; y: number }
type Kind = 'Shambler' | 'Runner' | 'Tank' | 'Exploder'

const FRAME_MS = 1000 / 30
const MAX_RUN_MS = 20 * 60 * 1000
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
}

const send = (model: Model, message: GameMessage): Model =>
  update(model, message).model

const walking = (model: Model) =>
  model.zombies.filter(zombie => zombie.state._tag === 'Walking')

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

const kite = (model: Model): Vector => {
  const { player } = model
  const nearest = walking(model).sort(
    (a, b) => distance(player, a) - distance(player, b),
  )[0]
  if (nearest !== undefined && distance(player, nearest) < FLEE_PX) {
    return steerToward(nearest, player)
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

const nearestVisible = (model: Model) =>
  walking(model)
    .filter(zombie => hasLineOfSight(model.player, zombie))
    .sort((a, b) => distance(model.player, a) - distance(model.player, b))[0]

const aimAndFire = (model: Model, frame: number): Model => {
  if (frame % AIM_EVERY_FRAMES !== 0) {
    return model
  }
  const target = nearestVisible(model)
  const isHeld = model.input.mouseButton._tag === 'Held'
  if (target === undefined) {
    return isHeld
      ? send(model, Message.ReleasedPointer({ pointerId: 1 }))
      : model
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

const canBuy = (model: Model, item: Parameters<typeof priceFor>[1]) =>
  model.wallet.balance >= priceFor(model, item)

const wantedPurchase = (
  model: Model,
): Parameters<typeof priceFor>[1] | undefined => {
  const spare = Option.getOrUndefined(maybeSpare(model.player.arsenal))
  if (model.player.hp <= 3 && canBuy(model, 'Heart')) return 'Heart'
  if (spare === undefined) {
    if (canBuy(model, 'Smg')) return 'Smg'
    if (canBuy(model, 'Shotgun') && model.wallet.balance < 90) return 'Shotgun'
    return undefined
  }
  const refill = spare.kind === 'Smg' ? 'SmgRounds' : 'ShotgunShells'
  if (spare.rounds < maxRounds(spare.kind) / 2 && canBuy(model, refill)) {
    return refill
  }
  if (spare.kind === 'Shotgun' && canBuy(model, 'Smg')) return 'Smg'
  const barricades =
    model.trapStock.Barricade +
    model.traps.filter(trap => trap._tag === 'Barricade').length
  if (barricades < 2 && canBuy(model, 'Barricade')) return 'Barricade'
  if (model.player.hp <= 4 && canBuy(model, 'Heart')) return 'Heart'
  return undefined
}

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
  const counts = new Map<string, number>()
  model.phase.spawns.forEach(spawn => {
    counts.set(spawn.door, (counts.get(spawn.door) ?? 0) + 1)
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

type PrepPlan = 'Shop' | 'Barricade' | 'Go'

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
  return 'Go'
}

// RUN

const emptyHurt = (): Record<Kind, number> => ({
  Shambler: 0,
  Runner: 0,
  Tank: 0,
  Exploder: 0,
})

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
    modifyFields(initialModel, { rngState: () => seed }),
    Message.MeasuredGameSurface(SURFACE),
  )
  let model = tapKey(ready, 'Enter')
  let shoppedWave = 0
  let stuckFrames = 0
  let lastPosition: Vector = model.player
  let strafe = 1
  let frame = 0
  let maxAlive = 0
  botRandom = seed
  while (
    (model.phase._tag === 'Preparation' || model.phase._tag === 'Wave') &&
    model.stats.runMs < MAX_RUN_MS
  ) {
    const wave = model.phase.wave
    if (model.shop._tag === 'Browsing') {
      model = shop(model)
      if (model.shop._tag !== 'Browsing') shoppedWave = wave
      continue
    }
    if (model.phase._tag === 'Preparation') {
      model = holdFire(model)
      const plan = prepPlan(model, shoppedWave === wave)
      if (plan === 'Go') {
        model = pressKeys(model, new Set())
        model = tapKey(model, 'Enter')
        continue
      }
      const target =
        plan === 'Shop'
          ? STALL_FRONT
          : boxCenter(THRESHOLDS[busiestDoor(model) ?? 'North'].box)
      if (plan === 'Barricade' && distance(model.player, target) < 8) {
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
    maxAlive = Math.max(maxAlive, model.zombies.length)
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
  return {
    seed,
    cleared: model.stats.wavesCleared,
    victory: model.phase._tag === 'Victory',
    runMs: model.stats.runMs,
    moneyAfterWave,
    hurtBy,
    maxAlive,
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
const started = performance.now()
const results = EffectArray.makeBy(runs, index =>
  runOnce(firstSeed + index * 7919),
)
const elapsed = (performance.now() - started) / 1000

console.log(`${runs} runs in ${elapsed.toFixed(1)} s`)
console.log('\nWave  reached  cleared')
for (let wave = 1; wave <= FINAL_WAVE; wave++) {
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
console.log(`\nVictories: ${wins.length} of ${runs}`)
console.log(`Median wave of death: ${median(deaths)}`)
console.log(
  `Median run length: ${(median(results.map(r => r.runMs)) / 60000).toFixed(2)} min`,
)
console.log(
  `Median win length: ${(median(wins.map(r => r.runMs)) / 60000).toFixed(2)} min`,
)
console.log(
  '\nMoney earned by the end of wave (median of runs that cleared it)',
)
for (let wave = 1; wave <= FINAL_WAVE; wave++) {
  const values = results.flatMap(r =>
    r.moneyAfterWave[wave - 1] === undefined
      ? []
      : [r.moneyAfterWave[wave - 1]!],
  )
  if (values.length > 0) console.log(`  wave ${wave}: $${median(values)}`)
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

console.log(
  `\nMost zombies on screen at once: median ${median(results.map(r => r.maxAlive))}, worst ${Math.max(...results.map(r => r.maxAlive))}`,
)
