// The kitchen pass: the parlour break with the boarded kitchen door's
// price tag, the in-world prompt once the player is in reach, the hold's
// ring filling, a press short of the price, the boards smashing open after
// a hold, the same hold mid-wave, the kitchen mid-wave with an oven
// belching and zombies slipping in soup, and a view up the kitchen with the
// parlour below, on a 1280x720 desktop, an 844x390 phone on its side, and a
// 390x844 phone held upright, as `s36-<TAG>-<viewport>-<scene>.png`. It
// checks that a hold opens the kitchen and a hold short of the price does
// not, and exits with 1 on any miss.
//   TAG=after bun run heavy -- bun tools/audit/shots36.ts
// ONLY picks scenes, such as `ONLY=prompt,ring`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_390,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
  model,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  tagOr,
  useHarness,
} from './lib'

const TAG = tagOr('after')

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
])

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page, problems: Array<string>, label: string) => Promise<void>
}>

// NOTE: every scene but the smash plays its frames at once with `tick=N`
// (N frames of 1/60 s) and holds there, so each picture is the same on every
// run.
const BREAK = 'wave=3&seen=all&money=85&gun=smg'

// NOTE: the smash plays on live frames, since a held frame would hide the
// boards flying and the wallet counting down, and the shot waits for that
// much game time, not wall time: the hold, then a moment of debris.
const HOLD_MS = 500
const SMASH_MS = 120
const WAIT_TIMEOUT_MS = 5000
const afterGameMs = async (page: Page, ms: number) => {
  const start: number = await page.evaluate(
    () => (window as any).__model.elapsedMs,
  )
  await page.waitForFunction(
    end => (window as any).__model.elapsedMs >= end,
    start + ms,
    { polling: 'raf', timeout: WAIT_TIMEOUT_MS },
  )
}

const isKitchenOpen = async (page: Page): Promise<boolean> =>
  (await model(page)).level.openExits.includes('Kitchen')

const AT_BOARDS = 'px=70&py=27'
const MID_WAVE = 'wave=4&seen=all&start=wave&elapsed=6000&money=85&gun=smg'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'door',
    query: `${BREAK}&px=70&py=44&tick=42`,
  },
  {
    name: 'prompt',
    query: `${BREAK}&${AT_BOARDS}&tick=24`,
  },
  {
    name: 'ring',
    query: `${BREAK}&${AT_BOARDS}&hold&tick=17`,
  },
  {
    name: 'short',
    query: `wave=3&seen=all&money=40&gun=smg&${AT_BOARDS}&hold&tick=7`,
    act: async (page, problems, label) => {
      if (await isKitchenOpen(page)) {
        problems.push(`${label}: a hold short of the price opened the kitchen`)
      }
    },
  },
  {
    name: 'smash',
    query: `${BREAK}&${AT_BOARDS}&hold`,
    act: async (page, problems, label) => {
      await afterGameMs(page, HOLD_MS + SMASH_MS)
      if (!(await isKitchenOpen(page))) {
        problems.push(`${label}: holding at the boards left the kitchen shut`)
      }
    },
  },
  {
    name: 'midwave',
    query: `${MID_WAVE}&${AT_BOARDS}&hold&tick=20`,
  },
  {
    name: 'kitchen',
    query:
      'wave=4&seen=all&start=wave&elapsed=9000&kitchen&gun=smg&god&px=96&py=-46&ovens=belch&ovenMs=600000&slip&aim=70,-100&tick=15',
  },
  {
    name: 'wide',
    query: 'wave=5&seen=all&kitchen&money=40&px=70&py=-8&tick=42',
  },
  {
    name: 'preview',
    query: 'wave=5&seen=all&kitchen&money=40&px=150&py=120&tick=42',
  },
]

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
const problems: Array<string> = []
for (const viewport of VIEWPORTS) {
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
    if (scene.act !== undefined) {
      await scene.act(page, problems, label)
      await settleAnimations(page)
    }
    await shot(page, `s36-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The kitchen pass found no problems.')
