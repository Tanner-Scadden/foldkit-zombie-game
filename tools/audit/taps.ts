// Taps every visible button on the home menu (with the full screen icon, the
// update chip, and a NEW ENTRY pop too), What's New, the Munchopedia list and
// an entry, the difficulty picker, its other panels, the pause screen,
// the character picker, the leave question, the gun cluster in a wave and a
// break, the shop (its cards, tabs, and the close X), Game Over, and Victory on
// 667x375 and 844x390 phones, or with PORTRAIT=1 on 390x844, 430x932, and
// 360x800 phones held upright, with touch. For each button it checks that the center and four points just
// inside its edges hit that button (document.elementFromPoint), then taps the
// center and a corner for real and checks that exactly one Message names the
// tap, and that it is not a press on the game surface. Exits with 1 on any
// miss.
//   BASE=http://localhost:4174/ bun taps.ts
//   PORTRAIT=1 BASE=http://localhost:4174/ bun taps.ts
// VIEWPORTS picks phones by name, such as `VIEWPORTS=u390,u360`.
// ONLY picks scenes, such as `ONLY=home,munchopedia`.
// TAPS_PARALLEL sets how many scenes run at once, each in its own browser
// context (3 by default, 1 for one after another). The report keeps the
// order of a run one after another.
import type { Page } from 'playwright-core'

import {
  type Log,
  PHONE_667,
  PHONE_844,
  UPRIGHT_360,
  UPRIGHT_390,
  UPRIGHT_430,
  type Viewport,
  finish,
  forEachInOrder,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  parallelFrom,
  pickViewports,
  settleAnimations,
  wait,
} from './lib'

// NOTE: a 2x pixel ratio on every phone keeps the many reloads quick. The hit
// tests read CSS pixels, so the ratio does not change them.
const LANDSCAPE: ReadonlyArray<Viewport> = [
  { ...PHONE_667, scale: 2 },
  { ...PHONE_844, scale: 2 },
]

const PORTRAIT: ReadonlyArray<Viewport> = [
  { ...UPRIGHT_390, scale: 2 },
  { ...UPRIGHT_430, scale: 2 },
  { ...UPRIGHT_360, scale: 2 },
]

const VIEWPORTS = pickViewports(
  process.env.PORTRAIT === undefined ? LANDSCAPE : PORTRAIT,
)

type Scene = Readonly<{
  name: string
  query: string
  openWith?: string
  thenOpen?: string
  opensDialog?: boolean
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
  {
    name: 'shop',
    query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142',
    opensDialog: true,
  },
  {
    name: 'shop-broke',
    query: 'wave=3&money=12&gun=shotgun&px=270&py=142',
    opensDialog: true,
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
  /(^|:)(Clicked\w*|SelectedOption|SelectedTab|RequestedClose|PressedPointer)$/

const isTapMessage = (tag: string): boolean => TAP_LEAVES.test(tag)

const OPEN_TIMEOUT_MS = 10_000

// NOTE: the fixed waits are the least a scene needs. Each step also waits
// for what it opens, so a busy machine, or several scenes at once, slows
// the run instead of breaking it.
const tapToOpen = async (page: Page, scene: Scene, selector: string) => {
  const locator = page.locator(selector).first()
  await locator
    .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
    .catch(() => undefined)
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error(`${scene.name}: nothing to open with ${selector}`)
  }
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

const waitForDialog = (page: Page) =>
  page
    .locator('dialog[open]')
    .first()
    .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
    .catch(() => undefined)

const openScene = async (page: Page, scene: Scene) => {
  await page.goto(harnessUrl(scene.query, 'device=touch', 'nodev'))
  await wait(SETTLE_MS)
  if (scene.openWith !== undefined) {
    await tapToOpen(page, scene, scene.openWith)
    await waitForDialog(page)
    await wait(500)
  }
  if (scene.thenOpen !== undefined) {
    await tapToOpen(page, scene, scene.thenOpen)
    await wait(400)
  }
  await settleAnimations(page)
}

// NOTE: true once the scene shows a button at `index`, in the open dialog
// when there is one.
const hasButton = (page: Page, index: number, hasDialog: boolean) =>
  page
    .waitForFunction(
      ({ index, hasDialog }) => {
        const scope: ParentNode = hasDialog
          ? (document.querySelector('dialog[open]') ?? document)
          : document
        return scope.querySelectorAll('button')[index] !== undefined
      },
      { index, hasDialog },
      { timeout: OPEN_TIMEOUT_MS },
    )
    .then(() => true)
    .catch(() => false)

const visibleTargets = (page: Page): Promise<ReadonlyArray<number>> =>
  page.evaluate(() => {
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
      .map(({ index }) => index)
  })

// NOTE: only a dialog's own panel counts. A list inside it, such as the
// Munchopedia's tiles, may keep its place.
const openedScroll = (page: Page): Promise<number> =>
  page.evaluate(() =>
    Math.round(document.querySelector('dialog[open] .panel')?.scrollTop ?? 0),
  )

// NOTE: a panel that scrolls, such as Settings on a landscape phone, can
// open with some buttons out of view. A player scrolls to them, so each
// button is scrolled into view before it is measured, hit tested, and tapped.
const placeTarget = (
  page: Page,
  index: number,
  hasDialog: boolean,
): Promise<Target> =>
  page.evaluate(
    ({ index, hasDialog, inset }) => {
      const scope: ParentNode = hasDialog
        ? (document.querySelector('dialog[open]') ?? document)
        : document
      const button = scope.querySelectorAll('button')[index]!
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
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
    },
    { index, hasDialog, inset: EDGE_INSET },
  )

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

const browser = await launch()

// NOTE: a tap can write the save, such as PLAY dismissing the iPhone tip.
// The save lives in SQLite on OPFS, which clearing localStorage does not
// reach, so every reopen gets a new browser context with empty storage.
const openFreshScene = async (viewport: Viewport, scene: Scene) => {
  const page = await openPage(browser, viewport)
  await openScene(page, scene)
  return page
}

// NOTE: opens the scene fresh for one tap, once more if the button is not
// there yet, and gives null when it is still missing.
const openWithButton = async (
  viewport: Viewport,
  scene: Scene,
  index: number,
  hasDialog: boolean,
): Promise<Page | null> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = await openFreshScene(viewport, scene)
    if (await hasButton(page, index, hasDialog)) {
      return page
    }
    await page.context().close()
  }
  return null
}

