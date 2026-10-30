// Plays co-op through the real game UI, in headless Chrome, two to three
// players each in their own browser context (their own device key, so
// their own player), against a build whose VITE_API_ORIGIN has the room
// Worker and VITE_COOP=On: a local workerd (tools/mp-dev/local.ts) or a pull request
// preview. Each page starts with a save that has finished the tutorial.
// The first creates a room from the CO-OP tile; the rest join from its
// `?room=` link; every seat shows; everyone presses READY and the arena
// opens; everyone walks and sees the others move; one page reloads and
// rejoins its seat; one leaves. With QUICK=1, two fresh pages then press
// QUICK PLAY, take the offer to start with two after 45 s, and must land in
// one room. Screenshots go to `tools/audit/shots/coop-e2e-*.png`.
// Run it through the heavy guard, as a Shared job (one context per page):
//   bun run heavy -- --shared bun tools/audit/coop.ts http://localhost:4398/ [players]
import type { BrowserContext, Page } from 'playwright-core'

import { SHOTS_DIR, finish, launch, wait } from './lib'

const BASE = process.argv[2] ?? process.env.BASE
if (BASE === undefined) {
  console.error('Usage: bun tools/audit/coop.ts <game url> [players]')
  process.exit(2)
}
const PLAYERS = Math.min(3, Math.max(2, Number(process.argv[3] ?? 3)))
const IS_QUICK = process.env.QUICK === '1'
const SAVE_KEY = 'munch-manor:save'

const GRADUATE_SAVE = {
  version: 2,
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
    introducedKinds: [],
  },
  homeScreenTip: 'Dismissed',
  settings: { sound: 'Muted', music: 'Off', shake: 'On' },
  appearance: {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Pink',
    skinTone: 'Tan',
    shirtColor: 'Teal',
  },
  difficulty: { chosen: 'Normal', card: 'Seen', nightmare: 'Locked' },
}

const problems: Array<string> = []

const check = (isOk: boolean, label: string) => {
  console.log(`${isOk ? '  ok  ' : '  FAIL'} ${label}`)
  if (!isOk) {
    problems.push(label)
  }
}

