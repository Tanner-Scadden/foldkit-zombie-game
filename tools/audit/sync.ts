// Checks player sync end to end against a deployed copy, in headless Chrome,
// with two browser contexts as two devices:
// 1. Device A starts from the live game's version 4 localStorage save (57
//    zombies splatted, What's New seen, no sharing setting yet), syncs with
//    sharing turned on and What's New still seen, changes its shirt, and
//    finishes a run (leaving it from the pause MENU).
// 2. A shows a link code; device B types it under "Use a code".
// 3. B then shows A's shirt, kills, and seen What's New, and says it is
//    linked to 2 devices.
// 4. B turns the music off; A sees it after a reload (a new connection).
// 5. A goes offline, turns screen shake off, says "Offline, will sync",
//    comes back online, catches up, and B sees screen shake off.
// Run it through the heavy guard:
//   bun run heavy -- bun tools/audit/sync.ts https://munch-manor-pr-2.tanner-scadden.workers.dev/
import { readFileSync } from 'node:fs'
import type { BrowserContext, Page } from 'playwright-core'

import { launch, wait } from './lib'

const BASE = process.argv[2] ?? process.env.BASE
if (BASE === undefined) {
  console.error('Usage: bun tools/audit/sync.ts <site url>')
  process.exit(2)
}

const SAVE_KEY = 'munch-manor:save'
const STARTING_KILLS = 57

// NOTE: the newest What's New day, as the build reads it from CHANGELOG.md,
// so a save that has seen it shows no dot on the What's New button.
const NEWEST_NEWS_DAY = (
  readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
    .split('\n')
    .find(line => line.startsWith('## ')) ?? ''
)
  .slice(3)
  .split(': ')[0]
  ?.trim()

// NOTE: the live game's save, as it keeps it in localStorage today.
const olderSave = {
  version: 4,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      shop: 'Learned',
      swap: 'Learned',
      pickup: 'Learned',
      timedBreaks: 'Learned',
      openBreak: 'Learned',
    },
    trapHint: 'Seen',
    introducedKinds: ['Shambler'],
  },
  homeScreenTip: 'Dismissed',
  settings: { sound: 'Muted', music: 'On', shake: 'On' },
  appearance: {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Ginger',
    skinTone: 'Medium',
    shirtColor: 'Teal',
  },
  difficulty: { chosen: 'Normal', card: 'Seen', nightmare: 'Locked' },
  bests: {
    runsPlayed: 3,
    totalKills: STARTING_KILLS,
    killsByKind: { Shambler: 50, Runner: 7 },
    byDifficulty: {
      Easy: { fastestWinMs: null, bestEndlessWave: null },
      Normal: { fastestWinMs: null, bestEndlessWave: null },
      Hard: { fastestWinMs: null, bestEndlessWave: null },
      Nightmare: { fastestWinMs: null, bestEndlessWave: null },
    },
  },
  home: { seenNewsDay: NEWEST_NEWS_DAY, openedEntries: ['Shambler'] },
}

const failures: Array<string> = []
const check = (isOk: boolean, label: string) => {
  console.log(`${isOk ? 'ok  ' : 'FAIL'} ${label}`)
  if (!isOk) {
    failures.push(label)
  }
}

