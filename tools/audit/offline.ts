// Plays the game with no network, the way it is played on an airplane, in
// headless Chrome against a real production build with its service worker.
//
// 1. Online, a first visit boots and the service worker precaches the game.
// 2. Offline (the browser offline and, locally, the server stopped too): a
//    reload and a cold start in a fresh page of the same browser both show
//    the splash and boot. A run starts and plays, the sound is muted in
//    settings, and after another offline reload it is still muted.
// 3. Back online, locally only: dist is rebuilt with a new BUILD_ID under
//    the open page, the update chip appears, tapping it lands on the new
//    build, and the old build's cache is gone. An offline start afterwards
//    runs the new build.
//
// Run it from the repo root through the guard, with its own preview port:
//   bun run heavy -- bun tools/audit/offline.ts
// Against a deployed copy (steps 1 and 2 only, nothing is built):
//   BASE=https://munch-manor.tanner-scadden.workers.dev/ bun run heavy -- bun tools/audit/offline.ts
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'

import { PHONE_844, launch, wait } from './lib'

const ROOT = resolve(import.meta.dir, '../..')
const PREVIEW_PORT = 4297
const LOCAL = `http://localhost:${PREVIEW_PORT}/`
const BASE = process.env.BASE ?? LOCAL
const IS_LOCAL = BASE === LOCAL
const CACHE_PREFIX = 'munch-manor-'

const failures: Array<string> = []
const check = (isOk: boolean, label: string) => {
  console.log(`${isOk ? 'ok  ' : 'FAIL'} ${label}`)
  if (!isOk) {
    failures.push(label)
  }
}

// BUILD AND SERVE

const build = (id: string) => {
  execFileSync('bun', ['run', 'build'], {
    cwd: ROOT,
    env: { ...process.env, BUILD_ID: id },
    stdio: 'ignore',
  })
  console.log(`built ${id}`)
}

const servedBuild = (): Promise<string | undefined> =>
  fetch(`${LOCAL}version.json`, { cache: 'no-store' })
    .then(response => response.json())
    .then(
      (body: { build?: string }) => body.build,
      () => undefined,
    )

// NOTE: other worktrees run their own servers, so the port must be free
// first, and the server that answers must serve this dist.
const serve = async (): Promise<ChildProcess> => {
  if ((await servedBuild()) !== undefined) {
    throw new Error(`port ${PREVIEW_PORT} is already taken by another server`)
  }
  const expected = JSON.parse(
    readFileSync(resolve(ROOT, 'dist/version.json'), 'utf8'),
  ).build
  const server = spawn(
    'bunx',
    ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  )
  for (const _ of Array.from({ length: 60 })) {
    if ((await servedBuild()) === expected) {
      return server
    }
    await wait(500)
  }
  throw new Error(`vite preview never served ${expected} on ${LOCAL}`)
}

// NOTE: the whole process group, so vite itself stops and not only bunx.
const stop = async (server: ChildProcess | undefined) => {
  if (server?.pid !== undefined && server.exitCode === null) {
    try {
      process.kill(-server.pid)
    } catch {
      server.kill()
    }
  }
  await wait(500)
}

const precacheCount = (): number => {
  const source = readFileSync(resolve(ROOT, 'dist/sw.js'), 'utf8')
  const line = source.split('\n')[1] ?? ''
  return JSON.parse(line.replace(/^const PRECACHE = /, '').replace(/;$/, ''))
    .length
}

// THE PAGE

type Caches = ReadonlyArray<Readonly<{ name: string; entries: number }>>

const gameCaches = (page: Page): Promise<Caches> =>
  page.evaluate(async prefix => {
    const names = (await caches.keys()).filter(name => name.startsWith(prefix))
    return Promise.all(
      names.map(async name => ({
        name,
        entries: (await (await caches.open(name)).keys()).length,
      })),
    )
  }, CACHE_PREFIX)

const isControlled = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker?.controller !== null)

const workerState = (page: Page) =>
  page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      return { support: false }
    }
    const registration = await navigator.serviceWorker.getRegistration()
    return {
      support: true,
      registered: registration !== undefined,
      installing: registration?.installing?.state ?? null,
      waiting: registration?.waiting?.state ?? null,
      active: registration?.active?.state ?? null,
    }
  })

