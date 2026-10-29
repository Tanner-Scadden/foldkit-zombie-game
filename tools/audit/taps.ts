// Taps every visible button on the home menu (with the full screen icon, the
// update chip, and a NEW ENTRY pop too), What's New, the Munchopedia list and
// an entry, the difficulty picker, its other panels, the pause screen,
// the character picker, the leave question, the gun cluster in a wave and a
// break, Game Over, and Victory on
// 667x375 and 844x390 phones, or with PORTRAIT=1 on 390x844, 430x932, and
// 360x800 phones held upright, with touch. For each button it checks that the center and four points just
// inside its edges hit that button (document.elementFromPoint), then taps the
// center and a corner for real and checks that exactly one Message names the
// tap, and that it is not a press on the game surface. Exits with 1 on any
// miss.
//   BASE=http://localhost:4174/ bun taps.ts
//   PORTRAIT=1 BASE=http://localhost:4174/ bun taps.ts
// ONLY picks scenes, such as `ONLY=home,munchopedia`.
import type { Page } from 'playwright-core'

import { HARNESS, launch, wait } from './lib'

const BASE = process.env.BASE ?? HARNESS
const ONLY = process.env.ONLY?.split(',')

type Viewport = Readonly<{ name: string; width: number; height: number }>

const LANDSCAPE: ReadonlyArray<Viewport> = [
  { name: 'p667', width: 667, height: 375 },
  { name: 'p844', width: 844, height: 390 },
]

const PORTRAIT: ReadonlyArray<Viewport> = [
  { name: 'u390', width: 390, height: 844 },
  { name: 'u430', width: 430, height: 932 },
  { name: 'u360', width: 360, height: 800 },
]

const VIEWPORTS = process.env.PORTRAIT === undefined ? LANDSCAPE : PORTRAIT

type Scene = Readonly<{
  name: string
  query: string
  openWith?: string
  thenOpen?: string
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: '' },
  {
    name: 'home-full',
    query: 'fit=full&kills=Runner:3&newentries=Runner',
  },
  { name: 'home-iphone', query: 'fit=home' },
  { name: 'whats-new', query: '', openWith: '#home-whats-new' },
  {
    name: 'whats-new-older',
    query: '',
    openWith: '#home-whats-new',
    thenOpen: '.news-page',
  },
  {
    name: 'munchopedia',
    query: 'kills=Shambler:40,Runner:3',
    openWith: '#home-munchopedia',
  },
  {
    name: 'munchopedia-entry',
    query: 'kills=Shambler:40,Runner:3',
    openWith: '#home-munchopedia',
    thenOpen: '.munch-tile',
  },
  { name: 'difficulty', query: '', openWith: '.home-difficulty' },
  { name: 'how-to-play', query: '', openWith: '#home-how-to-play' },
  { name: 'settings', query: 'fit=full', openWith: '#home-settings' },
  { name: 'character', query: '', openWith: '#home-character' },
  { name: 'paused', query: 'wave=3&seen=all&start=wave&phase=paused' },
  {
    name: 'leave',
    query: 'wave=3&seen=all&start=wave&phase=paused',
    openWith: '.pause-menu-button',
  },
  {
    name: 'wave-lowammo',
    query: 'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9',
  },
  {
    name: 'break-lowammo',
    query: 'wave=3&seen=all&gun=smg&loaded=9&barricades=1&turrets=1',
  },
  { name: 'gameover', query: 'wave=4&phase=gameover&stats' },
  { name: 'victory', query: 'wave=8&phase=victory&stats' },
]

type Point = Readonly<{ x: number; y: number }>
type Target = Readonly<{
  label: string
  index: number
  center: Point
  points: ReadonlyArray<Readonly<{ name: string; point: Point }>>
  width: number
  height: number
}>

const EDGE_INSET = 2
const MIN_SIDE = 48
const SETTLE_MS = 1100
const AFTER_TAP_MS = 250

const surfaceTags = new Set(['PressedPointer'])

const TAP_LEAVES =
  /(^|:)(Clicked\w*|SelectedOption|RequestedClose|PressedPointer)$/

const isTapMessage = (tag: string): boolean => TAP_LEAVES.test(tag)

const openScene = async (page: Page, scene: Scene) => {
  await page.goto(`${BASE}?${scene.query}&device=touch`)
  await wait(SETTLE_MS)
  if (scene.openWith !== undefined) {
    const box = await page.locator(scene.openWith).boundingBox()
    if (box === null) {
      throw new Error(`${scene.name}: nothing to open with ${scene.openWith}`)
    }
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await wait(500)
  }
  if (scene.thenOpen !== undefined) {
    const box = await page.locator(scene.thenOpen).first().boundingBox()
    if (box === null) {
      throw new Error(`${scene.name}: nothing to open with ${scene.thenOpen}`)
    }
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await wait(400)
  }
}