const errors: Array<string> = []
const watch = (page: Page, name: string) => {
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`))
}

const awaitGame = (page: Page) =>
  page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 45_000,
  })

const toggleSelector = (label: string) =>
  `button[aria-label="${label}"][aria-pressed]`

// NOTE: the gear opens the Profile on Settings. Sync, linking, and stats
// sharing live on its Account tab.
type ProfileTab = 'Look' | 'Name' | 'Account' | 'Settings'

const openTab = async (page: Page, tab: ProfileTab) => {
  if ((await page.locator('.profile-dialog[open]').count()) === 0) {
    await page.click('#home-settings')
    await page.waitForSelector('.profile-dialog[open]')
  }
  await page.getByRole('tab', { name: tab }).click()
  await wait(300)
}

const closePanel = async (page: Page) => {
  if ((await page.locator('dialog[open]').count()) > 0) {
    await page.keyboard.press('Escape')
    await wait(400)
  }
}

const tabOf = (label: string): ProfileTab =>
  label === 'Share anonymous play stats' ? 'Account' : 'Settings'

const setting = async (page: Page, label: string) => {
  await openTab(page, tabOf(label))
  return page.locator(toggleSelector(label)).getAttribute('aria-pressed')
}

const flip = async (page: Page, label: string) => {
  await openTab(page, tabOf(label))
  await page.locator(toggleSelector(label)).click()
}

const syncLine = async (page: Page) => {
  await openTab(page, 'Account')
  return (await page.locator('.account-status').textContent()) ?? ''
}

// NOTE: waits on the status line until it says what is expected, checking
// twice a second. Returns the last thing it said.
const waitForLine = async (page: Page, expected: RegExp, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  let line = await syncLine(page)
  while (!expected.test(line) && Date.now() < deadline) {
    await wait(500)
    line = await syncLine(page)
  }
  return line
}

const hasNewsDot = async (page: Page) => {
  await closePanel(page)
  const label =
    (await page.locator('#home-manor').getAttribute('aria-label')) ?? ''
  return label.includes("Something new in What's new")
}

const splatted = async (page: Page) => {
  await closePanel(page)
  const best = page.locator(
    '.home-best:has(.home-best-label:text-is("Zombies splatted")) .home-best-value',
  )
  return (await best.count()) === 0 ? '' : ((await best.textContent()) ?? '')
}

const look = async (page: Page) => {
  await closePanel(page)
  await page.click('.home-hero')
  const preview = page.locator('[aria-label^="Preview:"]')
  await preview.waitFor()
  const label = (await preview.getAttribute('aria-label')) ?? ''
  return label
}

const closeLook = async (page: Page) => {
  await page.keyboard.press('Escape')
  await wait(400)
}

const pickShirt = async (page: Page, color: string) => {
  await look(page)
  await page
    .getByRole('radiogroup', { name: 'Parts' })
    .getByRole('radio', { name: 'Outfit' })
    .click()
  await page
    .getByRole('radiogroup', { name: 'Outfit color' })
    .getByRole('radio', { name: color })
    .click()
  await wait(300)
  await closeLook(page)
}

// NOTE: the shortest real run end: start the campaign, pause, and leave it
// from the MENU. Leaving counts the run.
const finishRun = async (page: Page) => {
  await closePanel(page)
  await page.locator('.game-surface').focus()
  await page.keyboard.press('Enter')
  await wait(800)
  const normal = page.getByRole('button', { name: /^Normal/ })
  if ((await normal.count()) > 0) {
    await normal.first().click()
    await wait(800)
  }
  await page.keyboard.press('Escape')
  await wait(500)
  await page.keyboard.press('KeyH')
  await wait(800)
  await page.getByRole('button', { name: 'Leave' }).click()
  await wait(1000)
}

const newDevice = async (
  name: string,
): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  })
  const page = await context.newPage()
  watch(page, name)
  return { context, page }
}

const SYNC_TIMEOUT = 20_000

const browser = await launch()

console.log(`Checking sync on ${BASE}`)
const a = await newDevice('device A')
await a.page.goto(new URL('version.json', BASE).href)
await a.page.evaluate(([key, json]) => localStorage.setItem(key, json), [
  SAVE_KEY,
  JSON.stringify(olderSave),
] as const)
await a.page.goto(BASE)
await awaitGame(a.page)
check(
  /^Synced/.test(await waitForLine(a.page, /^Synced/, SYNC_TIMEOUT)),
  'device A syncs its older save',
)
check(
  (await splatted(a.page)) === `${STARTING_KILLS}`,
  `device A shows ${STARTING_KILLS} zombies splatted`,
)
check(
  !(await hasNewsDot(a.page)),
  `device A keeps What's New seen (${NEWEST_NEWS_DAY})`,
)
check(
  (await setting(a.page, 'Share anonymous play stats')) === 'true',
  'device A has stats sharing turned on by the migration',
)

await pickShirt(a.page, 'Purple')
check(
  (await look(a.page)).includes('purple vee'),
  'device A changes its shirt to purple',
)
await closeLook(a.page)
await finishRun(a.page)
await wait(1500)

