import { RESTART_GRACE_MS } from '../constants'
import { endOffer } from '../home'
import { releaseAll } from '../input'
import { type Model, Phase, type RunMode } from '../model'
import { startOrResume } from '../runFlow'
import { isRoundActive, keepGoing } from '../waves'
import { playStartSoundWhen, unlockAudio } from './sound'
import { type UpdateReturn, combine, withInput } from './step'

export const isPaused = Phase.isAnyOf(['Paused'])

export const isPastRestartGrace = (model: Model): boolean =>
  model.screenMs >= RESTART_GRACE_MS

const canStart = (model: Model): boolean =>
  Phase.match(model.phase, {
    Ready: () => true,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => true,
    Victory: () => endOffer(model) === 'MenuAndModes',
    GameOver: () => endOffer(model) === 'MenuAndModes',
  })

export const startWhenAllowed = (model: Model, mode: RunMode): Model =>
  canStart(model) ? startOrResume(model, mode) : model

export const keepGoingWhenAllowed = (model: Model): Model =>
  canStart(model) ? keepGoing(model) : model

export const startsRun = (before: Model, after: Model): boolean =>
  !isRoundActive(before.phase) &&
  !Phase.isAnyOf(['Paused'])(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase)

export const startFromButton = (before: Model, started: Model): UpdateReturn =>
  combine(withInput(started, releaseAll), [
    unlockAudio,
    playStartSoundWhen(startsRun(before, started)),
  ])

export const isScreenAnimated = (phase: Phase): boolean =>
  Phase.isAnyOf(['Ready', 'Victory', 'GameOver'])(phase)
