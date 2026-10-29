// Uncle Chunk's far attacks: a charge wind-up with its lane on the floor, the
// rush, a spit glob in the air with its landing mark and puddles, the player
// standing in a puddle, the dazed stars after a wall bonk, and the enraged
// look with ENRAGED on his bar, plus the entrance band clear of the money
// counter, on a desktop and a small landscape phone, as
// `s24-<TAG>-<viewport>-<scene>.png`.
//   TAG=after BASE=http://localhost:4174/ bun shots24.ts
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

const FIGHT = 'wave=8&start=wave&elapsed=3000&god&seen=all&gun=smg'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'charge-windup',
    query: `${FIGHT}&boss=charge&bx=240&by=70&tx=120&ty=125&px=120&py=125&windMs=500&crowd=5&aim=240,70&freeze=12`,
  },
  {
    name: 'rush',
    query: `${FIGHT}&boss=rush&bx=236&by=72&tx=120&ty=125&px=100&py=150&crowd=5&freeze=8`,
  },
  {
    name: 'glob',
    query: `${FIGHT}&boss=spit&bx=240&by=70&tx=120&ty=120&px=128&py=124&globMs=700&puddles=90,60;200,140&puddleMs=4000&freeze=14`,
  },
  {
    name: 'puddle',
    query: `${FIGHT}&boss=fighting&bx=250&by=60&px=120&py=120&puddles=120,120&puddleMs=4000&freeze=6`,
  },
  {
    name: 'dazed',
    query: `${FIGHT}&boss=dazed&bx=100&by=40&windMs=1500&enraged&bosshp=0.3&px=150&py=110&freeze=20`,
  },
  {
    name: 'enraged',
    query: `${FIGHT}&boss=fighting&enraged&bosshp=0.3&bx=230&by=80&px=120&py=110&crowd=6&freeze=40`,
  },
  {
    name: 'entrance',
    query: `wave=8&start=wave&boss=arriving&door=East&arriveMs=2000&god&seen=all&px=160&py=150&freeze=40`,
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
    await shot(page, `s24-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()
