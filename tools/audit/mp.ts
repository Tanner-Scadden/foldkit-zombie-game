// Checks co-op rooms on a deployed copy, in headless Chrome: two to four
// pages of the co-op dev page (tools/mp-dev) as separate players. The first
// creates a room; the rest join from its link; the run starts when every
// page has pressed READY, and each page walks in circles (`?bot=1`). Then it
// checks that every page sees every other page's dot move, measures the
// round trip and the bandwidth each page reports, reloads one page to
// rejoin its seat, and has the host end the run, which every page must
// hear. Last, as many fresh pages press QUICK PLAY (`?quick=1`, which also
// accepts an offer to start with fewer, so 2 or 3 players wait about 45 s)
// and must land in one public room together.
// Run it through the heavy guard, as a Shared job (one context per page):
//   bun run heavy -- --shared bun tools/audit/mp.ts https://munch-manor-mp-dev-pr-12.tanner-scadden.workers.dev/ [players]
import { Duration, Effect, Schedule, Schema } from 'effect'
import type { BrowserContext, Page } from 'playwright-core'

import { decodeJson, encodeJson } from '../json'
import { SHOTS_DIR, finish, launch, pollUntil, wait } from './lib'

const BASE = process.argv[2] ?? process.env['BASE']
if (BASE === undefined) {
  console.error('Usage: bun tools/audit/mp.ts <co-op dev page url> [players]')
  process.exit(2)
}
const PLAYERS = Math.min(4, Math.max(2, Number(process.argv[3] ?? 3)))
const PLAY_SECONDS = 12

// NOTE: the dev page's `#debug` readout, the fields this audit reads.
const Debug = Schema.Struct({
  code: Schema.String,
  visibility: Schema.NullOr(Schema.String),
  names: Schema.Array(Schema.String),
  slot: Schema.NullOr(Schema.Number),
  phase: Schema.String,
  lobbyStatus: Schema.NullOr(Schema.String),
  members: Schema.Number,
  rttMs: Schema.Number,
  downKBs: Schema.Number,
  inputsPerSecond: Schema.Number,
  bytesIn: Schema.Number,
  framesIn: Schema.Number,
  framesOut: Schema.Number,
  corrections: Schema.Number,
  maxCorrectionPx: Schema.Number,
  tick: Schema.NullOr(Schema.Number),
  others: Schema.Array(
    Schema.Struct({
      slot: Schema.Number,
      x: Schema.Number,
      away: Schema.Boolean,
    }),
  ),
})
type Debug = typeof Debug.Type
const decodeDebug = decodeJson(Debug)

const problems: Array<string> = []

const debugOf = async (page: Page): Promise<Debug | undefined> => {
  const text = await page.locator('#debug').textContent()
  if (text === null || text === '') {
    return undefined
  }
  return decodeDebug(text)
}

const until = async (
  what: string,
  pages: ReadonlyArray<Page>,
  holds: (debug: Debug) => boolean,
  timeoutMs = 20_000,
): Promise<boolean> => {
  const { last: isMet, elapsedMs } = await pollUntil(
    async () =>
      (await Promise.all(pages.map(debugOf))).every(
        debug => debug !== undefined && holds(debug),
      ),
    isDone => isDone,
    250,
    timeoutMs,
  )
  if (isMet) {
    console.log(`  ok  ${what} (${elapsedMs} ms)`)
    return true
  }
  problems.push(what)
  console.log(`  FAIL ${what}`)
  return false
}

const withBot = (url: string, name: string, code?: string): string => {
  const next = new URL(url)
  next.searchParams.set('bot', '1')
  next.searchParams.set('name', name)
  if (code !== undefined) {
    next.searchParams.set('room', code)
  }
  return next.toString()
}

const NAMES = ['Ana', 'Bo', 'Cy', 'Dee']

const browser = await launch()
const contexts: Array<BrowserContext> = []
const pages: Array<Page> = []

for (let index = 0; index < PLAYERS; index += 1) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 820 },
  })
  contexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', error =>
    problems.push(`page ${index}: ${error.message}`),
  )
  pages.push(page)
}

const [host, ...guests] = pages
if (host === undefined) {
  throw new Error('No host page')
}

console.log(`Co-op check with ${PLAYERS} players against ${BASE}`)
await host.goto(withBot(BASE, NAMES[0] ?? 'Ana'))
await host
  .locator('#status')
  .filter({ hasText: 'Signed in' })
  .waitFor({ timeout: 20_000 })
await host.locator('#create').click()
await host.waitForURL(/room=/, { timeout: 20_000 })
const code = new URL(host.url()).searchParams.get('room') ?? ''
console.log(`  ok  the host created room ${code}`)

await Promise.all(
  guests.map((page, index) =>
    page.goto(withBot(BASE, NAMES[index + 1] ?? 'Zed', code)),
  ),
)
await until(
  `every page shows ${PLAYERS} members by name`,
  pages,
  debug =>
    debug.members === PLAYERS &&
    [...debug.names].sort().join(',') ===
      NAMES.slice(0, PLAYERS).sort().join(','),
)

for (const page of pages) {
  await page.locator('#ready:not([disabled])').click()
}
await until(
  'the last READY starts the run on every page',
  pages,
  debug => debug.phase === 'Playing' && debug.tick !== null,
)

