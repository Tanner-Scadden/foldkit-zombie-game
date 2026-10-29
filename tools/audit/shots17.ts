// The camera and depth sort guard: frozen, deterministic shots of the main
// scenes on a desktop and a small landscape phone, as
// `s17-<TAG>-<viewport>-<scene>.png`.
//   TAG=before bun shots17.ts
//   TAG=after COMPARE=before bun shots17.ts
// COMPARE counts the pixels that differ from another tag's set and writes a
// diff image, `s17-diff-<viewport>-<scene>.png`, for any scene that differs.
// ONLY picks scenes by name, BASE points it at another harness port, and
// COMPARE_ONLY=1 compares the sets already on disk without taking new shots.
import { readdirSync } from 'node:fs'
import type { Browser } from 'playwright-core'

import { HARNESS, launch, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS
const ONLY = process.env.ONLY?.split(',')

type Viewport = Readonly<{
  name: string
  width: number
  height: number
  isPhone: boolean
}>

const VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'd1280', width: 1280, height: 720, isPhone: false },
  { name: 'p667', width: 667, height: 375, isPhone: true },
]

type Scene = Readonly<{ name: string; query: string }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'title', query: 'freeze=40' },
  {
    name: 'crowd',
    query: 'wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=220,50&freeze=75',
  },
  {
    name: 'crowd-shake',
    query: 'wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
  },
  {
    name: 'shop-top',
    query: 'wave=5&money=180&gun=smg&tier=1&px=275&py=142&freeze=40',
  },
  {
    name: 'shop-side',
    query: 'wave=5&money=180&px=262&py=160&freeze=40',
  },
  {
    name: 'powerups',
    query:
      'wave=6&start=wave&god&gun=smg&fill&crowd=10&boosts=RapidFire,Damage,Pierce&boostMs=7000&callout=RapidFire&calloutAge=300&aim=280,40&freeze=36',
  },
  {
    name: 'pickups',
    query: 'wave=4&start=wave&god&seen=all&pickups=all&pickupY=110&freeze=30',
  },
  { name: 'debut-band', query: 'wave=4&seen=all&prep=17000&freeze=30' },
  { name: 'debut-card', query: 'wave=2&seen=Shambler&start=wave&freeze=50' },
  {
    name: 'preview',
    query: 'wave=4&seen=Shambler,Runner&prep=14000&freeze=30',
  },
  {
    name: 'traps',
    query:
      'wave=3&seen=all&prep=12000&barricades=2&turrets=1&money=40&freeze=30',
  },
  { name: 'gameover', query: 'wave=5&phase=gameover&stats&freeze=120' },
  {
    name: 'wear',
    query:
      'wave=8&start=wave&elapsed=3000&lineup=wear&god&seen=all&px=40&py=160&freeze=110',
  },
  {
    name: 'boss',
    query:
      'wave=8&start=wave&elapsed=3000&lineup=boss&god&seen=all&px=40&py=160&freeze=110',
  },
  {
    name: 'gasbags',
    query:
      'wave=6&start=wave&god&gun=smg&fill&gasbags=16&aim=160,40&freeze=150',
  },
  { name: 'looks', query: 'looksheet&freeze=10' },
]

const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(viewport.isPhone
      ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : {}),
  })
  return context.newPage()
}

const shotName = (tag: string, viewport: Viewport, scene: Scene) =>
  `s17-${tag}-${viewport.name}-${scene.name}`

const isPicked = (scene: Scene) => !ONLY || ONLY.includes(scene.name)

const isComparingOnly = process.env.COMPARE_ONLY === '1'

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPicked(scene) || isComparingOnly) continue
    const page = await openPage(browser, viewport)
    const device = viewport.isPhone ? '&device=touch' : ''
    await page.goto(`${BASE}?${scene.query}${device}`)
    await wait(2500)
    await page
      .waitForFunction(() => (window as any).__isFrozen === true, null, {
        timeout: 15000,
      })
      .catch(() => undefined)
    await wait(300)
    await shot(page, shotName(TAG, viewport, scene))
    await page.context().close()
  }
}

if (process.env.COMPARE) {
  const compareTag = process.env.COMPARE
  const page = await (
    await browser.newContext({ viewport: { width: 400, height: 300 } })
  ).newPage()
  const dir = `${import.meta.dir}/shots`
  const files = readdirSync(dir)
  const toDataUrl = async (file: string) =>
    `data:image/png;base64,${Buffer.from(await Bun.file(`${dir}/${file}`).arrayBuffer()).toString('base64')}`
  for (const viewport of VIEWPORTS) {
    for (const scene of SCENES) {
      if (!isPicked(scene)) continue
      const before = `${shotName(compareTag, viewport, scene)}.png`
      const after = `${shotName(TAG, viewport, scene)}.png`
      if (!files.includes(before) || !files.includes(after)) continue
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
            return {
              width: image.width,
              height: image.height,
              data: context.getImageData(0, 0, image.width, image.height),
            }
          }
          const a = await pixels(first!)
          const b = await pixels(second!)
          const diff = document.createElement('canvas')
          diff.width = a.width
          diff.height = a.height
          const diffContext = diff.getContext('2d')!
          const out = diffContext.createImageData(a.width, a.height)
          let differing = 0
          let maxDelta = 0
          let left = Infinity
          let top = Infinity
          let right = -Infinity
          let bottom = -Infinity
          for (let i = 0; i < a.data.data.length; i += 4) {
            const delta = Math.max(
              Math.abs(a.data.data[i]! - b.data.data[i]!),
              Math.abs(a.data.data[i + 1]! - b.data.data[i + 1]!),
              Math.abs(a.data.data[i + 2]! - b.data.data[i + 2]!),
            )
            const gray = Math.round(
              (b.data.data[i]! + b.data.data[i + 1]! + b.data.data[i + 2]!) /
                12,
            )
            out.data[i] = delta > 0 ? 255 : gray
            out.data[i + 1] = delta > 0 ? 0 : gray
            out.data[i + 2] = delta > 0 ? 255 : gray
            out.data[i + 3] = 255
            if (delta > 0) {
              differing++
              const pixel = i / 4
              const x = pixel % a.width
              const y = Math.floor(pixel / a.width)
              left = Math.min(left, x)
              top = Math.min(top, y)
              right = Math.max(right, x)
              bottom = Math.max(bottom, y)
            }
            maxDelta = Math.max(maxDelta, delta)
          }
          diffContext.putImageData(out, 0, 0)
          return {
            differing,
            total: a.data.data.length / 4,
            maxDelta,
            box: differing > 0 ? { left, top, right, bottom } : null,
            diffUrl: differing > 0 ? diff.toDataURL('image/png') : null,
          }
        },
        [await toDataUrl(before), await toDataUrl(after)],
      )
      const label = `${viewport.name}-${scene.name}`
      console.log(
        `${label}: ${result.differing} of ${result.total} pixels differ, max channel delta ${result.maxDelta}${result.box ? `, in ${JSON.stringify(result.box)}` : ''}`,
      )
      if (result.diffUrl) {
        await Bun.write(
          `${dir}/s17-diff-${label}.png`,
          Buffer.from(result.diffUrl.split(',')[1]!, 'base64'),
        )
      }
    }
  }
}
await browser.close()
