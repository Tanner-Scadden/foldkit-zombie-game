import {
  canvasRect,
  desktop,
  launch,
  model,
  nearestZombie,
  toClient,
  wait,
} from './lib'
import { SCENARIOS } from './scenarios'

const RATE = Number(process.env.RATE ?? 4)
const MS = Number(process.env.MS ?? 2000)
const BASE = process.env.BASE ?? 'http://localhost:4175/'
const SCENARIO = process.env.SCENARIO ?? 'worst'
const scenario = SCENARIOS[SCENARIO]
if (!scenario) {
  throw new Error(`unknown scenario ${SCENARIO}`)
}

const b = await launch()
const p = await desktop(b)
const cdp = await p.context().newCDPSession(p)
await p.goto(BASE + scenario.q)
await scenario.warm()
let done = false
const bot = (async () => {
  if (!scenario.bot) {
    return
  }
  const rect = await canvasRect(p)
  await p.mouse.move(640, 300)
  await p.mouse.down()
  while (!done) {
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
await wait(1200)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
await wait(300)

const traceEvents: Array<any> = []
cdp.on('Tracing.dataCollected', ({ value }: any) => traceEvents.push(...value))
const traceDone = new Promise<void>(resolve =>
  cdp.once('Tracing.tracingComplete', () => resolve()),
)
await cdp.send('Tracing.start', {
  categories:
    'devtools.timeline,v8,v8.execute,disabled-by-default-devtools.timeline,blink.user_timing',
  transferMode: 'ReportEvents',
})
await wait(MS)
await cdp.send('Tracing.end')
await traceDone

await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
await cdp.send('Profiler.start')
await wait(MS)
const { profile } = (await cdp.send('Profiler.stop')) as any
done = true
await bot
await b.close()
if (process.env.DUMP) {
  await Bun.write(process.env.DUMP, JSON.stringify(profile))
}

console.log(`scenario ${SCENARIO} at ${RATE}x, ${MS}ms per pass`)

// TRACE: main thread time by top-level event kind

const mainThread = traceEvents.find(
  e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
)
const onMain = traceEvents.filter(
  e => mainThread && e.pid === mainThread.pid && e.tid === mainThread.tid,
)
const topLevel = (() => {
  const sorted = onMain
    .filter(e => e.ph === 'X' && e.dur !== undefined)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur)
  const out: Array<any> = []
  const stack: Array<any> = []
  for (const e of sorted) {
    while (
      stack.length &&
      e.ts >= stack[stack.length - 1].ts + stack[stack.length - 1].dur
    ) {
      stack.pop()
    }
    const depthUnderTask = stack.filter(s => s.name !== 'RunTask').length
    if (depthUnderTask === 0 && e.name !== 'RunTask') {
      out.push(e)
    }
    stack.push(e)
  }
  return out
})()
const sumByName = (names: ReadonlyArray<string>) =>
  topLevel
    .filter(e => names.includes(e.name))
    .reduce((sum, e) => sum + e.dur / 1000, 0)
const topNames = new Map<string, number>()
for (const e of topLevel) {
  topNames.set(e.name, (topNames.get(e.name) ?? 0) + e.dur / 1000)
}
const traceRows: Array<[string, ReadonlyArray<string>]> = [
  ['rAF callbacks (all JS in frame)', ['FireAnimationFrame']],
  [
    'other JS (events, timers, bot)',
    ['FunctionCall', 'EvaluateScript', 'TimerFire', 'EventDispatch'],
  ],
  [
    'GC (minor + major)',
    [
      'MinorGC',
      'MajorGC',
      'V8.GC_SCAVENGER',
      'V8.GC_MARK_COMPACTOR',
      'BlinkGC.AtomicPhase',
    ],
  ],
  ['style + layout', ['UpdateLayoutTree', 'Layout']],
  ['paint + prepaint', ['Paint', 'PrePaint', 'PaintImage']],
  [
    'layerize + commit',
    ['Layerize', 'Commit', 'UpdateLayer', 'CompositeLayers'],
  ],
]
console.log('--- main thread trace (ms over the pass)')
for (const [label, names] of traceRows) {
  console.log(sumByName(names).toFixed(0).padStart(6) + 'ms', label)
}
console.log('--- top-level main thread events')
for (const [name, t] of [...topNames]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)) {
  console.log(t.toFixed(0).padStart(6) + 'ms', name)
}
const frames = topLevel.filter(e => e.name === 'FireAnimationFrame')
console.log(
  `rAF callbacks: ${frames.length}, mean ${(sumByName(['FireAnimationFrame']) / Math.max(1, frames.length)).toFixed(2)}ms`,
)

// CPU PROFILE: self time bucketed by the nearest named ancestor

const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]))
const parent = new Map<number, number>()
for (const n of profile.nodes) {
  for (const c of n.children ?? []) {
    parent.set(c, n.id)
  }
}
const dt = new Map<number, number>()
profile.samples.forEach((id: number, i: number) =>
  dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000),
)
const total = [...dt.values()].reduce((a, b) => a + b, 0)
const label = (n: any) =>
  `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`
