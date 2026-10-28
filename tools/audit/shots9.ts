import { readdirSync } from 'node:fs'

import { desktop, launch, mobile, model, shot, wait } from './lib'

const BASE = process.env.BASE ?? 'http://localhost:4174/'
const TAG = process.env.TAG ?? 'now'

const scenes: ReadonlyArray<
  Readonly<{ name: string; q: string; isMobile?: boolean }>
> = [
  { name: 'title', q: '?freeze=40' },
  { name: 'prep', q: '?wave=2&prep=60000&freeze=40' },
  {
    name: 'worst',
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=220,50&freeze=75',
  },
  {
    name: 'worst-later',
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
  },
  {
    name: 'endless15',
    q: '?wave=15&mode=endless&start=wave&god&gun=smg&tier=3&fill&aim=100,120&freeze=150',
  },
  { name: 'gameover', q: '?wave=5&phase=gameover&stats&freeze=90' },
  { name: 'victory', q: '?wave=8&phase=victory&stats&freeze=90' },
  {
    name: 'touch',
    q: '?device=touch&wave=3&start=wave&god&fill&crowd=10&freeze=60',
    isMobile: true,
  },
  {
    name: 'touch-shake',
    q: '?device=touch&wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
    isMobile: true,
  },
]

const browser = await launch()
for (const scene of scenes) {
  const page = scene.isMobile
    ? await mobile(browser, true)
    : await desktop(browser)
  await page.goto(BASE + scene.q)
  await wait(2500)
  const m = await model(page)
  await shot(page, `s9-${TAG}-${scene.name}`)
  console.log(
    scene.name,
    `shake ${JSON.stringify(m.shake.offset)}`,
    `zombies ${m.zombies.length} particles ${m.particles.length} decals ${m.decals.length}`,
  )
  await page.context().close()
}

if (process.env.COMPARE) {
  const page = await desktop(browser)
  const dir = `${import.meta.dir}/shots`
  const files = readdirSync(dir)
  for (const scene of scenes) {
    const before = `s9-${process.env.COMPARE}-${scene.name}.png`
    const after = `s9-${TAG}-${scene.name}.png`
    if (!files.includes(before) || !files.includes(after)) continue
    const toDataUrl = async (file: string) =>
      `data:image/png;base64,${Buffer.from(await Bun.file(`${dir}/${file}`).arrayBuffer()).toString('base64')}`
    const result = await page.evaluate(
      async ([first, second]) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>(resolve => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.src = src
          })
        const pixels = async (src: string) => {
          const image = await load(src)
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')!
          context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, image.width, image.height).data
        }
        const a = await pixels(first!)
        const b = await pixels(second!)
        let differing = 0
        let maxDelta = 0
        for (let i = 0; i < a.length; i += 4) {
          const delta = Math.max(
            Math.abs(a[i]! - b[i]!),
            Math.abs(a[i + 1]! - b[i + 1]!),
            Math.abs(a[i + 2]! - b[i + 2]!),
          )
          if (delta > 0) differing++
          maxDelta = Math.max(maxDelta, delta)
        }
        return { differing, total: a.length / 4, maxDelta }
      },
      [await toDataUrl(before), await toDataUrl(after)],
    )
    console.log(
      `${scene.name}: ${result.differing} of ${result.total} pixels differ, max channel delta ${result.maxDelta}`,
    )
  }
}
await browser.close()
