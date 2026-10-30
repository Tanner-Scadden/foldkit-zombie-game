import { Array, Data, Effect, FileSystem, Option, Path, pipe } from 'effect'
import type { Browser, Page } from 'playwright-core'

import { textPixels } from '../../src/font'
import {
  harnessQuery,
  harnessUrl,
  waitForReady,
  whenSettled,
} from '../audit/lib'
import { type Caption, type Format, type Shot, encodePlan } from './shotList'
import { type ClipCue, decodeAudioLog } from './soundtrackRequest'

// THE DIRECTOR'S CAMERA
//
// NOTE: plays one shot through the built audit harness with `director` on
// (tools/audit/harness/director.ts): the page holds still, and this asks
// it for `step` ticks at a time, then captures the picture. CSS
// animations, such as the shop's MINE! stamp, are paused and set to the
// shot's own clock before each capture, so they too land on the same
// picture every render. Captions and fades are drawn over the page, so a
// captured frame is the finished frame.

export class PageFailed extends Data.TaggedError('PageFailed')<{
  readonly step: string
  readonly reason: string
}> {}

const onPage = <A>(step: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: error => new PageFailed({ step, reason: String(error) }),
  })

// NOTE: the CSS size and device scale of each format. Both are six screen
// pixels a game pixel: the landscape screen is 320x180 game pixels, and an
// upright phone's portrait screen is 180 wide and, at 9:16, 320 tall.
const VIEWPORTS: Readonly<
  Record<
    Format,
    { width: number; height: number; scale: number; isTouch: boolean }
  >
> = {
  '16:9': { width: 960, height: 540, scale: 2, isTouch: false },
  '9:16': { width: 360, height: 640, scale: 3, isTouch: true },
}

export const outputSize = (format: Format) => {
  const viewport = VIEWPORTS[format]
  return {
    width: viewport.width * viewport.scale,
    height: viewport.height * viewport.scale,
  }
}

// NOTE: what the game draws over the world: the HUD's canvas layer, the
// thumb area, and the HTML controls, for a clean plate.
const HIDE_HUD_CSS = `
.overlay-layer-canvas, .thumb-area, .touch-stick, .ghost-sticks,
.hud-tap-frame, .gun-cluster, .corner-buttons, .debut-card {
  visibility: hidden !important;
}`

export const openShotPage = (browser: Browser, format: Format) =>
  onPage('open the page', async () => {
    const viewport = VIEWPORTS[format]
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.scale,
      ...(viewport.isTouch ? { isMobile: true, hasTouch: true } : {}),
    })
    const page = await context.newPage()
    // NOTE: the page's animation clock stands still, so an animation
    // starts and stays at its first frame until `holdAnimations` sets it
    // to the shot's clock, however long a capture takes. A short one can
    // no longer run out unseen between two captures.
    const devTools = await context.newCDPSession(page)
    await devTools.send('Animation.enable')
    await devTools.send('Animation.setPlaybackRate', { playbackRate: 0 })
    return page
  })

// CAPTIONS

// NOTE: each font pixel is as many screen pixels as the largest of these
// that fits the caption in nine tenths of the frame's width.
const CAPTION_PIXEL_SIZES = [18, 12, 9, 6]
const CAPTION_COLORS: Readonly<Record<string, string>> = {
  Plain: '#f4f1de',
  Prompt: '#ffe066',
  Title: '#9be36a',
  Victory: '#ffd23f',
  Defeat: '#ff4a4f',
  Fresh: '#ff8a3d',
}
const CAPTION_OUTLINE = '#140c10'
const CAPTION_SHADOW = '#2a1418'

export type CaptionDrawing = Readonly<{
  rows: ReadonlyArray<string>
  pixel: number
  color: string
  place: 'Top' | 'Middle' | 'Bottom'
}>

const captionDrawing = (
  caption: Caption,
  frameWidth: number,
): CaptionDrawing => {
  const rows = textPixels(caption.text.toUpperCase())
  const width = (rows[0]?.length ?? 0) + 2
  const pixel = pipe(
    Array.findFirst(
      CAPTION_PIXEL_SIZES,
      size => width * size <= frameWidth * 0.9,
    ),
    Option.getOrElse(() => 6),
  )
  return {
    rows,
    pixel,
    color: CAPTION_COLORS[caption.tone ?? 'Prompt'] ?? '#ffe066',
    place: caption.place ?? 'Top',
  }
}

