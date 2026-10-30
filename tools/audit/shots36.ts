// The kitchen pass: the parlour break with the boarded kitchen door's
// prompt, the offer it opens, the boards smashing open, the kitchen mid-wave
// with an oven belching and zombies slipping in soup, and a view up the
// kitchen with the parlour below, on a 1280x720 desktop and a 390x844 phone
// held upright, as `s36-<TAG>-<viewport>-<scene>.png`. It checks that the
// offer opens on a bump and that buying it opens the exit, and exits with 1
// on any miss.
//   TAG=after bun run heavy -- bun tools/audit/shots36.ts
// ONLY picks scenes, such as `ONLY=door,offer`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
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

// NOTE: the bump opens the offer through a Command that runs once the scene
// is in, so a scene that expects it waits for the panel.
const OFFER_TIMEOUT_MS = 5000
const isOfferOpen = (page: Page) =>
  page
    .waitForSelector('.exit-panel', { timeout: OFFER_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false)

// NOTE: the smash plays on live frames, since a held frame would hide the
// boards flying and the wallet counting down, and the shot waits for that
// much game time, not wall time.
const SMASH_MS = 120
const afterGameMs = async (page: Page, ms: number) => {
  const start: number = await page.evaluate(
    () => (window as any).__model.elapsedMs,
  )
  await page.waitForFunction(
    end => (window as any).__model.elapsedMs >= end,
    start + ms,
    { polling: 'raf', timeout: OFFER_TIMEOUT_MS },
  )
}

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'door',
    query: `${BREAK}&px=70&py=44&tick=42`,
  },
  {
    name: 'offer',
    query: `${BREAK}&px=70&py=27&tick=54`,
    act: async (page, problems, label) => {
      if (!(await isOfferOpen(page))) {
        problems.push(`${label}: bumping the boarded door opened no offer`)
      }
    },
  },
  {
    name: 'smash',
    query: `${BREAK}&px=70&py=27`,
    act: async (page, problems, label) => {
      await isOfferOpen(page)
      await page.getByRole('button', { name: /Open the kitchen/ }).click()
      await afterGameMs(page, SMASH_MS)
      const current = await model(page)
      if (!current.level.openExits.includes('Kitchen')) {
        problems.push(`${label}: buying the offer left the kitchen shut`)
      }
    },
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
    if (!isPickedScene(scene.name)) continue
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
