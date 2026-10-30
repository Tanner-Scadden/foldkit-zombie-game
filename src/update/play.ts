import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { positionVariation } from '../audio'
import {
  FetchBuild,
  RegisterServiceWorker,
  UpdateServiceWorker,
} from '../commands'
import { isCouchKey, pressCouchKey } from '../couch'
import { makeStep } from '../definition'
import { advanceGame, clampFrameDelta, refreshIntent } from '../frame'
import {
  type PointerPress,
  isEndlessKey,
  isKeepGoingKey,
  isPauseKey,
  isReloadKey,
  isStartKey,
  isStartWaveKey,
  isSwapKey,
  pressKey,
  releaseAll,
  releaseKey,
} from '../input'
import {
  type GunSlot,
  type InputDevice,
  type Model,
  type Orientation,
  Phase,
  RunMode,
} from '../model'
import {
  ageDebutCard,
  isDebutCardUp,
  learnFromFrame,
  learnShop,
  learnStartWave,
  learnSwap,
  moveHintBand,
  skipDebutCard,
} from '../onboarding'
import { dropClip } from '../particles'
import { isCoop } from '../party'
import { isInteractTaken } from '../purchase'
import { startWave } from '../runFlow'
import { isUsingServiceWorker } from '../serviceWorker'
import { isAtCounter, isBrowsing } from '../shop'
import { tallyFrame } from '../stats'
import {
  RUNNING_BUILD,
  isCheckingForUpdates,
  maybeNewerBuild,
} from '../version'
import { isRoundActive, pause } from '../waves'
import {
  beginReload,
  canReload,
  cancelReload,
  heldSlotOf,
  heldWeapon,
  swapWeapon,
} from '../weapons'
import { coopFromKey, isCoopOpen, pressCoopKey, releaseCoopKey } from './coop'
import { isRunOn, keyInRun } from './coopRun'
import {
  difficultyCardFromKey,
  homeFocusFromKey,
  homeFromKey,
  homeStartFromKey,
  isAskingDifficultyFirst,
  menuFromKey,
} from './home'
import { profileFromKey } from './profile'
import {
  isPaused,
  isScreenAnimated,
  keepGoingWhenAllowed,
  startWhenAllowed,
  startsRun,
} from './run'
import {
  closeShop,
  closeShopOutsidePreparation,
  enterShop,
  leaveShopWithoutDialog,
} from './shop'
import {
  frameSoundCues,
  playSounds,
  playStartSoundWhen,
  playSwapSoundWhen,
  toggleAudioFromKey,
  uiCue,
  unlockAudio,
} from './sound'
import {
  type UpdateReturn,
  type UpdateStep,
  combine,
  toModel,
  unchanged,
  withInput,
} from './step'
import { trapFromKey } from './traps'

// The Steps the root's handlers (src/main.ts) are made of: the frame, the
// keys and pointers, the guns and traps, pausing, and the build check.

export const START_SOUND_GRACE_MS = 1000

export const useDevice = (model: Model, device: InputDevice): Model =>
  model.lastDevice === device
    ? model
    : modifyFields(model, { lastDevice: () => device })

export const asAllowedPress = (
  model: Model,
  press: PointerPress,
): PointerPress =>
  press.device === 'Touch' && model.touchControls === 'Blocked'
    ? { ...press, device: 'Mouse' }
    : press

export const orientationOf = (width: number, height: number): Orientation =>
  height > width ? 'Portrait' : 'Landscape'

export const resumeFromPointer = (model: Model): Model =>
  isPaused(model.phase) ? startWhenAllowed(model, model.mode) : model

