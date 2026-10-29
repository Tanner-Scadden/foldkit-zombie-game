// The fixed home layout pass: the home menu fresh (dots on What's New and
// the Munchopedia), with bests, a NEW ENTRY pop, the update chip, and full
// screen, in Endless, What's New and an older day, the Munchopedia empty and
// half found, an unlocked, a locked, and Uncle Chunk's entry, the difficulty
// picker from the badge, and Game Over with a NEW ENTRY notice, on 667x375
// and 844x390 phones with touch and on 1280x720 and 1920x1080 with a
// keyboard, as `s33-<TAG>-<viewport>-<scene>.png`. On a keyboard it also
// walks the arrow keys from PLAY and shoots each focused button as
// `s33-<TAG>-<viewport>-focus-<n>.png`.
// It prints any visible button smaller than 48 px on a phone, any two home
// buttons that overlap, any panel or page that scrolls, and whether PLAY sits
// in the same box in both modes. Exits with 1 on a problem.
//   TAG=after BASE=http://localhost:4174/ bun shots33.ts
// ONLY picks scenes, such as `ONLY=home,munchopedia`.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  DESKTOP_1920,
  PHONE_667,
  PHONE_844,
  type Viewport,
  deviceQuery,
  finish,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  shot,
  tagOr,
  wait,
} from './lib'

const TAG = tagOr('after')

const VIEWPORTS: ReadonlyArray<Viewport> = [
  PHONE_667,
  { ...PHONE_844, scale: 2 },
  DESKTOP_1280,
  DESKTOP_1920,
]

const FOUND =
  'bests&kills=Shambler:1203,Runner:140,Tank:12,Exploder:9,Thrower:3,Boss:2&opened=Shambler,Tank'

type Scene = Readonly<{
  name: string
  query: string
  open?: ReadonlyArray<string>
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: '' },
  {
    name: 'home-found',
    query: `${FOUND}&newentries=Thrower&fit=full&newer&newsseen`,
  },
  { name: 'home-endless', query: `${FOUND}&homemode=endless&newsseen` },
  { name: 'whats-new', query: '', open: ['#home-whats-new'] },
  {
    name: 'whats-new-older',
    query: '',
    open: ['#home-whats-new', '.news-page'],
  },
  { name: 'munchopedia-empty', query: '', open: ['#home-munchopedia'] },
  { name: 'munchopedia', query: FOUND, open: ['#home-munchopedia'] },
  {
    name: 'entry-unlocked',
    query: FOUND,
    open: ['#home-munchopedia', '.munch-tile >> nth=0'],
  },
  {
    name: 'entry-locked',
    query: FOUND,
    open: ['#home-munchopedia', '.munch-tile >> nth=5'],
  },
  {
    name: 'entry-boss',
    query: FOUND,
    open: ['#home-munchopedia', '.munch-tile >> nth=6'],
  },
  { name: 'difficulty', query: '', open: ['.home-difficulty'] },
  {
    name: 'gameover-new-entry',
    query: 'wave=7&phase=gameover&stats&newentries=Crawler,Thrower',
  },
]

const MIN_SIDE = 48

const problems: Array<string> = []

