// The armor and bests pass: the top HUD with two boosts (and all four with
// the boss bar), the home menu with "Your bests", every kind side by side at
// full health beside the player, every kind at every wear stage, the Big Lug
// at each armor stage with his plates on the floor, and a Kaboomer with his
// health bar, on 1280x720, 844x390, and 667x375, as
// `s32-<TAG>-<viewport>-<scene>.png`. Desktop scenes with a focus also get a
// crop as `s32-<TAG>-zoom-<scene>.png`.
//   TAG=after BASE=http://localhost:4174/ bun run heavy -- bun tools/audit/shots32.ts
// ONLY picks scenes by name and BASE points it at another harness port.
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
  { name: 'p844', width: 844, height: 390, isPhone: true },
  { name: 'p667', width: 667, height: 375, isPhone: true },
]

type Focus = Readonly<{ x: number; y: number; width: number; height: number }>

type Scene = Readonly<{ name: string; query: string; focus?: Focus }>

const STILL = 'wave=6&start=wave&elapsed=3000&god&seen=all'
const TOP_LEFT: Focus = { x: 0, y: 0, width: 160, height: 40 }

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'hud-boosts',
    query: `${STILL}&boosts=RapidFire,Speed&boostMs=7000&freeze=3`,
    focus: TOP_LEFT,
  },
  {
    name: 'hud-boosts-boss',
    query: `wave=8&start=wave&elapsed=3000&god&seen=all&boss=fighting&bosshp=0.6&boosts=RapidFire,Damage,Speed,Pierce&boostMs=9000&freeze=3`,
    focus: { x: 0, y: 0, width: 320, height: 40 },
  },
  { name: 'home-bests', query: 'bests' },
  {
    name: 'sizes',
    query: `${STILL}&lineup=sizes&px=46&py=100&freeze=2`,
    focus: { x: 30, y: 65, width: 210, height: 50 },
  },
  {
    name: 'lineup',
    query: `${STILL}&lineup=wear&px=160&py=150&freeze=2`,
    focus: { x: 30, y: 30, width: 260, height: 100 },
  },
  {
    name: 'armor',
    query: `${STILL}&lineup=armor&px=160&py=150&freeze=90`,
    focus: { x: 40, y: 55, width: 230, height: 60 },
  },
  {
    name: 'kaboomer-bar',
    query: `${STILL}&gasbags&px=160&py=90&fuseMs=200&freeze=3`,
    focus: { x: 40, y: 30, width: 240, height: 110 },
  },
  {
    name: 'card-lug',
    query: `wave=5&start=wave&seen=Shambler,Runner,Exploder&card=1800&god&freeze=2`,
  },
]

const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(viewport.isPhone
      ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { deviceScaleFactor: 3 }),
  })
  return context.newPage()
}

const isPicked = (scene: Scene) => !ONLY || ONLY.includes(scene.name)

const zoomShot = async (page: Page, scene: Scene) => {
  if (!scene.focus) return
  const box = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const rect = canvas?.getBoundingClientRect()
    return rect
      ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      : undefined
  })
  if (!box) return
  const scale = box.width / 320
  await page.screenshot({
    path: `${import.meta.dir}/shots/s32-${TAG}-zoom-${scene.name}.png`,
    clip: {
      x: box.left + scene.focus.x * scale,
      y: box.top + scene.focus.y * scale,
      width: scene.focus.width * scale,
      height: scene.focus.height * scale,
    },
  })
}

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPicked(scene)) continue
    const page = await openPage(browser, viewport)
    const device = viewport.isPhone ? '&device=touch' : ''
    await page.goto(`${BASE}?${scene.query}${device}`)
    await wait(2500)
    await shot(page, `s32-${TAG}-${viewport.name}-${scene.name}`)
    if (!viewport.isPhone) await zoomShot(page, scene)
    await page.context().close()
  }
}
await browser.close()
