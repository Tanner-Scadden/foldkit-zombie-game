// The shop sized to the screen: the shop scenes from shots14.ts, once per tab,
// on four desktop sizes and two landscape phones, as
// `s21-<TAG>-<viewport>-<scene>-<tab>.png`. It prints the computed font sizes
// and the panel's size for each viewport, and any tab whose panel has to
// scroll. `HEIGHTS=1` prints every tab's panel height, and `ONLY` picks
// viewports, such as `ONLY=d1280,p667`.
//   TAG=after bun shots21.ts
import type { Browser, Page } from 'playwright-core'

import { HARNESS, launch, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS
const ONLY = process.env.ONLY?.split(',')
const AT_STALL = 'px=270&py=142'

type Viewport = Readonly<{
  name: string
  width: number
  height: number
  isPhone: boolean
}>

const VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'd1280', width: 1280, height: 720, isPhone: false },
  { name: 'd1440', width: 1440, height: 900, isPhone: false },
  { name: 'd1920', width: 1920, height: 1080, isPhone: false },
  { name: 'd2560', width: 2560, height: 1440, isPhone: false },
  { name: 'p844', width: 844, height: 390, isPhone: true },
  { name: 'p667', width: 667, height: 375, isPhone: true },
].filter(viewport => !ONLY || ONLY.includes(viewport.name))

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'first', query: `wave=2&money=37&${AT_STALL}` },
  {
    name: 'shotgun',
    query: `wave=4&money=70&gun=shotgun&rounds=20&${AT_STALL}`,
  },
  {
    name: 'shotgun1',
    query: `wave=6&money=50&gun=shotgun&tier=1&rounds=20&${AT_STALL}`,
  },
  {
    name: 'smg',
    query: `wave=5&money=180&gun=smg&tier=1&rounds=200&${AT_STALL}`,
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

const overflow = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector('.shop-panel')
    return panel
      ? {
          extra: panel.scrollHeight - panel.clientHeight,
          height: Math.round(panel.getBoundingClientRect().height),
        }
      : { extra: -1, height: 0 }
  })

const measure = (page: Page) =>
  page.evaluate(() => {
    const size = (selector: string) => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).fontSize : '-'
    }
    const panel = document.querySelector('.shop-panel')?.getBoundingClientRect()
    return {
      panel: panel
        ? `${Math.round(panel.width)}x${Math.round(panel.height)} at y ${Math.round(panel.top)}`
        : '-',
      title: size('.shop-title'),
      balance: size('.shop-balance'),
      tab: size('.shop-tab'),
      name: size('.shop-item-heading'),
      blurb: size('.shop-item-blurb'),
      close: size('.shop-close'),
    }
  })

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    const page = await openPage(browser, viewport)
    await page.goto(`${BASE}?${scene.query}`)
    await wait(900)
    if (scene.name === 'first') {
      console.log(viewport.name, JSON.stringify(await measure(page)))
    }
    const tabs = page.getByRole('tab')
    const count = await tabs.count()
    for (let index = 0; index < count; index++) {
      if (index > 0) {
        await tabs.nth(index).click()
        await wait(250)
      }
      const label = (await tabs.nth(index).innerText())
        .split('\n')[0]
        .trim()
        .toLowerCase()
      const name = `s21-${TAG}-${viewport.name}-${scene.name}-${label}`
      await shot(page, name)
      const { extra, height } = await overflow(page)
      if (extra > 0) {
        console.log(`${name} scrolls by ${extra}px`)
      } else if (process.env.HEIGHTS) {
        console.log(`${name} is ${height} of ${viewport.height}px`)
      }
    }
    await page.close()
  }
}
await browser.close()
