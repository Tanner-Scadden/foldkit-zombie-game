import type { Page } from 'playwright-core'

import {
  launch,
  desktop,
  wait,
  HARNESS,
  model,
  canvasRect,
  toClient,
  nearestZombie,
} from './lib'

const BASE = process.env.BASE ?? HARNESS
const SECONDS = Number(process.env.SECONDS ?? 6)
const rates = (process.env.RATES ?? '1,4,6').split(',').map(Number)

const scenarios: Record<
  string,
  { q: string; warm: (p: Page) => Promise<void>; bot: boolean }
> = {
  idle: { q: '?wave=2&prep=60000', warm: async () => wait(1500), bot: false },
  busy: {
    q: '?wave=6&start=wave&god&gun=smg',
    warm: async () => wait(12000),
    bot: true,
  },
  worst: {
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30',
    warm: async () => wait(4000),
    bot: true,
  },
}

const stats = (xs: Array<number>) => {
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

const runBot = (p: Page, until: () => boolean) =>
  (async () => {
    const rect = await canvasRect(p)
    await p.mouse.move(640, 300)
    await p.mouse.down()
    while (!until()) {
      const m = await model(p)
      const z = nearestZombie(m)
      if (z) {
        const c = toClient(rect, z.x, z.y)
        await p.mouse.move(c.x, c.y)
      }
      await wait(100)
    }
    await p.mouse.up()
  })()

const browser = await launch()
const only = process.env.ONLY?.split(',')
const results: Array<any> = []
for (const [name, sc] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue
  for (const rate of rates) {
    const p = await desktop(browser)
    const cdp = await p.context().newCDPSession(p)
    await p.goto(BASE + sc.q + '&instrument')
    await wait(300)
    let done = false
    await sc.warm(p)
    const bot = sc.bot ? runBot(p, () => done) : Promise.resolve()
    if (sc.bot) await wait(1200)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    await wait(500)
    const m0 = await model(p)
    const data = await p.evaluate(async seconds => {
      const w = window as any
      w.__timings.update.length = 0
      w.__timings.view.length = 0
      const deltas: Array<number> = []
      let last = performance.now()
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
        update: [...w.__timings.update],
        view: [...w.__timings.view],
        shapes: w.__countShapes(),
      }
    }, SECONDS)
    const m1 = await model(p)
    done = true
    await bot
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const f = stats(data.deltas)
    const dropped = data.deltas.reduce(
      (n, d) => n + Math.max(0, Math.round(d / (1000 / 60)) - 1),
      0,
    )
    const over16 = data.deltas.filter(d => d > 1000 / 60 + 1).length
    const row = {
      scenario: name,
      rate,
      frames: data.deltas.length,
      median: +f.median.toFixed(1),
      p95: +f.p95.toFixed(1),
      max: +f.max.toFixed(1),
      dropped,
      over16,
      updateMean: +stats(data.update).mean.toFixed(2),
      updateP95: +stats(data.update).p95.toFixed(2),
      viewMean: +stats(data.view).mean.toFixed(2),
      viewP95: +stats(data.view).p95.toFixed(2),
      shapes: data.shapes,
      zombies: `${m0.zombies.length}->${m1.zombies.length}`,
      particles: `${m0.particles.length}->${m1.particles.length}`,
      phase: m1.phase._tag,
      decals: m1.decals.length,
    }
    console.log(JSON.stringify(row))
    results.push(row)
    await p.context().close()
  }
}
await browser.close()
const fs = await import('node:fs')
fs.writeFileSync(
  `${import.meta.dir}/perf-${process.env.TAG ?? 'run'}.json`,
  JSON.stringify(results, null, 1),
)