const awaitSplashGone = (page: Page) =>
  page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 30_000,
  })

// NOTE: the splash is in index.html itself, so a shell from the cache shows
// it at once. It is looked for as soon as the document is parsed.
const openGame = async (page: Page, how: () => Promise<unknown>) => {
  await how()
  const isSplashShown = (await page.locator('#splash').count()) === 1
  await awaitSplashGone(page)
  const canvases = await page.locator('.game-surface').count()
  return { isSplashShown, isBooted: canvases > 0 }
}

const goto = (page: Page) => () =>
  page.goto(BASE, { waitUntil: 'domcontentloaded' })

const reload = (page: Page) => () =>
  page.reload({ waitUntil: 'domcontentloaded' })

const runningScript = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]'))
      .map(script => script.getAttribute('src'))
      .join(' '),
  )

// NOTE: the gear on the home menu (#home-settings) opens the Profile on its
// Settings tab, a list named "Game settings" of toggle buttons named by
// their setting, with aria-pressed.
const soundToggle = (page: Page) =>
  page
    .getByRole('list', { name: 'Game settings' })
    .getByRole('button', { name: 'Sound', exact: true })

const openSettings = async (page: Page) => {
  await page.click('#home-settings')
  await soundToggle(page).waitFor({ timeout: 5000 })
}

const isMuted = async (page: Page) => {
  await openSettings(page)
  return (await soundToggle(page).getAttribute('aria-pressed')) === 'false'
}

const frameCount = (page: Page, ms: number) =>
  page.evaluate(
    duration =>
      new Promise<number>(done => {
        const start = performance.now()
        let frames = 0
        const step = (now: number) => {
          frames += 1
          if (now - start < duration) {
            requestAnimationFrame(step)
          } else {
            done(frames)
          }
        }
        requestAnimationFrame(step)
      }),
    ms,
  )

const status = (page: Page) =>
  page.evaluate(
    () => document.querySelector('[role="status"].sr-only')?.textContent ?? '',
  )

// NOTE: touch phone, so the run starts from the PLAY button and the first
// visit picks a difficulty. The player then walks and fires for a while.
const playARun = async (page: Page) => {
  await page.locator('#home-play').tap()
  await wait(400)
  const normal = page.getByRole('button', { name: /^normal/i })
  if ((await normal.count()) > 0) {
    await normal.tap()
  }
  await wait(1500)
  const surface = await page.locator('.game-surface').boundingBox()
  if (surface !== null) {
    for (const _ of [1, 2, 3, 4]) {
      await page.touchscreen.tap(
        surface.x + surface.width * 0.8,
        surface.y + surface.height * 0.4,
      )
      await wait(200)
    }
  }
  return {
    frames: await frameCount(page, 2000),
    status: await status(page),
  }
}

const goOffline = async (
  context: BrowserContext,
  server: ChildProcess | undefined,
) => {
  await context.setOffline(true)
  await stop(server)
}

// THE AUDIT

const offlinePart = async (page: Page) => {
  const online = await openGame(page, goto(page))
  check(online.isBooted, 'online: the first visit boots')
  await page
    .waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
      timeout: 30_000,
    })
    .catch(() => undefined)
  const isFirstControlled = await isControlled(page)
  if (!isFirstControlled) {
    console.log(`worker: ${JSON.stringify(await workerState(page))}`)
    console.log(
      `registering by hand: ${await page.evaluate(() =>
        navigator.serviceWorker.register('sw.js').then(
          registration => `ok, scope ${registration.scope}`,
          (error: unknown) => `failed: ${String(error)}`,
        ),
      )}`,
    )
  }
  check(isFirstControlled, 'online: the service worker controls the page')
  const firstCaches = await gameCaches(page)
  console.log(`caches: ${JSON.stringify(firstCaches)}`)
  check(
    firstCaches.length === 1 && (firstCaches[0]?.entries ?? 0) > 10,
    'online: one cache holds the precached game',
  )
  return firstCaches
}

