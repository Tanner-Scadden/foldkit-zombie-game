// Loads the production build in headless Chrome on a slow network and a slow
// CPU and times the loading splash: the first paint (which must be the
// splash, not a blank or unstyled page), when the game's canvas appears, when
// the game hides the splash, and when the splash leaves the page. It saves
// screenshots along the way as `splash-<TAG>-<profile>-<moment>.png`.
//   BASE=http://localhost:4173/ bun splash.ts
import { GAME, launch, wait } from './lib'

const BASE = process.env.BASE ?? GAME
const TAG = process.env.TAG ?? 'after'

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

const browser = await launch()
for (const profile of PROFILES) {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput:
      profile.downloadKbps === 0 ? -1 : profile.downloadKbps * KBPS_TO_BYTES,
    uploadThroughput:
      profile.downloadKbps === 0 ? -1 : profile.downloadKbps * KBPS_TO_BYTES,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuRate })
  await page.addInitScript(() => {
    const times: Record<string, number> = {}
    ;(window as any).__splashTimes = times
    new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        times[entry.name] ??= entry.startTime
      })
    }).observe({ type: 'paint', buffered: true })
    new MutationObserver(() => {
      const splash = document.getElementById('splash')
      if (splash !== null) {
        times['splash in DOM'] ??= performance.now()
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

  const shots: Array<string> = []
  const navigation = page.goto(BASE, { waitUntil: 'commit' })
  await navigation
  const started = Date.now()
  const snap = async (moment: string) => {
    const name = `splash-${TAG}-${profile.name}-${moment}`
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
  await snap('hiding')
  await page.waitForFunction(
    () => document.getElementById('splash') === null,
    undefined,
    { timeout: 30_000 },
  )
  await snap('ready')
  const times: Record<string, number> = await page.evaluate(
    () => (window as any).__splashTimes,
  )
  console.log(
    `\n${profile.name} (latency ${profile.latencyMs} ms, ${profile.downloadKbps || 'full'} kbps, CPU ${profile.cpuRate}x), ${Date.now() - started} ms wall:`,
  )
  Object.entries(times)
    .sort(([, first], [, second]) => first - second)
    .forEach(([name, ms]) =>
      console.log(`  ${name.padEnd(24)} ${Math.round(ms)} ms`),
    )
  console.log(`  shots: ${shots.join(', ')}`)
  await context.close()
}
await browser.close()
