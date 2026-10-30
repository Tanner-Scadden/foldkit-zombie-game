import { modifyFields } from 'foldkit/struct'

import { FIRST_PREPARATION_MS } from './constants'
import { type Model, Phase, Round, type RunMode } from './model'
import { raiseDebutCard, settleLessons } from './onboarding'
import { freshRun } from './runReset'
import { beginPreparation, startWaveEarly } from './waves'
import { withWorld } from './world'

// Starting, resuming, and starting a wave from the player's side: each
// resets or reads client state (the run's fields, the lessons settled from
// the save, the new zombie card) around the World's own step.

const startRun = (model: Model, mode: RunMode): Model =>
  withWorld(
    {
      ...model,
      ...freshRun(model),
      mode,
      lessons: settleLessons(model.lessons),
    },
    world => beginPreparation(world, 1, FIRST_PREPARATION_MS),
  )

const resume = (model: Model, round: Round): Model =>
  modifyFields(model, {
    phase: () =>
      Round.match(round, {
        Preparation: (preparation): Phase => preparation,
        Wave: (wave): Phase => wave,
      }),
  })

export const startOrResume = (model: Model, mode: RunMode): Model =>
  Phase.match(model.phase, {
    Ready: () => startRun(model, mode),
    Preparation: () => model,
    Wave: () => model,
    Paused: ({ round }) => resume(model, round),
    Victory: () => startRun(model, mode),
    GameOver: () => startRun(model, mode),
  })

// NOTE: START WAVE from the player: the wave starts, and a new kind in it
// raises its card.
export const startWave = (model: Model): Model =>
  Phase.isAnyOf(['Preparation'])(model.phase)
    ? raiseDebutCard(withWorld(model, startWaveEarly))
    : model
