// The portrait pass: a wave, a break with the door preview, the shop, the
// home menu, the boss fight, pause, Game Over, and the menu panels, on three
// portrait phones (390x844, 430x932, 360x800) and a landscape one (844x390),
// all with touch, as `s34-<TAG>-<viewport>-<scene>.png`. For every visible
// button it checks that it is at least 48 px and that its center hits it, and
// it checks that the page and the open dialog do not scroll. Exits with 1 on
// any problem.
//   TAG=after BASE=http://localhost:4174/ bun shots34.ts
// ONLY picks scenes, such as `ONLY=wave,break`, and VIEWPORTS picks phones,
// such as `VIEWPORTS=p390,l844`.
import type { Browser, Page } from 'playwright-core'

import { HARNESS, launch, shot, wait } from './lib'

const TAG = process.env.TAG ?? 'after'
const BASE = process.env.BASE ?? HARNESS
const ONLY = process.env.ONLY?.split(',')
const PICKED = process.env.VIEWPORTS?.split(',')

type Viewport = Readonly<{
  name: string
  width: number
  height: number
  scale: number
}>

const VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'p390', width: 390, height: 844, scale: 3 },
  { name: 'p430', width: 430, height: 932, scale: 3 },
  { name: 'p360', width: 360, height: 800, scale: 3 },
  { name: 'l844', width: 844, height: 390, scale: 3 },
]

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page) => Promise<void>
}>

const clickButton = (name: RegExp) => async (page: Page) => {
  await page.getByRole('button', { name }).first().click()
  await wait(500)
}

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wave',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&crowd=10&tough&px=150&py=110&aim=250,90',
  },
  {
    name: 'lowammo',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9&boosts=RapidFire,Damage,Speed,Pierce&px=60&py=110',
  },
  {
    name: 'break',
    query:
      'wave=3&seen=all&gun=smg&money=120&barricades=1&turrets=1&px=60&py=100',
  },
  {
    name: 'breakright',
    query: 'wave=7&seen=all&gun=smg&money=120&px=280&py=60',
  },
  {
    name: 'firstbreak',
    query: 'wave=2&seen=all&money=45&barricades=1&break=open&px=200&py=40',
  },
  { name: 'shop', query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142' },
  { name: 'home', query: '' },
  {
    name: 'bests',
    query: 'bests&kills=Shambler:40,Runner:12&newentries=Runner',
  },
  {
    name: 'boss',
    query:
      'wave=8&seen=all&start=wave&elapsed=9000&boss=stomp&windMs=500&bx=200&by=80&px=150&py=120',
  },
  {
    name: 'card',
    query: 'wave=2&start=wave&seen=Shambler&card=2000',
  },
  { name: 'pause', query: 'wave=3&seen=all&start=wave&phase=paused' },
  { name: 'gameover', query: 'wave=5&phase=gameover&stats' },
  { name: 'victory', query: 'wave=8&phase=victory&stats' },
  { name: 'whatsnew', query: '', act: clickButton(/what's new/i) },
  {
    name: 'munchopedia',
    query: 'kills=Shambler:40,Runner:12',
    act: clickButton(/munchopedia/i),
  },
  { name: 'character', query: '', act: clickButton(/^character/i) },
  { name: 'howto', query: '', act: clickButton(/how to play/i) },
  { name: 'settings', query: '', act: clickButton(/settings/i) },
  { name: 'difficulty', query: '', act: clickButton(/difficulty/i) },
]

const MIN_SIDE = 48

const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    isMobile: true,
    hasTouch: true,
  })
  return context.newPage()
}

const problems: Array<string> = []
const browser = await launch()
for (const viewport of VIEWPORTS) {
  if (PICKED && !PICKED.includes(viewport.name)) {
    continue
  }
  for (const scene of SCENES) {
    if (ONLY && !ONLY.includes(scene.name)) {
      continue
    }
    const page = await openPage(browser, viewport)
    const separator = scene.query === '' ? '' : '&'
    await page.goto(`${BASE}?${scene.query}${separator}device=touch`)
    await wait(1200)
    if (scene.act) {
      await scene.act(page)
    }
    const report = await page.evaluate(() => {
      const isShown = (element: Element) => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          box.width > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        )
      }
      const isInScroller = (element: Element): boolean => {
        const parent = element.parentElement
        if (parent === null) {
          return false
        }
        const overflow = getComputedStyle(parent).overflowY
        return (
          ((overflow === 'auto' || overflow === 'scroll') &&
            parent.scrollHeight > parent.clientHeight) ||
          isInScroller(parent)
        )
      }
      const openDialog = document.querySelector('dialog[open]')
      const buttons = Array.from(document.querySelectorAll('button'))
        .filter(isShown)
        .filter(button =>
          openDialog === null
            ? button.closest('dialog') === null
            : openDialog.contains(button),
        )
        .map(button => {
          const box = button.getBoundingClientRect()
          const hit = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          )
          return {
            name: (button.getAttribute('aria-label') ?? button.innerText)
              .replace(/\s+/g, ' ')
              .slice(0, 40),
            width: Math.round(box.width),
            height: Math.round(box.height),
            isHit:
              (hit !== null && button.contains(hit)) ||
              (isInScroller(button) && (box.bottom > innerHeight || box.y < 0)),
            isOnScreen:
              isInScroller(button) ||
              (box.x >= -1 &&
                box.y >= -1 &&
                box.right <= innerWidth + 1 &&
                box.bottom <= innerHeight + 1),
          }
        })
      const scroller = document.scrollingElement!
      const pageScrolls = scroller.scrollHeight > innerHeight + 1
      const panels = Array.from(
        document.querySelectorAll('dialog[open], dialog[open] > *'),
      ).filter(element => {
        const box = element.getBoundingClientRect()
        return box.bottom > innerHeight + 1 || box.right > innerWidth + 1
      })
      return {
        buttons,
        pageScrolls,
        offScreen: panels.length,
        layout:
          document.querySelector('.game-root')?.getAttribute('data-layout') ??
          '',
      }
    })
    await shot(page, `s34-${TAG}-${viewport.name}-${scene.name}`)
    const where = `${viewport.name} ${scene.name}`
    console.log(
      `${where} (${report.layout}): ${report.buttons.length} buttons${report.pageScrolls ? ', PAGE SCROLLS' : ''}`,
    )
    if (report.pageScrolls) {
      problems.push(`${where}: the page scrolls`)
    }
    if (report.offScreen > 0) {
      problems.push(`${where}: ${report.offScreen} dialog parts off screen`)
    }
    for (const button of report.buttons) {
      if (button.width < MIN_SIDE || button.height < MIN_SIDE) {
        problems.push(
          `${where}: "${button.name}" is ${button.width}x${button.height}`,
        )
      }
      if (!button.isHit) {
        problems.push(`${where}: "${button.name}" is covered at its center`)
      }
      if (!button.isOnScreen) {
        problems.push(`${where}: "${button.name}" is off screen`)
      }
    }
    await page.context().close()
  }
}
await browser.close()

if (problems.length > 0) {
  console.log(`\n${problems.length} problems:`)
  for (const problem of problems) {
    console.log(`  ${problem}`)
  }
  process.exit(1)
}
console.log('\nno problems')
