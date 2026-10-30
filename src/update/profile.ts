import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog, Tabs } from '@foldkit/ui'

import { dialogFolds } from '../dialogs'
import { isCharacterKey, releaseAll } from '../input'
import { Message } from '../message'
import { type Model, Phase, type ProfileTab } from '../model'
import {
  ProfileTabs,
  cleanName,
  draftName,
  rollName,
  shownName,
  withProfileFx,
} from '../profile'
import { isPastRestartGrace } from './run'
import { playSounds, uiCue } from './sound'
import { type UpdateReturn, type UpdateStep, withInput } from './step'

// NAME

// NOTE: the name is kept, and so saved and synced, when the player is done
// typing: Enter, leaving the field, another tab, or closing the Profile.
// Saving on every key would send a sync mutation per letter.
const keepName = (model: Model): Model => {
  const name = cleanName(model.profile.nameDraft)
  return modifyFields(model, {
    playerName: () => name,
    profile: profile => modifyFields(profile, { nameDraft: () => name }),
  })
}

const keepNameStep: UpdateStep = stepModel => ({ model: keepName(stepModel) })

export const typeName = (model: Model, value: string): UpdateReturn => ({
  model: model.profile.dialog.isOpen
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
  stepModel.profile.dialog.isOpen
    ? playSounds([uiCue('Pop')])(keepName(stepModel))
    : { model: stepModel }

export const leaveNameInput: UpdateStep = stepModel =>
  stepModel.profile.dialog.isOpen
    ? keepNameStep(stepModel)
    : { model: stepModel }

export const rollNameDice: UpdateStep = stepModel => {
  if (!stepModel.profile.dialog.isOpen) {
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

const foldProfileDialogOutMessage = Dialog.OutMessage.match<UpdateStep>({
  Opened: () => stepModel => ({ model: stepModel }),
  Closed: () => keepNameStep,
})

const profileDialog = dialogFolds({
  read: (model: Model) => model.profile.dialog,
  write: (model, nextDialog) =>
    modifyFields(model, {
      profile: profile => modifyFields(profile, { dialog: () => nextDialog }),
    }),
  toParentMessage: message => Message.GotProfileDialogMessage({ message }),
  foldOutMessage: foldProfileDialogOutMessage,
})

export const foldProfileDialog = profileDialog.fold

// NOTE: the Profile opens from the home menu, and from the end screens once
// their grace is past, as the character picker always did. Never in a run.
const canOpenProfile = (model: Model): boolean =>
  !model.profile.dialog.isOpen &&
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

export const openProfile =
  (tab: ProfileTab): UpdateStep =>
  stepModel =>
    canOpenProfile(stepModel)
      ? profileDialog.open(
          withInput(
            modifyFields(showTab(stepModel, tab), {
              profile: profile =>
                modifyFields(profile, {
                  nameDraft: () => stepModel.playerName,
                }),
            }),
            releaseAll,
          ),
        )
      : { model: stepModel }

export const profileFromKey: (code: string) => UpdateStep = code =>
  isCharacterKey(code)
    ? openProfile('Look')
    : stepModel => ({ model: stepModel })

// TABS

const switchTab =
  (tab: ProfileTab): UpdateStep =>
  stepModel =>
    tab === stepModel.profile.tab
      ? { model: stepModel }
      : playSounds([uiCue('Whoosh')])(showTab(keepName(stepModel), tab))

export const foldProfileTabs = Update.foldChild({
  update: ProfileTabs.update,
  read: (model: Model) =>
    model.profile.dialog.isOpen
      ? Option.some(model.profile.tabs)
      : Option.none(),
  write: (model, nextTabs) =>
    modifyFields(model, {
      profile: profile => modifyFields(profile, { tabs: () => nextTabs }),
    }),
  toParentMessage: message => Message.GotProfileTabsMessage({ message }),
  foldOutMessage: Tabs.OutMessage.match<
    UpdateStep,
    Tabs.OutMessage<ProfileTab>
  >({ Selected: ({ value }) => switchTab(value) }),
})

export const isProfileOpenOn = (model: Model, tab: ProfileTab): boolean =>
  model.profile.dialog.isOpen && model.profile.tab === tab
