// The knife and two gun slots pass: the knife mid-slash into a Groaner, the
// HUD's two gun slots with the pistol traded for a Pressure Cooker (and on
// touch the knife button beside them), and the shop's GUNS tab offering the
// Pop Pistol back for $0, on a 1280x720 desktop, an 844x390 phone on its
// side, and a 390x844 phone held upright, as
// `s40-<TAG>-<viewport>-<scene>.png`. It checks that holding the knife
// stabs, that the knife button shows on touch only and sits clear of the
// gun slots, and that the shop offers the pistol for $0, and exits with 1
// on any miss.
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

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'slash',
    query: `${FIGHTING}&gun=smg&iced=pan&stab&tick=4`,
    act: async (page, problems, label) => {
      const current = await model(page)
      if (current.player.knifeCooldownMs <= 0) {
        problems.push(`${label}: holding the knife did not stab`)
      }
    },
  },
  {
    name: 'slots',
    query: `${FIGHTING}&first=cooker&gun=smg&tier=2&tick=2`,
    act: async (page, problems, label) => {
      const isTouch = label.startsWith('l844') || label.startsWith('p390')
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector(selector)
          if (element === null) {
            return null
          }
          const { left, right, top, bottom } = element.getBoundingClientRect()
          return { left, right, top, bottom }
        }
        return {
          knife: box('.knife-button'),
          slots: [...document.querySelectorAll('.gun-slot-button')].map(
            element => {
              const { left, right, top, bottom } =
                element.getBoundingClientRect()
              return { left, right, top, bottom }
            },
          ),
        }
      })
      if (isTouch && boxes.knife === null) {
        problems.push(`${label}: no knife button on touch`)
      }
      if (!isTouch && boxes.knife !== null) {
        problems.push(`${label}: a knife button on a keyboard screen`)
      }
      if (boxes.slots.length !== 2) {
        problems.push(`${label}: ${boxes.slots.length} gun slots, not 2`)
      }
      const knife = boxes.knife
      if (knife !== null) {
        const overlaps = boxes.slots.some(
          slot =>
            knife.left < slot.right &&
            knife.right > slot.left &&
            knife.top < slot.bottom &&
            knife.bottom > slot.top,
        )
        if (overlaps) {
          problems.push(`${label}: the knife button covers a gun slot`)
        }
        if (
          knife.left < 0 ||
          knife.top < 0 ||
          knife.right > page.viewportSize()!.width ||
          knife.bottom > page.viewportSize()!.height
        ) {
          problems.push(`${label}: the knife button is off screen`)
        }
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
