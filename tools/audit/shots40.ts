// The knife and two gun slots pass: the knife in hand mid-slash into a
// Groaner, the HUD's slots with the pistol traded for a Pressure Cooker and
// the knife's slot on their right (with a gun in hand, and with the knife),
// and the shop's GUNS tab offering the Pop Pistol back for $0, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `s40-<TAG>-<viewport>-<scene>.png`. It checks that the knife
// in hand stabs on the trigger, that the three slots share a row with the
// knife's on the right, clear of each other and on screen, and that the
// shop offers the pistol for $0, and exits with 1 on any miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots40.ts
// ONLY picks scenes, such as `ONLY=slash`, and VIEWPORTS picks screens.
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

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const FIGHTING = `wave=4&seen=all&start=wave&elapsed=9000&god&${LEARNED}`

type Edges = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
}>

// NOTE: three slots in one row, the knife's on the right of the guns, none
// covering another, all on screen, on every device.
const checkSlots = async (
  page: Page,
  problems: Array<string>,
  label: string,
): Promise<void> => {
  const slots = await page.evaluate(() =>
    [...document.querySelectorAll('.gun-slot-button')].map(element => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      return {
        slot: element.getAttribute('data-slot') ?? '',
        left,
        right,
        top,
        bottom,
      }
    }),
  )
  if (slots.length !== 3) {
    problems.push(`${label}: ${slots.length} slots, not 3`)
    return
  }
  const knife = slots.find(slot => slot.slot === 'Knife')
  const guns = slots.filter(slot => slot.slot !== 'Knife')
  if (knife === undefined) {
    problems.push(`${label}: no knife slot`)
    return
  }
  if (guns.some(gun => gun.right > knife.left + 1)) {
    problems.push(`${label}: the knife's slot is not right of the guns`)
  }
  if (guns.some(gun => Math.abs(gun.top - knife.top) > 1)) {
    problems.push(`${label}: the knife's slot is not in the guns' row`)
  }
  const overlaps = (a: Edges, b: Edges): boolean =>
    a.left < b.right - 1 &&
    a.right > b.left + 1 &&
    a.top < b.bottom &&
    a.bottom > b.top
  if (guns.some(gun => overlaps(gun, knife))) {
    problems.push(`${label}: the knife's slot covers a gun slot`)
  }
  const size = page.viewportSize()
  if (
    size !== null &&
    slots.some(
      slot =>
        slot.left < 0 ||
        slot.top < 0 ||
        slot.right > size.width ||
        slot.bottom > size.height,
    )
  ) {
    problems.push(`${label}: a slot is off screen`)
  }
}

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'slash',
    query: `${FIGHTING}&gun=smg&iced=pan&stab&tick=4`,
    act: async (page, problems, label) => {
      const current = await model(page)
      if (current.player.knifeCooldownMs <= 0) {
        problems.push(`${label}: the knife in hand did not stab`)
      }
    },
  },
  {
    name: 'slots',
    query: `${FIGHTING}&first=cooker&gun=smg&tier=2&tick=2`,
    act: async (page, problems, label) => checkSlots(page, problems, label),
  },
  {
    name: 'knifed',
    query: `${FIGHTING}&first=cooker&gun=smg&tier=2&knife&tick=2`,
    act: async (page, problems, label) => {
      await checkSlots(page, problems, label)
      const held = await page.evaluate(
        () =>
          document
            .querySelector('.gun-slot-button[data-slot="Knife"]')
            ?.getAttribute('data-held') ?? '',
      )
      if (held !== 'true') {
        problems.push(`${label}: the knife's slot is not held`)
      }
    },
  },
  {
    name: 'shop',
    query: `wave=5&money=180&first=cooker&gun=smg&tier=1&px=270&py=142&${LEARNED}`,
    act: async (page, problems, label) => {
      const row = await page.evaluate(
        () =>
          document
            .querySelector('#shop-item-Pistol')
            ?.getAttribute('aria-label') ?? '',
      )
      if (!row.includes('$0')) {
        problems.push(`${label}: the shop does not offer the pistol for $0`)
      }
    },
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
    }
    await shot(page, `s40-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The knife and two gun slots pass found no problems.')
