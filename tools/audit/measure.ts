import type { Browser, Page } from 'playwright-core'

import { canvasRect, desktop, model, toClient, wait } from './lib'
import { SCENARIOS } from './scenarios'

export type FrameRow = Readonly<{
  scenario: string
  rate: number
  frames: number
  fps: number
  median: number
  p95: number
  max: number
  dropped: number
  updateMean: number
  updateP95: number
  viewMean: number
  viewP95: number
  jsMs: number
  busyMs: number
  shapes: number
  zombies: string
  particles: string
  phase: string
  decals: number
}>

const stats = (xs: ReadonlyArray<number>) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (f: number) =>
    s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0
  return {
    median: q(0.5),
    p95: q(0.95),
    max: s[s.length - 1] ?? 0,
    mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length),
  }
}

const round = (value: number, digits: number) => +value.toFixed(digits)

const aimTarget = (page: Page) =>
  page.evaluate(() => {
    const m = (window as any).__model
    let best: any
    let bestDistance = Infinity
    for (const z of m.zombies) {
      if (z.state._tag === 'Dying') continue
      const d = Math.hypot(z.x - m.player.x, z.y - m.player.y)
      if (d < bestDistance) {
        bestDistance = d
        best = z
      }
    }
    return best ? { x: best.x, y: best.y } : undefined
  })

const runBot = (page: Page, isDone: () => boolean) =>
  (async () => {
    const rect = await canvasRect(page)
    await page.mouse.move(640, 300)
    await page.mouse.down()
    while (!isDone()) {
      const target = await aimTarget(page)
      if (target) {
        const point = toClient(rect, target.x, target.y)
        await page.mouse.move(point.x, point.y)
      }
      await wait(100)
    }
    await page.mouse.up()
  })()

const mainThreadBusyMs = (events: ReadonlyArray<any>): number => {
  const main = events.find(
    e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
  )
  if (!main) return 0
  const tasks = events
    .filter(
      e =>
        e.pid === main.pid &&
        e.tid === main.tid &&
        e.ph === 'X' &&
        e.name === 'ThreadControllerImpl::RunTask',
    )
    .sort((a, b) => a.ts - b.ts)
  let busyUntil = -Infinity
  let busy = 0
  for (const task of tasks) {
    const end = task.ts + (task.dur ?? 0)
    if (end > busyUntil) {
      busy += end - Math.max(task.ts, busyUntil)
      busyUntil = end
    }
  }
  return busy / 1000
}

export const measureScenario = async (
  browser: Browser,
  base: string,
  name: string,
  rate: number,
  seconds: number,
): Promise<FrameRow> => {
  const scenario = SCENARIOS[name]
  if (!scenario) throw new Error(`unknown scenario ${name}`)
  const page = await desktop(browser)
  const cdp = await page.context().newCDPSession(page)
  await page.goto(base + scenario.q + '&instrument')
  await wait(300)
  let isDone = false
  await scenario.warm()
  const bot = scenario.bot ? runBot(page, () => isDone) : Promise.resolve()
  if (scenario.bot) await wait(1200)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await wait(500)
  const m0 = await model(page)

  const traceEvents: Array<any> = []
  cdp.on('Tracing.dataCollected', ({ value }: any) =>
    traceEvents.push(...value),
  )
  const traceDone = new Promise<void>(resolve =>
    cdp.once('Tracing.tracingComplete', () => resolve()),
  )
  await cdp.send('Tracing.start', {
    categories: 'toplevel',
    transferMode: 'ReportEvents',
  })
  const data = await page.evaluate(async seconds => {
    const w = window as any
    w.__timings.update.length = 0
    w.__timings.view.length = 0
    const deltas: Array<number> = []
    const start = performance.now()
    let last = start
    await new Promise<void>(resolve => {
      const end = last + seconds * 1000
      const tick = (t: number) => {
        deltas.push(t - last)
        last = t
        if (t < end) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    return {
      deltas,
      elapsedMs: last - start,
      update: [...w.__timings.update],
      view: [...w.__timings.view],
      shapes: w.__countShapes(),
    }
  }, seconds)
  await cdp.send('Tracing.end')
  await traceDone

  const m1 = await model(page)
  isDone = true
  await bot
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.context().close()

  const frame = stats(data.deltas)
  const update = stats(data.update)
  const view = stats(data.view)
  return {
    scenario: name,
    rate,
    frames: data.deltas.length,
    fps: round((1000 * data.deltas.length) / data.elapsedMs, 1),
    median: round(frame.median, 1),
    p95: round(frame.p95, 1),
    max: round(frame.max, 1),
    dropped: data.deltas.reduce(
      (n, d) => n + Math.max(0, Math.round(d / (1000 / 60)) - 1),
      0,
    ),
    updateMean: round(update.mean, 2),
    updateP95: round(update.p95, 2),
    viewMean: round(view.mean, 2),
    viewP95: round(view.p95, 2),
    jsMs: round(update.mean + view.mean, 2),
    busyMs: round(mainThreadBusyMs(traceEvents) / data.deltas.length, 2),
    shapes: data.shapes,
    zombies: `${m0.zombies.length}->${m1.zombies.length}`,
    particles: `${m0.particles.length}->${m1.particles.length}`,
    phase: m1.phase._tag,
    decals: m1.decals.length,
  }
}

export const calibrationMs = async (browser: Browser): Promise<number> => {
  const page = await desktop(browser)
  await page.goto('about:blank')
  const times = await page.evaluate(() => {
    const run = () => {
      const t0 = performance.now()
      let checksum = 0
      for (let round = 0; round < 40; round++) {
        const items = Array.from({ length: 20000 }, (_, i) => ({
          id: i,
          value: (i * 2654435761) % 1000003,
        }))
        items.sort((a, b) => a.value - b.value)
        checksum += items[round]!.value
      }
      return [performance.now() - t0, checksum]
    }
    return Array.from({ length: 5 }, () => run()[0]!)
  })
  await page.context().close()
  return [...times].sort((a, b) => a - b)[2]!
}
