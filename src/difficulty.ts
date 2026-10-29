import { Array } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Difficulty,
  type DifficultyBests,
  type DifficultySetting,
  type Model,
  Phase,
  type PlannedSpawn,
} from './model'

// TABLE

export type DifficultyStats = Readonly<{
  name: string
  blurb: string
  healthScale: number
  speedScale: number
  biteScale: number
}>

// NOTE: the scales multiply every zombie's base health and speed, the boss
// and his belched Groaners too, on top of the wave's own scales. A bite is
// whole hearts, so it rounds and never drops below one. Normal is not 1:
// boarded doors made planks strong, and its 1.05 and 1.02 bring the bot
// back to its targets without touching the wave tables.
export const DIFFICULTIES: Readonly<Record<Difficulty, DifficultyStats>> = {
  Easy: {
    name: 'Easy',
    blurb: 'Just here for the vibes',
    healthScale: 0.85,
    speedScale: 0.95,
    biteScale: 0.5,
  },
  Normal: {
    name: 'Normal',
    blurb: "The way it's meant to be played",
    healthScale: 1.05,
    speedScale: 1.02,
    biteScale: 1,
  },
  Hard: {
    name: 'Hard',
    blurb: 'They bite back',
    healthScale: 1.12,
    speedScale: 1.04,
    biteScale: 1,
  },
  Nightmare: {
    name: 'Nightmare',
    blurb: 'No mercy. Bring snacks',
    healthScale: 1.18,
    speedScale: 1.06,
    biteScale: 1.25,
  },
}

export const DIFFICULTY_ORDER: Array.NonEmptyReadonlyArray<Difficulty> = [
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
]

export const NIGHTMARE_LOCK_NOTE = 'Beat Hard to unlock'

export const isLocked = (
  setting: DifficultySetting,
  difficulty: Difficulty,
): boolean => difficulty === 'Nightmare' && setting.nightmare === 'Locked'

// SCALES

export const toughenSpawns = (
  difficulty: Difficulty,
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<PlannedSpawn> => {
  const { healthScale, speedScale } = DIFFICULTIES[difficulty]
  return Array.map(spawns, spawn =>
    modifyFields(spawn, {
      speedScale: scale => scale * speedScale,
      hpScale: scale => scale * healthScale,
    }),
  )
}

export const difficultySpeedScale = (difficulty: Difficulty): number =>
  DIFFICULTIES[difficulty].speedScale

export const biteDamage = (difficulty: Difficulty, damage: number): number =>
  Math.max(1, Math.round(damage * DIFFICULTIES[difficulty].biteScale))

// CHOOSING

export const chooseDifficulty = (
  model: Model,
  difficulty: Difficulty,
): Model =>
  isLocked(model.difficulty, difficulty)
    ? model
    : modifyFields(model, {
        difficulty: setting =>
          modifyFields(setting, { chosen: () => difficulty }),
      })

export const settleNightmare = (model: Model): Model =>
  model.difficulty.nightmare === 'JustUnlocked'
    ? modifyFields(model, {
        difficulty: setting =>
          modifyFields(setting, { nightmare: () => 'Unlocked' }),
      })
    : model

// UNLOCKING

export const hasJustWon = (before: Model, after: Model): boolean =>
  !Phase.isAnyOf(['Victory'])(before.phase) &&
  Phase.isAnyOf(['Victory'])(after.phase)

export const isNightmareUnlockedBy = (before: Model, after: Model): boolean =>
  hasJustWon(before, after) &&
  after.difficulty.chosen === 'Hard' &&
  after.difficulty.nightmare === 'Locked'

export const unlockNightmare = (model: Model): Model =>
  modifyFields(model, {
    difficulty: setting =>
      modifyFields(setting, { nightmare: () => 'JustUnlocked' }),
  })

// BESTS

export const bestsFor = (model: Model): DifficultyBests =>
  model.bests.byDifficulty[model.difficulty.chosen]

export const withBests = (
  model: Model,
  toBests: (bests: DifficultyBests) => DifficultyBests,
): Model => {
  const chosen = model.difficulty.chosen
  return modifyFields(model, {
    bests: bests =>
      modifyFields(bests, {
        byDifficulty: byDifficulty =>
          modifyFields(byDifficulty, {
            Easy: current => (chosen === 'Easy' ? toBests(current) : current),
            Normal: current =>
              chosen === 'Normal' ? toBests(current) : current,
            Hard: current => (chosen === 'Hard' ? toBests(current) : current),
            Nightmare: current =>
              chosen === 'Nightmare' ? toBests(current) : current,
          }),
      }),
  })
}
