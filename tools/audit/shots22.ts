// The character picker and the looks it makes: the title with the CHARACTER
// button, the picker with the classic look and with a picked one, Game Over
// and Victory with the button, four characters fighting a wave, and a sheet of every
// body, hair style, hair color, and skin tone, on a desktop and two landscape
// phones, as `s22-<TAG>-<viewport>-<scene>.png`.
//   TAG=after BASE=http://localhost:4174/ bun shots22.ts
// ONLY picks scenes by name and BASE points it at another harness port. It
// prints any picker panel that has to scroll.
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

type Scene = Readonly<{ name: string; query: string; isDesktopOnly?: boolean }>

const FIGHT =
  'wave=3&start=wave&elapsed=3000&god&seen=all&crowd=6&px=110&py=70&aim=250,120&freeze=70'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'title', query: '' },
  { name: 'picker', query: 'picker' },
  {
    name: 'picker-picked',
    query: 'picker&look=Female,Ponytail,Ginger,Tan,Teal',
  },
  { name: 'gameover', query: 'wave=4&phase=gameover' },
  { name: 'victory', query: 'wave=8&phase=victory' },
  {
    name: 'wave-female-long',
    query: `${FIGHT}&look=Female,Long,Black,Deep,Yellow`,
  },
  {
    name: 'wave-female-crop',
    query: `${FIGHT}&look=Female,Crop,Blonde,Fair,Purple`,
  },
  {
    name: 'wave-male-curls',
    query: `${FIGHT}&look=Male,Curls,Black,Brown,Red`,
  },
  {
    name: 'wave-male-ponytail',
    query: `${FIGHT}&look=Male,Ponytail,Pink,Medium,Pink`,
  },
  { name: 'looks', query: 'looksheet', isDesktopOnly: true },
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
    if (!isPicked(scene) || (scene.isDesktopOnly && viewport.isPhone)) continue
    const page = await openPage(
      browser,
      scene.isDesktopOnly
        ? { ...viewport, width: 1640, height: 900 }
        : viewport,
    )
    const device = viewport.isPhone ? '&device=touch' : ''
    await page.goto(`${BASE}?${scene.query}${device}`)
    await wait(2500)
    const scrolls = await page.evaluate(() => {
      const panel = document.querySelector('.look-panel')
      return panel !== null && panel.scrollHeight > panel.clientHeight + 1
    })
    if (scrolls)
      console.log(`${viewport.name} ${scene.name}: the picker scrolls`)
    await shot(page, `s22-${TAG}-${viewport.name}-${scene.name}`)
    await page.context().close()
  }
}
await browser.close()