// NOTE: runs in the page: the overlay with the shot's caption and fade.
const paintOverlay = ({
  captions,
  fade,
  outline,
  shadow,
}: {
  captions: ReadonlyArray<CaptionDrawing>
  fade: number
  outline: string
  shadow: string
}) => {
  const ratio = window.devicePixelRatio
  const id = 'director-overlay'
  const existing = document.getElementById(id)
  const canvas =
    existing instanceof HTMLCanvasElement
      ? existing
      : document.body.appendChild(document.createElement('canvas'))
  canvas.id = id
  canvas.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;image-rendering:pixelated'
  canvas.width = Math.round(window.innerWidth * ratio)
  canvas.height = Math.round(window.innerHeight * ratio)
  const context = canvas.getContext('2d')
  if (context === null) {
    return
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  for (const caption of captions) {
    const { rows, pixel } = caption
    const columns = rows[0]?.length ?? 0
    const left =
      Math.round((canvas.width - columns * pixel) / 2 / pixel) * pixel
    const textHeight = rows.length * pixel
    const top =
      caption.place === 'Top'
        ? Math.round(canvas.height * 0.08)
        : caption.place === 'Bottom'
          ? Math.round(canvas.height * 0.86 - textHeight)
          : Math.round((canvas.height - textHeight) / 2)
    const filled = (x: number, y: number) => rows[y]?.[x] === '#'
    const box = (x: number, y: number, color: string) => {
      context.fillStyle = color
      context.fillRect(left + x * pixel, top + y * pixel, pixel, pixel)
    }
    // NOTE: a one pixel outline around the letters, and under it a one
    // pixel drop shadow, as the game's own text has.
    const inked = (x: number, y: number) =>
      filled(x, y) ||
      filled(x - 1, y) ||
      filled(x + 1, y) ||
      filled(x, y - 1) ||
      filled(x, y + 1)
    for (let y = -1; y <= rows.length + 1; y++) {
      for (let x = -1; x <= columns; x++) {
        if (inked(x, y)) {
          box(x, y, outline)
        } else if (inked(x, y - 1)) {
          box(x, y, shadow)
        }
      }
    }
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < columns; x++) {
        if (filled(x, y)) {
          box(x, y, caption.color)
        }
      }
    }
  }
  if (fade > 0) {
    context.fillStyle = `rgba(0, 0, 0, ${fade})`
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
}

// NOTE: runs in the page: every CSS animation paused at its age on the
// shot's clock, counted from the tick it was first seen on.
const holdAnimations = (tick: number) => {
  const page = window as unknown as {
    __animationStarts?: WeakMap<Animation, number>
  }
  const starts = (page.__animationStarts ??= new WeakMap())
  for (const animation of document.getAnimations()) {
    if (!starts.has(animation)) {
      starts.set(animation, tick)
    }
    animation.pause()
    animation.currentTime =
      ((tick - (starts.get(animation) ?? tick)) * 1000) / 60
  }
}

// THE SHOT

export type ShotFrames = Readonly<{
  // NOTE: the clip frame each captured tick starts on, by tick.
  frameOfTick: ReadonlyMap<number, number>
  frameCount: number
  cues: ReadonlyArray<ClipCue>
}>

const FADE_STEPS = 16

const fadeAt = (shot: Shot, tick: number): number => {
  const fadeIn = shot.fadeIn ?? 0
  const fadeOut = shot.fadeOut ?? 0
  const before = fadeIn > 0 ? Math.max(0, 1 - tick / fadeIn) : 0
  const after = fadeOut > 0 ? Math.max(0, 1 - (shot.ticks - tick) / fadeOut) : 0
  return Math.round(Math.max(before, after) * FADE_STEPS) / FADE_STEPS
}

const repeatsAt = (shot: Shot, tick: number): number =>
  pipe(
    shot.slowMotion ?? [],
    Array.filter(slow => slow.from <= tick && tick < slow.to),
    Array.reduce(1, (most, slow) => Math.max(most, slow.repeat)),
  ) +
  pipe(
    shot.holds ?? [],
    Array.filter(hold => hold.at === tick),
    Array.reduce(0, (sum, hold) => sum + hold.frames),
  )

