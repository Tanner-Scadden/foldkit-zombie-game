// The shop entrance and the coin: the open stall in Preparation with the
// player coming at it from the side, the closed stall mid-wave with the touch
// buttons up, the wave bonus banner with the shop hint, bounty popups, and the
// shop dialog, on desktop and two landscape phones, as
// `s15-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun shots15.ts
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
  { name: 'p844', width: 844, height: 390, isPhone: true },
  { name: 'p667', width: 667, height: 375, isPhone: true },
]

const SCENES: ReadonlyArray<
  Readonly<{ name: string; query: string; touch: boolean }>
> = [
  {
    name: 'side',
    query: 'wave=2&money=70&gun=shotgun&px=228&py=160&prep=12000&freeze=40',
    touch: true,
  },
  {
    name: 'top',
    query: 'wave=2&money=70&px=272&py=118&prep=12000&freeze=40',
    touch: false,
  },
  {
    name: 'closed',
    query:
      'wave=3&start=wave&seen=all&money=120&gun=smg&px=240&py=160&freeze=20',
    touch: true,
  },
  {
    name: 'banner',
    query: 'wave=2&money=37&px=160&py=90&prep=19000&freeze=10',
    touch: false,
  },
  {
    name: 'hint',
    query: 'wave=2&money=37&px=160&py=90&prep=16000&freeze=10',
    touch: true,
  },
  {
    name: 'bounty',
    query:
      'wave=3&start=wave&seen=all&money=1234&gun=smg&bounty&px=160&py=120&freeze=2',
    touch: true,
  },
  {
    name: 'dialog',
    query: 'wave=4&money=70&gun=shotgun&rounds=20&px=270&py=142',
    touch: false,
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
    if (ONLY && !ONLY.includes(scene.name)) continue
    const page = await openPage(browser, viewport)
    const device = scene.touch && viewport.isPhone ? '&device=touch' : ''
    await page.goto(`${BASE}?${scene.query}${device}`)
    await wait(1200)
    await shot(page, `s15-${TAG}-${viewport.name}-${scene.name}`)
    await page.close()
  }
}
await browser.close()