const until = async (
  label: string,
  holds: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<boolean> => {
  const startedMs = Date.now()
  while (Date.now() - startedMs < timeoutMs) {
    if (await holds().catch(() => false)) {
      console.log(`  ok   ${label} (${Date.now() - startedMs} ms)`)
      return true
    }
    await wait(200)
  }
  problems.push(label)
  console.log(`  FAIL ${label}`)
  return false
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS_DIR}/coop-e2e-${name}.png` })

const browser = await launch()
const contexts: Array<BrowserContext> = []

const openPlayer = async (name: string): Promise<Page> => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  })
  contexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', error => problems.push(`${name}: ${error.message}`))
  await page.goto(new URL('version.json', BASE).href)
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [
    SAVE_KEY,
    JSON.stringify(GRADUATE_SAVE),
  ] as const)
  return page
}

const awaitGame = (page: Page) =>
  page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 45_000,
  })

const filledSeats = (page: Page) =>
  page.locator('.coop-seat:not([data-state="Empty"])').count()

const roomCodeOf = async (page: Page): Promise<string> => {
  const label = await page.locator('.coop-room-code').getAttribute('aria-label')
  return (label ?? '').replace('Room code ', '').replaceAll(' ', '')
}

const platesOf = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.coop-plate')).map(
      plate => ({
        me: plate.dataset['me'],
        away: plate.dataset['away'],
        left: plate.style.left,
        top: plate.style.top,
      }),
    ),
  )

// ROOM BY CODE

console.log(`Co-op through the game UI at ${BASE}, ${PLAYERS} players`)
const host = await openPlayer('host')
await host.goto(BASE)
await awaitGame(host)
await host.click('#home-coop')
await until('the CO-OP tile opens the hub', () =>
  host.getByRole('button', { name: /Quick play/ }).isVisible(),
)
await shot(host, 'hub')
await host.getByRole('button', { name: 'Make a room for friends' }).click()
await until(
  'NEW ROOM lands in a lobby with a code',
  async () => (await roomCodeOf(host)).length === 5,
)
const code = await roomCodeOf(host)
console.log(`  room ${code}`)
check(
  new URL(host.url()).searchParams.get('room') === code,
  'the address carries the room code',
)

const guests: Array<Page> = []
for (const index of Array.from({ length: PLAYERS - 1 }, (_, i) => i)) {
  const guest = await openPlayer(`guest ${index + 1}`)
  const link = new URL(BASE)
  link.searchParams.set('room', code)
  await guest.goto(link.href)
  await awaitGame(guest)
  guests.push(guest)
}
const everyone = [host, ...guests]

for (const [index, page] of everyone.entries()) {
  await until(
    `player ${index + 1} sees ${PLAYERS} seats filled`,
    async () => (await filledSeats(page)) === PLAYERS,
  )
}
check(
  (await host.locator('.coop-kick').count()) === PLAYERS - 1,
  'the host can kick each guest',
)
check(
  (await guests[0]!.locator('.coop-kick').count()) === 0,
  'a guest cannot kick',
)
await shot(host, 'lobby-host')
await shot(guests[0]!, 'lobby-guest')

for (const page of everyone.slice(0, -1)) {
  await page.getByRole('button', { name: 'READY' }).click()
}
await until(
  'the READY stamps show on the host',
  async () => (await host.locator('.coop-stamp').count()) === PLAYERS - 1,
)
await shot(host, 'lobby-ready')
await everyone.at(-1)!.getByRole('button', { name: 'READY' }).click()

for (const [index, page] of everyone.entries()) {
  await until(
    `player ${index + 1} is in the arena`,
    async () =>
      (await page.locator('.coop-arena-canvas').count()) === 1 &&
      (await platesOf(page)).length === PLAYERS,
  )
}
await wait(400)
await shot(host, 'countdown')

// WALKING

const before = await platesOf(guests[0]!)
await Promise.all(
  everyone.map((page, index) =>
    page.keyboard.down(index % 2 === 0 ? 'KeyD' : 'KeyA'),
  ),
)
await wait(1500)
await Promise.all(
  everyone.map((page, index) =>
    page.keyboard.up(index % 2 === 0 ? 'KeyD' : 'KeyA'),
  ),
)
await wait(400)
const after = await platesOf(guests[0]!)
const othersMoved = after.filter(
  (plate, index) => plate.me === 'Other' && plate.left !== before[index]?.left,
).length
check(
  othersMoved === PLAYERS - 1,
  `a guest sees the ${PLAYERS - 1} others walk (${othersMoved} moved)`,
)
check(
  after.some(
    plate =>
      plate.me === 'Me' && plate.left !== before.find(p => p.me === 'Me')?.left,
  ),
  'a guest walks its own player',
)
await shot(host, 'arena')
await shot(guests[0]!, 'arena-guest')

// REJOIN

const rejoiner = guests[0]!
await rejoiner.reload()
await awaitGame(rejoiner)
await until(
  'a reloaded guest rejoins the arena from the address',
  async () =>
    (await rejoiner.locator('.coop-plate[data-me="Me"]').count()) === 1,
)
await shot(rejoiner, 'rejoined')

// LEAVE

const leaver = everyone.at(-1)!
await leaver.getByRole('button', { name: 'Leave the room' }).click()
await until('LEAVE lands back on the hub', () =>
  leaver.getByRole('button', { name: /Quick play/ }).isVisible(),
)
check(
  new URL(leaver.url()).searchParams.get('room') === null,
  'leaving clears the room from the address',
)

// QUICK PLAY

if (IS_QUICK) {
  const quick = [await openPlayer('quick 1'), await openPlayer('quick 2')]
  for (const page of quick) {
    await page.goto(BASE)
    await awaitGame(page)
    await page.click('#home-coop')
    await page.getByRole('button', { name: /Quick play/ }).click()
  }
  await until(
    'two queued players see two heads',
    async () =>
      (await quick[0]!
        .locator('.coop-queue-seat[data-state="Filled"]')
        .count()) === 2,
  )
  await shot(quick[0]!, 'queue')
  await until(
    'the offer to start with two comes',
    () => quick[0]!.locator('.coop-offer-start').isVisible(),
    60_000,
  )
  await shot(quick[0]!, 'offer')
  for (const page of quick) {
    await page.locator('.coop-offer-start').click()
  }
  for (const [index, page] of quick.entries()) {
    await until(
      `quick player ${index + 1} lands in a lobby`,
      async () => (await filledSeats(page)) === 2,
    )
  }
  check(
    (await roomCodeOf(quick[0]!)) === (await roomCodeOf(quick[1]!)),
    'both quick players share one room',
  )
  await shot(quick[0]!, 'quick-lobby')
}

for (const context of contexts) {
  await context.close()
}
await browser.close()
finish(problems, 'Co-op played through the game UI with no problems.')