const self = new Map<string, number>()
for (const [id, t] of dt) {
  const l = label(nodes.get(id))
  self.set(l, (self.get(l) ?? 0) + t)
}
console.log('--- top self')
for (const [l, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(((100 * t) / total).toFixed(1).padStart(5) + '%', l)
}

const named = (name: string) => (n: any) => n.callFrame.functionName === name
const buckets: Array<[string, (n: any) => boolean]> = [
  ['paint (Foldkit paintScene)', named('paintScene')],
  ['scene build (sceneShapes)', named('sceneShapes')],
  ['update (harnessUpdate)', named('harnessUpdate')],
  ['snabbdom patch, minus paint', named('patch')],
  [
    'audit bot serialize',
    n => ['serialize', 'innerSerialize'].includes(n.callFrame.functionName),
  ],
  ['(garbage collector)', named('(garbage collector)')],
  ['(program) native, outside JS', named('(program)')],
  ['(idle)', named('(idle)')],
]
const bucketTotals = new Map<string, number>()
const otherSelf = new Map<string, number>()
for (const [id, t] of dt) {
  let cur: number | undefined = id
  let bucket = 'other JS (view vdom build, runtime, Effect)'
  while (cur !== undefined) {
    const node = nodes.get(cur)
    const hit = buckets.find(([, pred]) => pred(node))
    if (hit) {
      bucket = hit[0]
      break
    }
    cur = parent.get(cur)
  }
  bucketTotals.set(bucket, (bucketTotals.get(bucket) ?? 0) + t)
  if (bucket.startsWith('other')) {
    const l = label(nodes.get(id))
    otherSelf.set(l, (otherSelf.get(l) ?? 0) + t)
  }
}
console.log(
  `--- CPU profile, nearest-bucket breakdown (total ${total.toFixed(0)}ms)`,
)
for (const [name, t] of [...bucketTotals].sort((a, b) => b[1] - a[1])) {
  console.log(
    ((100 * t) / total).toFixed(1).padStart(5) + '%',
    name,
    t.toFixed(0) + 'ms',
  )
}

console.log('--- top self inside other JS')
for (const [l, t] of [...otherSelf].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(t.toFixed(0).padStart(6) + 'ms', l)
}

const FOCUS = process.env.FOCUS?.split(',') ?? []
for (const focus of FOCUS) {
  const chains = new Map<string, number>()
  for (const [id, t] of dt) {
    let cur: number | undefined = id
    const names: Array<string> = []
    let hit = false
    while (cur !== undefined) {
      const c = nodes.get(cur).callFrame
      if (c.functionName === focus) {
        hit = true
      }
      if (c.functionName) {
        names.push(c.functionName)
      }
      cur = parent.get(cur)
    }
    if (!hit) {
      continue
    }
    const key = names.slice(0, 8).join(' < ')
    chains.set(key, (chains.get(key) ?? 0) + t)
  }
  console.log(`--- stacks through ${focus}`)
  for (const [k, t] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(t.toFixed(0) + 'ms', k)
  }
}
