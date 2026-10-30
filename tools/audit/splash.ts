// Loads the production build in headless Chrome on a slow network and a slow
// CPU and times the loading splash: the first paint (which must be the
// splash, not a blank or unstyled page), when the game's canvas appears, when
// the game hides the splash, and when the splash leaves the page, on a first
// visit and on a returning player's repeat visit. It saves screenshots along
// the way as `splash-<TAG>-<profile>-<visit>-<moment>.png`.
// It also prints when each load step finished (the `load:<step>` marks from
// src/splash.ts), each move of the progress bar, the main thread's long
// tasks, and with PROFILE=1 the functions that took the most CPU time before
// the splash hid, and with NETWORK=1 every request the page and its workers
// made, with when it started and finished. ONLY=<profile> runs one profile.
//   BASE=http://localhost:4173/ bun splash.ts
import type { BrowserContext } from 'playwright-core'

import { GAME, launch, wait } from './lib'

const BASE = process.env.BASE ?? GAME
const TAG = process.env.TAG ?? 'after'

// NOTE: the first visit loads with the cache off and no save. The repeat
// visit closes that page and opens a new one in the same browser context
// with the cache on, so the assets come from the cache and the save from
// OPFS, as when a returning player opens the app again.
const VISITS = ['first', 'repeat'] as const

type Profile = Readonly<{
  name: string
  latencyMs: number
  downloadKbps: number
  cpuRate: number
}>

const PROFILES: ReadonlyArray<Profile> = [
  { name: 'fast', latencyMs: 0, downloadKbps: 0, cpuRate: 1 },
  { name: 'slow4g', latencyMs: 150, downloadKbps: 1600, cpuRate: 4 },
  { name: 'slow3g', latencyMs: 400, downloadKbps: 400, cpuRate: 6 },
]

const KBPS_TO_BYTES = 1000 / 8
const ONLY = process.env.ONLY
const PROFILE = process.env.PROFILE === '1'
const NETWORK = process.env.NETWORK === '1'
const TOP_FUNCTIONS = 20

type ProfileNode = Readonly<{
  id: number
  callFrame: Readonly<{
    functionName: string
    url: string
    lineNumber: number
  }>
}>

type CpuProfile = Readonly<{
  nodes: ReadonlyArray<ProfileNode>
  samples: ReadonlyArray<number>
  timeDeltas: ReadonlyArray<number>
}>

const topSelfTime = (profile: CpuProfile): ReadonlyArray<string> => {
  const byId = new Map(profile.nodes.map(node => [node.id, node]))
  const selfMs = new Map<string, number>()
  profile.samples.forEach((id, index) => {
    const frame = byId.get(id)?.callFrame
    const name =
      frame === undefined
        ? '?'
        : `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`
    selfMs.set(
      name,
      (selfMs.get(name) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000,
    )
  })
  return [...selfMs.entries()]
    .sort(([, first], [, second]) => second - first)
    .slice(0, TOP_FUNCTIONS)
    .map(([name, ms]) => `${String(Math.round(ms)).padStart(6)} ms  ${name}`)
}

const openPage = async (context: BrowserContext, profile: Profile) => {
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput:
      profile.downloadKbps === 0 ? -1 : profile.downloadKbps * KBPS_TO_BYTES,
    uploadThroughput:
      profile.downloadKbps === 0 ? -1 : profile.downloadKbps * KBPS_TO_BYTES,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate })
  return { page, cdp }
}