export const hasStartedWave = (before: Model, after: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(before.phase) &&
  Phase.isAnyOf(['Wave'])(after.phase)

export const learnStartWaveWhen = (before: Model, after: Model): Model =>
  hasStartedWave(before, after) ? learnStartWave(after) : after

export const learnSwapWhen = (before: Model, after: Model): Model =>
  changedWeapon(before, after) ? learnSwap(after) : after

// NOTE: at a purchasable the interact key holds to buy (src/purchase.ts),
// so the same key starts the wave only away from one.
export const preparationFromKey = (model: Model, code: string): Model => {
  if (isPauseKey(code)) {
    return pause(model)
  } else if (isStartWaveKey(code) && !isInteractTaken(model)) {
    return startWave(model)
  } else {
    return model
  }
}

export const startFromKey = (model: Model, code: string): Model => {
  if (isStartKey(code)) {
    return startWhenAllowed(model, RunMode.Campaign())
  } else if (isEndlessKey(code)) {
    return startWhenAllowed(model, RunMode.Endless())
  } else {
    return model
  }
}

export const resumeFromKey = (model: Model, code: string): Model =>
  isPauseKey(code) ? startWhenAllowed(model, model.mode) : model

export const victoryFromKey = (model: Model, code: string): Model =>
  isKeepGoingKey(code) ? keepGoingWhenAllowed(model) : startFromKey(model, code)

export const swapGun = (model: Model): Model => {
  if (
    !isRoundActive(model.phase) ||
    isAtCounter(model.shop) ||
    isDebutCardUp(model)
  ) {
    return model
  }

  const swapped = modifyFields(model, {
    player: player => modifyFields(player, { arsenal: swapWeapon }),
  })
  return changedWeapon(model, swapped)
    ? modifyFields(swapped, { player: cancelReload })
    : swapped
}

export const heldSlot = (model: Model): GunSlot =>
  heldSlotOf(model.player.arsenal)

export const swapFromKey = (model: Model, code: string): Model =>
  isSwapKey(code) ? swapGun(model) : model

export const changedWeapon = (before: Model, after: Model): boolean =>
  heldWeapon(before.player.arsenal) !== heldWeapon(after.player.arsenal)

export const isFighting = Phase.isAnyOf(['Wave'])

// NOTE: in co-op the new zombie card shows without stopping the game
// (decided row 9), so only single player waits on it.
export const isDebutCardBlocking = (model: Model): boolean =>
  isFighting(model.phase) && isDebutCardUp(model) && !isCoop(model)

export const skipDebutCardWhenUp = (model: Model): Model =>
  isDebutCardBlocking(model) ? skipDebutCard(model) : model

export const debutCardFromKey = (model: Model, code: string): Model => {
  if (isStartKey(code)) {
    return skipDebutCard(model)
  } else if (isPauseKey(code)) {
    return pause(model)
  } else {
    return model
  }
}

export const phaseFromKey = (model: Model, code: string): Model =>
  Phase.match(model.phase, {
    Ready: () =>
      isAskingDifficultyFirst(model) ? model : homeStartFromKey(model, code),
    Preparation: () => preparationFromKey(model, code),
    Wave: () => (isPauseKey(code) ? pause(model) : model),
    Paused: () => resumeFromKey(model, code),
    Victory: () => victoryFromKey(model, code),
    GameOver: () => startFromKey(model, code),
  })

export const hasResumed = (before: Model, after: Model): boolean =>
  isPaused(before.phase) && !isPaused(after.phase)

// MENU TAPS

// NOTE: a soft pop on the home menu's own buttons, so a tap feels pressed.
export const tapSound: UpdateStep = playSounds([uiCue('Pop')])

// RELOAD

export const reloadHeldGun: UpdateStep = stepModel => {
  const { player } = stepModel
  if (
    !isRoundActive(stepModel.phase) ||
    isAtCounter(stepModel.shop) ||
    !canReload(player)
  ) {
    return { model: stepModel }
  }

  return playSounds([
    { sound: 'MagOut', variation: positionVariation(player.x, player.y) },
  ])(dropClip(modifyFields(stepModel, { player: beginReload })))
}

export const reloadFromKey: (code: string) => UpdateStep = code => stepModel =>
  isReloadKey(code) ? reloadHeldGun(stepModel) : { model: stepModel }

// PAUSE

export const pauseStep: UpdateStep = stepModel => ({
  model: withInput(pause(stepModel), releaseAll),
})

export const pauseRound = makeStep(() =>
  Update.combineSteps([closeShop, pauseStep]),
)

export const releaseInput: UpdateStep = stepModel => ({
  model: withInput(stepModel, releaseAll),
})

export const pauseWhenAway = makeStep(model =>
  isRoundActive(model.phase) ? pauseRound : releaseInput,
)

export const isFreshRun = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  model.elapsedMs < START_SOUND_GRACE_MS

// VERSION

export const checkForUpdate = (model: Model): UpdateReturn =>
  isCheckingForUpdates(RUNNING_BUILD)
    ? { model, commands: [FetchBuild()] }
    : { model }

// NOTE: a newer build also asks the service worker to look for it, so the
// new build installs in the background before the player taps the chip.
export const recordRemoteBuild = (
  model: Model,
  runningBuild: string,
  remoteBuild: string,
): UpdateReturn => {
  const maybeNewer = maybeNewerBuild(runningBuild, remoteBuild)
  const next = modifyFields(model, { maybeNewerBuild: () => maybeNewer })
  return Option.isSome(maybeNewer) && isUsingServiceWorker(runningBuild)
    ? { model: next, commands: [UpdateServiceWorker()] }
    : { model: next }
}

// NOTE: the service worker registers once the splash is gone, so precaching
// the game for offline play never slows the game's own first load.
export const registerServiceWorkerAfterSplash = (
  model: Model,
  runningBuild: string,
): UpdateReturn =>
  isUsingServiceWorker(runningBuild)
    ? { model, commands: [RegisterServiceWorker()] }
    : { model }

// FRAME

// NOTE: one frame of single player, or nothing while an online run's room
// runs the World (its frames are TickedRoomFrame).
export const tickFrame = (deltaTime: number) =>
  makeStep(model => {
    if (isRunOn(model)) {
      return unchanged
    } else if (isDebutCardBlocking(model)) {
      return toModel(ageDebutCard(model, clampFrameDelta(deltaTime)))
    } else if (isRoundActive(model.phase)) {
      const framed = moveHintBand(
        learnFromFrame(
          model,
          tallyFrame(
            model,
            advanceGame(model, deltaTime),
            clampFrameDelta(deltaTime),
          ),
        ),
      )
      const advanced = isCoop(framed)
        ? ageDebutCard(framed, clampFrameDelta(deltaTime))
        : framed
      const hasEnteredShop =
        !isBrowsing(model.shop) && isBrowsing(advanced.shop)
      return Update.combineSteps([
        toModel(hasEnteredShop ? learnShop(advanced) : advanced),
        playSounds(frameSoundCues(advanced.frameEvents)),
        ...(hasEnteredShop ? [enterShop] : []),
        closeShopOutsidePreparation,
        leaveShopWithoutDialog,
      ])
    } else if (isScreenAnimated(model.phase)) {
      return toModel(
        modifyFields(model, {
          screenMs: screenMs => screenMs + clampFrameDelta(deltaTime),
        }),
      )
    } else {
      return unchanged
    }
  })

// KEYS

export const pressedKey = (code: string) =>
  makeStep(model => {
    if (isRunOn(model)) {
      return keyInRun(code)
    }

    const keyed = useDevice(model, 'KeyboardMouse')
    if (isCouchKey(keyed, code)) {
      return toModel(
        withInput(pressCouchKey(keyed, code), input => pressKey(input, code)),
      )
    }
    if (isCoopOpen(keyed)) {
      return Update.combineSteps([
        toModel(keyed),
        unlockAudio,
        pressCoopKey(code),
      ])
    }

    if (isAtCounter(keyed.shop)) {
      return Update.combineSteps([
        toModel(
          withInput(toggleAudioFromKey(keyed, code), input =>
            pressKey(input, code),
          ),
        ),
        unlockAudio,
      ])
    }

    if (isDebutCardBlocking(keyed)) {
      return Update.combineSteps([
        toModel(
          withInput(
            toggleAudioFromKey(debutCardFromKey(keyed, code), code),
            input => pressKey(input, code),
          ),
        ),
        unlockAudio,
      ])
    }

    const phased = phaseFromKey(keyed, code)
    const pressed = learnSwapWhen(
      model,
      learnStartWaveWhen(
        model,
        withInput(swapFromKey(toggleAudioFromKey(phased, code), code), input =>
          hasResumed(model, phased) ? input : pressKey(input, code),
        ),
      ),
    )
    return Update.combineSteps([
      toModel(pressed),
      unlockAudio,
      profileFromKey(code),
      coopFromKey(code),
      difficultyCardFromKey(code),
      menuFromKey(code),
      homeFocusFromKey(code),
      homeFromKey(code),
      trapFromKey(code),
      reloadFromKey(code),
      playStartSoundWhen(startsRun(model, pressed)),
      playSwapSoundWhen(changedWeapon(model, pressed)),
    ])
  })

export const releasedKey = (code: string) =>
  makeStep(model => {
    const released = withInput(model, input => releaseKey(input, code))
    return isCoopOpen(released)
      ? Update.combineSteps([toModel(released), releaseCoopKey(code)])
      : toModel(released)
  })

// GUNS AND TRAPS

export const swapFromButton: UpdateStep = model => {
  const swapped = learnSwapWhen(model, refreshIntent(swapGun(model)))
  return combine(swapped, [
    unlockAudio,
    playSwapSoundWhen(changedWeapon(model, swapped)),
  ])
}

export const pressGunSlot =
  (slot: GunSlot): UpdateStep =>
  model => {
    if (isDebutCardBlocking(model)) {
      return { model }
    } else if (slot === heldSlot(model)) {
      return combine(model, [unlockAudio, reloadHeldGun])
    } else {
      return swapFromButton(model)
    }
  }

// NOTE: the counter and the new zombie card hold the round's buttons.
export const isTrapButtonHeld = (model: Model): boolean =>
  isAtCounter(model.shop) || isDebutCardBlocking(model)

export const startWaveFromButton: UpdateStep = model => ({
  model: learnStartWaveWhen(model, startWave(model)),
})
