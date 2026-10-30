// The close button pass: every menu dialog's shared close X (the shop, the
// kitchen's offer, the MORE hand, Settings, What's New, the Munchopedia and
// an entry, How to play, the character picker, and the difficulty picker) on an 844x390 landscape
// phone, 390x844 and 375x667 upright phones, all with touch, and 1280x720
// and 1920x1080 with a mouse, as `closes-<TAG>-<viewport>-<scene>.png`.
// For each close it checks:
//   - the button is at least 48 px and on screen, and its visible face is
//     smaller (26 to 34 px on a phone, at most 40 px on a desktop),
//   - the face's center and corners and the hit area's edges and corners all
//     hit the button (document.elementFromPoint), so nothing covers it and a
//     tap just off the face still lands,
//   - the button's box does not cross any other button, link, or tab in the
//     dialog, or its title, Rattles' bubble, the wallet, or the tabs' text,
//   - a real tap (a click on a desktop) on the face's center and on two
//     opposite corners of the hit area each sends exactly one RequestedClose
//     and no other tap Message, reaches nothing behind it, and closes the
//     dialog,
//   - Escape sends one RequestedClose and closes the dialog.
// Exits with 1 on any problem.
//   TAG=after bun run heavy -- bun tools/audit/closes.ts
// ONLY picks scenes, such as `ONLY=shop,hand`, VIEWPORTS picks screens
// (`l844`, `p390`, `p375`, `d1280`, `d1920`), and CLOSES_PARALLEL sets how
// many scenes run at once (3 by default).
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  DESKTOP_1920,
  type Log,
  PHONE_844,
  UPRIGHT_375,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  forEachInOrder,
  harnessQuery,
  isPickedScene,
  launch,
  parallelFrom,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  tagOr,
  useHarness,
} from './lib'

const TAG = tagOr('after')

const VIEWPORTS = pickViewports([
  { ...PHONE_844, name: 'l844', scale: 2 },
  { ...UPRIGHT_390, name: 'p390', scale: 2 },
  { ...UPRIGHT_375, name: 'p375' },
  DESKTOP_1280,
  DESKTOP_1920,
])

type Scene = Readonly<{
  name: string
  query: string
  open: ReadonlyArray<string>
}>

const MANOR = '#home-manor'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'shop',
    query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142',
    open: [],
  },
  {
    name: 'kitchen-offer',
    query: 'wave=3&seen=all&money=85&gun=smg&px=70&py=27',
    open: [],
  },
  { name: 'hand', query: 'support', open: [MANOR] },
  { name: 'settings', query: 'fit=full&rotate', open: ['#home-settings'] },
  { name: 'whatsnew', query: '', open: [MANOR, '#hand-card-whatsnew'] },
  {
    name: 'munchopedia',
    query: 'kills=Shambler:40,Runner:3',
    open: [MANOR, '#hand-card-munchopedia'],
  },
  {
    name: 'munchopedia-entry',
    query: 'kills=Shambler:40,Runner:3',
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile'],
  },
  { name: 'howto', query: '', open: [MANOR, '#hand-card-howtoplay'] },
  { name: 'character', query: '', open: [MANOR, '#hand-card-character'] },
  { name: 'difficulty', query: '', open: ['#home-difficulty'] },
  { name: 'home-guide', query: 'fit=home', open: ['#home-install'] },
  { name: 'greet', query: 'greet', open: [] },
]

const MIN_SIDE = 48
const PHONE_FACE = { min: 26, max: 34 }
const DESKTOP_FACE = { min: 26, max: 40 }
const INSET = 2
const OPEN_TIMEOUT_MS = 10_000
const CLOSE_TIMEOUT_MS = 3000

const CLOSE = 'dialog[open] .menu-close'