await openTab(a.page, 'Account')
await a.page.getByRole('button', { name: 'Link another device' }).click()
await a.page.locator('.account-code').waitFor({ timeout: SYNC_TIMEOUT })
const code = (
  (await a.page.locator('.account-code').textContent()) ?? ''
).trim()
check(/^[A-Z2-9]{6}$/.test(code), `device A shows a link code (${code})`)

const b = await newDevice('device B')
await b.page.goto(BASE)
await awaitGame(b.page)
check(
  /^Synced/.test(await waitForLine(b.page, /^Synced/, SYNC_TIMEOUT)),
  'device B syncs its own new player',
)
check((await splatted(b.page)) === '', 'device B starts with no kills')
check(await hasNewsDot(b.page), "device B starts with What's New unseen")
await openTab(b.page, 'Account')
await b.page.getByRole('button', { name: 'Use a code' }).click()
const codeForm = b.page.locator('label[for="link-code-input"]')
await codeForm.waitFor({ timeout: SYNC_TIMEOUT })
check(
  ((await codeForm.textContent()) ?? '').includes(
    "This device will use the other device's progress.",
  ),
  "device B's code form says it will use the other device's progress",
)
await b.page.locator('.account-code-input').fill(code.toLowerCase())
await b.page.getByRole('button', { name: 'Link', exact: true }).click()
await b.page
  .getByText("Linked! This device now uses your other device's progress.")
  .waitFor({ timeout: SYNC_TIMEOUT })
check(true, 'device B links with the code')
const bLine = await waitForLine(b.page, /Linked to 2 devices/, SYNC_TIMEOUT)
check(/Linked to 2 devices/.test(bLine), `device B says "${bLine}"`)
check(
  (await splatted(b.page)) === `${STARTING_KILLS}`,
  `device B shows A's ${STARTING_KILLS} zombies splatted`,
)
check(
  (await look(b.page)).includes('purple vee'),
  "device B shows A's purple shirt",
)
await closeLook(b.page)
check(!(await hasNewsDot(b.page)), "device B shows A's What's New as seen")
const aLine = await waitForLine(a.page, /Linked to 2 devices/, SYNC_TIMEOUT)
check(
  /Linked to 2 devices/.test(aLine),
  `device A says "${aLine}" without a reload`,
)

const musicBefore = await setting(b.page, 'Music')
await flip(b.page, 'Music')
const musicSeen: Array<string | null> = []
for (const _ of [1, 2, 3, 4, 5, 6]) {
  await wait(500)
  musicSeen.push(await setting(b.page, 'Music'))
}
check(
  musicSeen.every(value => value === 'false'),
  `device B turns the music off and it stays off (${musicBefore} then ${musicSeen.join(', ')})`,
)
await wait(2000)
await a.page.reload()
await awaitGame(a.page)
await waitForLine(a.page, /^Synced/, SYNC_TIMEOUT)
check(
  (await setting(a.page, 'Music')) === 'false',
  "device A sees B's music setting after a reload",
)

await a.context.setOffline(true)
await wait(1500)
await flip(a.page, 'Screen shake')
const offline = await waitForLine(a.page, /Offline, will sync/, SYNC_TIMEOUT)
check(offline === 'Offline, will sync', `device A offline says "${offline}"`)
await a.context.setOffline(false)
const back = await waitForLine(a.page, /^Synced/, 40_000)
check(/^Synced/.test(back), `device A back online says "${back}"`)
await wait(2000)
await b.page.reload()
await awaitGame(b.page)
await waitForLine(b.page, /^Synced/, SYNC_TIMEOUT)
check(
  (await setting(b.page, 'Screen shake')) === 'false',
  "device B sees A's offline change once A is back",
)

await browser.close()

check(
  errors.length === 0,
  `no page errors${errors.length === 0 ? '' : `: ${errors.join('; ')}`}`,
)
console.log(
  failures.length === 0
    ? 'All sync checks passed.'
    : `${failures.length} checks failed.`,
)
process.exit(failures.length === 0 ? 0 : 1)
