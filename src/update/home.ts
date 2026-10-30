import { Array, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { NEWS_DAYS } from '../changelog'
import {
  FocusEndMenuButton,
  FocusHandCard,
  FocusHomeButton,
  ReloadPage,
  ShowInstallPrompt,
  WaitForUnwrap,
} from '../commands'
import {
  HandDialogBinding,
  HomeScreenStepsBinding,
  PanelDialogBinding,
  UpdateGreetingBinding,
} from '../composition'
import { Screen as CoopScreen } from '../coop/model'
import { runDifficultyOf } from '../coopPlay'
import { makeStep } from '../definition'
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
  isInstallTileShown,
  isManorKey,
  isModeKey,
  isOnHome,
  isSettingsKey,
  isUpdateGiftShown,
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
import {
  type Difficulty,
  DifficultyCard,
  type HandCard,
  type InstallOutcome,
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
import {
  type UpdateReturn,
  type UpdateStep,
  combine,
  unchanged,
  withInput,
} from './step'

// MENU

// NOTE: the panel's Closed fold (src/composition.ts): a Difficulty panel
// that asked before a run, closed without a pick, asks again next time.
export const forgetAskedMode: UpdateStep = stepModel => ({
  model: DifficultyCard.isAnyOf(['Asking'])(stepModel.difficultyCard)
    ? modifyFields(stepModel, { difficultyCard: () => DifficultyCard.Unseen() })
    : stepModel,
})

const isPanelAllowed = (model: Model, panel: MenuPanel): boolean => {
  if (
    model.panelDialog.isOpen ||
    model.profileDialog.isOpen ||
    model.handDialog.isOpen
  ) {
    return false
  } else if (panel === 'LeaveRun') {
    return isPaused(model.phase)
  } else {
    return isOnHome(model.phase)
  }
}

const showPanel =
  (panel: MenuPanel): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(stepModel, {
        panel: () => panel,
        tutorialReset: () => 'Idle',
      }),
      releaseAll,
    ),
  })

export const openPanel = (panel: MenuPanel) =>
  makeStep(model =>
    isPanelAllowed(model, panel)
      ? Update.combineSteps([
          showPanel(panel),
          PanelDialogBinding.requestOpen(),
        ])
      : unchanged,
  )

export const closePanel = makeStep(model =>
  model.panelDialog.isOpen ? PanelDialogBinding.requestClose() : unchanged,
)

export const goHome: UpdateStep = stepModel => ({
  model: returnHome(withInput(stepModel, releaseAll)),
})

const isEndScreen = Phase.isAnyOf(['Victory', 'GameOver'])

export const leaveFromMenu = makeStep(model => {
  if (isPaused(model.phase)) {
    return openPanel('LeaveRun')
  } else if (isEndScreen(model.phase) && isPastRestartGrace(model)) {
    return goHome
  } else {
    return unchanged
  }
})

export const leaveRun = makeStep(model =>
  isPaused(model.phase) && model.panel === 'LeaveRun'
    ? Update.combineSteps([closePanel, goHome])
    : unchanged,
)

const isEndMenuKey = (model: Model, code: string): boolean =>
  isMenuKey(code) || (isStartKey(code) && endOffer(model) === 'MenuOnly')

export const menuFromKey = (code: string) =>
  makeStep(model => (isEndMenuKey(model, code) ? leaveFromMenu : unchanged))

export const canMoveHomeFocus = (model: Model): boolean =>
  isOnHome(model.phase) &&
  CoopScreen.isAnyOf(['Closed'])(model.coop.screen) &&
  !model.panelDialog.isOpen &&
  !model.profileDialog.isOpen &&
  !model.handDialog.isOpen

// NOTE: the gear opens the Profile on its Settings tab, only from the menu
// itself, as the gear is only there.
export const openSettingsFromGear = makeStep(model =>
  canMoveHomeFocus(model) ? openProfile('Settings') : unchanged,
)

// THE MANOR HAND

const releaseInput: UpdateStep = stepModel => ({
  model: withInput(stepModel, releaseAll),
})

