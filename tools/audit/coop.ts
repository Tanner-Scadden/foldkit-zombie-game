// Plays co-op through the real game UI, in headless Chrome, two to three
// players each in their own browser context (their own device key, so
// their own player), against a build whose VITE_API_ORIGIN has the room
// Worker and VITE_COOP=On: a local workerd (tools/mp-dev/local.ts) or a pull
// request preview. Each page starts with a save that has finished the
// tutorial. The first creates a room from the CO-OP tile; the rest join from
// its `?room=` link; every seat shows; everyone presses READY and the run
// opens as the game's own scene. Then the real game: everyone walks and
// sees the others move, presses READY to start wave 1 early, and shoots
// zombies with the mouse; the last player walks into the zombies until they
// go down and the first walks over and stands still to revive them; the
// wave is cleared, the next break opens the stall, and the first player
// walks in and buys; everyone presses READY again. One page reloads and
// rejoins its seat; one leaves. It reports each page's round trip, what came
// down a second, and how far its own player was corrected. With QUICK=1, two
// fresh pages then press QUICK PLAY, take the offer to start with two after
// 45 s, and must land in one room. Screenshots go to
// `tools/audit/shots/coop-e2e-*.png`. VIEWPORT=p390 or l844 shoots a phone
// held upright or sideways instead of a desktop (the walking and shooting
// use keys and the mouse either way). PICK=Endless,Hard has the host pick
// that mode and difficulty in the lobby (after a guest's READY, which the
// pick takes back) and checks every page plays it. NET=200,50,2 puts each
// page behind a bad link: a 200 ms round trip, up to 50 ms of jitter, and
// 2% of messages held 200 ms as a lost TCP segment's resend would be,
// order kept (the page's WebSockets are wrapped; Chrome's own throttling
// leaves WebSockets alone). It reports hit registration: the hits each
// page saw its own tracers make against the hits the room confirmed.
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
const [PICK_MODE, PICK_DIFFICULTY] = (process.env.PICK ?? '').split(',')
const [NET_RTT, NET_JITTER, NET_LOSS] = (process.env.NET ?? '')
  .split(',')
  .map(Number)

// NOTE: runs in the page before the game: every WebSocket's sends and
// messages wait half the round trip, plus jitter, plus a resend's delay
// for the lost ones, each in order behind the one before.
const slowSockets = (link: {
  readonly rttMs: number
  readonly jitterMs: number
  readonly lossPercent: number
}) => {
  const Native = window.WebSocket
  const delay = () =>
    link.rttMs / 2 +
    Math.random() * link.jitterMs +
    (Math.random() * 100 < link.lossPercent ? 200 : 0)
  const replayed = new WeakSet<Event>()
  class SlowSocket extends Native {
    private outAt = 0
    private inAt = 0
    constructor(url: string | URL, protocols?: string | Array<string>) {
      super(url, protocols)
      super.addEventListener('message', event => {
        if (replayed.has(event)) {
          return
        }
        event.stopImmediatePropagation()
        const atMs = Math.max(this.inAt, performance.now() + delay())
        this.inAt = atMs
        setTimeout(() => {
          const again = new MessageEvent('message', { data: event.data })
          replayed.add(again)
          this.dispatchEvent(again)
        }, atMs - performance.now())
      })
    }
    override send(data: Parameters<WebSocket['send']>[0]) {
      const atMs = Math.max(this.outAt, performance.now() + delay())
      this.outAt = atMs
      setTimeout(() => {
        if (this.readyState === Native.OPEN) {
          super.send(data)
        }
      }, atMs - performance.now())
    }
  }
  window.WebSocket = SlowSocket
}
const SAVE_KEY = 'munch-manor:save'

const VIEWPORTS: Readonly<
  Record<string, { width: number; height: number; isMobile: boolean }>
> = {
  d1280: { width: 1280, height: 720, isMobile: false },
  l844: { width: 844, height: 390, isMobile: false },
  p390: { width: 390, height: 844, isMobile: false },
}
const VIEWPORT_NAME = process.env.VIEWPORT ?? 'd1280'
const VIEWPORT = VIEWPORTS[VIEWPORT_NAME] ?? VIEWPORTS['d1280']!

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

