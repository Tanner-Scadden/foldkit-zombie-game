// Difficulty levels and planks as bait, as `s29-<TAG>-<viewport>-<scene>.png`.
//
// Shoots the first-time difficulty card with Nightmare locked and unlocked,
// SETTINGS with the difficulty row, Groaners and a Big Lug chewing a Plank
// Pile, the two-plank cap notice, and Game Over and Victory naming the
// difficulty, on 667x375, 844x390, and 1280x720. It prints any panel that
// has to scroll.
//   TAG=after BASE=http://localhost:4174/ bun shots29.ts
import type { Browser, Page } from 'playwright-core'

import { HARNESS, launch, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS
const ONLY = process.env.ONLY?.split(',')

type Viewport = Readonly<{
  name: string
  width: number
  height: number
  scale: number
  isPhone: boolean
}>

const VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'p667', width: 667, height: 375, scale: 2, isPhone: true },
  { name: 'p844', width: 844, height: 390, scale: 3, isPhone: true },
  { name: 'd1280', width: 1280, height: 720, scale: 1, isPhone: false },
]

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page) => Promise<void>
  waitMs?: number
}>

const clickHome = (id: string) => async (page: Page) => {
  await page.click(`#${id}`)
  await wait(500)
}

const SCENES: ReadonlyArray<Scene> = [
  { name: 'card-locked', query: 'ask', act: clickHome('home-play') },
  {
    name: 'card-unlocked',
    query: 'ask&difficulty=Hard&nightmare=JustUnlocked',
    act: clickHome('home-play'),
  },
  { name: 'settings', query: 'fit=full', act: clickHome('home-settings') },
  {
    name: 'settings-nightmare',
    query: 'difficulty=Nightmare&nightmare=Unlocked',
    act: clickHome('home-settings'),
  },
  {
    name: 'chewing',
    query:
      'wave=4&start=wave&elapsed=1&planks=West,North&chewers=4&px=230&py=110&god',
    waitMs: 1800,
  },
  {
    name: 'plank-cap',
    query: 'wave=3&planks=West,South&barricades=1&px=300&py=90',
    act: async page => {
      await page.keyboard.press('KeyT')
      await wait(250)
    },
  },
  {
    name: 'gameover-hard',
    query: 'wave=4&phase=gameover&stats&difficulty=Hard',
  },
  {
    name: 'victory-unlock',
    query: 'wave=8&phase=victory&stats&difficulty=Hard&nightmare=JustUnlocked',
  },
]

const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    ...(viewport.isPhone ? { isMobile: true, hasTouch: true } : {}),
  })
  return context.newPage()
}

const main = async () => {
  const browser = await launch()
  for (const viewport of VIEWPORTS) {
    for (const scene of SCENES) {
      if (ONLY && !ONLY.includes(scene.name)) {
        continue
      }
      const page = await openPage(browser, viewport)
      const device = viewport.isPhone ? '&device=touch' : ''
      await page.goto(`${BASE}?${scene.query}${device}`)
      await wait(1200)
      if (scene.act) {
        await scene.act(page)
      }
      await wait(scene.waitMs ?? 400)
      const report = await page.evaluate(() => {
        const panel = document.querySelector('.panel')
        return panel === null
          ? 'no panel'
          : `panel ${panel.clientHeight}/${panel.scrollHeight}${
              panel.scrollHeight > panel.clientHeight + 1 ? ' SCROLLS' : ''
            }`
      })
      console.log(`${viewport.name} ${scene.name}: ${report}`)
      await shot(page, `s29-${TAG}-${viewport.name}-${scene.name}`)
      await page.context().close()
    }
  }
  await browser.close()
}

await main()
