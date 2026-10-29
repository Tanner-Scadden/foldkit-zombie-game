// The home menu pass: the home menu with and without session bests, How to
// play, Settings, the character picker, the pause screen with MENU, the leave
// question, Game Over and Victory with MENU, on 667x375 and 844x390 phones with
// touch and on 1280x720 with a keyboard, as `s25-<TAG>-<viewport>-<scene>.png`.
// It prints any visible button smaller than 48 px.
//   TAG=after BASE=http://localhost:4174/ bun shots25.ts
// ONLY picks scenes, such as `ONLY=home,leave`.
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

type Scene = Readonly<{ name: string; query: string; openWith?: string }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: 'look=Female,Ponytail,Ginger,Tan,Teal' },
  { name: 'home-bests', query: 'bests' },
  { name: 'home-iphone', query: 'fit=home' },
  { name: 'how-to-play', query: '', openWith: '#home-how-to-play' },
  { name: 'settings', query: 'fit=full', openWith: '#home-settings' },
  { name: 'character', query: '', openWith: '#home-character' },
  { name: 'paused', query: 'wave=3&seen=all&start=wave&phase=paused' },
  {
    name: 'leave',
    query: 'wave=3&seen=all&start=wave&phase=paused',
    openWith: '.pause-menu-button',
  },
  { name: 'gameover', query: 'wave=4&phase=gameover&stats' },
  { name: 'victory', query: 'wave=8&phase=victory&stats' },
]

const MIN_SIDE = 48

const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    ...(viewport.isPhone ? { isMobile: true, hasTouch: true } : {}),
  })
  return context.newPage()
}

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
    if (scene.openWith !== undefined) {
      const box = await page.locator(scene.openWith).boundingBox()
      if (box !== null) {
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        if (viewport.isPhone) {
          await page.touchscreen.tap(x, y)
        } else {
          await page.mouse.click(x, y)
        }
      }
      await wait(600)
    }
    const small = await page.evaluate(minSide => {
      const openDialog = document.querySelector('dialog[open]')
      const scope: ParentNode = openDialog ?? document
      return Array.from(scope.querySelectorAll('button'))
        .filter(button => openDialog !== null || !button.closest('dialog'))
        .map(button => ({
          label:
            button.getAttribute('aria-label') ??
            button.textContent?.trim() ??
            '?',
          box: button.getBoundingClientRect(),
        }))
        .filter(
          ({ box }) =>
            box.width > 0 && (box.width < minSide || box.height < minSide),
        )
        .map(
          ({ label, box }) =>
            `${label} ${Math.round(box.width)}x${Math.round(box.height)}`,
        )
    }, MIN_SIDE)
    const name = `s25-${TAG}-${viewport.name}-${scene.name}`
    await shot(page, name)
    console.log(
      `${name}${small.length > 0 ? `  small: ${small.join(', ')}` : ''}`,
    )
    await page.context().close()
  }
}
await browser.close()
