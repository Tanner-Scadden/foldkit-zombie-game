import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ProfileDialogBinding } from '../composition'
import { makeStep } from '../definition'
import { isCharacterKey, releaseAll } from '../input'
import { type Model, Phase, type ProfileTab } from '../model'
import {
  cleanName,
  draftName,
  rollName,
  shownName,
  withProfileFx,
} from '../profile'
import { isPastRestartGrace } from './run'
import { playSounds, uiCue } from './sound'
import {
  type UpdateReturn,
  type UpdateStep,
  unchanged,
  withInput,
} from './step'

// NAME

// NOTE: the name is kept, and so saved and synced, when the player is done
// typing: Enter, leaving the field, another tab, or closing the Profile.
// Saving on every key would send a sync mutation per letter.
const keepNameModel = (model: Model): Model => {
  const name = cleanName(model.profile.nameDraft)
  return modifyFields(model, {
    playerName: () => name,
    profile: profile => modifyFields(profile, { nameDraft: () => name }),
  })
}

export const keepName: UpdateStep = stepModel => ({
  model: keepNameModel(stepModel),
})

export const typeName = (model: Model, value: string): UpdateReturn => ({
  model: model.profileDialog.isOpen
    ? modifyFields(model, {
        profile: profile =>
          modifyFields(profile, {
            nameDraft: () => draftName(value),
            fx: () => 'Still',
          }),
      })
    : model,
})

export const submitName: UpdateStep = stepModel =>
  stepModel.profileDialog.isOpen
    ? playSounds([uiCue('Pop')])(keepNameModel(stepModel))
    : { model: stepModel }

export const leaveNameInput: UpdateStep = stepModel =>
  stepModel.profileDialog.isOpen ? keepName(stepModel) : { model: stepModel }

export const rollNameDice: UpdateStep = stepModel => {
  if (!stepModel.profileDialog.isOpen) {
    return { model: stepModel }
  }
  const [rngState, name] = rollName(
    stepModel.cosmeticRngState,
    shownName(cleanName(stepModel.profile.nameDraft)),
  )
  return playSounds([uiCue('LootPop')])(
    withProfileFx(
      modifyFields(stepModel, {
        cosmeticRngState: () => rngState,
        playerName: () => name,
        profile: profile => modifyFields(profile, { nameDraft: () => name }),
      }),
      'Spin',
    ),
  )
}

// DIALOG

// NOTE: the Profile opens from the home menu, and from the end screens once
// their grace is past, as the character picker always did. Never in a run.
const canOpenProfile = (model: Model): boolean =>
  !model.profileDialog.isOpen &&
  !model.panelDialog.isOpen &&
  !model.handDialog.isOpen &&
  Phase.match(model.phase, {
    Ready: () => true,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => false,
    Victory: () => isPastRestartGrace(model),
    GameOver: () => isPastRestartGrace(model),
  })

const showTab = (model: Model, tab: ProfileTab): Model =>
  modifyFields(model, {
    tutorialReset: () => 'Idle',
    profile: profile =>
      modifyFields(profile, { tab: () => tab, fx: () => 'Still' }),
  })

const prepareProfile =
  (tab: ProfileTab): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(showTab(stepModel, tab), {
        profile: profile =>
          modifyFields(profile, { nameDraft: () => stepModel.playerName }),
      }),
      releaseAll,
    ),
  })

export const openProfile = (tab: ProfileTab) =>
  makeStep(model =>
    canOpenProfile(model)
      ? Update.combineSteps([
          prepareProfile(tab),
          ProfileDialogBinding.requestOpen(),
        ])
      : unchanged,
  )

export const profileFromKey = (code: string) =>
  makeStep(() => (isCharacterKey(code) ? openProfile('Look') : unchanged))

// TABS

export const switchTab =
  (tab: ProfileTab): UpdateStep =>
  stepModel =>
    tab === stepModel.profile.tab
      ? { model: stepModel }
      : playSounds([uiCue('Whoosh')])(showTab(keepNameModel(stepModel), tab))

export const isProfileOpenOn = (model: Model, tab: ProfileTab): boolean =>
  model.profileDialog.isOpen && model.profile.tab === tab
