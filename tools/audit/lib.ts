import { chromium, type Browser, type Page } from 'playwright-core'

export const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const GAME = 'http://localhost:4173/'
export const HARNESS = 'http://localhost:4174/'

export const launch = () =>
  chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

// VIEWPORTS

export type Viewport = Readonly<{
  name: string
  width: number
  height: number
  scale: number
  isPhone: boolean
}>

// NOTE: the screens the audit scripts shoot. A script that names a screen
// differently in its file names, or wants another pixel ratio, spreads one of
// these and overrides the field.
export const DESKTOP_1280: Viewport = {
  name: 'd1280',
  width: 1280,
  height: 720,
  scale: 1,
  isPhone: false,
}
export const DESKTOP_1920: Viewport = {
  name: 'd1920',
  width: 1920,
  height: 1080,
  scale: 1,
  isPhone: false,
}
export const PHONE_667: Viewport = {
  name: 'p667',
  width: 667,
  height: 375,
  scale: 2,
  isPhone: true,
}
export const PHONE_844: Viewport = {
  name: 'p844',
  width: 844,
  height: 390,
  scale: 3,
  isPhone: true,
}
export const PHONE_932: Viewport = {
  name: 'p932',
  width: 932,
  height: 430,
  scale: 3,
  isPhone: true,
}
export const ANDROID_915: Viewport = {
  name: 'a915',
  width: 915,
  height: 412,
  scale: 2.625,
  isPhone: true,
}
export const UPRIGHT_390: Viewport = {
  name: 'u390',
  width: 390,
  height: 844,
  scale: 3,
  isPhone: true,
}
export const UPRIGHT_430: Viewport = {
  name: 'u430',
  width: 430,
  height: 932,
  scale: 3,
  isPhone: true,
}
export const UPRIGHT_360: Viewport = {
  name: 'u360',
  width: 360,
  height: 800,
  scale: 3,
  isPhone: true,
}
export const UPRIGHT_375: Viewport = {
  name: 'u375',
  width: 375,
  height: 667,
  scale: 2,
  isPhone: true,
}

export const openPage = async (browser: Browser, viewport: Viewport) => {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    ...(viewport.isPhone ? { isMobile: true, hasTouch: true } : {}),
  })
  return context.newPage()
}

export const desktop = (browser: Browser) => openPage(browser, DESKTOP_1280)

export const mobile = (browser: Browser, landscape = false) =>
  openPage(browser, landscape ? PHONE_844 : UPRIGHT_390)

// THE ENVIRONMENT

// NOTE: every harness script reads the same variables: TAG names the shot
// set, BASE points at another harness port, ONLY picks scenes by name, and
// VIEWPORTS picks screens by name.
export const tagOr = (fallback: string) => process.env.TAG ?? fallback
export const BASE = process.env.BASE ?? HARNESS

const listFromEnv = (key: string) => process.env[key]?.split(',')
const ONLY = listFromEnv('ONLY')
const PICKED_VIEWPORTS = listFromEnv('VIEWPORTS')

export const isPickedScene = (name: string) =>
  ONLY === undefined || ONLY.includes(name)

export const pickViewports = (
  viewports: ReadonlyArray<Viewport>,
): ReadonlyArray<Viewport> =>
  viewports.filter(
    viewport =>
      PICKED_VIEWPORTS === undefined ||
      PICKED_VIEWPORTS.includes(viewport.name),
  )

// NOTE: joins the query parts that are not empty, so a scene with no query
// and a device part make `?device=touch`, never `?&device=touch`.
export const harnessUrl = (...parts: ReadonlyArray<string>) =>
  `${BASE}?${parts.filter(part => part.length > 0).join('&')}`

export const deviceQuery = (viewport: Viewport) =>
  viewport.isPhone ? 'device=touch' : ''