// NOTE: each player wears their own look, so every page can check that it
// draws the others in theirs.
const LOOKS = [
  {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Pink',
    skinTone: 'Tan',
    shirtColor: 'Teal',
  },
  {
    body: 'Male',
    hairStyle: 'Curls',
    hairColor: 'Blonde',
    skinTone: 'Deep',
    shirtColor: 'Red',
  },
  {
    body: 'Female',
    hairStyle: 'Long',
    hairColor: 'Black',
    skinTone: 'Fair',
    shirtColor: 'Yellow',
  },
]

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
  page.screenshot({
    path: `${SHOTS_DIR}/coop-e2e-${VIEWPORT_NAME === 'd1280' ? '' : `${VIEWPORT_NAME}-`}${name}.png`,
  })

const browser = await launch()
const PHONE_CONTEXT =
  VIEWPORT_NAME === 'd1280' ? {} : { isMobile: true, hasTouch: true }
const contexts: Array<BrowserContext> = []

const openPlayer = async (name: string, lookIndex = 0): Promise<Page> => {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    ...PHONE_CONTEXT,
  })
  contexts.push(context)
  const page = await context.newPage()
  if (NET_RTT !== undefined && !Number.isNaN(NET_RTT)) {
    await page.addInitScript(slowSockets, {
      rttMs: NET_RTT,
      jitterMs: NET_JITTER ?? 0,
      lossPercent: NET_LOSS ?? 0,
    })
  }
  page.on('pageerror', error => problems.push(`${name}: ${error.message}`))
  await page.goto(new URL('version.json', BASE).href)
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [
    SAVE_KEY,
    JSON.stringify({
      ...GRADUATE_SAVE,
      appearance: LOOKS[lookIndex % LOOKS.length],
    }),
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

// THE ROOM'S WORLD, AS THE PAGE DRAWS IT

type Seat = Readonly<{
  slot: number
  x: number
  y: number
  hp: number
  life: string
  ready: string
  kills: number
  money: number
  shop: string
}>

type Readout = Readonly<{
  tick: number
  phase: string
  mode: string
  difficulty: string
  wave: number
  stall: Readonly<{ left: number; top: number; right: number; bottom: number }>
  zombies: ReadonlyArray<Readonly<{ x: number; y: number }>>
  players: ReadonlyArray<Seat>
}>

type Net = Readonly<{
  slot: number
  lookedHits: number
  confirmedHits: number
  delayMs: number
  rttMs: number
  bytesIn: number
  framesIn: number
  inputsOut: number
  nowMs: number
  corrections: number
  correctionPx: number
}>

const netOf = (page: Page): Promise<Net | undefined> =>
  page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('.coop-net')
    if (element === null) {
      return undefined
    }
    const number = (key: string) => Number(element.dataset[key] ?? 0)
    return {
      slot: number('slot'),
      lookedHits: number('lookedHits'),
      confirmedHits: number('confirmedHits'),
      delayMs: number('delay'),
      rttMs: number('rtt'),
      bytesIn: number('bytesIn'),
      framesIn: number('framesIn'),
      inputsOut: number('inputsOut'),
      nowMs: number('now'),
      corrections: number('corrections'),
      correctionPx: number('correctionPx'),
    }
  })

const readoutOf = async (page: Page): Promise<Readout | undefined> => {
  const text = await page
    .locator('.coop-net')
    .getAttribute('data-world')
    .catch(() => null)
  return text === null || text === '' ? undefined : JSON.parse(text)
}

const slotOf = async (page: Page): Promise<number> =>
  (await netOf(page))?.slot ?? -1

const ownSeatOf = async (page: Page): Promise<Seat | undefined> => {
  const [readout, slot] = [await readoutOf(page), await slotOf(page)]
  return readout?.players.find(seat => seat.slot === slot)
}

// NOTE: the parlour fills the 320 by 180 view while the kitchen is shut,
// so the camera stands still and a world point is a fixed point on the
// game canvas.
const toClient = async (page: Page, x: number, y: number) =>
  page.evaluate(
    ([worldX, worldY]) => {
      const canvas = document.querySelector('.game-canvas')
      if (canvas === null) {
        return { x: 0, y: 0 }
      }
      const box = canvas.getBoundingClientRect()
      const scale = Math.min(box.width / 320, box.height / 180)
      return {
        x: box.left + (box.width - 320 * scale) / 2 + worldX * scale,
        y: box.top + (box.height - 180 * scale) / 2 + worldY * scale,
      }
    },
    [x, y] as const,
  )

// CONTROLLERS

