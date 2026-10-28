import {
  launch,
  desktop,
  wait,
  model,
  canvasRect,
  toClient,
  nearestZombie,
} from './lib'
const RATE = Number(process.env.RATE ?? 4)
const b = await launch()
const p = await desktop(b)
const cdp = await p.context().newCDPSession(p)
await p.goto(
  'http://localhost:4175/?wave=8&start=wave&god&gun=smg&fill&crowd=30',
)
await wait(4000)
let done = false
const bot = (async () => {
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
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
await cdp.send('Profiler.start')
await wait(Number(process.env.MS ?? 2000))
const { profile } = (await cdp.send('Profiler.stop')) as any
done = true
await bot
await b.close()

const nodes = new Map<number, any>(profile.nodes.map((n: any) => [n.id, n]))
const parent = new Map<number, number>()
for (const n of profile.nodes)
  for (const c of n.children ?? []) parent.set(c, n.id)
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
console.log('total ms', total.toFixed(0))
console.log('--- top self')
for (const [l, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30))
  console.log(((100 * t) / total).toFixed(1).padStart(5) + '%', l)
// inclusive for named roots
const inclusive = (pred: (n: any) => boolean) => {
  let sum = 0
  for (const [id, t] of dt) {
    let cur: number | undefined = id
    while (cur !== undefined) {
      if (pred(nodes.get(cur))) {
        sum += t
        break
      }
      cur = parent.get(cur)
    }
  }
  return sum
}
const fn = (name: string) => (n: any) => n.callFrame.functionName === name
const rows: Array<[string, (n: any) => boolean]> = [
  ['update (harnessUpdate)', fn('harnessUpdate')],
  ['advanceGame', fn('advanceGame')],
  [
    'view (scene + vdom build)',
    (n: any) =>
      n.callFrame.functionName === 'view' && n.callFrame.url.includes('entry'),
  ],
  ['sceneShapes', fn('sceneShapes')],
  ['paintScene (Foldkit canvas)', fn('paintScene')],
  ['patch (snabbdom)', fn('patch')],
  ['(garbage collector)', fn('(garbage collector)')],
  ['(idle)', fn('(idle)')],
  ['(program)', fn('(program)')],
]
console.log('--- inclusive')
for (const [name, pred] of rows) {
  const t = inclusive(pred)
  console.log(
    ((100 * t) / total).toFixed(1).padStart(5) + '%',
    name,
    t.toFixed(0) + 'ms',
  )
}
// callers of hot schema parser frames
const chains = new Map<string, number>()
for (const [id, t] of dt) {
  const n = nodes.get(id)
  if (
    !(
      n.callFrame.url.includes('index-') &&
      [17220, 17695, 19080].includes(n.callFrame.lineNumber + 1)
    )
  )
    continue
  let cur: number | undefined = id
  const names: Array<string> = []
  while (cur !== undefined) {
    const c = nodes.get(cur).callFrame
    if (c.functionName && !['(anon)'].includes(c.functionName))
      names.push(c.functionName + ':' + (c.lineNumber + 1))
    cur = parent.get(cur)
  }
  const key = names.slice(0, 12).join(' < ')
  chains.set(key, (chains.get(key) ?? 0) + t)
}
console.log('--- schema parse callers')
for (const [k, t] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 6))
  console.log(t.toFixed(0) + 'ms', k)
