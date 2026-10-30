import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { randomAppearance } from '../appearance'
import * as Character from '../character'
import { Message } from '../message'
import type { Model } from '../model'
import { withProfileFx } from '../profile'
import { playSounds, uiCue } from './sound'
import type { UpdateStep } from './step'

const foldCharacterOutMessage = Character.OutMessage.match<UpdateStep>({
  ChoseLook:
    ({ part, value }) =>
    stepModel =>
      playSounds([uiCue('Pop')])(
        withProfileFx(
          modifyFields(stepModel, {
            appearance: appearance =>
              Character.chooseLook(appearance, part, value),
          }),
          'Poof',
        ),
      ),
  RequestedRandomLook: () => stepModel => {
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
  },
})

export const foldCharacter = Update.foldChild({
  update: Character.update,
  read: (model: Model) => Option.some(model.character),
  write: (model, nextCharacter) =>
    modifyFields(model, { character: () => nextCharacter }),
  toParentMessage: message => Message.GotCharacterMessage({ message }),
  foldOutMessage: foldCharacterOutMessage,
})
