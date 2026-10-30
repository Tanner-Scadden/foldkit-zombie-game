import { modifyFields } from 'foldkit/struct'

import { FIRST_PREPARATION_MS } from './constants'
import { type Model, Phase, Round, type RunMode } from './model'
import { raiseDebutCard, settleLessons } from './onboarding'
import { isCoop, seatCrew } from './party'
import { markReady } from './revive'
import { freshRun } from './runReset'
import { beginPreparation, startWaveEarly } from './waves'
import { withWorld } from './world'

// Starting, resuming, and starting a wave from the player's side: each
// resets or reads client state (the run's fields, the lessons settled from
// the save, the new zombie card) around the World's own step.

// NOTE: a `?local=N` link seats N players at this keyboard before the
// first wave is rolled, so the wave already counts them.
const startRun = (model: Model, mode: RunMode): Model =>
  withWorld(
    {
      ...model,
      ...freshRun(model),
      mode,
      lessons: settleLessons(model.lessons),
    },
    world =>
      beginPreparation(
        seatCrew(world, model.localPlayers),
        1,
        FIRST_PREPARATION_MS,
      ),
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
// In co-op START WAVE is the player's READY, and the wave starts once
// everyone has pressed it (decided 7).
export const startWave = (model: Model): Model => {
  if (!Phase.isAnyOf(['Preparation'])(model.phase)) {
    return model
  }
  return isCoop(model)
    ? withWorld(model, markReady)
    : raiseDebutCard(withWorld(model, startWaveEarly))
}
