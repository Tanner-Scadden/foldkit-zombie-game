import { modifyFields } from 'foldkit/struct'

import { randomAppearance } from '../appearance'
import * as Character from '../character'
import type { LookPart, LookToggle } from '../model'
import { withProfileFx } from '../profile'
import { playSounds, uiCue } from './sound'
import type { UpdateStep } from './step'

// NOTE: the Look tab's OutMessages, folded in src/composition.ts. The root
// owns the look, so each one changes it here and plays its poof or spin.

export const chooseLook =
  (part: LookPart, value: string): UpdateStep =>
  stepModel =>
    playSounds([uiCue('Pop')])(
      withProfileFx(
        modifyFields(stepModel, {
          appearance: appearance =>
            Character.chooseLook(appearance, part, value),
        }),
        'Poof',
      ),
    )

export const flipLook =
  (toggle: LookToggle): UpdateStep =>
  stepModel =>
    playSounds([uiCue('Pop')])(
      withProfileFx(
        modifyFields(stepModel, {
          appearance: appearance => Character.flipLook(appearance, toggle),
        }),
        'Poof',
      ),
    )

export const rollLook: UpdateStep = stepModel => {
  const [rngState, appearance] = randomAppearance(
    stepModel.cosmeticRngState,
    stepModel.appearance,
  )
  return playSounds([uiCue('LootPop')])(
    withProfileFx(
      modifyFields(stepModel, {
        cosmeticRngState: () => rngState,
        appearance: () => appearance,
      }),
      'Spin',
    ),
  )
}
