import { Schema } from 'effect'

import { WARM_UP_CLASS } from '@game/layers'

import { encodeJson } from '../json'
import { launch, wait } from './lib'

// Loads a deployed copy of the game in headless Chrome and checks that it
// boots: the page answers 200, the four game canvases mount, and nothing
// throws. The sprite warm-up canvases from src/layers.ts are not counted.
// Usage: bun live-check.ts [url]

const URL = process.argv[2] ?? 'https://munchmanor.com/'
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
const canvases = await page
  .locator(`canvas:not(.${WARM_UP_CLASS} canvas):not(canvas.${WARM_UP_CLASS})`)
  .count()
await browser.close()

const status = response?.status() ?? 0
const isOk =
  status === 200 && canvases === EXPECTED_CANVASES && errors.length === 0

const Report = Schema.Struct({
  url: Schema.String,
  status: Schema.Number,
  canvases: Schema.Number,
  errors: Schema.Array(Schema.String),
})

console.log(encodeJson(Report, 2)({ url: URL, status, canvases, errors }))
process.exit(isOk ? 0 : 1)
