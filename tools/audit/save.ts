// Plays past the wave 1 practice gate in headless Chrome, reloads, and checks
// that the on-device save brought the player back with the gate open, the
// sound still muted, and the save in localStorage.
//   BASE=http://localhost:4173/ bun save.ts
import { GAME, desktop, launch, wait } from './lib'

const BASE = process.env.BASE ?? GAME
const SAVE_KEY = 'munch-manor:save'
const GATE_NOTE = 'The wave waits until you try moving, aiming, and firing.'

const browser = await launch()
const page = await desktop(browser)
const failures: Array<string> = []
const check = (isOk: boolean, label: string) => {
  console.log(`${isOk ? 'ok  ' : 'FAIL'} ${label}`)
  if (!isOk) {
    failures.push(label)
  }
}

const status = () =>
  page.evaluate(
    () => document.querySelector('[role="status"].sr-only')?.textContent ?? '',
  )

const savedLessons = () =>
  page.evaluate(key => {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  }, SAVE_KEY)

const awaitSplashGone = () =>
  page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 30_000,
  })

await page.goto(BASE)
await page.evaluate(key => localStorage.removeItem(key), SAVE_KEY)
await page.reload()
await awaitSplashGone()
check((await savedLessons()) === null, 'a first visit has no save')

await page.keyboard.press('KeyM')
await page.keyboard.press('Enter')
await wait(300)
check(
  (await status()).includes(GATE_NOTE),
  'a new player meets the practice gate',
)

await wait(2600)
await page.keyboard.down('KeyD')
await wait(700)
await page.keyboard.up('KeyD')
const canvas = await page.locator('.game-surface').boundingBox()
if (canvas !== null) {
  await page.mouse.move(
    canvas.x + canvas.width * 0.8,
    canvas.y + canvas.height * 0.3,
  )
  for (const _ of [1, 2, 3, 4, 5]) {
    await page.mouse.down()
    await wait(120)
    await page.mouse.up()
    await wait(250)
  }
}
await wait(400)
check(!(await status()).includes(GATE_NOTE), 'moving and firing opens the gate')
const save = await savedLessons()
check(save?.onboarding?.lessons?.move === 'Learned', 'the move lesson is saved')
check(save?.onboarding?.lessons?.fire === 'Learned', 'the fire lesson is saved')
check(save?.settings?.sound === 'Muted', 'muting is saved')

await page.reload()
await awaitSplashGone()
await page.keyboard.press('Enter')
await wait(300)
check(
  !(await status()).includes(GATE_NOTE),
  'after a reload the gate stays open',
)
check(
  (await savedLessons())?.settings?.sound === 'Muted',
  'after a reload the sound is still muted',
)

await page.evaluate(key => localStorage.setItem(key, '{broken'), SAVE_KEY)
await page.reload()
await awaitSplashGone()
await page.keyboard.press('Enter')
await wait(300)
check((await status()).includes(GATE_NOTE), 'a corrupted save starts fresh')

await browser.close()
if (failures.length > 0) {
  process.exit(1)
}
