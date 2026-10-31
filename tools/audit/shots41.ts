// The playtest clarity pass: the first break's trap hint and the trap slot
// that sends players to Rattles, the place-it hint once a trap is owned,
// How to play with a card's line open, the pause screen, the spare gun's
// ammo running low (amber, then red), EMPTY with the knife drawn, Rattles
// calling about ammo, and the shop's gun cards with their rounds, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `s41-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots41.ts
// ONLY picks scenes, such as `ONLY=lowammo`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
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
  act?: (
    page: Page,
    viewport: Viewport,
    problems: Array<string>,
    label: string,
  ) => Promise<void>
}>

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const FIGHTING = `wave=4&seen=all&start=wave&elapsed=9000&god&${LEARNED}`

const press = async (page: Page, viewport: Viewport, name: RegExp) => {
  const button = page.getByRole('button', { name }).first()
  await (viewport.isPhone ? button.tap() : button.click())
}

const openHowToPlay = async (page: Page, viewport: Viewport) => {
  await press(page, viewport, /^More:/)
  await page.locator('dialog[open]').first().waitFor({ state: 'visible' })
  await press(page, viewport, /^How to play:/)
  await page
    .locator('dialog[open] .panel')
    .first()
    .waitFor({ state: 'visible' })
}

// NOTE: a card's line shows on focus with a keyboard and on a tap on touch.
const openCardLine =
  (card: string) =>
  async (
    page: Page,
    viewport: Viewport,
    problems: Array<string>,
    label: string,
  ) => {
    await openHowToPlay(page, viewport)
    const button = page.locator(`#help-card-${card}`)
    if ((await button.count()) === 0) {
      problems.push(`${label}: no ${card} card button`)
      return
    }
    if (viewport.isPhone) {
      await button.tap()
    } else {
      await button.focus()
    }
    await settleAnimations(page)
    const isShown = await page
      .locator(`#help-card-${card}-line`)
      .isVisible()
      .catch(() => false)
    if (!isShown) {
      problems.push(`${label}: the ${card} card's line is not showing`)
    }
  }

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'firstbreak',
    query:
      'wave=2&break=open&breakMs=4000&learned=move,fire,startWave,swap,pickup,timedBreaks',
  },
  { name: 'break', query: `wave=3&prep=15000&${LEARNED}` },
  {
    name: 'traphint',
    query: `wave=3&prep=15000&traphint=Barricade&barricades=2&${LEARNED}`,
  },
  {
    name: 'shoptraps',
    query: `wave=3&prep=15000&money=80&px=270&py=142&${LEARNED}`,
    act: async (page, viewport) => {
      const tab = page.getByRole('tab', { name: /^Traps/ }).first()
      await (viewport.isPhone ? tab.tap() : tab.click())
      await settleAnimations(page)
    },
  },
  {
    name: 'howto',
    query: '',
    act: (page, viewport) => openHowToPlay(page, viewport),
  },
  { name: 'howto-charge', query: '', act: openCardLine('charge') },
  { name: 'pause', query: 'wave=3&seen=all&start=wave&phase=paused' },
  { name: 'ammo', query: `${FIGHTING}&gun=smg&rounds=150&loaded=30&tick=2` },
  { name: 'lowammo', query: `${FIGHTING}&gun=smg&rounds=55&loaded=25&tick=2` },
  { name: 'lastammo', query: `${FIGHTING}&gun=smg&rounds=4&loaded=4&tick=2` },
  {
    name: 'empty',
    query: `${FIGHTING}&gun=smg&rounds=1&loaded=1&aim=160,40&tick=12`,
  },
  {
    name: 'knife',
    query: `${FIGHTING}&first=shotgun&gun=smg&dry&aim=160,40&tick=6`,
  },
  {
    name: 'rattles',
    query: `${FIGHTING}&gun=smg&rounds=25&loaded=25&aim=160,40&tick=40`,
  },
  { name: 'shopguns', query: `wave=5&money=180&px=270&py=142&${LEARNED}` },
  {
    name: 'shopowned',
    query: `wave=5&money=180&gun=smg&rounds=48&loaded=18&px=270&py=142&${LEARNED}`,
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
    const label = `${viewport.name} ${scene.name}`
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    await settleAnimations(page)
    if (scene.act !== undefined) {
      await scene.act(page, viewport, problems, label)
    }
    await shot(page, `s41-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The playtest clarity pass found no problems.')
