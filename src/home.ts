import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { RESTART_GRACE_MS } from './constants'
import type { FocusStep } from './input'
import { type HomeButton, type Model, Phase, initialModel } from './model'
import { totalKills } from './stats'

// BUTTONS

export const HOME_BUTTONS: Array.NonEmptyReadonlyArray<HomeButton> = [
  'Play',
  'Endless',
  'Character',
  'HowToPlay',
  'Settings',
]

const HOME_BUTTON_IDS: Readonly<Record<HomeButton, string>> = {
  Play: 'home-play',
  Endless: 'home-endless',
  Character: 'home-character',
  HowToPlay: 'home-how-to-play',
  Settings: 'home-settings',
}

export const homeButtonId = (button: HomeButton): string =>
  HOME_BUTTON_IDS[button]

export const RESET_TUTORIAL_BUTTON_ID = 'reset-tutorial'
export const KEEP_TUTORIAL_BUTTON_ID = 'keep-tutorial'

const STEP_OFFSET: Readonly<Record<FocusStep, number>> = {
  Previous: -1,
  Next: 1,
}

export const steppedHomeFocus = (
  maybeFocus: Option.Option<HomeButton>,
  step: FocusStep,
): HomeButton =>
  Option.match(maybeFocus, {
    onNone: () => Array.headNonEmpty(HOME_BUTTONS),
    onSome: focused => {
      const index = pipe(
        Array.findFirstIndex(HOME_BUTTONS, button => button === focused),
        Option.getOrElse(() => 0),
      )
      const count = HOME_BUTTONS.length
      return pipe(
        Array.get(HOME_BUTTONS, (index + STEP_OFFSET[step] + count) % count),
        Option.getOrElse(() => Array.headNonEmpty(HOME_BUTTONS)),
      )
    },
  })

// HOME

export const isOnHome = Phase.isAnyOf(['Ready'])

// END SCREENS

export type EndOffer = 'Nothing' | 'MenuOnly' | 'MenuAndModes'

export const END_MENU_BUTTON_ID = 'end-menu-button'

const isEndScreen = Phase.isAnyOf(['Victory', 'GameOver'])

// NOTE: a newer build waits on the home menu, so the end screens offer only
// MENU then. Starting another run here would keep the old build running.
export const endOffer = (model: Model): EndOffer => {
  if (!isEndScreen(model.phase) || model.screenMs < RESTART_GRACE_MS) {
    return 'Nothing'
  } else if (Option.isSome(model.maybeNewerBuild)) {
    return 'MenuOnly'
  } else {
    return 'MenuAndModes'
  }
}

export const returnHome = (model: Model): Model =>
  modifyFields(model, {
    phase: () => Phase.Ready(),
    pacing: () => initialModel.pacing,
    boss: () => initialModel.boss,
    intensity: () => 0,
    player: () => initialModel.player,
    zombies: () => [],
    bullets: () => [],
    particles: () => [],
    decals: () => [],
    score: () => 0,
    wallet: () => initialModel.wallet,
    shop: () => initialModel.shop,
    frameEvents: () => [],
    hitStop: () => initialModel.hitStop,
    shake: () => initialModel.shake,
    popups: () => [],
    streak: () => initialModel.streak,
    blasts: () => [],
    traps: () => [],
    pickups: () => [],
    boosts: () => initialModel.boosts,
    callouts: () => [],
    trapStock: () => initialModel.trapStock,
    flowField: () => initialModel.flowField,
    wideFlowField: () => initialModel.wideFlowField,
    debutCard: () => initialModel.debutCard,
    stats: () => initialModel.stats,
    screenMs: () => 0,
    maybeHomeFocus: () => Option.none(),
  })

// SESSION BESTS

const fasterWin = (
  maybeFastestMs: Option.Option<number>,
  runMs: number,
): Option.Option<number> =>
  Option.some(
    Option.match(maybeFastestMs, {
      onNone: () => runMs,
      onSome: fastestMs => Math.min(fastestMs, runMs),
    }),
  )

const hasWon = (before: Model, after: Model): boolean =>
  !Phase.isAnyOf(['Victory'])(before.phase) &&
  Phase.isAnyOf(['Victory'])(after.phase)

export const recordSessionBests = (before: Model, after: Model): Model => {
  const newKills = Math.max(
    0,
    totalKills(after.stats) - totalKills(before.stats),
  )
  const isWin = hasWon(before, after)
  if (newKills === 0 && !isWin) {
    return after
  }

  return modifyFields(after, {
    sessionBests: bests => ({
      kills: bests.kills + newKills,
      maybeFastestWinMs: isWin
        ? fasterWin(bests.maybeFastestWinMs, after.stats.runMs)
        : bests.maybeFastestWinMs,
    }),
  })
}
