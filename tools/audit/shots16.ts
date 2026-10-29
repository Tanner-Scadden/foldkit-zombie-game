// The end screens with the feedback line: Game Over and Victory in the
// campaign and Game Over in endless, after the mode buttons are up, on
// desktop and two landscape phones, as `s16-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun shots16.ts
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
  { name: 'p844', width: 844, height: 390, isPhone: true },
  { name: 'p667', width: 667, height: 375, isPhone: true },
]

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'gameover', query: 'wave=5&phase=gameover&stats&freeze=120' },
  { name: 'victory', query: 'wave=8&phase=victory&stats&freeze=120' },
  {
    name: 'endless',
    query: 'mode=endless&wave=14&best=14&phase=gameover&stats&freeze=120',
  },
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

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    const page = await openPage(browser, viewport)
    const device = viewport.isPhone ? '&device=touch' : ''
    await page.goto(`${BASE}?${scene.query}${device}`)
    await wait(1500)
    await shot(page, `s16-${TAG}-${viewport.name}-${scene.name}`)
    await page.close()
  }
}
await browser.close()
