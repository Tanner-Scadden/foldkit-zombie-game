// The Kaboomer and the Big Leaguer: every kind at every wear stage, the
// Kaboomer idle with a long fuse, close with a short one, shot, blowing with
// its ring, the KABOOM, frenzied, a crowd of every kind, the Big Leaguer
// idle, winding up, throwing, taunting, and shielding, and both debut cards,
// on a desktop and a small landscape phone, as
// `s30-<TAG>-<viewport>-<scene>.png`. `ZOOM=1` also writes a 4x crop around
// the action of each desktop scene as `s30-<TAG>-zoom-<scene>.png`.
//   TAG=after BASE=http://localhost:4174/ bun shots29.ts
// ONLY picks scenes by name and BASE points it at another harness port.
import type { Browser } from 'playwright-core'

import { HARNESS, launch, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS
const ONLY = process.env.ONLY?.split(',')
const ZOOM = process.env.ZOOM === '1'

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

type Focus = Readonly<{ x: number; y: number; width: number; height: number }>

type Scene = Readonly<{ name: string; query: string; focus?: Focus }>

const STILL = 'wave=6&start=wave&elapsed=3000&god&seen=all'
const PLAYER = 'px=160&py=90'
const AROUND_GASBAGS: Focus = { x: 40, y: 30, width: 240, height: 110 }

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'lineup',
    query: `${STILL}&lineup=wear&px=160&py=150&freeze=2`,
    focus: { x: 30, y: 30, width: 260, height: 100 },
  },
  {
    name: 'lineup-kaboomer',
    query: `${STILL}&lineup=wear&px=160&py=150&freeze=2`,
    focus: { x: 34, y: 70, width: 100, height: 36 },
  },
  {
    name: 'kaboomer',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=200&freeze=3`,
    focus: AROUND_GASBAGS,
  },
  {
    name: 'kaboomer-walk',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=200&freeze=17`,
    focus: AROUND_GASBAGS,
  },
  {
    name: 'kaboomer-blowing',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=120&freeze=7`,
    focus: AROUND_GASBAGS,
  },
  {
    name: 'kaboomer-pop',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=20&freeze=3`,
    focus: AROUND_GASBAGS,
  },
  {
    name: 'kaboomer-pop-late',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=20&freeze=10`,
    focus: AROUND_GASBAGS,
  },
  {
    name: 'frenzy',
    query: `${STILL}&frenzy&wipe&${PLAYER}&freeze=6`,
    focus: { x: 20, y: 50, width: 200, height: 90 },
  },
  {
    name: 'crowd',
    query: `${STILL}&crowd=12&frenzy&gasbags&chucker=heft&cx=230&cy=110&crawler=surfacing&wx=128&wy=112&px=150&py=95&freeze=6`,
  },
  {
    name: 'gasroom',
    query: `wave=6&start=wave&god&gun=smg&fill&gasroom=10&freeze=40`,
  },
  {
    name: 'lineup-leaguer',
    query: `${STILL}&lineup=wear&px=160&py=150&freeze=2`,
    focus: { x: 165, y: 70, width: 100, height: 40 },
  },
  {
    name: 'leaguer-walk',
    query: `${STILL}&lineup=wear&px=160&py=150&freeze=9`,
    focus: { x: 165, y: 70, width: 100, height: 40 },
  },
  {
    name: 'leaguer-windup',
    query: `${STILL}&chucker=heft&cx=220&cy=80&heftMs=500&${PLAYER}&freeze=5`,
    focus: { x: 170, y: 30, width: 100, height: 60 },
  },
  {
    name: 'leaguer-throw',
    query: `${STILL}&chucker=throw&cx=240&cy=60&flyMs=420&${PLAYER}&freeze=4`,
    focus: { x: 140, y: 20, width: 130, height: 80 },
  },
  {
    name: 'leaguer-taunt',
    query: `${STILL}&chucker=taunt&cx=220&cy=80&${PLAYER}&freeze=3`,
    focus: { x: 170, y: 50, width: 100, height: 50 },
  },
  {
    name: 'leaguer-shield',
    query: `${STILL}&chucker=shield&cx=200&cy=80&${PLAYER}&freeze=5`,
    focus: { x: 140, y: 50, width: 100, height: 50 },
  },
  {
    name: 'leaguer-shield-side',
    query: `${STILL}&chucker=shield&cx=200&cy=80&px=200&py=140&freeze=5`,
    focus: { x: 150, y: 50, width: 100, height: 100 },
  },
  {
    name: 'card-leaguer',
    query: `wave=6&start=wave&seen=Shambler,Runner,Exploder,Tank&card=1800&god&freeze=2`,
  },
  {
    name: 'card-kaboomer',
    query: `wave=4&start=wave&seen=Shambler,Runner&card=1800&god&freeze=2`,
  },
  {
    name: 'preview-kaboomer',
    query: `wave=4&god&seen=Shambler,Runner&prep=15000&freeze=30`,
  },
]

const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(viewport.isPhone
      ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { deviceScaleFactor: ZOOM ? 3 : 1 }),
  })
  return context.newPage()
}

const isPicked = (scene: Scene) => !ONLY || ONLY.includes(scene.name)

const zoomShot = async (
  page: Awaited<ReturnType<typeof openPage>>,
  scene: Scene,
) => {
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
    path: `${import.meta.dir}/shots/s30-${TAG}-zoom-${scene.name}.png`,
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
    await shot(page, `s30-${TAG}-${viewport.name}-${scene.name}`)
    if (ZOOM && !viewport.isPhone) await zoomShot(page, scene)
    await page.context().close()
  }
}
await browser.close()