const MOVE_KEYS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' }

type Held = { keys: Set<string>; firing: boolean }

const holdKeys = async (page: Page, held: Held, want: Set<string>) => {
  for (const key of held.keys) {
    if (!want.has(key)) {
      await page.keyboard.up(key)
    }
  }
  for (const key of want) {
    if (!held.keys.has(key)) {
      await page.keyboard.down(key)
    }
  }
  held.keys = want
}

const stopAll = async (page: Page, held: Held) => {
  await holdKeys(page, held, new Set())
  if (held.firing) {
    await page.mouse.up()
    held.firing = false
  }
}

const keysToward = (
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  near = 6,
): Set<string> => {
  const keys = new Set<string>()
  if (to.x - from.x > near) keys.add(MOVE_KEYS.right)
  if (from.x - to.x > near) keys.add(MOVE_KEYS.left)
  if (to.y - from.y > near) keys.add(MOVE_KEYS.down)
  if (from.y - to.y > near) keys.add(MOVE_KEYS.up)
  return keys
}

const nearestOf = (
  zombies: Readout['zombies'],
  at: Readonly<{ x: number; y: number }>,
) =>
  zombies.reduce<Readout['zombies'][number] | undefined>(
    (best, zombie) =>
      best === undefined ||
      Math.hypot(zombie.x - at.x, zombie.y - at.y) <
        Math.hypot(best.x - at.x, best.y - at.y)
        ? zombie
        : best,
    undefined,
  )

// NOTE: aims the mouse at the nearest zombie in the parlour and holds the
// trigger; with none in, lets go.
const shootNearest = async (
  page: Page,
  held: Held,
  readout: Readout,
  own: Seat,
) => {
  const target = nearestOf(
    readout.zombies.filter(
      zombie =>
        zombie.x > 0 && zombie.x < 320 && zombie.y > 0 && zombie.y < 180,
    ),
    own,
  )
  if (target === undefined) {
    if (held.firing) {
      await page.mouse.up()
      held.firing = false
    }
    return
  }
  const at = await toClient(page, target.x, target.y)
  await page.mouse.move(at.x, at.y)
  if (!held.firing) {
    await page.mouse.down()
    held.firing = true
  }
}

type Role = 'Fight' | 'Feed' | 'Revive' | 'Shop' | 'Idle'

const PARLOUR_MIDDLE = { x: 160, y: 96 }

// NOTE: one step of one page's player, from what its own page draws.
const drive = async (
  page: Page,
  held: Held,
  role: Role,
  partner: number,
): Promise<void> => {
  const readout = await readoutOf(page)
  const slot = await slotOf(page)
  const own = readout?.players.find(seat => seat.slot === slot)
  if (readout === undefined || own === undefined) {
    return
  }
  if (role === 'Idle' || own.life !== 'Standing') {
    return stopAll(page, held)
  }
  if (role === 'Feed') {
    if (held.firing) {
      await page.mouse.up()
      held.firing = false
    }
    // NOTE: the feeder walks unarmed into the nearest zombie already in the
    // room, never out into a doorway's crowd, so they go down where the
    // others fight and the team stays close.
    const inside = readout.zombies.filter(
      zombie =>
        zombie.x > 24 && zombie.x < 296 && zombie.y > 36 && zombie.y < 168,
    )
    return holdKeys(
      page,
      held,
      keysToward(own, nearestOf(inside, own) ?? PARLOUR_MIDDLE, 2),
    )
  }
  if (role === 'Revive') {
    const downed = readout.players.find(seat => seat.slot === partner)
    const isClose =
      downed !== undefined && Math.hypot(downed.x - own.x, downed.y - own.y) < 9
    await holdKeys(
      page,
      held,
      downed === undefined || isClose ? new Set() : keysToward(own, downed, 3),
    )
    return shootNearest(page, held, readout, own)
  }
  if (role === 'Shop') {
    if (held.firing) {
      await page.mouse.up()
      held.firing = false
    }
    const middleY = (readout.stall.top + readout.stall.bottom) / 2
    const beside = { x: readout.stall.left - 12, y: middleY }
    const isBeside = Math.abs(own.y - middleY) < 4 && own.x < readout.stall.left
    return holdKeys(
      page,
      held,
      own.shop === 'Browsing'
        ? new Set()
        : isBeside
          ? new Set([MOVE_KEYS.right])
          : keysToward(own, beside, 2),
    )
  }
  const leg = Math.floor(Date.now() / 900 + slot) % 4
  const drift = [MOVE_KEYS.right, MOVE_KEYS.down, MOVE_KEYS.left, MOVE_KEYS.up][
    leg
  ]!
  const home =
    Math.hypot(own.x - PARLOUR_MIDDLE.x, own.y - PARLOUR_MIDDLE.y) > 50
  await holdKeys(
    page,
    held,
    home ? keysToward(own, PARLOUR_MIDDLE) : new Set([drift]),
  )
  return shootNearest(page, held, readout, own)
}

