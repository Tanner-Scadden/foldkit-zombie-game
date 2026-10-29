// The balance targets from GAME_DESIGN.md, as data. The nightly suite and
// the model's tests both read them. Change a target here and in the design
// doc together.

import { Option } from 'effect'

export type Target = Readonly<{
  key: string
  label: string
  maybeMin: Option.Option<number>
  maybeMax: Option.Option<number>
  source: string
}>

const between = (
  key: string,
  label: string,
  min: number,
  max: number,
  source: string,
): Target => ({
  key,
  label,
  maybeMin: Option.some(min),
  maybeMax: Option.some(max),
  source,
})

const atMost = (
  key: string,
  label: string,
  max: number,
  source: string,
): Target => ({
  key,
  label,
  maybeMin: Option.none(),
  maybeMax: Option.some(max),
  source,
})

const BALANCE_PASS = 'Balance pass: the targets'
const LEVELS = 'Difficulty levels and planks as bait: Balance'
const PRINCIPLES = 'Difficulty principles: sawtooth intensity'

// NOTE: the incoming health a second at a peak, against the player's damage
// a second, as the analytical model measures it on Normal.
export const PEAK_RATIO_TARGET: Readonly<{ min: number; max: number }> = {
  min: 1.5,
  max: 2.5,
}
export const PEAK_RATIO_WAVES: ReadonlyArray<number> = [5, 6, 7, 8]

// NOTE: the longest a wave should run, in seconds of the bot's median time
// in the snapshot pass. The model plays faster than the bot, so its own
// wave lengths are held to the same ceilings.
export type WaveLengthTarget = Readonly<{ wave: number; maxSeconds: number }>

export const WAVE_LENGTH_TARGETS: ReadonlyArray<WaveLengthTarget> = [
  { wave: 1, maxSeconds: 40 },
  { wave: 2, maxSeconds: 75 },
  { wave: 3, maxSeconds: 75 },
  { wave: 4, maxSeconds: 75 },
  { wave: 5, maxSeconds: 90 },
  { wave: 6, maxSeconds: 90 },
  { wave: 7, maxSeconds: 90 },
  { wave: 8, maxSeconds: 120 },
]

// NOTE: dead air: the seconds a wave leaves the room empty with nothing at
// a door while spawns are still to come, on the mean run, and the longest
// such stretch in any snapshot run.
export const QUIET_TARGET: Readonly<{
  meanMaxSeconds: number
  longestMaxSeconds: number
}> = {
  meanMaxSeconds: 3,
  longestMaxSeconds: 1.2,
}

const PACING = 'Packs and pacing: no dead air'

export const TARGETS: ReadonlyArray<Target> = [
  between('normal.wins', 'Normal wins (default bot)', 0.15, 0.25, LEVELS),
  between('normal-swap.wins', 'Normal wins (SWAP=1)', 0.3, 0.45, LEVELS),
  between('easy.wins', 'Easy wins', 0.55, 0.7, LEVELS),
  between('hard.wins', 'Hard wins', 0.05, 0.12, LEVELS),
  between('nightmare.wins', 'Nightmare wins', 0.01, 0.04, LEVELS),
  atMost(
    'normal.died.w1-2',
    'Normal deaths in waves 1 and 2',
    0.03,
    BALANCE_PASS,
  ),
  atMost(
    'normal.died.w3-4',
    'Normal deaths in waves 3 and 4',
    0.1,
    BALANCE_PASS,
  ),
  between(
    'normal.died.w5-6',
    'Normal deaths in waves 5 and 6',
    0.25,
    0.35,
    BALANCE_PASS,
  ),
  between(
    'normal.died.peakWave',
    'Normal wave with the most deaths',
    8,
    8,
    BALANCE_PASS,
  ),
  between(
    'normal.medianWin',
    'Normal median win (minutes)',
    7,
    9,
    BALANCE_PASS,
  ),
  between(
    'normal.closeCalls',
    'Normal close calls (share of wins at 1 heart)',
    0.3,
    0.5,
    BALANCE_PASS,
  ),
  ...PEAK_RATIO_WAVES.map(wave =>
    between(
      `model.normal.peakRatio.w${wave}`,
      `Model: wave ${wave} peak incoming hp/s over player dps (Normal)`,
      PEAK_RATIO_TARGET.min,
      PEAK_RATIO_TARGET.max,
      PRINCIPLES,
    ),
  ),
  ...WAVE_LENGTH_TARGETS.flatMap(({ wave, maxSeconds }) => [
    atMost(
      `waves.w${wave}.medianLength`,
      `Wave ${wave} median length in the snapshot pass (seconds)`,
      maxSeconds,
      PACING,
    ),
    atMost(
      `waves.w${wave}.quiet`,
      `Wave ${wave} quiet empty room mid-wave, mean (seconds)`,
      QUIET_TARGET.meanMaxSeconds,
      PACING,
    ),
    atMost(
      `waves.w${wave}.worstQuiet`,
      `Wave ${wave} longest quiet empty room in any run (seconds)`,
      QUIET_TARGET.longestMaxSeconds,
      PACING,
    ),
  ]),
]