export const openHand = makeStep(model =>
  canMoveHomeFocus(model)
    ? Update.combineSteps([releaseInput, HandDialogBinding.requestOpen()])
    : unchanged,
)

// NOTE: a card puts the hand away before it opens its panel, so the
// panel's Done or Esc lands back on the menu, not in the hand: a card's
// handler runs closeHand, then the card's own Step.
export const closeHand = makeStep(model =>
  model.handDialog.isOpen ? HandDialogBinding.requestClose() : unchanged,
)

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

const seeNewsStep: UpdateStep = stepModel => ({ model: seeNews(stepModel) })

export const openWhatsNew = makeStep(model =>
  isPanelAllowed(model, 'WhatsNew')
    ? Update.combineSteps([seeNewsStep, openPanel('WhatsNew')])
    : unchanged,
)

const showPage =
  (page: MunchopediaPage): UpdateStep =>
  stepModel => ({ model: showMunchopediaPage(stepModel, page) })

export const openMunchopedia = (page: MunchopediaPage) =>
  makeStep(model =>
    isPanelAllowed(model, 'Munchopedia')
      ? Update.combineSteps([showPage(page), openPanel('Munchopedia')])
      : unchanged,
  )

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

const openCard = (card: KeyedHandCard) => {
  switch (card) {
    case 'WhatsNew':
      return openWhatsNew
    case 'Munchopedia':
      return openMunchopedia(MunchopediaPage.List())
    case 'Character':
      return openProfile('Look')
    case 'HowToPlay':
      return openPanel('HowToPlay')
  }
}

const switchModeStep: UpdateStep = stepModel => ({
  model: switchMode(stepModel),
})

// NOTE: C opens the character picker on every screen that offers it, so it
// stays with characterFromKey and is left out here. The card keys work from
// the menu without opening the hand first.
export const homeFromKey = (code: string) =>
  makeStep(model => {
    if (!canMoveHomeFocus(model)) {
      return unchanged
    } else if (isModeKey(code)) {
      return switchModeStep
    } else if (isDifficultyKey(code)) {
      return openPanel('Difficulty')
    } else if (isManorKey(code)) {
      return openHand
    } else if (isSettingsKey(code)) {
      return openProfile('Settings')
    } else {
      return Option.match(maybeHandCardOfKey(code), {
        onNone: () => unchanged,
        onSome: card => (card === 'Character' ? unchanged : openCard(card)),
      })
    }
  })

// DIFFICULTY

export const isAskingDifficultyFirst = (model: Model): boolean =>
  DifficultyCard.isAnyOf(['Unseen'])(model.difficultyCard) &&
  isOnHome(model.phase)

const markAsking =
  (mode: RunMode): UpdateStep =>
  stepModel => ({
    model: modifyFields(stepModel, {
      difficultyCard: () => DifficultyCard.Asking({ mode }),
    }),
  })

const askDifficulty = (mode: RunMode) =>
  makeStep(model =>
    isPanelAllowed(model, 'Difficulty')
      ? Update.combineSteps([markAsking(mode), openPanel('Difficulty')])
      : unchanged,
  )

const startWithMode =
  (mode: RunMode): UpdateStep =>
  stepModel =>
    startFromButton(stepModel, startWhenAllowed(stepModel, mode))

export const startOrAsk = (mode: RunMode) =>
  makeStep(model =>
    isAskingDifficultyFirst(model)
      ? Update.combineSteps([unlockAudio, askDifficulty(mode)])
      : startWithMode(mode),
  )

export const difficultyCardFromKey = (code: string) =>
  makeStep(model =>
    isAskingDifficultyFirst(model) && isStartKey(code)
      ? askDifficulty(runModeOf(model.home.mode))
      : unchanged,
  )

const chooseFromCard =
  (difficulty: Difficulty): UpdateStep =>
  stepModel => ({
    model: modifyFields(chooseDifficulty(stepModel, difficulty), {
      difficultyCard: () => DifficultyCard.Seen(),
    }),
  })

