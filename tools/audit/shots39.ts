// The Mystery Leftovers pass: the fridge in the open kitchen with its price
// tag lit and the hold's ring part filled, the reveal (its spin, and each
// prize landed: Cooker, Pan, Brain Freeze, Sandwich, Dud), a weapon on
// offer with its TAKE tag and the gun it would replace, the take's flight
// and the slot's pulse, the fridge chained shut after a slam,
// the Pressure Cooker charging with lids in the air and one bursting, the
// Clang Pan mid-swing with zombies reeling, Brain Freeze spraying with
// zombies frozen and chilled, and the pause screen's control cards, on a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `s39-<TAG>-<viewport>-<scene>.png`. It checks that a hold at
// the fridge pulls it and that the control cards fit without scrolling, and
// exits with 1 on any miss.
//   TAG=after bun run heavy -- bun tools/audit/shots39.ts
// ONLY picks scenes, such as `ONLY=tag,pull`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_844,
  SHOTS_DIR,
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
  // NOTE: a control card's frames take turns through a looping animation,
  // which a shot with animations off holds at a hidden frame, so the pause
  // shot lets them run.
  isAnimated?: boolean
  act?: (page: Page, problems: Array<string>, label: string) => Promise<void>
}>

// NOTE: every scene plays its frames at once with `tick=N` (N frames of
// 1/60 s) and holds there, so each picture is the same on every run. The
// fridge stands in the kitchen's north-east corner, tiles 17 and 18 of rows
// -13 and -12, so (180, -102) is just in reach below its door. The weapon
// scenes stand at (40, -12), on the open floor at the kitchen's foot.
const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const BREAK = `wave=3&seen=all&kitchen&money=200&gun=smg&prep=14000&${LEARNED}`
const AT_FRIDGE = 'px=180&py=-102'
const IN_KITCHEN = `wave=4&seen=all&start=wave&elapsed=9000&kitchen&god&px=40&py=-12&${LEARNED}`

// NOTE: the fridge seed that draws each prize on a first pull, for a player
// holding the Chatterbox. The hold pays on tick 30, so tick 45 is a quarter
// of a second into the reveal's spin, tick 85 shows the prize landed, and
// tick 130 the weapon on offer (the key still held, so it is not taken).
const PRIZE_SEEDS = {
  cooker: 7,
  pan: 1,
  freeze: 2,
  sandwich: 30,
  dud: 4,
} as const

const expectDoor =
  (tag: 'Open' | 'Offering' | 'Shut') =>
  async (page: Page, problems: Array<string>, label: string) => {
    const door = (await model(page)).fridge.door
    if (door._tag !== tag) {
      problems.push(`${label}: the fridge door is ${door._tag}, not ${tag}`)
    }
  }

const PULL_SCENES: ReadonlyArray<Scene> = Object.entries(PRIZE_SEEDS).map(
  ([prize, seed]) => ({
    name: `pull-${prize}`,
    query: `${BREAK}&${AT_FRIDGE}&hold&fridgeseed=${seed}&tick=85`,
    act: expectDoor('Open'),
  }),
)

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'tag',
    query: `${BREAK}&${AT_FRIDGE}&hold&tick=17`,
  },
  {
    name: 'spin',
    query: `${BREAK}&${AT_FRIDGE}&hold&fridgeseed=${PRIZE_SEEDS.freeze}&tick=45`,
    act: expectDoor('Open'),
  },
  ...PULL_SCENES,
  {
    name: 'offer',
    query: `${BREAK}&${AT_FRIDGE}&hold&fridgeseed=${PRIZE_SEEDS.cooker}&tick=130`,
    act: expectDoor('Offering'),
  },
  {
    name: 'take',
    query: `${BREAK}&${AT_FRIDGE}&fridge=offering&prize=Freeze&fridgeMs=5000&hold&tick=40`,
    act: expectDoor('Shut'),
  },
  {
    name: 'take-slot',
    query: `${BREAK}&${AT_FRIDGE}&fridge=offering&prize=Freeze&fridgeMs=5000&hold&tick=60`,
    act: expectDoor('Shut'),
  },
  {
    name: 'slammed',
    query: `${BREAK}&px=160&py=-96&fridge=slammed&fridgeMs=20000&tick=24`,
  },
  {
    name: 'cooker',
    query: `${IN_KITCHEN}&gun=cooker&stick=60,-8&lobs&tick=40`,
  },
  {
    name: 'pan',
    query: `${IN_KITCHEN}&gun=pan&stick=60,0&iced=pan&tick=34`,
  },
  {
    name: 'freeze',
    query: `${IN_KITCHEN}&gun=freeze&stick=60,0&iced=freeze&tick=14`,
  },
  {
    name: 'pause',
    query: 'wave=3&start=wave&phase=paused&tick=24',
    isAnimated: true,
    act: async (page, problems, label) => {
      const fit = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.help-card')]
        const scrolls = [
          document.scrollingElement,
          ...document.querySelectorAll('*'),
        ].filter(
          element =>
            element instanceof HTMLElement &&
            element.scrollHeight > element.clientHeight + 1 &&
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
        ).length
        const off = cards.filter(card => {
          const box = card.getBoundingClientRect()
          return (
            box.left < 0 ||
            box.top < 0 ||
            box.right > window.innerWidth ||
            box.bottom > window.innerHeight
          )
        }).length
        return { count: cards.length, scrolls, off }
      })
      if (fit.count !== 10) {
        problems.push(`${label}: ${fit.count} control cards, not 10`)
      }
      if (fit.off > 0) {
        problems.push(`${label}: ${fit.off} control cards off screen`)
      }
      if (fit.scrolls > 0) {
        problems.push(`${label}: ${fit.scrolls} panels scroll`)
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
    const name = `s39-${TAG}-${viewport.name}-${scene.name}`
    if (scene.isAnimated === true) {
      await page.screenshot({ path: `${SHOTS_DIR}/${name}.png` })
    } else {
      await shot(page, name)
    }
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The Mystery Leftovers pass found no problems.')