const press = async (page: Page, viewport: Viewport, selector: string) => {
  const box = await page.locator(selector).first().boundingBox()
  if (box === null) {
    problems.push(`nothing to open with ${selector}`)
    return
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (viewport.isPhone) {
    await page.touchscreen.tap(x, y)
  } else {
    await page.mouse.click(x, y)
  }
  await wait(500)
}

const check = (page: Page, minSide: number, isPhone: boolean) =>
  page.evaluate(
    ({ minSide, isPhone }) => {
      const openDialog = document.querySelector('dialog[open]')
      const scope: ParentNode = openDialog ?? document
      const buttons = Array.from(scope.querySelectorAll('button'))
        .filter(button => openDialog !== null || !button.closest('dialog'))
        .map(button => ({
          label:
            button.getAttribute('aria-label') ??
            button.textContent?.trim() ??
            '?',
          box: button.getBoundingClientRect(),
        }))
        .filter(({ box }) => box.width > 0 && box.height > 0)
      const small = isPhone
        ? buttons
            .filter(
              ({ box }) =>
                box.width < minSide - 0.5 || box.height < minSide - 0.5,
            )
            .map(
              ({ label, box }) =>
                `${label} ${Math.round(box.width)}x${Math.round(box.height)}`,
            )
        : []
      const overlaps =
        openDialog === null
          ? buttons.flatMap((first, index) =>
              buttons
                .slice(index + 1)
                .filter(
                  second =>
                    first.box.left < second.box.right - 1 &&
                    second.box.left < first.box.right - 1 &&
                    first.box.top < second.box.bottom - 1 &&
                    second.box.top < first.box.bottom - 1,
                )
                .map(second => `${first.label} / ${second.label}`),
            )
          : []
      const panel = document.querySelector('dialog[open] .panel')
      const panelScroll =
        panel === null ? 0 : panel.scrollHeight - panel.clientHeight
      const pageScroll =
        document.documentElement.scrollHeight - window.innerHeight
      const play = document.querySelector('#home-play')?.getBoundingClientRect()
      return {
        small,
        overlaps,
        panelScroll,
        pageScroll,
        play:
          play === undefined
            ? 'none'
            : `${Math.round(play.x)},${Math.round(play.y)} ${Math.round(play.width)}x${Math.round(play.height)}`,
      }
    },
    { minSide, isPhone },
  )

const browser = await launch()
for (const viewport of VIEWPORTS) {
  const playBoxes = new Map<string, string>()
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await openPage(browser, viewport)
    await page.goto(harnessUrl(scene.query, deviceQuery(viewport)))
    await wait(1200)
    for (const selector of scene.open ?? []) {
      await press(page, viewport, selector)
    }
    const found = await check(page, MIN_SIDE, viewport.isPhone)
    const name = `s33-${TAG}-${viewport.name}-${scene.name}`
    await shot(page, name)
    playBoxes.set(scene.name, found.play)
    const notes = [
      found.small.length > 0 ? `small: ${found.small.join(', ')}` : '',
      found.overlaps.length > 0 ? `overlap: ${found.overlaps.join('; ')}` : '',
      found.panelScroll > 0 ? `panel scrolls ${found.panelScroll}px` : '',
      found.pageScroll > 0 ? `PAGE SCROLLS ${found.pageScroll}px` : '',
    ].filter(Boolean)
    console.log(`${name}  play ${found.play}  ${notes.join('  ')}`)
    if (found.small.length > 0 || found.overlaps.length > 0) {
      problems.push(`${name}: ${notes.join('  ')}`)
    }
    if (found.pageScroll > 0) {
      problems.push(`${name}: the page scrolls`)
    }
    if (scene.name.startsWith('munchopedia') && found.panelScroll > 0) {
      problems.push(`${name}: the Munchopedia panel scrolls`)
    }
    await page.context().close()
  }
  const campaignPlay = playBoxes.get('home-found')
  const endlessPlay = playBoxes.get('home-endless')
  if (campaignPlay !== undefined && endlessPlay !== undefined) {
    const same = campaignPlay === endlessPlay
    console.log(
      `${viewport.name} PLAY campaign ${campaignPlay}, endless ${endlessPlay}: ${same ? 'same box' : 'MOVED'}`,
    )
    if (!same) {
      problems.push(`${viewport.name}: PLAY moves when the mode switches`)
    }
  }
  if (!viewport.isPhone && isPickedScene('focus')) {
    const page = await openPage(browser, viewport)
    await page.goto(harnessUrl(FOUND, 'newsseen'))
    await wait(1200)
    const order: Array<string> = []
    for (let step = 1; step <= 8; step++) {
      await page.keyboard.press('ArrowDown')
      await wait(250)
      order.push(
        await page.evaluate(() => document.activeElement?.id ?? '(none)'),
      )
      await shot(page, `s33-${TAG}-${viewport.name}-focus-${step}`)
    }
    const tabOrder: Array<string> = []
    await page.locator('#home-play').focus()
    for (let step = 0; step < 8; step++) {
      tabOrder.push(
        await page.evaluate(
          () =>
            document.activeElement?.id ||
            document.activeElement?.getAttribute('aria-label') ||
            '(none)',
        ),
      )
      await page.keyboard.press('Tab')
      await wait(100)
    }
    console.log(`${viewport.name} arrows: ${order.join(' > ')}`)
    console.log(`${viewport.name} tab: ${tabOrder.join(' > ')}`)
    await page.context().close()
  }
}
await browser.close()

finish(problems, 'The home layout is clean.')