// NOTE: prints the problems a check found and exits with 1, or prints the
// all clear.
export const finish = (problems: ReadonlyArray<string>, allClear: string) => {
  if (problems.length > 0) {
    console.log(`\n${problems.length} problems:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`\n${allClear}`)
}

export const SHOTS_DIR = `${import.meta.dir}/shots`

export const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS_DIR}/${name}.png` })

export const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

// PIXEL COMPARE

const pngDataUrl = async (path: string) =>
  `data:image/png;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64')}`

export type PixelDiff = Readonly<{
  differing: number
  total: number
  maxDelta: number
  box: Readonly<{
    left: number
    top: number
    right: number
    bottom: number
  }> | null
  diffUrl: string | null
}>

// NOTE: counts the pixels that differ between two PNG files in the page's
// own canvas, and draws a diff with the changed pixels in magenta over a dim
// copy of the second image.
export const comparePngs = async (
  page: Page,
  beforePath: string,
  afterPath: string,
): Promise<PixelDiff> =>
  page.evaluate(
    async ([first, second]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>(resolve => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.src = src
        })
      const pixels = async (src: string) => {
        const image = await load(src)
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return {
          width: image.width,
          height: image.height,
          data: context.getImageData(0, 0, image.width, image.height),
        }
      }
      const a = await pixels(first)
      const b = await pixels(second)
      const diff = document.createElement('canvas')
      diff.width = a.width
      diff.height = a.height
      const diffContext = diff.getContext('2d')!
      const out = diffContext.createImageData(a.width, a.height)
      let differing = 0
      let maxDelta = 0
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (let i = 0; i < a.data.data.length; i += 4) {
        const delta = Math.max(
          Math.abs(a.data.data[i]! - b.data.data[i]!),
          Math.abs(a.data.data[i + 1]! - b.data.data[i + 1]!),
          Math.abs(a.data.data[i + 2]! - b.data.data[i + 2]!),
        )
        const gray = Math.round(
          (b.data.data[i]! + b.data.data[i + 1]! + b.data.data[i + 2]!) / 12,
        )
        out.data[i] = delta > 0 ? 255 : gray
        out.data[i + 1] = delta > 0 ? 0 : gray
        out.data[i + 2] = delta > 0 ? 255 : gray
        out.data[i + 3] = 255
        if (delta > 0) {
          differing++
          const pixel = i / 4
          const x = pixel % a.width
          const y = Math.floor(pixel / a.width)
          left = Math.min(left, x)
          top = Math.min(top, y)
          right = Math.max(right, x)
          bottom = Math.max(bottom, y)
        }
        maxDelta = Math.max(maxDelta, delta)
      }
      diffContext.putImageData(out, 0, 0)
      return {
        differing,
        total: a.data.data.length / 4,
        maxDelta,
        box: differing > 0 ? { left, top, right, bottom } : null,
        diffUrl: differing > 0 ? diff.toDataURL('image/png') : null,
      }
    },
    [await pngDataUrl(beforePath), await pngDataUrl(afterPath)] as const,
  )

export const model = (page: Page) =>
  page.evaluate(() => (window as any).__model)

export const canvasRect = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('.game-canvas')!
    const r = c.getBoundingClientRect()
    const scale = Math.min(r.width / 320, r.height / 180)
    const w = 320 * scale,
      h = 180 * scale
    return {
      left: r.left + (r.width - w) / 2,
      top: r.top + (r.height - h) / 2,
      scale,
    }
  })

export const toClient = (
  rect: { left: number; top: number; scale: number },
  x: number,
  y: number,
) => ({
  x: rect.left + x * rect.scale,
  y: rect.top + y * rect.scale,
})

export const nearestZombie = (m: any) => {
  const walking = m.zombies.filter((z: any) => z.state._tag !== 'Dying')
  if (walking.length === 0) return undefined
  return walking.reduce((best: any, z: any) =>
    Math.hypot(z.x - m.player.x, z.y - m.player.y) <
    Math.hypot(best.x - m.player.x, best.y - m.player.y)
      ? z
      : best,
  )
}