const pickFromBadge = (difficulty: Difficulty) =>
  makeStep(model =>
    isPanelOpen(model, 'Difficulty') &&
    isOnHome(model.phase) &&
    !isLocked(model.difficulty, difficulty)
      ? Update.combineSteps([chooseFromCard(difficulty), closePanel])
      : unchanged,
  )

export const pickFromCard = (difficulty: Difficulty) =>
  makeStep(model =>
    DifficultyCard.match(model.difficultyCard, {
      Unseen: () => pickFromBadge(difficulty),
      Seen: () => pickFromBadge(difficulty),
      Asking: ({ mode }) =>
        isLocked(model.difficulty, difficulty)
          ? unchanged
          : Update.combineSteps([
              chooseFromCard(difficulty),
              closePanel,
              startWithMode(mode),
            ]),
    }),
  )

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
    isNightmareUnlockedBy(before, stepModel, runDifficultyOf(stepModel))
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

// INSTALL

export const dismissHomeScreenTip = (model: Model): Model =>
  model.homeScreenTip === 'Dismissed'
    ? model
    : modifyFields(model, { homeScreenTip: () => 'Dismissed' })

const dismissTip: UpdateStep = stepModel => ({
  model: dismissHomeScreenTip(stepModel),
})

const openHomeScreenSteps = makeStep(model =>
  model.homeScreenSteps.isOpen
    ? unchanged
    : Update.combineSteps([releaseInput, HomeScreenStepsBinding.requestOpen()]),
)

const promptInstall: UpdateStep = stepModel => ({
  model: dismissHomeScreenTip(stepModel),
  commands: [ShowInstallPrompt()],
})

// NOTE: the install tile pulses until its first tap. Chrome's own prompt
// comes first where the browser offered one; an iPhone gets the picture
// guide, since Safari has no prompt to show.
export const pressInstall = makeStep(model => {
  if (!isInstallTileShown(model)) {
    return unchanged
  } else if (model.installOffer === 'Ready') {
    return promptInstall
  } else {
    return Update.combineSteps([dismissTip, openHomeScreenSteps])
  }
})

export const settleInstallPrompt = (
  model: Model,
  outcome: InstallOutcome,
): Model =>
  modifyFields(model, {
    installOffer: () => (outcome === 'Accepted' ? 'Installed' : 'None'),
  })

// UPDATE GIFT

export const unwrapUpdateGift: UpdateStep = model =>
  isUpdateGiftShown(model) && model.updateGift === 'Wrapped'
    ? combine(model, [
        stepModel => ({
          model: modifyFields(stepModel, { updateGift: () => 'Unwrapping' }),
          commands: [WaitForUnwrap()],
        }),
        playSounds([uiCue('LootPop')]),
      ])
    : { model }

export const rewrapUpdateGift = (model: Model): Model =>
  modifyFields(model, { updateGift: () => 'Wrapped' })

export const reloadOntoNewerBuild: UpdateStep = model =>
  Option.match(model.maybeNewerBuild, {
    onNone: () => ({ model: rewrapUpdateGift(model) }),
    onSome: build => ({ model, commands: [ReloadPage({ build })] }),
  })

// UPDATE GREETING

// NOTE: the page just reloaded from the gift onto the build it unwrapped,
// so the home menu throws a little party, once.
export const greetUpdate = (isDue: boolean) =>
  makeStep(model =>
    isDue && isOnHome(model.phase) && !model.updateGreeting.isOpen
      ? UpdateGreetingBinding.requestOpen()
      : unchanged,
  )

export const newsFromGreeting = makeStep(() =>
  Update.combineSteps([UpdateGreetingBinding.requestClose(), openWhatsNew]),
)

// END SCREENS

const isOfferingOnlyMenu = (model: Model): boolean =>
  endOffer(model) === 'MenuOnly'

export const focusEndMenuFrom =
  (before: Model): UpdateStep =>
  stepModel =>
    !isOfferingOnlyMenu(before) && isOfferingOnlyMenu(stepModel)
      ? { model: stepModel, commands: [FocusEndMenuButton()] }
      : { model: stepModel }