// NOTE: what a close button must never cover: the dialog's other controls
// and the text a player reads first. A tab panel takes focus so it can
// scroll, but it is a frame around controls, not one, so only what is in it
// counts.
const OTHERS = [
  'button',
  'a[href]',
  'input',
  '[role="tab"]',
  '[role="radio"]',
  '[tabindex]:not([tabindex="-1"]):not([role="tabpanel"])',
].join(',')

const TEXTS = [
  'h2',
  '.shop-greeting',
  '.shop-wallet',
  '.shop-keeper',
  '.panel-blurb',
  '[role="tablist"]',
  '.look-preview',
].join(',')

type Point = Readonly<{ x: number; y: number }>
type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>
type Placed = Readonly<{
  button: Box
  face: Box
  points: ReadonlyArray<Readonly<{ name: string; point: Point }>>
}>

const isRequestedClose = (tag: string) => tag.endsWith(':RequestedClose')
const TAP_LEAVES =
  /(^|:)(Clicked\w*|SelectedOption|SelectedTab|RequestedClose|PressedPointer)$/

const press = async (page: Page, viewport: Viewport, point: Point) => {
  if (viewport.isPhone) {
    await page.touchscreen.tap(point.x, point.y)
  } else {
    await page.mouse.click(point.x, point.y)
  }
}

const waitForDialog = (page: Page) =>
  page
    .locator('dialog[open]')
    .first()
    .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
    .catch(() => undefined)

// NOTE: the harness's ready signal says the scene is in. A dialog the game
// opens itself, such as the shop on reaching the stall, is waited for by
// its close, and each tap that opens a dialog waits for it to open and
// settle, never for a fixed time.
const openScene = async (page: Page, viewport: Viewport, scene: Scene) => {
  await settleAnimations(page)
  for (const selector of scene.open) {
    const locator = page.locator(selector).first()
    await locator
      .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
      .catch(() => undefined)
    const box = await locator.boundingBox()
    if (box === null) {
      throw new Error(`${scene.name}: nothing to open with ${selector}`)
    }
    await press(page, viewport, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    })
    await waitForDialog(page)
    await settleAnimations(page)
  }
  await page
    .locator(CLOSE)
    .first()
    .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
    .catch(() => undefined)
  await settleAnimations(page)
}

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])

// NOTE: every scene starts from its query with an empty save, switched in on
// a page of the same screen, whatever an earlier close left behind.
const freshScene = async (viewport: Viewport, scene: Scene) => {
  const page = await pages.open(
    viewport,
    harnessQuery(scene.query, deviceQuery(viewport)),
  )
  await openScene(page, viewport, scene)
  return page
}

const placeClose = (page: Page): Promise<Placed | null> =>
  page.evaluate(
    ({ selector, inset }) => {
      const button = document.querySelector(selector)
      const face = button?.querySelector('.menu-close-face')
      if (button === null || button === undefined || face == null) {
        return null
      }
      const toBox = (rect: DOMRect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      })
      const b = toBox(button.getBoundingClientRect())
      const f = toBox(face.getBoundingClientRect())
      const center = { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 }
      return {
        button: b,
        face: f,
        points: [
          { name: 'face center', point: center },
          {
            name: 'face top left',
            point: { x: f.left + inset, y: f.top + inset },
          },
          {
            name: 'face bottom right',
            point: { x: f.right - inset, y: f.bottom - inset },
          },
          {
            name: 'hit top left',
            point: { x: b.left + inset, y: b.top + inset },
          },
          {
            name: 'hit top right',
            point: { x: b.right - inset, y: b.top + inset },
          },
          {
            name: 'hit bottom left',
            point: { x: b.left + inset, y: b.bottom - inset },
          },
          {
            name: 'hit bottom right',
            point: { x: b.right - inset, y: b.bottom - inset },
          },
          { name: 'hit left', point: { x: b.left + inset, y: center.y } },
          { name: 'hit right', point: { x: b.right - inset, y: center.y } },
          { name: 'hit top', point: { x: center.x, y: b.top + inset } },
          { name: 'hit bottom', point: { x: center.x, y: b.bottom - inset } },
        ],
      }
    },
    { selector: CLOSE, inset: INSET },
  )

