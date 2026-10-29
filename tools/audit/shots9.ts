import { readdirSync } from 'node:fs'

import {
  BASE,
  SHOTS_DIR,
  comparePngs,
  desktop,
  launch,
  mobile,
  model,
  shot,
  tagOr,
  wait,
} from './lib'

const TAG = tagOr('now')

const scenes: ReadonlyArray<
  Readonly<{ name: string; q: string; isMobile?: boolean }>
> = [
  { name: 'title', q: '?freeze=40' },
  { name: 'prep', q: '?wave=2&prep=60000&freeze=40' },
  {
    name: 'worst',
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=220,50&freeze=75',
  },
  {
    name: 'worst-later',
    q: '?wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
  },
  {
    name: 'endless15',
    q: '?wave=15&mode=endless&start=wave&god&gun=smg&tier=3&fill&aim=100,120&freeze=150',
  },
  { name: 'gameover', q: '?wave=5&phase=gameover&stats&freeze=90' },
  { name: 'victory', q: '?wave=8&phase=victory&stats&freeze=90' },
  {
    name: 'touch',
    q: '?device=touch&wave=3&start=wave&god&fill&crowd=10&freeze=60',
    isMobile: true,
  },
  {
    name: 'touch-shake',
    q: '?device=touch&wave=8&start=wave&god&gun=smg&fill&crowd=30&aim=60,140&freeze=200',
    isMobile: true,
  },
]

const browser = await launch()
for (const scene of scenes) {
  const page = scene.isMobile
    ? await mobile(browser, true)
    : await desktop(browser)
  await page.goto(BASE + scene.q)
  await wait(2500)
  const m = await model(page)
  await shot(page, `s9-${TAG}-${scene.name}`)
  console.log(
    scene.name,
    `shake ${JSON.stringify(m.shake.offset)}`,
    `zombies ${m.zombies.length} particles ${m.particles.length} decals ${m.decals.length}`,
  )
  await page.context().close()
}

if (process.env.COMPARE) {
  const page = await desktop(browser)
  const files = readdirSync(SHOTS_DIR)
  for (const scene of scenes) {
    const before = `s9-${process.env.COMPARE}-${scene.name}.png`
    const after = `s9-${TAG}-${scene.name}.png`
    if (!files.includes(before) || !files.includes(after)) continue
    const result = await comparePngs(
      page,
      `${SHOTS_DIR}/${before}`,
      `${SHOTS_DIR}/${after}`,
    )
    console.log(
      `${scene.name}: ${result.differing} of ${result.total} pixels differ, max channel delta ${result.maxDelta}`,
    )
  }
}
await browser.close()
