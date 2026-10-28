// Copy and layout pass: every screen on two desktop sizes and two landscape
// phones, as `s13-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun shots13.ts
// ONLY picks scenes by name, such as ONLY=intro,preview.
import type { Browser, Page } from 'playwright-core'

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
  { name: 'd1920', width: 1920, height: 1080, isPhone: false },
  { name: 'p844', width: 844, height: 390, isPhone: true },
  { name: 'p667', width: 667, height: 375, isPhone: true },
]

type Scene = Readonly<{
  name: string
  query: string
  waitMs?: number
  act?: (page: Page, viewport: Viewport) => Promise<void>
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'title', query: 'freeze=40' },
  { name: 'gate', query: 'wave=1&seen=all&prep=6000' },
  { name: 'preview', query: 'wave=4&seen=all&prep=14000&freeze=30' },
  {
    name: 'preview-new',
    query: 'wave=4&seen=Shambler,Runner&prep=14000&freeze=30',
  },
  {
    name: 'preview-firing',
    query:
      'wave=5&seen=all&prep=14000&gun=shotgun&aim=200,40&px=160&py=100&freeze=50',
  },
  { name: 'intro', query: 'wave=2&seen=Shambler&start=wave', waitMs: 900 },
  {
    name: 'intro-late',
    query: 'wave=5&seen=Shambler,Runner,Exploder&start=wave',
    waitMs: 1800,
  },
  { name: 'wave-banner', query: 'wave=3&seen=all&start=wave&freeze=30' },
  { name: 'cleared', query: 'wave=3&seen=all&prep=19000&freeze=30' },
  { name: 'debut-banner', query: 'wave=4&seen=all&prep=17000&freeze=30' },
  {
    name: 'beefier',
    query: 'wave=12&mode=endless&seen=all&prep=17000&freeze=30',
  },
  {
    name: 'callout',
    query: 'wave=3&seen=all&start=wave&callout=Pierce&freeze=20',
  },
  {
    name: 'pause',
    query: 'wave=3&seen=all&start=wave',
    act: async page => {
      await page.keyboard.press('Escape')
      await wait(300)
    },
  },
  { name: 'gameover', query: 'wave=5&phase=gameover&stats&freeze=120' },
  { name: 'victory', query: 'wave=8&phase=victory&stats&freeze=120' },
  { name: 'shop', query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142' },
  {
    name: 'traps',
    query: 'wave=3&seen=all&prep=12000&barricades=2&turrets=1&money=40',
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
    const device = viewport.isPhone ? '&device=touch' : ''
    await page.goto(`${BASE}?${scene.query}${device}`)
    await wait(scene.waitMs ?? 1500)
    if (scene.act) await scene.act(page, viewport)
    await shot(page, `s13-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()
