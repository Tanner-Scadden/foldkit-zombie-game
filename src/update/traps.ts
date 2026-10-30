import { Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from '../arena'
import { SHAKE_TRAUMA_MAX, TRAP_PLACE_TRAUMA } from '../constants'
import { type TrapChoice, maybeTrapChoice } from '../input'
import type { Model } from '../model'
import { puffDust } from '../particles'
import {
  cycleTrap,
  maybeSelectedKind,
  placeTrap,
  refusePlacement,
  trapCenter,
} from '../traps'
import { isRoundActive } from '../waves'
import { withWorld } from '../world'
import { playSounds, uiCue } from './sound'
import type { UpdateReturn, UpdateStep } from './step'

const shakeBy = (model: Model, trauma: number): Model =>
  modifyFields(model, {
    shake: shake =>
      modifyFields(shake, {
        trauma: current => Math.min(SHAKE_TRAUMA_MAX, current + trauma),
      }),
  })

export const placeSelectedTrap = (model: Model): UpdateReturn => {
  if (Option.isNone(maybeSelectedKind(model)) || !isRoundActive(model.phase)) {
    return { model }
  }

  return Result.match(placeTrap(model), {
    onFailure: reason =>
      playSounds([uiCue('Denied')])(refusePlacement(model, reason)),
    onSuccess: ({ model: placed, trap }) => {
      const { x, y } = trapCenter(levelOf(placed), trap)
      return playSounds([{ sound: 'Thunk', variation: 0 }])(
        shakeBy(puffDust(placed, x, y), TRAP_PLACE_TRAUMA),
      )
    },
  })
}

export const nextTrap = (model: Model): UpdateReturn => {
  if (!isRoundActive(model.phase)) {
    return { model }
  }

  const cycled = withWorld(model, cycleTrap)
  return playSounds(
    cycled.selectedTrap === model.selectedTrap ? [] : [uiCue('Swap')],
  )(cycled)
}

const TRAP_CHOICES: Readonly<
  Record<TrapChoice, (model: Model) => UpdateReturn>
> = {
  Place: placeSelectedTrap,
  Next: nextTrap,
}

export const trapFromKey: (code: string) => UpdateStep = code => stepModel =>
  Option.match(maybeTrapChoice(code), {
    onNone: () => ({ model: stepModel }),
    onSome: choice => TRAP_CHOICES[choice](stepModel),
  })