const missedPoints = (page: Page, placed: Placed) =>
  page.evaluate(
    ({ selector, points }) => {
      const button = document.querySelector(selector)
      return points
        .filter(({ point }) => {
          const hit = document.elementFromPoint(point.x, point.y)
          return button === null || hit === null || !button.contains(hit)
        })
        .map(({ name, point }) => {
          const hit = document.elementFromPoint(point.x, point.y)
          return `${name} hits ${hit === null ? 'nothing' : `${hit.tagName.toLowerCase()}.${hit.className}`}`
        })
    },
    { selector: CLOSE, points: placed.points },
  )

// NOTE: text is measured by its own glyphs, not its block, since a title row
// that stops short of the close still spans the panel's width. Text only a
// screen reader reads is left out.
const overlaps = (page: Page) =>
  page.evaluate(
    ({ selector, others, texts }) => {
      const close = document.querySelector(selector)
      const dialog = document.querySelector('dialog[open]')
      if (close === null || dialog === null) {
        return []
      }
      const c = close.getBoundingClientRect()
      const crosses = (r: DOMRect) =>
        r.width > 0 &&
        r.height > 0 &&
        r.left < c.right - 0.5 &&
        r.right > c.left + 0.5 &&
        r.top < c.bottom - 0.5 &&
        r.bottom > c.top + 0.5
      const isShown = (element: Element) => {
        const style = getComputedStyle(element)
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          !element.closest('.sr-only')
        )
      }
      const name = (element: Element) =>
        (
          element.getAttribute('aria-label') ??
          (element as HTMLElement).innerText ??
          element.className
        )
          .replace(/\s+/g, ' ')
          .slice(0, 40)
      const found: Array<string> = []
      for (const other of Array.from(dialog.querySelectorAll(others))) {
        if (other === close || close.contains(other) || other.contains(close)) {
          continue
        }
        if (isShown(other) && crosses(other.getBoundingClientRect())) {
          found.push(`covers ${other.tagName.toLowerCase()} "${name(other)}"`)
        }
      }
      for (const text of Array.from(dialog.querySelectorAll(texts))) {
        if (!isShown(text) || text.contains(close)) {
          continue
        }
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
        const rects: Array<DOMRect> = []
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement?.closest('.sr-only')) {
            continue
          }
          const range = document.createRange()
          range.selectNodeContents(node)
          rects.push(...Array.from(range.getClientRects()))
        }
        const boxes =
          text.matches('.shop-keeper, .look-preview, [role="tablist"]') ||
          rects.length === 0
            ? [text.getBoundingClientRect()]
            : rects
        if (boxes.some(crosses)) {
          found.push(`covers the text "${name(text)}"`)
        }
      }
      return found
    },
    { selector: CLOSE, others: OTHERS, texts: TEXTS },
  )

const isOnScreen = (page: Page, box: Box) =>
  page.evaluate(
    box =>
      box.left >= -1 &&
      box.top >= -1 &&
      box.right <= innerWidth + 1 &&
      box.bottom <= innerHeight + 1,
    box,
  )

const clearMessages = (page: Page) =>
  page.evaluate(() => {
    ;(window as any).__messages.length = 0
  })

const messages = (page: Page): Promise<ReadonlyArray<string>> =>
  page.evaluate(() => [...(window as any).__messages])

const waitForClosed = (page: Page) =>
  page
    .waitForFunction(
      () => document.querySelector('dialog[open]') === null,
      null,
      {
        timeout: CLOSE_TIMEOUT_MS,
      },
    )
    .then(() => true)
    .catch(() => false)

