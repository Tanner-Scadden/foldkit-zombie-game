import { Array, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { MS_PER_SECOND } from './constants'
import {
  GameEvent,
  type KillCounts,
  type Model,
  type RunStats,
  type ZombieKind,
} from './model'

// TALLY

const addKill = (kills: KillCounts, kind: ZombieKind): KillCounts =>
  modifyFields(kills, {
    Shambler: count => (kind === 'Shambler' ? count + 1 : count),
    Runner: count => (kind === 'Runner' ? count + 1 : count),
    Tank: count => (kind === 'Tank' ? count + 1 : count),
    Exploder: count => (kind === 'Exploder' ? count + 1 : count),
    Thrower: count => (kind === 'Thrower' ? count + 1 : count),
    Crawler: count => (kind === 'Crawler' ? count + 1 : count),
    Boss: count => (kind === 'Boss' ? count + 1 : count),
  })

const killedKinds = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<ZombieKind> =>
  pipe(
    events,
    Array.filter(GameEvent.isAnyOf(['ZombieKilled'])),
    Array.map(({ kind }) => kind),
  )

const clearedWaves = (events: ReadonlyArray<GameEvent>): number =>
  Array.filter(events, GameEvent.isAnyOf(['WaveCleared'])).length

export const tallyFrame = (
  before: Model,
  after: Model,
  deltaMs: number,
): Model =>
  modifyFields(after, {
    stats: stats =>
      modifyFields(stats, {
        kills: kills =>
          Array.reduce(killedKinds(after.frameEvents), kills, addKill),
        wavesCleared: count => count + clearedWaves(after.frameEvents),
        heartsLost: count =>
          count + Math.max(0, before.player.hp - after.player.hp),
        runMs: runMs => runMs + deltaMs,
      }),
  })

export const countShots = (stats: RunStats, shots: number): RunStats =>
  modifyFields(stats, { shotsFired: fired => fired + shots })

export const countHits = (stats: RunStats, hits: number): RunStats =>
  modifyFields(stats, { shotsHit: hit => hit + hits })

export const countTrapPlaced = (stats: RunStats): RunStats =>
  modifyFields(stats, { trapsPlaced: placed => placed + 1 })

// READING

export const killTotal = (kills: KillCounts): number =>
  kills.Shambler +
  kills.Runner +
  kills.Tank +
  kills.Exploder +
  kills.Thrower +
  kills.Crawler +
  kills.Boss

export const totalKills = ({ kills }: RunStats): number => killTotal(kills)

const zipKills = (
  first: KillCounts,
  second: KillCounts,
  combine: (firstCount: number, secondCount: number) => number,
): KillCounts => ({
  Shambler: combine(first.Shambler, second.Shambler),
  Runner: combine(first.Runner, second.Runner),
  Tank: combine(first.Tank, second.Tank),
  Exploder: combine(first.Exploder, second.Exploder),
  Thrower: combine(first.Thrower, second.Thrower),
  Crawler: combine(first.Crawler, second.Crawler),
  Boss: combine(first.Boss, second.Boss),
})

export const addKills = (kills: KillCounts, more: KillCounts): KillCounts =>
  zipKills(kills, more, (count, extra) => count + extra)

export const killsSince = (
  kills: KillCounts,
  earlier: KillCounts,
): KillCounts =>
  zipKills(kills, earlier, (count, before) => Math.max(0, count - before))

export const accuracyPercent = ({ shotsFired, shotsHit }: RunStats): number =>
  shotsFired > 0 ? Math.round((100 * shotsHit) / shotsFired) : 0

const SECONDS_PER_MINUTE = 60

export const runTimeLabel = ({ runMs }: RunStats): string =>
  durationLabel(runMs)

export const durationLabel = (runMs: number): string => {
  const totalSeconds = Math.floor(runMs / MS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const POOR_AIM_PERCENT = 25

export const defeatVerdict = (wave: number, stats: RunStats): string => {
  if (wave <= 1) {
    return 'Eaten on wave 1. Those were the slow ones'
  } else if (
    stats.shotsFired > 0 &&
    accuracyPercent(stats) < POOR_AIM_PERCENT
  ) {
    return `Eaten on wave ${wave}. Try hitting them`
  } else {
    return `Eaten on wave ${wave}`
  }
}

export const victoryVerdict = (stats: RunStats): string =>
  stats.heartsLost === 0
    ? 'Not a single bite. Show-off'
    : 'The house is yours. For now'
