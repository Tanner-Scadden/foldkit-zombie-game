// The update chip, in two parts, as `s26-<TAG>-...png`.
//
// PART=layout (the default) puts a newer build in the harness Model and
// shoots the title, the iPhone tip, Game Over, Victory, both breaks, pause,
// and a wave (which must show no chip) on 667x375, 844x390, and 1280x720. It
// prints the chip's box and any button or panel it overlaps.
//   TAG=after bun shots26.ts
//
// PART=e2e drives the real production build end to end. It builds with
// BUILD_ID=e2e-one, serves dist on 4186 with vite preview, opens the game,
// rebuilds with BUILD_ID=e2e-two while the page stays open, fires
// visibilitychange, waits for the chip, taps it, and checks the reloaded
// page runs the new build. Run it from tools/audit:
//   PART=e2e bun shots26.ts
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_667,
  PHONE_844,
  TAG,
  type Viewport,
  deviceQuery,
  gotoScene,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  settleAnimations,
  shot,
  useHarness,
  wait,
} from './lib'

const PART = process.env['PART'] ?? 'layout'
const ROOT = resolve(import.meta.dir, '../..')

const VIEWPORTS: ReadonlyArray<Viewport> = [PHONE_667, PHONE_844, DESKTOP_1280]

type Scene = Readonly<{ name: string; query: string; hasChip: boolean }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'title', query: '', hasChip: true },
  { name: 'title-iphone', query: 'fit=home', hasChip: true },
  { name: 'title-android', query: 'fit=full&install&bests', hasChip: true },
  { name: 'unwrap', query: 'unwrap', hasChip: true },
  { name: 'greet', query: 'greet', hasChip: true },
  {
    name: 'gameover',
    query: 'wave=4&phase=gameover&stats&tick=72',
    hasChip: false,
  },
  {
    name: 'victory',
    query: 'wave=8&phase=victory&stats&tick=72',
    hasChip: false,
  },
  {
    name: 'break1',
    query: 'wave=2&seen=all&money=45&barricades=1&break=open&px=200&py=100',
    hasChip: false,
  },
  {
    name: 'break2',
    query:
      'wave=3&seen=all&gun=smg&money=120&barricades=1&turrets=1&px=200&py=100',
    hasChip: false,
  },
  {
    name: 'paused',
    query: 'wave=3&seen=all&start=wave&gun=smg&phase=paused&elapsed=6000',
    hasChip: false,
  },
  {
    name: 'wave',
    query: 'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&px=150&py=110',
    hasChip: false,
  },
]

const chipReport = (page: Page) =>
  page.evaluate(() => {
    type Box = { x: number; y: number; width: number; height: number }
    const toBox = (element: Element): Box => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    const overlaps = (a: Box, b: Box) =>
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height
    const chip = document.querySelector('.home-gift')
    if (chip === null) {
      return { chip: undefined, overlaps: [] }
    }
    const chipBox = toBox(chip)
    const others = Array.from(
      document.querySelectorAll(
        'button, .pause-help, .mode-choice, .preparation-controls',
      ),
    )
      .filter(element => element !== chip && element.closest('dialog') === null)
      .filter(element => {
        const box = toBox(element)
        const style = getComputedStyle(element)
        return (
          box.width > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        )
      })
    return {
      chip: { label: chip.textContent, ...chipBox },
      overlaps: others
        .filter(element => overlaps(chipBox, toBox(element)))
        .map(
          element => element.getAttribute('aria-label') ?? element.className,
        ),
    }
  })