const directedTick = (page: Page) =>
  onPage('read the tick', () =>
    page.evaluate(() => (window as any).__directedTick as number | undefined),
  )

const awaitTick = (page: Page, tick: number) =>
  onPage(`reach tick ${tick}`, () =>
    page.waitForFunction(
      expected => (window as any).__directedTick === expected,
      tick,
      { polling: 'raf', timeout: 60_000 },
    ),
  )

// NOTE: plays a shot and writes its frames from `firstFrame` on, as
// frame-000000.png and up in `dir`. A repeated frame is a hard link.
export const captureShot = (
  page: Page,
  shot: Shot,
  format: Format,
  dir: string,
  firstFrame: number,
  log: (line: string) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const isTouch = VIEWPORTS[format].isTouch
    const query = harnessQuery(
      shot.scene,
      'director',
      'nodev',
      isTouch ? 'device=touch' : '',
    )
    yield* onPage('load the scene', async () => {
      await page.goto(harnessUrl(query))
      await waitForReady(page)
    })
    if (shot.hideHud === true) {
      yield* onPage('hide the HUD', () =>
        page.addStyleTag({ content: HIDE_HUD_CSS }).then(() => undefined),
      )
    }
    const plan = yield* encodePlan({
      segments: shot.segments ?? [],
      taps: shot.taps ?? [],
      ...(shot.coop === undefined ? {} : { coop: shot.coop }),
    })
    yield* onPage('start the shot', () =>
      page.evaluate(json => (window as any).__director.start(json), plan),
    )
    yield* awaitTick(page, 0)
    const frameWidth = outputSize(format).width
    const step = shot.step ?? 1
    const frameOfTick = new Map<number, number>()
    let frame = firstFrame
    for (let tick = 0; tick < shot.ticks; tick += step) {
      for (const click of Array.filter(
        shot.clicks ?? [],
        click => click.at === tick,
      )) {
        yield* onPage(`click ${click.selector}`, () =>
          page.click(click.selector, { timeout: 5_000 }),
        )
      }
      if (tick > 0) {
        yield* onPage('step', () =>
          page.evaluate(n => (window as any).__director.step(n), step),
        )
        yield* awaitTick(page, tick)
      }
      yield* onPage('settle', async () => {
        await whenSettled(page)
        await page.evaluate(holdAnimations, tick)
        await page.evaluate(paintOverlay, {
          captions: Array.map(
            Array.filter(
              shot.captions ?? [],
              caption => caption.from <= tick && tick < caption.to,
            ),
            caption => captionDrawing(caption, frameWidth),
          ),
          fade: fadeAt(shot, tick),
          outline: CAPTION_OUTLINE,
          shadow: CAPTION_SHADOW,
        })
      })
      const png = yield* onPage('capture', () =>
        page.screenshot({ type: 'png', caret: 'hide', animations: 'allow' }),
      )
      const first = path.join(dir, frameName(frame))
      yield* fs.writeFile(first, png)
      frameOfTick.set(tick, frame)
      frame++
      for (let copy = 1; copy < repeatsAt(shot, tick); copy++) {
        yield* fs.link(first, path.join(dir, frameName(frame)))
        frame++
      }
      if (tick % 120 === 0) {
        yield* log(`  ${shot.name}: tick ${tick} of ${shot.ticks}`)
      }
    }
    const reached = yield* directedTick(page)
    const audio = yield* decodeAudioLog(
      yield* onPage('read the audio log', () =>
        page.evaluate((): unknown => (window as any).__director.audio()),
      ),
    )
    // NOTE: a sound logged on tick t is heard on the first frame that
    // shows the world after it.
    const captured = [...frameOfTick.entries()]
    const cues = Array.getSomes(
      Array.map(audio, cue =>
        Option.map(
          Array.findFirst(captured, ([tick]) => tick > cue.tick),
          ([, at]): ClipCue => ({ frame: at, cue }),
        ),
      ),
    )
    yield* log(
      `  ${shot.name}: ${frame - firstFrame} frames, ${cues.length} sounds, tick ${reached ?? 0}`,
    )
    return {
      frameOfTick,
      frameCount: frame - firstFrame,
      cues,
    } satisfies ShotFrames
  })

export const frameName = (frame: number): string =>
  `frame-${String(frame).padStart(6, '0')}.png`
