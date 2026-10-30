import { type Subprocess, spawn } from 'bun'
import { connect } from 'node:net'
import { loadavg } from 'node:os'
import { resolve } from 'node:path'

import { yieldTurnAsync } from '../heavy/turn'
import { launch, wait } from './lib'
import { type FrameRow, calibrationMs, measureScenario } from './measure'

const ROOT = resolve(import.meta.dir, '../..')
const VITE = `${ROOT}/node_modules/.bin/vite`
const BASELINE_PATH = `${import.meta.dir}/frame-baseline.json`

const PORT = Number(process.env.PORT ?? 4179)
const SCENARIO_NAMES = (process.env.SCENARIOS ?? 'worst,endlessCap').split(',')
const RATES = (process.env.RATES ?? '1,4,6').split(',').map(Number)
const SECONDS = Number(process.env.SECONDS ?? 5)
const TRIALS = Number(process.env.TRIALS ?? 2)
const IS_UPDATING = process.env.UPDATE === '1'
const GATE = process.env.GATE ?? 'all'

const JS_TOLERANCE = Number(process.env.JS_TOLERANCE ?? 0.25)
const BUSY_TOLERANCE = Number(process.env.BUSY_TOLERANCE ?? 0.25)
const FPS_TOLERANCE = Number(process.env.FPS_TOLERANCE ?? 0.15)
const P95_TOLERANCE = Number(process.env.P95_TOLERANCE ?? 0.3)

type Baseline = Readonly<{
  recordedAt: string
  calibrationMs: number
  loadAverage: number
  seconds: number
  rows: ReadonlyArray<FrameRow>
}>

const isPortTaken = (port: number) =>
  new Promise<boolean>(done => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      done(true)
    })
    socket.once('error', () => done(false))
  })

const waitForServer = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const isUp = await fetch(url)
      .then(response => response.ok)
      .catch(() => false)
    if (isUp) return
    await wait(100)
  }
  throw new Error(`the harness never answered at ${url}`)
}

const buildHarness = async () => {
  const build = spawn([VITE, 'build', 'tools/audit/harness'], {
    cwd: ROOT,
    stdout: 'ignore',
    stderr: 'inherit',
  })
  if ((await build.exited) !== 0) throw new Error('the harness build failed')
}

const startPreview = (): Subprocess =>
  spawn(
    [
      VITE,
      'preview',
      'tools/audit/harness',
      '--port',
      String(PORT),
      '--strictPort',
    ],
    { cwd: ROOT, stdout: 'ignore', stderr: 'inherit', detached: true },
  )

const stopPreview = (server: Subprocess) => {
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    server.kill()
  }
}

const bestOf = (trials: ReadonlyArray<FrameRow>): FrameRow => {
  const [first, ...rest] = trials
  if (!first) throw new Error('no trials ran')
  return rest.reduce(
    (best, row) => ({
      ...best,
      fps: Math.max(best.fps, row.fps),
      p95: Math.min(best.p95, row.p95),
      median: Math.min(best.median, row.median),
      jsMs: Math.min(best.jsMs, row.jsMs),
      busyMs: Math.min(best.busyMs, row.busyMs),
      updateMean: Math.min(best.updateMean, row.updateMean),
      viewMean: Math.min(best.viewMean, row.viewMean),
    }),
    first,
  )
}

const measureAll = async (base: string) => {
  const browser = await launch()
  const calibration = await calibrationMs(browser)
  const rows: Array<FrameRow> = []
  for (const [index, name] of SCENARIO_NAMES.entries()) {
    // NOTE: under the heavy guard, other jobs may go between scenarios.
    if (index > 0) {
      await yieldTurnAsync(`the ${SCENARIO_NAMES[index - 1]} scenario`, 1)
    }
    for (const rate of RATES) {
      const trials: Array<FrameRow> = []
      for (let trial = 0; trial < TRIALS; trial++) {
        trials.push(await measureScenario(browser, base, name, rate, SECONDS))
      }
      const row = bestOf(trials)
      console.log(
        `${name} ${rate}x: ${row.fps} fps, p95 ${row.p95}ms, js ${row.jsMs}ms (update ${row.updateMean} + view ${row.viewMean}), main thread ${row.busyMs}ms per frame, ${row.shapes} shapes`,
      )
      rows.push(row)
    }
  }
  await browser.close()
  return { calibration, rows }
}