const playFor = async (
  everyone: ReadonlyArray<Page>,
  helds: ReadonlyArray<Held>,
  roleOf: (index: number) => Role,
  partner: number,
  isDone: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> => {
  const startedMs = Date.now()
  while (Date.now() - startedMs < timeoutMs) {
    await Promise.all(
      everyone.map((page, index) =>
        drive(page, helds[index]!, roleOf(index), partner).catch(() => {}),
      ),
    )
    if (await isDone().catch(() => false)) {
      return true
    }
    await wait(90)
  }
  return false
}

// ROOM BY CODE

console.log(
  `Co-op through the game UI at ${BASE}, ${PLAYERS} players, ${VIEWPORT_NAME}`,
)
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
  const guest = await openPlayer(`guest ${index + 1}`, index + 1)
  const link = new URL(BASE)
  link.searchParams.set('room', code)
  await guest.goto(link.href)
  await awaitGame(guest)
  guests.push(guest)
}
const everyone = [host, ...guests]
const helds: Array<Held> = everyone.map(() => ({
  keys: new Set(),
  firing: false,
}))

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

const headOf = (page: Page, who: 'Me' | 'Other', at = 0) =>
  page
    .locator(`.coop-seat[data-me="${who}"] .coop-seat-head`)
    .nth(at)
    .evaluate(element => getComputedStyle(element).backgroundImage)
const hostHead = await headOf(host, 'Me')
const guestHead = await headOf(guests[0]!, 'Me')
check(hostHead !== guestHead, 'the host and the guest wear different looks')
check(
  (await headOf(host, 'Other')) === guestHead &&
    (await headOf(guests[0]!, 'Other')) === hostHead,
  'each page draws the other player in their own look',
)

if (PICK_MODE !== undefined && PICK_DIFFICULTY !== undefined) {
  await guests[0]!.getByRole('button', { name: 'READY' }).click()
  await until(
    'a guest READY stamps on the host',
    async () => (await host.locator('.coop-stamp').count()) === 1,
  )
  await host.getByRole('button', { name: PICK_MODE, exact: true }).click()
  await host.getByRole('button', { name: PICK_DIFFICULTY, exact: true }).click()
  for (const [index, page] of everyone.entries()) {
    await until(
      `player ${index + 1} sees ${PICK_MODE} on ${PICK_DIFFICULTY}`,
      async () =>
        (await page
          .locator(`.coop-picks[aria-label="${PICK_MODE}, ${PICK_DIFFICULTY}"]`)
          .count()) === 1,
    )
  }
  await until(
    'the pick takes back the READY stamps',
    async () => (await host.locator('.coop-stamp').count()) === 0,
  )
  await shot(host, 'picks-host')
  await shot(guests[0]!, 'picks-guest')
}

for (const page of everyone.slice(0, -1)) {
  await page.getByRole('button', { name: 'READY' }).click()
}
await until(
  'the READY stamps show on the host',
  async () => (await host.locator('.coop-stamp').count()) === PLAYERS - 1,
)
await everyone.at(-1)!.getByRole('button', { name: 'READY' }).click()

for (const [index, page] of everyone.entries()) {
  await until(
    `player ${index + 1} plays the room's World in the game's own scene`,
    async () =>
      (await readoutOf(page))?.players.length === PLAYERS &&
      (await page.locator('.coop[data-screen="Arena"]').count()) === 1 &&
      (await page.locator('.game-canvas').isVisible()),
  )
}
if (PICK_MODE !== undefined && PICK_DIFFICULTY !== undefined) {
  for (const [index, page] of everyone.entries()) {
    const readout = await readoutOf(page)
    check(
      readout?.mode === PICK_MODE && readout.difficulty === PICK_DIFFICULTY,
      `player ${index + 1} plays ${PICK_MODE} on ${PICK_DIFFICULTY} (${readout?.mode} on ${readout?.difficulty})`,
    )
  }
}
await wait(400)
await shot(host, 'countdown')
const startNet = await Promise.all(everyone.map(netOf))
const startedMs = Date.now()