// NOTE: one fresh scene per tap, since the tap closes the dialog.
const checkClosing = async (
  viewport: Viewport,
  scene: Scene,
  how: string,
  act: (page: Page, placed: Placed) => Promise<void>,
  log: Log,
): Promise<ReadonlyArray<string>> => {
  const where = `${viewport.name} ${scene.name} ${how}`
  const page = await freshScene(viewport, scene)
  const placed = await placeClose(page)
  if (placed === null) {
    pages.release(page)
    return [`${where}: no close button on reopen`]
  }
  await clearMessages(page)
  await act(page, placed)
  const isClosed = await waitForClosed(page)
  const tags = await messages(page)
  pages.release(page)
  const closes = tags.filter(isRequestedClose)
  const strays = tags.filter(
    tag => TAP_LEAVES.test(tag) && !isRequestedClose(tag),
  )
  const isOk = closes.length === 1 && strays.length === 0 && isClosed
  log(
    `${isOk ? 'ok  ' : 'FAIL'} ${where}: ${tags.filter(tag => TAP_LEAVES.test(tag)).join(', ') || '(nothing)'}${isClosed ? '' : ', STILL OPEN'}`,
  )
  return isOk
    ? []
    : [
        `${where}: sent ${tags.join(', ') || 'nothing'}${isClosed ? '' : ' and the dialog stayed open'}`,
      ]
}

const checkScene = async (
  viewport: Viewport,
  scene: Scene,
  log: Log,
): Promise<ReadonlyArray<string>> => {
  const problems: Array<string> = []
  const where = `${viewport.name} ${scene.name}`
  const page = await freshScene(viewport, scene)
  const placed = await placeClose(page)
  await shot(page, `closes-${TAG}-${viewport.name}-${scene.name}`)
  if (placed === null) {
    pages.release(page)
    return [`${where}: no shared close button in the open dialog`]
  }
  const width = placed.button.right - placed.button.left
  const height = placed.button.bottom - placed.button.top
  const face = Math.round(placed.face.right - placed.face.left)
  const range = viewport.isPhone ? PHONE_FACE : DESKTOP_FACE
  log(
    `${where}: button ${Math.round(width)}x${Math.round(height)}, face ${face} px`,
  )
  if (width < MIN_SIDE || height < MIN_SIDE) {
    problems.push(
      `${where}: the button is ${Math.round(width)}x${Math.round(height)}, under ${MIN_SIDE} px`,
    )
  }
  if (face < range.min || face > range.max) {
    problems.push(
      `${where}: the face is ${face} px, outside ${range.min} to ${range.max}`,
    )
  }
  if (!(await isOnScreen(page, placed.button))) {
    problems.push(`${where}: the button is off screen`)
  }
  for (const miss of await missedPoints(page, placed)) {
    problems.push(`${where}: the ${miss}`)
  }
  for (const overlap of await overlaps(page)) {
    problems.push(`${where}: the close ${overlap}`)
  }
  pages.release(page)

  const tapPoints = ['face center', 'hit top left', 'hit bottom right']
  for (const name of tapPoints) {
    problems.push(
      ...(await checkClosing(
        viewport,
        scene,
        `${viewport.isPhone ? 'tap' : 'click'} ${name}`,
        async (tapPage, placedNow) => {
          const point = placedNow.points.find(p => p.name === name)!.point
          await press(tapPage, viewport, point)
        },
        log,
      )),
    )
  }
  problems.push(
    ...(await checkClosing(
      viewport,
      scene,
      'Escape',
      tapPage => tapPage.keyboard.press('Escape'),
      log,
    )),
  )
  return problems
}

const UNITS = VIEWPORTS.flatMap(viewport =>
  SCENES.filter(scene => isPickedScene(scene.name)).map(scene => ({
    viewport,
    scene,
  })),
)

const problems = await forEachInOrder(
  UNITS,
  parallelFrom('CLOSES_PARALLEL'),
  ({ viewport, scene }, log) => checkScene(viewport, scene, log),
)
await pages.close()
await browser.close()

finish(
  problems.flat(),
  'Every close button is small, clear of its dialog, and closes on one tap and on Escape.',
)
