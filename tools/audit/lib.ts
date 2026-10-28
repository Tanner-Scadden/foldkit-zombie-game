import {
  chromium,
  type Browser,
  type Page,
  type CDPSession,
} from 'playwright-core'

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

export const desktop = async (browser: Browser) => {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  })
  return ctx.newPage()
}

export const mobile = async (browser: Browser, landscape = false) => {
  const ctx = await browser.newContext({
    viewport: landscape
      ? { width: 844, height: 390 }
      : { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  return ctx.newPage()
}

export const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${import.meta.dir}/shots/${name}.png` })

export const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

export type Touch = { id: number; x: number; y: number }
export const touch = async (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Array<Touch>,
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      radiusX: 4,
      radiusY: 4,
      force: 1,
    })),
  })

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

export const mouseBot = async (
  page: Page,
  ms: number,
  until?: (m: any) => boolean,
) => {
  const rect = await canvasRect(page)
  await page.mouse.move(640, 300)
  await page.mouse.down()
  const end = Date.now() + ms
  while (Date.now() < end) {
    const m = await model(page)
    if (until && until(m)) break
    const z = nearestZombie(m)
    if (z) {
      const p = toClient(rect, z.x, z.y)
      await page.mouse.move(p.x, p.y)
    }
    await wait(40)
  }
  await page.mouse.up()
}

export const walkTo = async (
  page: Page,
  tx: number,
  ty: number,
  maxMs = 6000,
) => {
  const end = Date.now() + maxMs
  const held = new Set<string>()
  const set = async (key: string, on: boolean) => {
    if (on && !held.has(key)) {
      await page.keyboard.down(key)
      held.add(key)
    }
    if (!on && held.has(key)) {
      await page.keyboard.up(key)
      held.delete(key)
    }
  }
  while (Date.now() < end) {
    const m = await model(page)
    const dx = tx - m.player.x,
      dy = ty - m.player.y
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break
    await set('KeyD', dx > 1.5)
    await set('KeyA', dx < -1.5)
    await set('KeyS', dy > 1.5)
    await set('KeyW', dy < -1.5)
    await wait(16)
  }
  for (const k of [...held]) await page.keyboard.up(k)
}
