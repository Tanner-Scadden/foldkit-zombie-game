// The end of a run pass: a real death played tick by tick (the bite, the
// fall, the stamp, the card), the Game Over card with a NEW BEST, Victory
// with its trophy and confetti, and co-op's party wipe and win with the MVP
// crown, on a 1280x720 desktop, an 844x390 phone on its side, and a 390x844
// phone held upright, as `s43-<TAG>-<viewport>-<scene>.png`. The death is
// played with the harness's director (tools/audit/harness/director.ts), so
// its frames are the same on every run: it steps until the player falls,
// then shoots the beat at fixed ticks after. It checks that the end card
// shows its RETRY, HOME, and SHARE buttons once the beat is over, that a
// tap on SHARE (and X on a keyboard) opens X's post intent in a new tab, and
// exits with 1 on any miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots43.ts
// ONLY picks scenes, such as `ONLY=death`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_390,
  deviceQuery,
  finish,
  harnessQuery,
  harnessUrl,
  isPickedScene,
  launch,
  model,
  openPage,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  tagOr,
  useHarness,
  waitForReady,
  whenSettled,
} from './lib'

const TAG = tagOr('after')

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
])

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const BUTTONS = ['#end-retry-button', '#end-menu-button', '#end-share-button']

type Scene = Readonly<{
  name: string
  query: string
  buttons?: ReadonlyArray<string>
}>

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'gameover',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'gameover-best',
    query: `wave=12&mode=endless&phase=gameover&stats&best=9&crowd=10&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'victory',
    query: `wave=10&phase=victory&stats&difficulty=Hard&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'victory-confetti',
    query: `wave=10&phase=victory&stats&difficulty=Hard&${LEARNED}&tick=90`,
  },
  {
    name: 'coop-wipe',
    query: `wave=5&phase=gameover&stats&party=3&crowd=10&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-win',
    query: `wave=10&phase=victory&stats&party=3&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  { name: 'coop-ended', query: `coop=ended&${LEARNED}&tick=30` },
  { name: 'coop-result', query: `coop=result&${LEARNED}&tick=30` },
]

// NOTE: the death beat's ticks after the fall, shot one by one.
const DEATH_TICKS = [0, 4, 12, 24, 40, 60, 80, 100, 130, 170, 400]
const DEATH_SCENE = `wave=4&start=wave&elapsed=9000&crowd=40&seen=all&seed=7&${LEARNED}`
const STEP = 6
const MAX_TICKS = 60 * 40

const directedTick = (page: Page) =>
  page.evaluate(() => (window as any).__directedTick as number)

const stepTo = async (page: Page, target: number) => {
  const now = await directedTick(page)
  if (target > now) {
    await page.evaluate(n => (window as any).__director.step(n), target - now)
    await page.waitForFunction(
      expected => (window as any).__directedTick === expected,
      target,
      { polling: 'raf', timeout: 60_000 },
    )
  }
  await whenSettled(page)
}

const isOver = async (page: Page) =>
  (await model(page)).phase._tag === 'GameOver'

const shootDeath = async (
  browser: Awaited<ReturnType<typeof launch>>,
  viewport: (typeof VIEWPORTS)[number],
  problems: Array<string>,
) => {
  const page = await openPage(browser, viewport)
  await page.goto(
    harnessUrl(DEATH_SCENE, 'director', 'nodev', deviceQuery(viewport)),
  )
  await waitForReady(page)
  await page.evaluate(
    json => (window as any).__director.start(json),
    JSON.stringify({ segments: [], taps: [] }),
  )
  let tick = 0
  let lastAlive = 0
  while (tick < MAX_TICKS && !(await isOver(page))) {
    lastAlive = tick
    tick += STEP
    await stepTo(page, tick)
  }
  if (!(await isOver(page))) {
    problems.push(`${viewport.name} death: the player never fell`)
    await page.context().close()
    return
  }
  // NOTE: back up to the last alive frame and walk to the fall tick by tick.
  await page.goto(
    harnessUrl(DEATH_SCENE, 'director', 'nodev', deviceQuery(viewport)),
  )
  await waitForReady(page)
  await page.evaluate(
    json => (window as any).__director.start(json),
    JSON.stringify({ segments: [], taps: [] }),
  )
  await stepTo(page, lastAlive)
  let fall = lastAlive
  while (!(await isOver(page))) {
    await shot(page, `s43-${TAG}-${viewport.name}-death-before`)
    fall += 1
    await stepTo(page, fall)
  }
  for (const after of DEATH_TICKS) {
    await stepTo(page, fall + after)
    await shot(page, `s43-${TAG}-${viewport.name}-death-${after}`)
  }
  console.log(`shot ${viewport.name} death (fell on tick ${fall})`)
  await page.context().close()
}

// NOTE: SHARE is a link, so a tap (or X on a keyboard, which clicks it)
// must open X's post intent in a new tab by itself. x.com is answered here,
// so nothing reaches X.
const X_INTENT = /^https:\/\/x\.com\/intent\/post\?text=.+&url=/

const opensX = async (page: Page, act: () => Promise<void>) => {
  await page
    .context()
    .route('https://x.com/**', route =>
      route.fulfill({ status: 200, body: 'share' }),
    )
  const opening = page
    .context()
    .waitForEvent('page', { timeout: 5_000 })
    .catch(() => null)
  await act()
  const tab = await opening
  if (tab === null) {
    return ''
  }
  await tab.waitForLoadState('domcontentloaded').catch(() => undefined)
  const url = tab.url()
  await tab.close()
  return url
}

const checkShare = async (
  page: Page,
  label: string,
  isKeyboard: boolean,
  problems: Array<string>,
) => {
  const tapped = await opensX(page, () =>
    page.locator('a#end-share-button').click(),
  )
  if (!X_INTENT.test(tapped)) {
    problems.push(`${label}: tapping SHARE opened ${tapped || 'nothing'}`)
  }
  const shares = await page.evaluate(
    () =>
      ((window as any).__messages ?? []).filter(
        (message: string) => message === 'ClickedShareButton',
      ).length,
  )
  if (shares < 1) {
    problems.push(`${label}: tapping SHARE sent no ClickedShareButton`)
  }
  if (isKeyboard) {
    await page.locator('.game-surface').focus()
    const keyed = await opensX(page, () => page.keyboard.press('KeyX'))
    if (!X_INTENT.test(keyed)) {
      problems.push(`${label}: X opened ${keyed || 'nothing'}`)
    }
  }
}

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
const problems: Array<string> = []
for (const viewport of VIEWPORTS) {
  if (isPickedScene('death')) {
    await shootDeath(browser, viewport, problems)
  }
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    const label = `${viewport.name} ${scene.name}`
    await settleAnimations(page)
    for (const selector of scene.buttons ?? []) {
      if (TAG === 'before') {
        break
      }
      const isShown = await page.evaluate(
        target => document.querySelector(target) !== null,
        selector,
      )
      if (!isShown) {
        problems.push(`${label}: no ${selector}`)
      }
    }
    await shot(page, `s43-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    if (TAG !== 'before' && scene.name === 'gameover') {
      await checkShare(page, label, !viewport.isPhone, problems)
    }
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The end of a run pass found no problems.')