const seen = new Map<number, Map<number, Set<number>>>()
const statsOfAll = Effect.promise(() => Promise.all(pages.map(debugOf)))
const watchOthers = Effect.promise(async () => {
  const debugs = await Promise.all(pages.map(debugOf))
  debugs.forEach((debug, index) => {
    debug?.others.forEach(other => {
      const byOther = seen.get(index) ?? new Map<number, Set<number>>()
      const xs = byOther.get(other.slot) ?? new Set<number>()
      xs.add(Math.round(other.x))
      byOther.set(other.slot, xs)
      seen.set(index, byOther)
    })
  })
})
// NOTE: the play is timed from the first readout to the last, so the rates
// below are over the whole play.
const [played, [firstStats, lastStats]] = await Effect.runPromise(
  Effect.timed(
    Effect.all([
      statsOfAll,
      watchOthers.pipe(
        Effect.repeat(
          Schedule.spaced(Duration.millis(200)).pipe(
            Schedule.upTo({ duration: Duration.seconds(PLAY_SECONDS) }),
          ),
        ),
        Effect.andThen(statsOfAll),
      ),
    ]),
  ),
)
pages.forEach((_, index) => {
  const byOther = seen.get(index)
  const moved = [...(byOther?.values() ?? [])].filter(xs => xs.size > 10).length
  if (moved < PLAYERS - 1) {
    problems.push(`page ${index} saw ${moved} of ${PLAYERS - 1} others move`)
  } else {
    console.log(`  ok  page ${index} saw all ${PLAYERS - 1} others move`)
  }
})

const seconds = Duration.toMillis(played) / 1000
const measured = lastStats.map((debug, index) => {
  const first = firstStats[index]
  return {
    page: index,
    slot: debug?.slot,
    rttMs: debug?.rttMs,
    downKBsWindow: Number(debug?.downKBs.toFixed(2)),
    downKBsRun: Number(
      (
        ((debug?.bytesIn ?? 0) - (first?.bytesIn ?? 0)) /
        1024 /
        seconds
      ).toFixed(2),
    ),
    messagesInPerSecond: Number(
      (((debug?.framesIn ?? 0) - (first?.framesIn ?? 0)) / seconds).toFixed(1),
    ),
    messagesOutPerSecond: Number(
      (((debug?.framesOut ?? 0) - (first?.framesOut ?? 0)) / seconds).toFixed(
        1,
      ),
    ),
    inputsPerSecond: Number(debug?.inputsPerSecond.toFixed(1)),
    corrections: debug?.corrections,
    maxCorrectionPx: Number(debug?.maxCorrectionPx.toFixed(1)),
  }
})
console.log('  measured over the play:')
const Measured = Schema.Struct({
  page: Schema.Number,
  slot: Schema.optional(Schema.NullOr(Schema.Number)),
  rttMs: Schema.optional(Schema.Number),
  downKBsWindow: Schema.Number,
  downKBsRun: Schema.Number,
  messagesInPerSecond: Schema.Number,
  messagesOutPerSecond: Schema.Number,
  inputsPerSecond: Schema.Number,
  corrections: Schema.optional(Schema.Number),
  maxCorrectionPx: Schema.Number,
})
const encodeMeasured = encodeJson(Measured)
measured.forEach(row => console.log(`    ${encodeMeasured(row)}`))

await Promise.all(
  pages.map((page, index) =>
    page.screenshot({ path: `${SHOTS_DIR}/mp-${PLAYERS}p-page${index}.png` }),
  ),
)
console.log(`  shots in ${SHOTS_DIR}/mp-${PLAYERS}p-page*.png`)

const rejoining = guests[0]
if (rejoining !== undefined) {
  const before = await debugOf(rejoining)
  await rejoining.reload()
  await until(
    'a reloaded page rejoins its seat and plays again',
    [rejoining],
    debug => debug.phase === 'Playing' && debug.slot === before?.slot,
  )
  await until(
    'nobody shows the reloaded player as away',
    [host],
    debug => debug.others.every(other => !other.away),
    10_000,
  )
}

await host.locator('#end:not([disabled])').click()
await until(
  'every page hears the game end',
  pages,
  debug => debug.phase === 'Ended',
)
await until(
  'every lobby is back for another run',
  pages,
  debug => debug.lobbyStatus === 'Lobby',
)
await pages[0]?.screenshot({ path: `${SHOTS_DIR}/mp-${PLAYERS}p-ended.png` })
await Promise.all(contexts.map(context => context.close()))

const quickContexts: Array<BrowserContext> = []
const quickPages: Array<Page> = []
for (let index = 0; index < PLAYERS; index += 1) {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 820 },
  })
  quickContexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', error =>
    problems.push(`quick page ${index}: ${error.message}`),
  )
  const url = new URL(withBot(BASE, `Quick ${index + 1}`))
  url.searchParams.set('quick', '1')
  await page.goto(url.toString())
  quickPages.push(page)
  await wait(300)
}
await quickPages[0]?.screenshot({
  path: `${SHOTS_DIR}/mp-${PLAYERS}p-queue.png`,
})
await until(
  `${PLAYERS} QUICK PLAY pages land in one public room`,
  quickPages,
  debug => debug.visibility === 'Public' && debug.members === PLAYERS,
  PLAYERS === 4 ? 30_000 : 90_000,
)
const quickCodes = new Set(
  (await Promise.all(quickPages.map(debugOf))).map(debug => debug?.code),
)
if (quickCodes.size !== 1) {
  problems.push(`QUICK PLAY made ${quickCodes.size} rooms`)
}
await quickPages[0]?.screenshot({
  path: `${SHOTS_DIR}/mp-${PLAYERS}p-quick-lobby.png`,
})
await Promise.all(quickContexts.map(context => context.close()))
await browser.close()
finish(problems, `Co-op with ${PLAYERS} players works on ${BASE}`)
