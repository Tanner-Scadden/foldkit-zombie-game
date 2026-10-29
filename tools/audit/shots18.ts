// The pause screen's controls panel, for a keyboard and for touch, on two
// desktop sizes and two landscape phones, as
// `s18-<TAG>-<viewport>-<device>.png`.
//   TAG=after bun shots18.ts
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

const DEVICES = ['keyboard', 'touch'] as const

const openPage = async (
  browser: Browser,
  viewport: Viewport,
  device: (typeof DEVICES)[number],
) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.isPhone ? 2 : 1,
    ...(device === 'touch'
      ? { isMobile: viewport.isPhone, hasTouch: true }
      : {}),
  })
  return context.newPage()
}

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const device of DEVICES) {
    const page = await openPage(browser, viewport, device)
    const touch = device === 'touch' ? '&device=touch' : ''
    await page.goto(
      `${BASE}?wave=3&seen=all&start=wave&money=40&gun=smg&phase=paused${touch}`,
    )
    await wait(1200)
    await shot(page, `s18-${TAG}-${viewport.name}-${device}`)
    await page.context().close()
  }
}
await browser.close()
