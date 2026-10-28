// The shop with ammo and upgrades nested under the owned gun: no gun yet, a
// half empty Barn Buster, and a tier 1 Chatterbox, on desktop and two
// landscape phones, once per tab, as `s14-<TAG>-<viewport>-<scene>-<tab>.png`.
// It also prints any tab whose panel has to scroll.
//   TAG=after bun shots14.ts
import type { Browser } from 'playwright-core'

import { HARNESS, launch, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS
const AT_STALL = 'px=270&py=142'

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

const overflow = (page: Awaited<ReturnType<typeof openPage>>) =>
  page.evaluate(() => {
    const panel = document.querySelector('.shop-panel')
    return panel ? panel.scrollHeight - panel.clientHeight : -1
  })

const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    const page = await openPage(browser, viewport)
    await page.goto(`${BASE}?${scene.query}`)
    await wait(900)
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
      const name = `s14-${TAG}-${viewport.name}-${scene.name}-${label}`
      await shot(page, name)
      const extra = await overflow(page)
      if (extra > 0) {
        console.log(`${name} scrolls by ${extra}px`)
      }
    }
    await page.close()
  }
}
await browser.close()
