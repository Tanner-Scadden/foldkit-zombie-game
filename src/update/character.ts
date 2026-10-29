import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { randomAppearance } from '../appearance'
import * as Character from '../character'
import { isCharacterKey, releaseAll } from '../input'
import { Message } from '../message'
import { type Model, Phase } from '../model'
import { isPastRestartGrace } from './run'
import { type UpdateStep, withInput } from './step'

const canPickCharacter = (model: Model): boolean =>
  Phase.match(model.phase, {
    Ready: () => true,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => false,
    Victory: () => isPastRestartGrace(model),
    GameOver: () => isPastRestartGrace(model),
  })

const foldCharacterOutMessage = Character.OutMessage.match<UpdateStep>({
  ChoseLook:
    ({ choice }) =>
    stepModel => ({
      model: modifyFields(stepModel, {
        appearance: appearance => Character.chooseLook(appearance, choice),
      }),
    }),
  RequestedRandomLook: () => stepModel => {
    const [rngState, appearance] = randomAppearance(
      stepModel.rngState,
      stepModel.appearance,
    )
    return {
      model: modifyFields(stepModel, {
        rngState: () => rngState,
        appearance: () => appearance,
      }),
    }
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

const foldCharacterOpen = Update.foldChildStep({
  update: Character.open,
  read: (model: Model) => Option.some(model.character),
  write: (model, nextCharacter) =>
    modifyFields(model, { character: () => nextCharacter }),
  toParentMessage: message => Message.GotCharacterMessage({ message }),
})

export const openCharacterPicker: UpdateStep = stepModel =>
  canPickCharacter(stepModel) && !stepModel.character.dialog.isOpen
    ? foldCharacterOpen(withInput(stepModel, releaseAll))
    : { model: stepModel }

export const characterFromKey: (code: string) => UpdateStep =
  code => stepModel =>
    isCharacterKey(code) ? openCharacterPicker(stepModel) : { model: stepModel }
