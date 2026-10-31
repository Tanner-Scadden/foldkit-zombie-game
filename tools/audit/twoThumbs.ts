// Two thumbs on the HUD: with one finger held on the move stick and moving,
// a second finger taps the other gun's slot, the melee slot, the held gun's
// slot, and the reload button, on an 844x390 phone on its side and a 390x844 phone held
// upright, with real multi-touch (CDP Input.dispatchTouchEvent, two touch
// points at once). It checks that each tap does what a lone tap does (the
// gun swaps, the melee weapon comes out, the reload starts) while the stick
// stays held, and shoots `tt-<TAG>-<viewport>-<scene>.png` with both fingers down.
// Exits with 1 on any miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/twoThumbs.ts
// VIEWPORTS picks screens, such as `VIEWPORTS=l844`.
import { Schema } from 'effect'
import type { CDPSession, Page } from 'playwright-core'

import {
  PHONE_844,
  TAG,
  UPRIGHT_390,
  type Viewport,
  finish,
  launch,
  modelAs,
  pickViewports,
  scenePages,
  shot,
  useHarness,
  wait,
} from './lib'
import { LEARNED } from './scenes'

const VIEWPORTS = pickViewports([
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
])

// NOTE: a live wave (no `tick`), so the subscriptions and the frames run
// as on a phone. The SMG's magazine is part spent, so a reload has rounds
// to take.
const FIGHTING = `wave=4&seen=all&start=wave&elapsed=9000&god&gun=smg&loaded=4&${LEARNED}&device=touch`

type Point = Readonly<{ x: number; y: number }>

const MOVE_ID = 1
const TAP_ID = 2
const STEP_MS = 40

const touch = (
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: ReadonlyArray<Readonly<{ id: number; at: Point }>>,
) =>
  session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(({ id, at }) => ({
      id,
      x: at.x,
      y: at.y,
      radiusX: 4,
      radiusY: 4,
      force: 1,
    })),
  })

// NOTE: where the left thumb lands: low on the left of the world, clear of
// the HUD's buttons.
const stickPoint = (page: Page): Promise<Point> =>
  page.evaluate(() => {
    const surface = document.querySelector('.game-surface')
    if (surface === null) {
      throw new Error('No .game-surface on the page')
    }
    const box = surface.getBoundingClientRect()
    const thumbArea = document.querySelector('.thumb-area')
    const top =
      thumbArea === null ? box.top : thumbArea.getBoundingClientRect().top
    return {
      x: box.left + box.width * 0.18,
      y: top + (box.bottom - top) * 0.45,
    }
  })

const centerOf = async (page: Page, selector: string): Promise<Point> => {
  const box = await page.locator(selector).first().boundingBox()
  if (box === null) {
    throw new Error(`nothing at ${selector}`)
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const Tagged = Schema.Struct({ _tag: Schema.String })

// NOTE: as much of the Model as the checks read.
const ThumbView = Schema.Struct({
  input: Schema.Struct({ moveStick: Tagged }),
  player: Schema.Struct({
    arsenal: Tagged,
    wield: Schema.String,
    reload: Tagged,
  }),
})
type ThumbView = typeof ThumbView.Type

type Check = Readonly<{
  name: string
  selector: string
  // NOTE: what the tap should have done, read from the Model before and
  // after; a miss names what went wrong.
  verdict: (before: ThumbView, after: ThumbView) => string | undefined
}>

const isMoving = (m: ThumbView): boolean => m.input.moveStick._tag === 'Active'

const CHECKS: ReadonlyArray<Check> = [
  {
    name: 'swap',
    selector: '.gun-slot-button[data-held="false"]:not([data-slot="Melee"])',
    verdict: (before, after) =>
      before.player.arsenal._tag === after.player.arsenal._tag
        ? 'the other gun did not come out'
        : undefined,
  },
  {
    name: 'knife',
    selector: '.gun-slot-button[data-slot="Melee"]',
    verdict: (_before, after) =>
      after.player.wield === 'Melee' ? undefined : 'the knife did not come out',
  },
  {
    name: 'slot-reload',
    selector: '.gun-slot-button[data-held="true"]',
    verdict: (_before, after) =>
      after.player.reload._tag === 'Reloading'
        ? undefined
        : 'a tap on the held gun did not reload',
  },
  {
    name: 'reload',
    selector: '.reload-button, .reload-icon-button',
    verdict: (_before, after) =>
      after.player.reload._tag === 'Reloading'
        ? undefined
        : 'the reload button did not reload',
  },
]

// NOTE: the run's guns are spent down a little so a reload has rounds to
// take, then the left thumb goes down, walks, and stays; the right thumb
// taps the target; then both lift.
const twoThumbTap = async (
  page: Page,
  session: CDPSession,
  check: Check,
  problems: Array<string>,
  label: string,
): Promise<void> => {
  const stick = await stickPoint(page)
  await touch(session, 'touchStart', [{ id: MOVE_ID, at: stick }])
  for (const step of [10, 20, 30]) {
    await wait(STEP_MS)
    await touch(session, 'touchMove', [
      { id: MOVE_ID, at: { x: stick.x + step, y: stick.y - step / 2 } },
    ])
  }
  const held = { x: stick.x + 30, y: stick.y - 15 }
  await wait(STEP_MS)
  const target = await centerOf(page, check.selector)
  await page.evaluate(() => {
    window.__messages.length = 0
  })
  const before = await modelAs(page, ThumbView)
  if (!isMoving(before)) {
    problems.push(`${label}: the move stick is not held before the tap`)
  }
  await touch(session, 'touchStart', [
    { id: MOVE_ID, at: held },
    { id: TAP_ID, at: target },
  ])
  await wait(STEP_MS)
  await shot(page, `tt-${TAG}-${label.replace(' ', '-')}`)
  // NOTE: Chrome's touch emulation lifts the fingers a touchEnd lists, and
  // a touchStart lists every finger still down.
  await touch(session, 'touchEnd', [{ id: TAP_ID, at: target }])
  await wait(STEP_MS * 3)
  const after = await modelAs(page, ThumbView)
  const tags: ReadonlyArray<string> = await page.evaluate(() => [
    ...window.__messages,
  ])
  if (!isMoving(after)) {
    problems.push(`${label}: the tap let go of the move stick`)
  }
  const miss = check.verdict(before, after)
  if (miss !== undefined) {
    problems.push(
      `${label}: ${miss} (messages: ${[...new Set(tags)].join(', ')})`,
    )
  }
  console.log(
    `${miss === undefined ? 'ok  ' : 'FAIL'} ${label}: ${[...new Set(tags.filter(tag => !tag.startsWith('Ticked') && !tag.startsWith('Moved')))].join(', ')}`,
  )
  await touch(session, 'touchEnd', [{ id: MOVE_ID, at: held }])
  await wait(STEP_MS)
}

const runViewport = async (
  pages: ReturnType<typeof scenePages>,
  viewport: Viewport,
  problems: Array<string>,
): Promise<void> => {
  for (const check of CHECKS) {
    const page = await pages.open(viewport, FIGHTING, { fresh: true })
    const session = await page.context().newCDPSession(page)
    await wait(300)
    await twoThumbTap(
      page,
      session,
      check,
      problems,
      `${viewport.name} ${check.name}`,
    )
    await session.detach()
    pages.release(page)
  }
}

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
const problems: Array<string> = []
for (const viewport of VIEWPORTS) {
  await runViewport(pages, viewport, problems)
}
await pages.close()
await browser.close()
finish(problems, 'Every second-thumb tap did its job with the stick held.')