type Check = Readonly<{
  label: string
  measured: number
  limit: number
  isOk: boolean
  isGated: boolean
}>

const checksFor = (
  row: FrameRow,
  baseRow: FrameRow,
  loadFactor: number,
): ReadonlyArray<Check> => {
  const isFrameGated = GATE === 'all'
  const jsLimit = baseRow.jsMs * loadFactor * (1 + JS_TOLERANCE)
  const busyLimit = baseRow.busyMs * loadFactor * (1 + BUSY_TOLERANCE)
  const fpsFloor = baseRow.fps * (1 - FPS_TOLERANCE)
  const p95Limit = baseRow.p95 * (1 + P95_TOLERANCE)
  return [
    {
      label: 'js ms (update + view)',
      measured: row.jsMs,
      limit: jsLimit,
      isOk: row.jsMs <= jsLimit,
      isGated: true,
    },
    {
      label: 'main thread ms per frame',
      measured: row.busyMs,
      limit: busyLimit,
      isOk: row.busyMs <= busyLimit,
      isGated: true,
    },
    {
      label: 'fps',
      measured: row.fps,
      limit: fpsFloor,
      isOk: row.fps >= fpsFloor,
      isGated: isFrameGated,
    },
    {
      label: 'p95 frame ms',
      measured: row.p95,
      limit: p95Limit,
      isOk: row.p95 <= p95Limit,
      isGated: isFrameGated,
    },
  ]
}

const compare = (
  measured: Readonly<{ calibration: number; rows: ReadonlyArray<FrameRow> }>,
  baseline: Baseline,
): boolean => {
  const loadFactor = Math.max(1, measured.calibration / baseline.calibrationMs)
  console.log(
    `\ncalibration ${measured.calibration.toFixed(1)}ms now, ${baseline.calibrationMs.toFixed(1)}ms in the baseline (${baseline.recordedAt}). CPU time limits scale by ${loadFactor.toFixed(2)}.`,
  )
  const failures = measured.rows.flatMap(row => {
    const baseRow = baseline.rows.find(
      candidate =>
        candidate.scenario === row.scenario && candidate.rate === row.rate,
    )
    if (!baseRow) {
      console.log(`${row.scenario} ${row.rate}x: no baseline row, skipped`)
      return []
    }
    return checksFor(row, baseRow, loadFactor).flatMap(check => {
      const verdict = check.isOk ? 'ok' : check.isGated ? 'FAIL' : 'warn'
      console.log(
        `${verdict.padEnd(4)} ${row.scenario} ${row.rate}x ${check.label}: ${check.measured.toFixed(2)} (limit ${check.limit.toFixed(2)})`,
      )
      return !check.isOk && check.isGated
        ? [`${row.scenario} ${row.rate}x ${check.label}`]
        : []
    })
  })
  if (failures.length > 0) {
    console.log(`\nFrame time regressed: ${failures.join(', ')}`)
    return false
  }
  console.log('\nFrame time is within the baseline tolerances.')
  return true
}

const main = async () => {
  const existingBase = process.env.BASE
  const server = existingBase
    ? undefined
    : await (async () => {
        if (await isPortTaken(PORT)) {
          throw new Error(
            `port ${PORT} is already in use. Stop that server or set PORT.`,
          )
        }
        await buildHarness()
        const preview = startPreview()
        await waitForServer(`http://localhost:${PORT}/`)
        return preview
      })()
  try {
    const measured = await measureAll(
      existingBase ?? `http://localhost:${PORT}/`,
    )
    if (IS_UPDATING) {
      const baseline: Baseline = {
        recordedAt: new Date().toISOString(),
        calibrationMs: measured.calibration,
        loadAverage: loadavg()[0] ?? 0,
        seconds: SECONDS,
        rows: measured.rows,
      }
      await Bun.write(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n')
      console.log(`\nWrote ${BASELINE_PATH}`)
      return true
    }
    const file = Bun.file(BASELINE_PATH)
    if (!(await file.exists())) {
      throw new Error('no baseline yet. Run with UPDATE=1 to record one.')
    }
    return compare(measured, await file.json())
  } finally {
    if (server) stopPreview(server)
  }
}

const isPassing = await main()
process.exit(isPassing ? 0 : 1)
