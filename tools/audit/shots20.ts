// Wear and the boss: every kind at every wear stage, the boss at its five
// stages, the door preview with the boss marker, the boss entrance band, a
// stomp wind-up with its ring and the boss bar, a belch wind-up, and parts
// flying off under fire, on a desktop and a small landscape phone, as
// `s20-<TAG>-<viewport>-<scene>.png`.
//   TAG=after BASE=http://localhost:4194/ bun shots20.ts
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

const QUIET = 'god&seen=all&px=40&py=160'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wear',
    query: `wave=8&start=wave&elapsed=3000&lineup=wear&${QUIET}&freeze=110`,
  },
  {
    name: 'boss-stages',
    query: `wave=8&start=wave&elapsed=3000&lineup=boss&${QUIET}&freeze=110`,
  },
  { name: 'preview', query: 'wave=8&seen=all&prep=14000&freeze=30' },
  {
    name: 'entrance',
    query: `wave=8&start=wave&boss=arriving&door=East&arriveMs=2000&${QUIET}&freeze=40`,
  },
  {
    name: 'stomp',
    query:
      'wave=8&start=wave&elapsed=3000&boss=stomp&bx=190&by=90&bosshp=0.55&god&seen=all&gun=smg&fill&crowd=8&aim=190,90&freeze=40',
  },
  {
    name: 'belch',
    query:
      'wave=8&start=wave&elapsed=3000&boss=belch&bx=240&by=60&bosshp=0.3&windMs=1000&god&seen=all&gun=smg&px=110&py=120&freeze=48',
  },
  {
    name: 'fire',
    query:
      'wave=8&start=wave&elapsed=3000&boss=fighting&bx=250&by=90&bosshp=0.81&god&seen=all&gun=smg&tier=3&crowd=10&aim=250,90&freeze=70',
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
    await shot(page, `s20-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()
