import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  FocusTutorialReset,
  HideSplash,
  RedeemLinkCode,
  ReloadSyncedSave,
  RequestLinkCode,
  ShowLoadProgress,
  WriteSave,
} from '../commands'
import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from '../home'
import type { Message } from '../message'
import {
  LOAD_STEPS,
  type LoadStep,
  Loading,
  type Model,
  type TutorialReset,
} from '../model'
import { LinkFlow, changesBetween } from '../playerSync'
import {
  type PlayerSave,
  hasSaveFieldsChanged,
  isSameSave,
  restoreSave,
  saveOf,
} from '../save'
import type { UpdateReturn, UpdateStep } from './step'

// LOADING

export const finishLoadStep = (model: Model, step: LoadStep): UpdateReturn =>
  Loading.match(model.loading, {
    Loaded: () => ({ model }),
    Loading: ({ pending }) => {
      const remaining = Array.filter(pending, waiting => waiting !== step)
      const progress = ShowLoadProgress({
        loaded: LOAD_STEPS.length - remaining.length,
        total: LOAD_STEPS.length,
      })
      if (Array.isReadonlyArrayEmpty(remaining)) {
        return {
          model: modifyFields(model, { loading: () => Loading.Loaded() }),
          commands: [progress, HideSplash()],
        }
      } else {
        return {
          model: modifyFields(model, {
            loading: () => Loading.Loading({ pending: remaining }),
          }),
          commands: [progress],
        }
      }
    },
  })

// SAVE

export const loadSave = (
  model: Model,
  maybeSave: Option.Option<PlayerSave>,
): UpdateReturn =>
  finishLoadStep(
    modifyFields(
      Option.match(maybeSave, {
        onNone: () => model,
        onSome: save => restoreSave(model, save),
      }),
      { saveStatus: () => 'Read' },
    ),
    'Save',
  )

// NOTE: a save that arrived from sync is already in the store, so taking
// it into the Model writes nothing back. Every other change to the save is
// written with the mutations that describe it.
export const writeSaveFrom =
  (before: Model, message: Message): UpdateStep =>
  stepModel => {
    if (
      before.saveStatus === 'Unread' ||
      stepModel.saveStatus === 'Unread' ||
      message._tag === 'UpdatedSyncedSave' ||
      message._tag === 'CompletedReloadSyncedSave' ||
      !hasSaveFieldsChanged(before, stepModel)
    ) {
      return { model: stepModel }
    }

    const beforeSave = saveOf(before)
    const save = saveOf(stepModel)
    return isSameSave(beforeSave, save)
      ? { model: stepModel }
      : {
          model: modifyFields(stepModel, {
            writesInFlight: count => count + 1,
          }),
          commands: [
            WriteSave({ save, changes: changesBetween(beforeSave, save) }),
          ],
        }
  }

// NOTE: a save from another device, or from the server, replaces what this
// device shows: its look, settings, difficulty, and bests. Lessons and
// unlocks only ever move forward, as on load.
export const takeSyncedSave = (model: Model, save: PlayerSave): UpdateReturn =>
  model.writesInFlight > 0
    ? { model: modifyFields(model, { syncedSave: () => 'Stale' }) }
    : { model: restoreSave(model, save) }

// NOTE: once this device's own writes have landed, a save from sync that
// was held back is read again from the store, which by then has both.
export const finishWrite = (model: Model): UpdateReturn => {
  const next = modifyFields(model, {
    writesInFlight: count => Math.max(count - 1, 0),
  })
  return next.writesInFlight === 0 && next.syncedSave === 'Stale'
    ? {
        model: modifyFields(next, { syncedSave: () => 'Current' }),
        commands: [ReloadSyncedSave()],
      }
    : { model: next }
}

// LINKING

export const startLinking = (model: Model): UpdateReturn =>
  LinkFlow.match(model.linkFlow, {
    Requesting: () => ({ model }),
    Redeeming: () => ({ model }),
    Idle: () => requestLinkCode(model),
    Showing: () => requestLinkCode(model),
    Entering: () => requestLinkCode(model),
    Linked: () => requestLinkCode(model),
    Failed: () => requestLinkCode(model),
  })

const requestLinkCode = (model: Model): UpdateReturn => ({
  model: modifyFields(model, { linkFlow: () => LinkFlow.Requesting() }),
  commands: [RequestLinkCode()],
})

export const typeLinkCode = (model: Model, value: string): UpdateReturn =>
  LinkFlow.isAnyOf(['Entering', 'Failed'])(model.linkFlow)
    ? {
        model: modifyFields(model, {
          linkFlow: () =>
            LinkFlow.Entering({ code: value.toUpperCase().slice(0, 7) }),
        }),
      }
    : { model }

export const submitLinkCode = (model: Model): UpdateReturn =>
  LinkFlow.match(model.linkFlow, {
    Entering: ({ code }) => ({
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Redeeming({ code }),
      }),
      commands: [RedeemLinkCode({ code })],
    }),
    Idle: () => ({ model }),
    Requesting: () => ({ model }),
    Showing: () => ({ model }),
    Redeeming: () => ({ model }),
    Linked: () => ({ model }),
    Failed: () => ({ model }),
  })

// TUTORIAL RESET

const isSettingsOpen = (model: Model): boolean =>
  model.panelDialog.isOpen && model.panel === 'Settings'

export const askToResetTutorial = (model: Model): UpdateReturn =>
  isSettingsOpen(model)
    ? {
        model: modifyFields(model, { tutorialReset: () => 'Asking' }),
        commands: [FocusTutorialReset({ id: KEEP_TUTORIAL_BUTTON_ID })],
      }
    : { model }

export const answerTutorialReset = (
  model: Model,
  forget: (model: Model) => Model,
  tutorialReset: TutorialReset,
): UpdateReturn =>
  model.tutorialReset === 'Asking'
    ? {
        model: modifyFields(forget(model), {
          tutorialReset: () => tutorialReset,
        }),
        commands: [FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID })],
      }
    : { model }
