// The kitchen pass: the parlour break with the boarded kitchen door's
// prompt, the offer it opens, the boards smashing open, the kitchen mid-wave
// with an oven belching and zombies slipping in soup, and a view up the
// kitchen with the parlour below, on a 1280x720 desktop and a 390x844 phone
// held upright, as `s36-<TAG>-<viewport>-<scene>.png`. It checks that the
// offer opens on a bump and that buying it opens the exit, and exits with 1
// on any miss.
//   TAG=after BASE=http://localhost:4191/ bun shots36.ts
// ONLY picks scenes, such as `ONLY=door,offer`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  UPRIGHT_390,
  deviceQuery,
  finish,
  harnessUrl,
  isPickedScene,
  launch,
  model,
  openPage,
  pickViewports,
  shot,
  tagOr,
  wait,
} from './lib'

const TAG = tagOr('after')

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...UPRIGHT_390, name: 'p390' },
])

type Scene = Readonly<{
  name: string
  query: string
  settleMs: number
  act?: (page: Page, problems: Array<string>, label: string) => Promise<void>
}>

const BREAK = 'wave=3&seen=all&money=85&gun=smg&nodev'

const isOfferOpen = (page: Page) =>
  page.evaluate(() => document.querySelector('.exit-panel') !== null)

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'door',
    query: `${BREAK}&px=70&py=44`,
    settleMs: 700,
  },
  {
    name: 'offer',
    query: `${BREAK}&px=70&py=27`,
    settleMs: 900,
    act: async (page, problems, label) => {
      if (!(await isOfferOpen(page))) {
        problems.push(`${label}: bumping the boarded door opened no offer`)
      }
    },
  },
  {
    name: 'smash',
    query: `${BREAK}&px=70&py=27`,
    settleMs: 900,
    act: async (page, problems, label) => {
      await page.getByRole('button', { name: /Open the kitchen/ }).click()
      await wait(120)
      const current = await model(page)
      if (!current.level.openExits.includes('Kitchen')) {
        problems.push(`${label}: buying the offer left the kitchen shut`)
      }
    },
  },
  {
    name: 'kitchen',
    query:
      'wave=4&seen=all&start=wave&elapsed=9000&kitchen&gun=smg&god&px=96&py=-46&ovens=belch&ovenMs=600000&slip&aim=70,-100&nodev',
    settleMs: 250,
  },
  {
    name: 'wide',
    query: 'wave=5&seen=all&kitchen&money=40&px=70&py=-8&nodev',
    settleMs: 700,
  },
  {
    name: 'preview',
    query: 'wave=5&seen=all&kitchen&money=40&px=150&py=120&nodev',
    settleMs: 700,
  },
]

const browser = await launch()
const problems: Array<string> = []
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) continue
    const page = await openPage(browser, viewport)
    const label = `${viewport.name} ${scene.name}`
    await page.goto(harnessUrl(scene.query, deviceQuery(viewport)))
    await page.waitForSelector('canvas')
    await wait(scene.settleMs)
    if (scene.act !== undefined) {
      await scene.act(page, problems, label)
    }
    await shot(page, `s36-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    await page.context().close()
  }
}
await browser.close()
finish(problems, 'The kitchen pass found no problems.')
