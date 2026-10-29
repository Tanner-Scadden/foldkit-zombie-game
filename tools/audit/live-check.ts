import { launch, wait } from './lib'

// Loads a deployed copy of the game in headless Chrome and checks that it
// boots: the page answers 200, the four canvases mount, and nothing throws.
// Usage: bun live-check.ts [url]

const URL = process.argv[2] ?? 'https://munch-manor.tanner-scadden.workers.dev/'
const EXPECTED_CANVASES = 4

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })

const errors: Array<string> = []
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
page.on('console', message =>
  message.type() === 'error'
    ? errors.push(`console: ${message.text()}`)
    : undefined,
)
page.on('requestfailed', request =>
  errors.push(
    `requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`,
  ),
)

const response = await page.goto(URL, { waitUntil: 'networkidle' })
await wait(1500)
const canvases = await page.locator('canvas').count()
await browser.close()

const status = response?.status() ?? 0
const isOk =
  status === 200 && canvases === EXPECTED_CANVASES && errors.length === 0

console.log(JSON.stringify({ url: URL, status, canvases, errors }, null, 2))
process.exit(isOk ? 0 : 1)