// NOTE: the link is measured over the fight, while the room still sends,
// or until now on a phone, which only fights for its pictures.
const linkNow = async () => ({
  nets: await Promise.all(everyone.map(netOf)),
  atMs: Date.now(),
})
let linkAtEnd: Awaited<ReturnType<typeof linkNow>> | undefined

// WALKING

const positionsOn = async (page: Page) =>
  new Map((await readoutOf(page))?.players.map(seat => [seat.slot, seat]) ?? [])

const before = await positionsOn(guests[0]!)
await Promise.all(
  everyone.map((page, index) =>
    page.keyboard.down(index % 2 === 0 ? 'KeyD' : 'KeyA'),
  ),
)
await wait(1200)
await Promise.all(
  everyone.map((page, index) =>
    page.keyboard.up(index % 2 === 0 ? 'KeyD' : 'KeyA'),
  ),
)
await wait(400)
const after = await positionsOn(guests[0]!)
const guestSlot = await slotOf(guests[0]!)
const moved = [...after.values()].filter(
  seat => Math.abs(seat.x - (before.get(seat.slot)?.x ?? seat.x)) > 10,
)
check(
  moved.filter(seat => seat.slot !== guestSlot).length === PLAYERS - 1,
  `a guest sees the ${PLAYERS - 1} others walk`,
)
check(
  moved.some(seat => seat.slot === guestSlot),
  'a guest walks its own player, predicted',
)
await shot(guests[0]!, 'walked')

// READY STARTS THE WAVE

for (const page of everyone) {
  await page.keyboard.press('Enter')
}
await until(
  'READY from everyone starts wave 1 before its clock',
  async () => (await readoutOf(host))?.phase === 'Wave',
  4000,
)

// NOTE: a phone draws the upright or sideways layout with its own camera,
// so the scripted mouse aim (which reads the desktop's still parlour) is
// off there: on a phone the players fight a while for the pictures, and
// the desktop run checks the kills, the revive, the break, and the shop.
const isPhone = VIEWPORT_NAME !== 'd1280'

