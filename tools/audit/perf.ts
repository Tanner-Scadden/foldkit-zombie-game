import { HARNESS, launch } from './lib'
import { type FrameRow, measureScenario } from './measure'
import { SCENARIOS } from './scenarios'

const BASE = process.env.BASE ?? HARNESS
const SECONDS = Number(process.env.SECONDS ?? 6)
const rates = (process.env.RATES ?? '1,4,6').split(',').map(Number)
const only = process.env.ONLY?.split(',')

const browser = await launch()
const results: Array<FrameRow> = []
for (const name of Object.keys(SCENARIOS)) {
  if (only && !only.includes(name)) continue
  for (const rate of rates) {
    const row = await measureScenario(browser, BASE, name, rate, SECONDS)
    console.log(JSON.stringify(row))
    results.push(row)
  }
}
await browser.close()
await Bun.write(
  `${import.meta.dir}/perf-${process.env.TAG ?? 'run'}.json`,
  JSON.stringify(results, null, 1),
)