const measureVisit = async (visit: Visit) => {
  const { context, profile } = visit
  const { page, cdp } = await openPage(context, profile)
  await cdp.send('Network.setCacheDisabled', {
    cacheDisabled: visit.name === 'first',
  })
  if (PROFILE) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    await cdp.send('Profiler.start')
  }
  const requests: Array<string> = []
  context.removeAllListeners('request')
  context.removeAllListeners('requestfinished')
  const asked = new Map<object, number>()
  const navigationAt = Date.now()
  if (NETWORK) {
    context.on('request', request => asked.set(request, Date.now()))
    context.on('requestfinished', request =>
      requests.push(
        `${String((asked.get(request) ?? navigationAt) - navigationAt).padStart(6)} to ${String(Date.now() - navigationAt).padStart(6)} ms  ${request.url().split('/').pop()?.slice(0, 60)}`,
      ),
    )
  }
  const shots: Array<string> = []
  await page.goto(BASE, { waitUntil: 'commit' })
  const started = Date.now()
  const snap = async (moment: string) => {
    const name = `splash-${TAG}-${profile.name}-${visit.name}-${moment}`
    await page.screenshot({ path: `${import.meta.dir}/shots/${name}.png` })
    shots.push(name)
  }
  await wait(profile.cpuRate === 1 ? 60 : 300)
  await snap('early')
  await page.waitForFunction(
    () => (window as any).__splashTimes?.['splash hiding'] !== undefined,
    undefined,
    { timeout: 120_000 },
  )
  const maybeProfile = PROFILE
    ? ((await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile })
        .profile
    : undefined
  await snap('hiding')
  await page.waitForFunction(
    () => document.getElementById('splash') === null,
    undefined,
    { timeout: 30_000 },
  )
  await snap('ready')
  const times: Record<string, number> = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType('navigation')
    const times = (window as any).__splashTimes
    if (navigation instanceof PerformanceNavigationTiming) {
      times['DOMContentLoaded'] = navigation.domContentLoadedEventStart
      times['load event'] = navigation.loadEventStart
    }
    return times
  })
  console.log(
    `\n${profile.name} ${visit.name} visit (latency ${profile.latencyMs} ms, ${profile.downloadKbps || 'full'} kbps, CPU ${profile.cpuRate}x), ${Date.now() - started} ms wall:`,
  )
  Object.entries(times)
    .sort(([, first], [, second]) => first - second)
    .forEach(([name, ms]) =>
      console.log(`  ${name.padEnd(24)} ${Math.round(ms)} ms`),
    )
  const pageOrigin: number = await page.evaluate(() => performance.timeOrigin)
  for (const worker of page.workers()) {
    const { origin, marks } = await worker.evaluate(() => ({
      origin: performance.timeOrigin,
      marks: performance
        .getEntriesByType('mark')
        .map(mark => [mark.name, mark.startTime] as const),
    }))
    marks.forEach(([name, ms]) =>
      console.log(
        `  worker ${name.padEnd(20)} ${Math.round(ms + origin - pageOrigin)} ms`,
      ),
    )
  }
  const longTasks: ReadonlyArray<[number, number]> = await page.evaluate(
    () => (window as any).__longTasks,
  )
  const hiding = times['splash hiding'] ?? Infinity
  const beforeHiding = longTasks.filter(([start]) => start < hiding)
  console.log(
    `  long tasks before hiding: ${beforeHiding.length}, ${Math.round(beforeHiding.reduce((total, [, duration]) => total + duration, 0))} ms total, longest ${Math.round(Math.max(0, ...beforeHiding.map(([, duration]) => duration)))} ms`,
  )
  beforeHiding.forEach(([start, duration]) =>
    console.log(
      `    at ${String(Math.round(start)).padStart(6)} ms for ${Math.round(duration)} ms`,
    ),
  )
  if (maybeProfile !== undefined) {
    await Bun.write(
      `${import.meta.dir}/shots/splash-${TAG}-${profile.name}-${visit.name}.cpuprofile`,
      JSON.stringify(maybeProfile),
    )
    console.log('  most CPU time before hiding (self, throttled):')
    topSelfTime(maybeProfile).forEach(line => console.log(`    ${line}`))
  }
  if (NETWORK) {
    console.log('  requests (wall clock from navigation):')
    requests.forEach(line => console.log(`    ${line}`))
  }
  console.log(`  shots: ${shots.join(', ')}`)
  await page.close()
}

type Visit = Readonly<{
  name: (typeof VISITS)[number]
  context: BrowserContext
  profile: Profile
}>

const browser = await launch()
for (const profile of PROFILES.filter(
  ({ name }) => ONLY === undefined || ONLY === name,
)) {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await context.addInitScript(() => {
    const times: Record<string, number> = {}
    const longTasks: Array<[number, number]> = []
    ;(window as any).__splashTimes = times
    ;(window as any).__longTasks = longTasks
    new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        longTasks.push([entry.startTime, entry.duration])
      })
    }).observe({ type: 'longtask', buffered: true })
    new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        if (entry.name.startsWith('load:')) {
          times[entry.name] ??= entry.startTime
        }
      })
    }).observe({ type: 'mark', buffered: true })
    new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        times[entry.name] ??= entry.startTime
      })
    }).observe({ type: 'paint', buffered: true })
    new MutationObserver(() => {
      const splash = document.getElementById('splash')
      if (splash !== null) {
        times['splash in DOM'] ??= performance.now()
        const share = splash.style.getPropertyValue('--splash-progress')
        if (share !== '') {
          times[`bar at ${Math.round(Number(share) * 100)}%`] ??=
            performance.now()
        }
      }
      if (splash?.classList.contains('is-gone')) {
        times['splash hiding'] ??= performance.now()
      }
      if (splash === null && times['splash in DOM'] !== undefined) {
        times['splash removed'] ??= performance.now()
      }
      if (document.querySelector('.game-canvas') !== null) {
        times['game canvas'] ??= performance.now()
      }
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })

  for (const name of VISITS) {
    await measureVisit({ name, context, profile })
  }
  await context.close()
}
await browser.close()