if (isPhone) {
  await playFor(
    everyone,
    helds,
    () => 'Fight',
    -1,
    async () => false,
    12_000,
  )
  // NOTE: keys made each phone a keyboard; a tap makes it a touch screen
  // again, which draws the phone's own layout and its touch controls.
  for (const [index, page] of everyone.entries()) {
    await stopAll(page, helds[index]!)
    await page.touchscreen.tap(VIEWPORT.width / 2, VIEWPORT.height * 0.45)
  }
  await wait(500)
  await shot(host, 'wave')
  await shot(guests[0]!, 'wave-guest')
} else {
  // THE FIGHT AND A REVIVE

  const killsOn = async (page: Page) =>
    (await readoutOf(page))?.players.reduce(
      (sum, seat) => sum + seat.kills,
      0,
    ) ?? 0

  const shotKills = await playFor(
    everyone,
    helds,
    () => 'Fight',
    -1,
    async () => (await killsOn(host)) >= 3,
    60_000,
  )
  check(shotKills, 'the players shoot zombies, each kill to its shooter')
  await shot(host, 'fight')
  await shot(guests[0]!, 'fight-guest')

  const feeder = everyone.length - 1
  const feederSlot = await slotOf(everyone[feeder]!)
  // NOTE: the others hold their fire meanwhile, or they shoot the zombies
  // before any reaches the feeder.
  const downed = await playFor(
    everyone,
    helds,
    index => (index === feeder ? 'Feed' : 'Idle'),
    feederSlot,
    async () =>
      (await readoutOf(host))?.players.find(seat => seat.slot === feederSlot)
        ?.life === 'Downed',
    90_000,
  )
  check(downed, 'a player who walks into the zombies goes down')
  if (downed) {
    await shot(host, 'downed')
    const revived = await playFor(
      everyone,
      helds,
      index => (index === 0 ? 'Revive' : index === feeder ? 'Idle' : 'Fight'),
      feederSlot,
      async () =>
        (await readoutOf(host))?.players.find(seat => seat.slot === feederSlot)
          ?.life === 'Standing',
      12_000,
    )
    check(revived, 'a teammate standing still beside them revives them')
    await shot(host, 'revived')
  }

  linkAtEnd = await linkNow()

  // THE BREAK, THE STALL, AND READY

  // NOTE: the host clears the rest of the wave alone, so its kills pay for
  // something at the stall.
  const cleared = await playFor(
    everyone,
    helds,
    index => (index === 0 ? 'Fight' : 'Idle'),
    -1,
    async () => {
      const readout = await readoutOf(host)
      return readout?.phase === 'Preparation' && readout.wave === 2
    },
    180_000,
  )
  check(cleared, 'the wave is cleared and the next break opens')
  await Promise.all(everyone.map((page, index) => stopAll(page, helds[index]!)))
  await shot(host, 'break')

  const moneyBefore = (await ownSeatOf(host))?.money ?? 0
  const atStall = await playFor(
    everyone,
    helds,
    index => (index === 0 ? 'Shop' : 'Idle'),
    -1,
    async () => (await ownSeatOf(host))?.shop === 'Browsing',
    15_000,
  )
  check(atStall, 'the host walks into the stall')
  await Promise.all(everyone.map((page, index) => stopAll(page, helds[index]!)))
  const shopOpen = await until(
    'the shop dialog opens for the host only',
    async () =>
      (await host.locator('.shop-dialog[open]').count()) >= 1 &&
      (await guests[0]!.locator('.shop-dialog[open]').count()) === 0,
  )
  if (shopOpen) {
    await shot(host, 'shop')
    const available = host.locator(
      '.shop-dialog[open] li[data-verdict="available"] button',
    )
    const tabs = host.locator('.shop-dialog[open] .shop-tab')
    for (const index of Array.from(
      { length: await tabs.count() },
      (_, i) => i,
    )) {
      if ((await available.count()) > 0) {
        break
      }
      await tabs.nth(index).click()
      await wait(200)
    }
    if ((await available.count()) > 0) {
      await shot(host, 'shop-tab')
      await available.first().click()
      await until(
        'a purchase goes to the room and the money comes off',
        async () => ((await ownSeatOf(host))?.money ?? 0) < moneyBefore,
        5000,
      )
    } else {
      console.log(`  note nothing affordable with $${moneyBefore}`)
    }
    await host.keyboard.press('Escape')
    await until(
      'closing the shop tells the room',
      async () => (await ownSeatOf(host))?.shop !== 'Browsing',
      5000,
    )
  }

  for (const page of everyone) {
    await page.keyboard.press('Enter')
  }
  await until(
    'READY over everyone shows, then wave 2 starts',
    async () => (await readoutOf(host))?.phase === 'Wave',
    6000,
  )
}

// THE LINK

const endNet = linkAtEnd ?? (await linkNow())
const seconds = (endNet.atMs - startedMs) / 1000
for (const [index, net] of endNet.nets.entries()) {
  const start = startNet[index]
  if (net === undefined || start === undefined) {
    continue
  }
  const kbps = (net.bytesIn - start.bytesIn) / 1024 / seconds
  const inputs = (net.inputsOut - start.inputsOut) / seconds
  console.log(
    `  player ${index + 1}: round trip ${net.rttMs} ms, down ${kbps.toFixed(2)} KB/s over ${net.framesIn - start.framesIn} messages (${((net.framesIn - start.framesIn) / seconds).toFixed(1)} a second), up ${inputs.toFixed(1)} inputs a second, ${net.corrections} corrections (at most ${net.correctionPx} px)`,
  )
  console.log(
    `  player ${index + 1}: hits seen ${net.lookedHits - start.lookedHits}, confirmed ${net.confirmedHits - start.confirmedHits}; drawn ${net.delayMs} ms behind`,
  )
  check(net.rttMs > 0, `player ${index + 1} measured a round trip`)
}

// REJOIN

const rejoiner = guests[0]!
const rejoinSlot = await slotOf(rejoiner)
await rejoiner.reload()
await awaitGame(rejoiner)
await until(
  'a reloaded guest rejoins its seat from the address',
  async () =>
    (await slotOf(rejoiner)) === rejoinSlot &&
    (await readoutOf(rejoiner))?.players.length === PLAYERS,
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
}

for (const context of contexts) {
  await context.close()
}
await browser.close()
finish(
  problems,
  'Co-op played a real wave through the game UI with no problems.',
)
