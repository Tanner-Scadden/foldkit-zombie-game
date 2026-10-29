// The lighter greens, the new Gasbag, frenzy, the Chucker, and the Ankle
// Biter: a lineup of every kind at every wear stage, the Gasbag idle,
// pulsing, blowing with its blast ring, and popping, a crowd of every kind,
// a frenzied pack with its HORDE!
// callout, a Chucker heaving a Groaner and the throw with its landing mark,
// a dazed Groaner, an Ankle Biter breaking through the floor and one on the
// player's ankles, the door preview with its FLOOR count, and the two new
// zombie cards, on a desktop and a small landscape phone, as
// `s27-<TAG>-<viewport>-<scene>.png`.
//   TAG=after BASE=http://localhost:4174/ bun shots27.ts
// ONLY picks scenes by name and BASE points it at another harness port.
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

const STILL = 'wave=6&start=wave&elapsed=3000&god&seen=all'
const PLAYER = 'px=160&py=90'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'lineup',
    query: `${STILL}&lineup=wear&px=160&py=150&freeze=2`,
  },
  {
    name: 'gasbag',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=200&freeze=3`,
  },
  {
    name: 'gasbag-pulse',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=120&freeze=7`,
  },
  {
    name: 'gasbag-pop',
    query: `${STILL}&gasbags&${PLAYER}&fuseMs=20&freeze=8`,
  },
  {
    name: 'crowd',
    query: `${STILL}&crowd=12&frenzy&gasbags&chucker=heft&cx=230&cy=110&crawler=surfacing&wx=128&wy=112&px=150&py=95&freeze=6`,
  },
  {
    name: 'frenzy',
    query: `${STILL}&frenzy&wipe&${PLAYER}&freeze=6`,
  },
  {
    name: 'chucker-heft',
    query: `${STILL}&chucker=heft&cx=220&cy=70&heftMs=500&${PLAYER}&freeze=5`,
  },
  {
    name: 'chucker-throw',
    query: `${STILL}&chucker=throw&cx=240&cy=50&flyMs=420&${PLAYER}&freeze=4`,
  },
  {
    name: 'dazed',
    query: `${STILL}&chucker=dazed&${PLAYER}&freeze=10`,
  },
  {
    name: 'crawler-surfacing',
    query: `${STILL}&crawler=surfacing&wx=128&wy=112&surfMs=300&${PLAYER}&freeze=4`,
  },
  {
    name: 'crawler-cling',
    query: `${STILL}&crawler=cling&${PLAYER}&freeze=4`,
  },
  {
    name: 'preview-floor',
    query: `wave=7&god&seen=Shambler,Runner,Exploder,Tank,Thrower&prep=15000&freeze=30`,
  },
  {
    name: 'card-chucker',
    query: `wave=6&start=wave&seen=Shambler,Runner,Exploder,Tank&card=1800&god&freeze=2`,
  },
  {
    name: 'card-crawler',
    query: `wave=7&start=wave&seen=Shambler,Runner,Exploder,Tank,Thrower&card=1800&god&freeze=2`,
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

const isPicked = (scene: Scene) => !ONLY || ONLY.includes(scene.name)

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPicked(scene)) continue
    const page = await openPage(browser, viewport)
    const device = viewport.isPhone ? '&device=touch' : ''
    await page.goto(`${BASE}?${scene.query}${device}`)
    await wait(2500)
    await shot(page, `s27-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()