const checkScene = async (
  viewport: Viewport,
  scene: Scene,
  log: Log,
): Promise<ReadonlyArray<string>> => {
  const failures: Array<string> = []
  const page = await openFreshScene(viewport, scene)
  const hasDialog = scene.openWith !== undefined || scene.opensDialog === true
  const indices = await visibleTargets(page)
  const where = `${viewport.name} ${scene.name}`
  if (indices.length === 0) {
    failures.push(`${where}: no buttons`)
  }
  const openScroll = await openedScroll(page)
  if (openScroll > 0) {
    failures.push(
      `${where}: the open panel starts ${openScroll} px down, hiding its top`,
    )
  }
  const targets: Array<Target> = []
  for (const index of indices) {
    const target = await placeTarget(page, index, hasDialog)
    targets.push(target)
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
    for (const { name } of target.points.filter(
      ({ name }) => name === 'center' || name === 'corner',
    )) {
      const tapPage = await openWithButton(
        viewport,
        scene,
        target.index,
        hasDialog,
      )
      if (tapPage === null) {
        log(`FAIL ${where} "${target.label}" ${name}: gone on reopen`)
        failures.push(
          `${where} "${target.label}" ${name}: the button was not there when the scene was opened again`,
        )
        continue
      }
      const tapPoint = (
        await placeTarget(tapPage, target.index, hasDialog)
      ).points.find(placed => placed.name === name)!.point
      await tapPage.evaluate(() => {
        ;(window as any).__messages.length = 0
      })
      await tapPage.touchscreen.tap(tapPoint.x, tapPoint.y)
      await wait(AFTER_TAP_MS)
      const tags: ReadonlyArray<string> = await tapPage.evaluate(() => [
        ...(window as any).__messages,
      ])
      await tapPage.context().close()
      const tapTags = tags.filter(isTapMessage)
      const reachedSurface = tags.some(tag => surfaceTags.has(tag))
      const isOk = tapTags.length === 1 && !reachedSurface
      log(
        `${isOk ? 'ok  ' : 'FAIL'} ${where} "${target.label}" ${name}: ${tapTags.join(', ') || '(nothing)'}`,
      )
      if (!isOk) {
        failures.push(
          `${where} "${target.label}" ${name} tap sent ${tags.join(', ') || 'nothing'}`,
        )
      }
    }
  }
  await page.context().close()
  return failures
}

// NOTE: each viewport and scene pair is one unit of work, so even the two
// landscape phones fill every context.
const UNITS = VIEWPORTS.flatMap(viewport =>
  SCENES.filter(scene => isPickedScene(scene.name)).map(scene => ({
    viewport,
    scene,
  })),
)

const failures = await forEachInOrder(
  UNITS,
  parallelFrom('TAPS_PARALLEL'),
  ({ viewport, scene }, log) => checkScene(viewport, scene, log),
)
await browser.close()

finish(failures.flat(), 'Every tap landed on its button and sent one Message.')