const layout = async () => {
  await useHarness()
  const browser = await launch()
  for (const viewport of VIEWPORTS) {
    for (const scene of SCENES) {
      if (!isPickedScene(scene.name)) {
        continue
      }
      const page = await openPage(browser, viewport)
      await gotoScene(
        page,
        harnessUrl(scene.query, 'newer=next', deviceQuery(viewport)),
      )
      await settleAnimations(page)
      const report = await chipReport(page)
      const isRight = (report.chip !== undefined) === scene.hasChip
      console.log(
        `${viewport.name} ${scene.name}: ${
          report.chip === undefined
            ? 'no chip'
            : `chip at ${Math.round(report.chip.x)},${Math.round(report.chip.y)} ${Math.round(report.chip.width)}x${Math.round(report.chip.height)}`
        }${isRight ? '' : ' WRONG'}${
          report.overlaps.length > 0
            ? ` OVERLAPS ${report.overlaps.join(', ')}`
            : ''
        }`,
      )
      await shot(page, `s26-${TAG}-${viewport.name}-${scene.name}`)
      await page.context().close()
    }
  }
  await browser.close()
}

const PREVIEW_PORT = 4186
const PREVIEW = `http://localhost:${PREVIEW_PORT}/`

const build = (id: string) => {
  execFileSync('bun', ['run', 'build'], {
    cwd: ROOT,
    env: { ...process.env, BUILD_ID: id },
    stdio: 'ignore',
  })
  const versionFile = execFileSync('cat', ['dist/version.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
  const bundled = execFileSync('grep', ['-rl', id, 'dist/assets'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim()
  console.log(`built ${id}: version.json ${versionFile}, id in ${bundled}`)
}

const serve = (): ChildProcess =>
  spawn(
    'bunx',
    ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  )

const runningBuild = (page: Page) =>
  page.evaluate(async () => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map(
      script => script.getAttribute('src'),
    )
    return scripts.join(' ')
  })

const e2e = async () => {
  build('e2e-one')
  const server = serve()
  await wait(2500)
  const browser = await launch()
  try {
    const page = await openPage(browser, PHONE_667)
    const versionRequests: Array<string> = []
    page.on('request', request => {
      if (request.url().includes('version.json')) {
        versionRequests.push(request.url())
      }
    })
    await page.goto(PREVIEW)
    await wait(2500)
    console.log(`first load runs ${await runningBuild(page)}`)
    console.log(
      `chip before the rebuild: ${await page.locator('.home-gift').count()}`,
    )
    await shot(page, `s26-${TAG}-e2e-before`)

    build('e2e-two')
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    )
    await page.locator('.home-gift').waitFor({ timeout: 5000 })
    console.log(
      `chip after visibilitychange: ${await page.locator('.home-gift').textContent()}`,
    )
    console.log(`version.json requests: ${versionRequests.join(', ')}`)
    await shot(page, `s26-${TAG}-e2e-chip`)

    await Promise.all([
      page.waitForEvent('load'),
      page.locator('.home-gift').tap(),
    ])
    await wait(2500)
    const reloadedBundle = await runningBuild(page)
    const servedBundle = execFileSync('ls', ['dist/assets'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(name => name.endsWith('.js'))
    console.log(`reloaded page runs ${reloadedBundle}`)
    console.log(`dist now holds ${servedBundle.join(' ')}`)
    console.log(
      `reloaded into the new build: ${servedBundle.some(name => reloadedBundle.includes(name))}`,
    )
    console.log(
      `chip after the reload: ${await page.locator('.home-gift').count()}`,
    )
    const isGreeted = await page
      .locator('dialog[open] .greeting-panel')
      .waitFor({ timeout: 5000 })
      .then(
        () => true,
        () => false,
      )
    console.log(`greeted after the reload: ${isGreeted}`)
    console.log(`address after the reload: ${page.url()}`)
    await wait(1600)
    await shot(page, `s26-${TAG}-e2e-after`)
    await page.keyboard.press('Escape')
    await wait(400)
    console.log(
      `greeting after Escape: ${await page.locator('dialog[open] .greeting-panel').count()}`,
    )
    await page.reload()
    await wait(2500)
    console.log(
      `greeting after another reload: ${await page.locator('dialog[open] .greeting-panel').count()}`,
    )
  } finally {
    await browser.close()
    server.kill()
  }
}

await (PART === 'e2e' ? e2e() : layout())