const main = async () => {
  let server: ChildProcess | undefined
  if (IS_LOCAL) {
    build('offline-one')
    server = await serve()
    console.log(`precache list: ${precacheCount()} files`)
  }
  const browser = await launch()
  const context = await browser.newContext({
    viewport: { width: PHONE_844.width, height: PHONE_844.height },
    deviceScaleFactor: PHONE_844.scale,
    isMobile: true,
    hasTouch: true,
  })
  const errors: Array<string> = []
  context.on('weberror', error => errors.push(error.error().message))
  context.on('console', message => {
    const text = message.text()
    if (message.type() === 'error' || /service ?worker|sw\.js/i.test(text)) {
      console.log(`console ${message.type()}: ${text}`)
    }
  })
  try {
    const page = await context.newPage()
    const firstCaches = await offlinePart(page)
    if (failures.length > 0) {
      throw new Error('the worker never took control, so offline is moot')
    }
    const firstScript = await runningScript(page)

    await goOffline(context, server)
    server = undefined
    const versionOffline = await page.evaluate(() =>
      fetch(`version.json?at=${Date.now()}`, { cache: 'no-store' }).then(
        () => 'answered',
        () => 'failed',
      ),
    )
    check(versionOffline === 'failed', 'offline: version.json is not cached')

    const reloaded = await openGame(page, reload(page))
    check(reloaded.isSplashShown, 'offline reload: the splash shows')
    check(reloaded.isBooted, 'offline reload: the game boots')
    await page.close()

    const cold = await context.newPage()
    const started = await openGame(cold, goto(cold))
    check(started.isSplashShown, 'offline cold start: the splash shows')
    check(started.isBooted, 'offline cold start: the game boots')
    check(
      (await runningScript(cold)) === firstScript,
      'offline cold start: the same build runs',
    )
    const run = await playARun(cold)
    console.log(`run: ${run.frames} frames in 2s, status "${run.status}"`)
    check(run.frames > 30, 'offline: a run plays frames')

    await cold.reload({ waitUntil: 'domcontentloaded' })
    await awaitSplashGone(cold)
    await openSettings(cold)
    if ((await soundToggle(cold).getAttribute('aria-pressed')) !== 'false') {
      await soundToggle(cold).tap()
    }
    await wait(800)
    await openGame(cold, reload(cold))
    check(await isMuted(cold), 'offline: the muted sound outlives a reload')

    if (IS_LOCAL) {
      await updatePart(context, cold, firstCaches[0]?.name ?? '')
    }
  } finally {
    await browser.close()
    await stop(server)
  }
  console.log(
    errors.length === 0
      ? 'no page errors'
      : `page errors: ${errors.join(' | ')}`,
  )
  check(errors.length === 0, 'no page errors')
  if (failures.length > 0) {
    console.log(`${failures.length} failed`)
    process.exit(1)
  }
  console.log('all clear')
}

// NOTE: like PART=e2e in shots26.ts, but with the worker in the loop: the
// new build's worker installs in the background, the chip asks it to take
// over, and the old cache goes with the reload.
const updatePart = async (
  context: BrowserContext,
  page: Page,
  oldCache: string,
) => {
  const server = await serve()
  try {
    await context.setOffline(false)
    await openGame(page, goto(page))
    build('offline-two')
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    )
    await page.locator('.home-gift').waitFor({ timeout: 10_000 })
    check(true, 'update: the chip appears for the new build')
    await Promise.all([
      page.waitForEvent('load', { timeout: 30_000 }),
      page.locator('.home-gift').tap(),
    ])
    await awaitSplashGone(page)
    const servedScripts = readFileSync(resolve(ROOT, 'dist/index.html'), 'utf8')
    const script = await runningScript(page)
    check(
      script !== '' &&
        script.split(' ').every(src => servedScripts.includes(src)),
      'update: the reload lands on the new build',
    )
    await wait(1000)
    const after = await gameCaches(page)
    console.log(`caches after the update: ${JSON.stringify(after)}`)
    check(
      after.every(cache => cache.name !== oldCache) &&
        after.some(cache => cache.name === `${CACHE_PREFIX}offline-two`),
      'update: the old cache is gone, the new one is there',
    )
    check(
      (await page.locator('.home-gift').count()) === 0,
      'update: no chip after the reload',
    )

    await context.setOffline(true)
    await stop(server)
    const cold = await context.newPage()
    const started = await openGame(cold, goto(cold))
    check(
      started.isBooted && (await runningScript(cold)) === script,
      'update: an offline cold start runs the new build',
    )
  } finally {
    await stop(server)
  }
}

await main()