const visibleTargets = (page: Page): Promise<ReadonlyArray<Target>> =>
  page.evaluate(inset => {
    const openDialog = document.querySelector('dialog[open]')
    const scope: ParentNode = openDialog ?? document
    return Array.from(scope.querySelectorAll('button'))
      .map((button, index) => ({ button, index }))
      .filter(({ button }) => {
        const box = button.getBoundingClientRect()
        const style = getComputedStyle(button)
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          (openDialog !== null || button.closest('dialog') === null)
        )
      })
      .map(({ button, index }) => {
        const box = button.getBoundingClientRect()
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        return {
          label:
            button.getAttribute('aria-label') ??
            button.textContent?.trim() ??
            '?',
          index,
          center,
          width: box.width,
          height: box.height,
          points: [
            { name: 'center', point: center },
            { name: 'left', point: { x: box.left + inset, y: center.y } },
            { name: 'right', point: { x: box.right - inset, y: center.y } },
            { name: 'top', point: { x: center.x, y: box.top + inset } },
            { name: 'bottom', point: { x: center.x, y: box.bottom - inset } },
            {
              name: 'corner',
              point: { x: box.left + inset * 4, y: box.top + inset * 4 },
            },
          ],
        }
      })
  }, EDGE_INSET)

const hitsButton = (
  page: Page,
  target: Target,
  point: Point,
  hasDialog: boolean,
) =>
  page.evaluate(
    ({ index, point: { x, y }, hasDialog }) => {
      const scope: ParentNode = hasDialog
        ? (document.querySelector('dialog[open]') ?? document)
        : document
      const button = scope.querySelectorAll('button')[index]
      const hit = document.elementFromPoint(x, y)
      return button !== undefined && hit !== null && button.contains(hit)
    },
    {
      index: target.index,
      point,
      hasDialog,
    },
  )

const failures: Array<string> = []
const browser = await launch()
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (ONLY && !ONLY.includes(scene.name)) {
      continue
    }
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    })
    // NOTE: a tap can write the save, such as PLAY dismissing the iPhone
    // tip, so every reopen starts from no save and shows the same scene.
    await context.addInitScript(() => localStorage.clear())
    const page = await context.newPage()
    await openScene(page, scene)
    const hasDialog = scene.openWith !== undefined
    const targets = await visibleTargets(page)
    const where = `${viewport.name} ${scene.name}`
    if (targets.length === 0) {
      failures.push(`${where}: no buttons`)
    }
    for (const target of targets) {
      if (target.width < MIN_SIDE || target.height < MIN_SIDE) {
        failures.push(
          `${where} "${target.label}": ${Math.round(target.width)}x${Math.round(target.height)} is under ${MIN_SIDE} px`,
        )
      }
      for (const { name, point } of target.points) {
        if (!(await hitsButton(page, target, point, hasDialog))) {
          failures.push(`${where} "${target.label}": the ${name} misses it`)
        }
      }
    }
    for (const target of targets) {
      for (const { name, point } of target.points.filter(
        ({ name }) => name === 'center' || name === 'corner',
      )) {
        await openScene(page, scene)
        await page.evaluate(() => {
          ;(window as any).__messages.length = 0
        })
        await page.touchscreen.tap(point.x, point.y)
        await wait(AFTER_TAP_MS)
        const tags: ReadonlyArray<string> = await page.evaluate(() => [
          ...(window as any).__messages,
        ])
        const tapTags = tags.filter(isTapMessage)
        const reachedSurface = tags.some(tag => surfaceTags.has(tag))
        const isOk = tapTags.length === 1 && !reachedSurface
        console.log(
          `${isOk ? 'ok  ' : 'FAIL'} ${where} "${target.label}" ${name}: ${tapTags.join(', ') || '(nothing)'}`,
        )
        if (!isOk) {
          failures.push(
            `${where} "${target.label}" ${name} tap sent ${tags.join(', ') || 'nothing'}`,
          )
        }
      }
    }
    await context.close()
  }
}
await browser.close()

if (failures.length > 0) {
  console.log(`\n${failures.length} problems:\n${failures.join('\n')}`)
  process.exit(1)
} else {
  console.log('\nEvery tap landed on its button and sent one Message.')
}
