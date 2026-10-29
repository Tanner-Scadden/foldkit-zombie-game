// The top right corner with the PAUSE, MUTE, and MUSIC buttons over the
// RELOAD and SWAP buttons, mid-wave and between waves, for a keyboard and for
// touch, and the pause screen's keyboard panel, on two desktop sizes and two
// landscape phones, as `s19-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun shots19.ts
// BASE points it at another harness port.
import type { Browser } from 'playwright-core'

import { HARNESS, launch, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS

type Viewport = Readonly<{
  name: string
  width: number
  height: number
  isPhone: boolean
}>

const VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'd1280', width: 1280, height: 720, isPhone: false },
  { name: 'd1920', width: 1920, height: 1080, isPhone: false },
  { name: 'p844', width: 844, height: 390, isPhone: true },
  { name: 'p667', width: 667, height: 375, isPhone: true },
]

type Scene = Readonly<{ name: string; query: string; isTouch: boolean }>

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wave-touch',
    query: 'wave=3&seen=all&start=wave&gun=smg&device=touch',
    isTouch: true,
  },
  {
    name: 'prep-touch',
    query: 'wave=3&seen=all&gun=smg&device=touch',
    isTouch: true,
  },
  {
    name: 'wave-keyboard',
    query: 'wave=3&seen=all&start=wave&gun=smg',
    isTouch: false,
  },
  {
    name: 'paused-keyboard',
    query: 'wave=3&seen=all&start=wave&gun=smg&phase=paused',
    isTouch: false,
  },
  {
    name: 'paused-touch',
    query: 'wave=3&seen=all&start=wave&gun=smg&phase=paused&device=touch',
    isTouch: true,
  },
]

const openPage = async (
  browser: Browser,
  viewport: Viewport,
  isTouch: boolean,
) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.isPhone ? 2 : 1,
    ...(isTouch ? { isMobile: viewport.isPhone, hasTouch: true } : {}),
  })
  return context.newPage()
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height

const BUTTONS = [
  '.pause-button',
  '.mute-button',
  '.music-button',
  '.reload-button',
  '.swap-button',
]

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    const page = await openPage(browser, viewport, scene.isTouch)
    await page.goto(`${BASE}?${scene.query}`)
    await wait(1200)
    const boxes = (
      await Promise.all(
        BUTTONS.map(async selector => {
          const locator = page.locator(selector)
          if ((await locator.count()) === 0) {
            return []
          }
          const box = await locator.boundingBox()
          return box ? [{ selector, ...box }] : []
        }),
      )
    ).flat()
    const clashes = boxes.flatMap((a, index) =>
      boxes
        .slice(index + 1)
        .filter(b => overlaps(a, b))
        .map(b => `${a.selector} x ${b.selector}`),
    )
    console.log(
      `${viewport.name} ${scene.name}: ${boxes.map(b => b.selector).join(' ')}${clashes.length > 0 ? ` OVERLAP ${clashes.join(', ')}` : ''}`,
    )
    await shot(page, `s19-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()
