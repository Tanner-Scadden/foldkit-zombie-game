import type { Request } from 'playwright-core'

import { desktop, launch, wait } from './lib'

// Plays the shortest real run end against a deployed copy, from the menu to a
// quit through the pause MENU, and checks that the game posts its run summary
// to the analytics Worker and the Worker accepts it. Run it through the heavy guard:
//
//   bun run heavy -- bun tools/audit/beacon-check.ts https://munch-manor-pr-42.tanner-scadden.workers.dev/

const URL = process.argv[2]
if (URL === undefined) {
  console.error('Usage: bun beacon-check.ts <site url>')
  process.exit(2)
}

const RUNS_PATH = '/api/runs'
const BEACON_WAIT_MS = 10_000

const browser = await launch()
const page = await desktop(browser)

const errors: Array<string> = []
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))

const beacon = new Promise<Request>(resolve => {
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith(RUNS_PATH)) {
      resolve(request)
    }
  })
})

await page.goto(URL, { waitUntil: 'networkidle' })
await wait(2000)
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

const outcome = await Promise.race([
  beacon.then(request => ({ request })),
  wait(BEACON_WAIT_MS).then(() => ({ request: undefined })),
])

// NOTE: Chrome does not hand a beacon's Blob body to Playwright, so the check
// reads the Worker's answer. `bun tools/analytics/report.ts` shows the row.
const response =
  outcome.request === undefined ? null : await outcome.request.response()

await browser.close()

const ACCEPTED = 202
const isOk = response?.status() === ACCEPTED && errors.length === 0

console.log(
  JSON.stringify(
    {
      url: URL,
      beaconUrl: outcome.request?.url(),
      status: response?.status(),
      errors,
    },
    null,
    2,
  ),
)
process.exit(isOk ? 0 : 1)
