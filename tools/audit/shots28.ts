// The update waits on the home menu, as `s28-<TAG>-<viewport>-<scene>.png`.
//
// Shoots Game Over and Victory with and without a newer build, and the home
// menu with the chip, on 667x375, 844x390, and 1280x720. It prints the end
// screen buttons in order, the note, and whether the chip shows.
//   TAG=after BASE=http://localhost:4174/ bun shots28.ts
import type { Browser } from 'playwright-core'

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

type Scene = Readonly<{ name: string; query: string }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'gameover', query: 'wave=4&phase=gameover&stats' },
  { name: 'gameover-update', query: 'wave=4&phase=gameover&stats&newer=next' },
  { name: 'victory', query: 'wave=8&phase=victory&stats' },
  { name: 'victory-update', query: 'wave=8&phase=victory&stats&newer=next' },
  { name: 'home-update', query: 'newer=next' },
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
      await wait(1500)
      const report = await page.evaluate(() => ({
        buttons: Array.from(
          document.querySelectorAll('.mode-choice .mode-button-label'),
        ).map(label => label.textContent),
        note: document.querySelector('.mode-choice-note')?.textContent,
        hasChip: document.querySelector('.update-chip') !== null,
        focused: document.activeElement?.id,
      }))
      console.log(
        `${viewport.name} ${scene.name}: [${report.buttons.join(', ')}]${
          report.note === undefined ? '' : ` note "${report.note}"`
        } chip ${report.hasChip ? 'yes' : 'no'} focus ${report.focused || '-'}`,
      )
      await shot(page, `s28-${TAG}-${viewport.name}-${scene.name}`)
      await page.context().close()
    }
  }
  await browser.close()
}

await main()
