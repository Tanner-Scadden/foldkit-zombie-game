import { Array, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import { NEWS_DAYS } from '../changelog'
import { FocusEndMenuButton, FocusHandCard, FocusHomeButton } from '../commands'
import { Screen as CoopScreen } from '../coop/model'
import { dialogFolds } from '../dialogs'
import {
  chooseDifficulty,
  isLocked,
  isNightmareUnlockedBy,
  settleNightmare,
  unlockNightmare,
} from '../difficulty'
import {
  type KeyedHandCard,
  dealtCards,
  endOffer,
  isDifficultyKey,
  isManorKey,
  isModeKey,
  isOnHome,
  isSettingsKey,
  maybeHandCardOfKey,
  returnHome,
  runModeOf,
  seeNews,
  showMunchopediaPage,
  steppedHomeFocus,
  switchMode,
  turnNewsPage,
} from '../home'
import { isMenuKey, isStartKey, maybeFocusStep, releaseAll } from '../input'
import { Message } from '../message'
import {
  type Difficulty,
  DifficultyCard,
  type HandCard,
  type MenuPanel,
  type Model,
  MunchopediaPage,
  Phase,
  type RunMode,
} from '../model'
import { openProfile } from './profile'
import {
  isPastRestartGrace,
  isPaused,
  startFromButton,
  startWhenAllowed,
  startsRun,
} from './run'
import { playSounds, uiCue, unlockAudio } from './sound'
import { type UpdateReturn, type UpdateStep, withInput } from './step'

// MENU

const writePanelDialog = (model: Model, nextPanelDialog: Dialog.Model): Model =>
  modifyFields(model, { panelDialog: () => nextPanelDialog })

const forgetAskedMode = (model: Model): Model =>
  DifficultyCard.isAnyOf(['Asking'])(model.difficultyCard)
    ? modifyFields(model, { difficultyCard: () => DifficultyCard.Unseen() })
    : model

const foldPanelDialogOutMessage = Dialog.OutMessage.match<UpdateStep>({
  Opened: () => stepModel => ({ model: stepModel }),
  Closed: () => stepModel => ({ model: forgetAskedMode(stepModel) }),
})

const panelDialog = dialogFolds({
  read: (model: Model) => model.panelDialog,
  write: writePanelDialog,
  toParentMessage: message => Message.GotPanelDialogMessage({ message }),
  foldOutMessage: foldPanelDialogOutMessage,
})

export const foldPanelDialog = panelDialog.fold

const isPanelAllowed = (model: Model, panel: MenuPanel): boolean => {
  if (
    model.panelDialog.isOpen ||
    model.profile.dialog.isOpen ||
    model.handDialog.isOpen
  ) {
    return false
  } else if (panel === 'LeaveRun') {
    return isPaused(model.phase)
  } else {
    return isOnHome(model.phase)
  }
}

export const openPanel =
  (panel: MenuPanel): UpdateStep =>
  stepModel =>
    isPanelAllowed(stepModel, panel)
      ? panelDialog.open(
          withInput(
            modifyFields(stepModel, {
              panel: () => panel,
              tutorialReset: () => 'Idle',
            }),
            releaseAll,
          ),
        )
      : { model: stepModel }

export const closePanel: UpdateStep = stepModel =>
  stepModel.panelDialog.isOpen
    ? panelDialog.close(stepModel)
    : { model: stepModel }

export const goHome: UpdateStep = stepModel => ({
  model: returnHome(withInput(stepModel, releaseAll)),
})

const isEndScreen = Phase.isAnyOf(['Victory', 'GameOver'])

export const leaveFromMenu: UpdateStep = stepModel => {
  if (isPaused(stepModel.phase)) {
    return openPanel('LeaveRun')(stepModel)
  } else if (isEndScreen(stepModel.phase) && isPastRestartGrace(stepModel)) {
    return goHome(stepModel)
  } else {
    return { model: stepModel }
  }
}

export const leaveRun: UpdateStep = stepModel =>
  isPaused(stepModel.phase) && stepModel.panel === 'LeaveRun'
    ? Update.combine(stepModel, [closePanel, goHome])
    : { model: stepModel }

const isEndMenuKey = (model: Model, code: string): boolean =>
  isMenuKey(code) || (isStartKey(code) && endOffer(model) === 'MenuOnly')

export const menuFromKey: (code: string) => UpdateStep = code => stepModel =>
  isEndMenuKey(stepModel, code)
    ? leaveFromMenu(stepModel)
    : { model: stepModel }

export const canMoveHomeFocus = (model: Model): boolean =>
  isOnHome(model.phase) &&
  CoopScreen.isAnyOf(['Closed'])(model.coop.screen) &&
  !model.panelDialog.isOpen &&
  !model.profile.dialog.isOpen &&
  !model.handDialog.isOpen

// NOTE: the gear opens the Profile on its Settings tab, only from the menu
// itself, as the gear is only there.
export const openSettingsFromGear: UpdateStep = stepModel =>
  canMoveHomeFocus(stepModel)
    ? openProfile('Settings')(stepModel)
    : { model: stepModel }

// THE MANOR HAND

const handDialog = dialogFolds({
  read: (model: Model) => model.handDialog,
  write: (model, nextHandDialog) =>
    modifyFields(model, { handDialog: () => nextHandDialog }),
  toParentMessage: message => Message.GotHandDialogMessage({ message }),
})

export const foldHandDialog = handDialog.fold

export const openHand: UpdateStep = stepModel =>
  canMoveHomeFocus(stepModel)
    ? handDialog.open(withInput(stepModel, releaseAll))
    : { model: stepModel }

const closeHand: UpdateStep = stepModel =>
  stepModel.handDialog.isOpen
    ? handDialog.close(stepModel)
    : { model: stepModel }

// NOTE: a card puts the hand away, then opens its panel, so the panel's
// Done or Esc lands back on the menu, not in the hand.
export const fromHand =
  (step: UpdateStep): UpdateStep =>
  stepModel =>
    Update.combine(stepModel, [closeHand, step])

export const stepHandFocus = (model: Model, card: HandCard): UpdateReturn =>
  model.handDialog.isOpen && Array.contains(dealtCards(model), card)
    ? { model, commands: [FocusHandCard({ card })] }
    : { model }

export const homeFocusFromKey: (code: string) => UpdateStep =
  code => stepModel =>
    Option.match(maybeFocusStep(code), {
      onNone: () => ({ model: stepModel }),
      onSome: step => {
        if (!canMoveHomeFocus(stepModel)) {
          return { model: stepModel }
        }

        const button = steppedHomeFocus(stepModel.maybeHomeFocus, step)
        return {
          model: modifyFields(stepModel, {
            maybeHomeFocus: () => Option.some(button),
          }),
          commands: [FocusHomeButton({ button })],
        }
      },
    })

// HOME MENU

const isPanelOpen = (model: Model, panel: MenuPanel): boolean =>
  model.panelDialog.isOpen && model.panel === panel

export const homeStartFromKey = (model: Model, code: string): Model =>
  isStartKey(code) ? startWhenAllowed(model, runModeOf(model.home.mode)) : model

export const openWhatsNew: UpdateStep = stepModel =>
  isPanelAllowed(stepModel, 'WhatsNew')
    ? openPanel('WhatsNew')(seeNews(stepModel))
    : { model: stepModel }

export const openMunchopedia =
  (page: MunchopediaPage): UpdateStep =>
  stepModel =>
    isPanelAllowed(stepModel, 'Munchopedia')
      ? openPanel('Munchopedia')(showMunchopediaPage(stepModel, page))
      : { model: stepModel }

export const turnMunchopediaPage = (
  model: Model,
  page: MunchopediaPage,
): UpdateReturn => ({
  model: isPanelOpen(model, 'Munchopedia')
    ? showMunchopediaPage(model, page)
    : model,
})

export const turnNews = (model: Model, step: number): UpdateReturn => ({
  model: isPanelOpen(model, 'WhatsNew')
    ? turnNewsPage(model, step, NEWS_DAYS.length)
    : model,
})

const CARD_OPENERS: Readonly<Record<KeyedHandCard, UpdateStep>> = {
  WhatsNew: openWhatsNew,
  Munchopedia: openMunchopedia(MunchopediaPage.List()),
  Character: openProfile('Look'),
  HowToPlay: openPanel('HowToPlay'),
}

// NOTE: C opens the character picker on every screen that offers it, so it
// stays with characterFromKey and is left out here. The card keys work from
// the menu without opening the hand first.
export const homeFromKey: (code: string) => UpdateStep = code => stepModel => {
  if (!canMoveHomeFocus(stepModel)) {
    return { model: stepModel }
  } else if (isModeKey(code)) {
    return { model: switchMode(stepModel) }
  } else if (isDifficultyKey(code)) {
    return openPanel('Difficulty')(stepModel)
  } else if (isManorKey(code)) {
    return openHand(stepModel)
  } else if (isSettingsKey(code)) {
    return openProfile('Settings')(stepModel)
  } else {
    return Option.match(maybeHandCardOfKey(code), {
      onNone: () => ({ model: stepModel }),
      onSome: card =>
        card === 'Character'
          ? { model: stepModel }
          : CARD_OPENERS[card](stepModel),
    })
  }
}

// DIFFICULTY

export const isAskingDifficultyFirst = (model: Model): boolean =>
  DifficultyCard.isAnyOf(['Unseen'])(model.difficultyCard) &&
  isOnHome(model.phase)

const askDifficulty =
  (mode: RunMode): UpdateStep =>
  stepModel =>
    isPanelAllowed(stepModel, 'Difficulty')
      ? openPanel('Difficulty')(
          modifyFields(stepModel, {
            difficultyCard: () => DifficultyCard.Asking({ mode }),
          }),
        )
      : { model: stepModel }

export const startOrAsk =
  (mode: RunMode): UpdateStep =>
  stepModel =>
    isAskingDifficultyFirst(stepModel)
      ? Update.combine(stepModel, [unlockAudio, askDifficulty(mode)])
      : startFromButton(stepModel, startWhenAllowed(stepModel, mode))

export const difficultyCardFromKey: (code: string) => UpdateStep =
  code => stepModel =>
    isAskingDifficultyFirst(stepModel) && isStartKey(code)
      ? askDifficulty(runModeOf(stepModel.home.mode))(stepModel)
      : { model: stepModel }

const pickFromBadge =
  (difficulty: Difficulty): UpdateStep =>
  stepModel =>
    isPanelOpen(stepModel, 'Difficulty') &&
    isOnHome(stepModel.phase) &&
    !isLocked(stepModel.difficulty, difficulty)
      ? closePanel(
          modifyFields(chooseDifficulty(stepModel, difficulty), {
            difficultyCard: () => DifficultyCard.Seen(),
          }),
        )
      : { model: stepModel }

export const pickFromCard =
  (difficulty: Difficulty): UpdateStep =>
  stepModel =>
    DifficultyCard.match(stepModel.difficultyCard, {
      Unseen: () => pickFromBadge(difficulty)(stepModel),
      Seen: () => pickFromBadge(difficulty)(stepModel),
      Asking: ({ mode }) =>
        isLocked(stepModel.difficulty, difficulty)
          ? { model: stepModel }
          : Update.combine(
              modifyFields(chooseDifficulty(stepModel, difficulty), {
                difficultyCard: () => DifficultyCard.Seen(),
              }),
              [
                closePanel,
                nextModel =>
                  startFromButton(nextModel, startWhenAllowed(nextModel, mode)),
              ],
            ),
    })

export const settleNightmareFrom =
  (before: Model): UpdateStep =>
  stepModel => ({
    model: startsRun(before, stepModel)
      ? settleNightmare(stepModel)
      : stepModel,
  })

export const unlockNightmareFrom =
  (before: Model): UpdateStep =>
  stepModel =>
    isNightmareUnlockedBy(before, stepModel)
      ? playSounds([uiCue('PowerUp')])(unlockNightmare(stepModel))
      : { model: stepModel }

// SETTINGS

export const toggleShake = (model: Model): Model =>
  modifyFields(model, {
    shakeSetting: setting => (setting === 'On' ? 'Off' : 'On'),
  })

export const toggleCursor = (model: Model): Model =>
  modifyFields(model, {
    cursorSetting: setting => (setting === 'Bold' ? 'Thin' : 'Bold'),
  })

export const toggleShareStats = (model: Model): Model =>
  modifyFields(model, {
    shareStats: setting => (setting === 'On' ? 'Off' : 'On'),
  })

// HOME SCREEN TIP

export const dismissHomeScreenTip = (model: Model): Model =>
  model.homeScreenTip === 'Dismissed'
    ? model
    : modifyFields(model, { homeScreenTip: () => 'Dismissed' })

const isOnTitle = Phase.isAnyOf(['Ready'])

const homeScreenSteps = dialogFolds({
  read: (model: Model) => model.homeScreenSteps,
  write: (model, nextHomeScreenSteps) =>
    modifyFields(model, { homeScreenSteps: () => nextHomeScreenSteps }),
  toParentMessage: message => Message.GotHomeScreenStepsMessage({ message }),
})

export const foldHomeScreenSteps = homeScreenSteps.fold

export const openHomeScreenSteps: UpdateStep = stepModel =>
  isOnTitle(stepModel.phase) && !stepModel.homeScreenSteps.isOpen
    ? homeScreenSteps.open(withInput(stepModel, releaseAll))
    : { model: stepModel }

export const finishHomeScreenSteps: UpdateStep = stepModel =>
  Update.combine(stepModel, [
    homeScreenSteps.close,
    closedModel => ({ model: dismissHomeScreenTip(closedModel) }),
  ])

export const dismissHomeScreenTipFrom =
  (before: Model): UpdateStep =>
  stepModel => ({
    model:
      isOnTitle(before.phase) && !isOnTitle(stepModel.phase)
        ? dismissHomeScreenTip(stepModel)
        : stepModel,
  })

// END SCREENS

const isOfferingOnlyMenu = (model: Model): boolean =>
  endOffer(model) === 'MenuOnly'

export const focusEndMenuFrom =
  (before: Model): UpdateStep =>
  stepModel =>
    !isOfferingOnlyMenu(before) && isOfferingOnlyMenu(stepModel)
      ? { model: stepModel, commands: [FocusEndMenuButton()] }
      : { model: stepModel }
