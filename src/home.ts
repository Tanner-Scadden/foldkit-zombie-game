import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { maybeNewestNewsDay } from './changelog'
import { FEEDBACK_LINE, RESTART_GRACE_MS } from './constants'
import { hasJustWon, withBests } from './difficulty'
import type { FocusStep } from './input'
import {
  type HomeButton,
  type HomeMode,
  type KillCounts,
  type Model,
  MunchopediaPage,
  Phase,
  RunMode,
  RunTally,
  type ZombieKind,
} from './model'
import { isDiscovered, newlyDiscovered } from './munchopedia'
import { freshRun } from './runReset'
import { addKills, killTotal, killsSince } from './stats'

// BUTTONS

// NOTE: the fixed home layout. Arrow keys walk PLAY, the mode toggle, then
// the rail top to bottom. A new feature joins the rail or the mode toggle,
// so PLAY never moves.
export const HOME_BUTTONS: Array.NonEmptyReadonlyArray<HomeButton> = [
  'Play',
  'Mode',
  'WhatsNew',
  'Munchopedia',
  'Character',
  'HowToPlay',
  'Settings',
]

export type RailButton = Exclude<HomeButton, 'Play' | 'Mode'>

export const RAIL_BUTTONS: Array.NonEmptyReadonlyArray<RailButton> = [
  'WhatsNew',
  'Munchopedia',
  'Character',
  'HowToPlay',
  'Settings',
]

const HOME_BUTTON_IDS: Readonly<Record<HomeButton, string>> = {
  Play: 'home-play',
  Mode: 'home-mode',
  WhatsNew: 'home-whats-new',
  Munchopedia: 'home-munchopedia',
  Character: 'home-character',
  HowToPlay: 'home-how-to-play',
  Settings: 'home-settings',
}

type HomeKey = Readonly<{ code: string; cap: string; name: string }>

// NOTE: one key per button. Enter, E, and C were already the home keys. The
// rail's other keys are letters no other screen uses, so WASD, R, Q, T, G,
// H, K, M, and N keep their one meaning: L for the latest news, Z for
// zombies, I for info, and O for options.
export const HOME_KEYS: Readonly<Record<HomeButton, HomeKey>> = {
  Play: { code: 'Enter', cap: 'ENTER', name: 'Enter' },
  Mode: { code: 'KeyE', cap: 'E', name: 'E' },
  WhatsNew: { code: 'KeyL', cap: 'L', name: 'L' },
  Munchopedia: { code: 'KeyZ', cap: 'Z', name: 'Z' },
  Character: { code: 'KeyC', cap: 'C', name: 'C' },
  HowToPlay: { code: 'KeyI', cap: 'I', name: 'I' },
  Settings: { code: 'KeyO', cap: 'O', name: 'O' },
}

export const maybeRailButtonOfKey = (code: string): Option.Option<RailButton> =>
  Array.findFirst(RAIL_BUTTONS, button => HOME_KEYS[button].code === code)

export const isModeKey = (code: string): boolean => code === HOME_KEYS.Mode.code

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

// MODE

export const runModeOf = (mode: HomeMode): RunMode =>
  mode === 'Campaign' ? RunMode.Campaign() : RunMode.Endless()

export const switchMode = (model: Model): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        mode: mode => (mode === 'Campaign' ? 'Endless' : 'Campaign'),
      }),
  })

// WHAT'S NEW

export const isNewsUnseen = (model: Model): boolean =>
  Option.match(maybeNewestNewsDay, {
    onNone: () => false,
    onSome: ({ date }) => !Option.contains(model.home.maybeSeenNewsDay, date),
  })

export const seeNews = (model: Model): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        newsPage: () => 0,
        maybeSeenNewsDay: seen =>
          Option.match(maybeNewestNewsDay, {
            onNone: () => seen,
            onSome: ({ date }) => Option.some(date),
          }),
      }),
  })

export const turnNewsPage = (
  model: Model,
  step: number,
  dayCount: number,
): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        newsPage: page => Math.max(0, Math.min(dayCount - 1, page + step)),
      }),
  })

// MUNCHOPEDIA

const openEntry = (model: Model, kind: ZombieKind): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        munchopediaPage: () => MunchopediaPage.Entry({ kind }),
        newEntries: Array.filter(fresh => fresh !== kind),
        openedEntries: opened =>
          isDiscovered(model.bests.killsByKind, kind)
            ? Array.union(opened, [kind])
            : opened,
      }),
  })

export const showMunchopediaPage = (
  model: Model,
  page: MunchopediaPage,
): Model =>
  MunchopediaPage.match(page, {
    List: () =>
      modifyFields(model, {
        home: home =>
          modifyFields(home, { munchopediaPage: () => MunchopediaPage.List() }),
      }),
    Entry: ({ kind }) => openEntry(model, kind),
  })

// END SCREENS

type EndOffer = 'Nothing' | 'MenuOnly' | 'MenuAndModes'

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

// NOTE: going home ends the run, so every run field goes back to a fresh start.
export const returnHome = (model: Model): Model => ({
  ...model,
  ...freshRun(model),
  phase: Phase.Ready(),
  maybeHomeFocus: Option.none(),
})

// BESTS

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

const isInRun = Phase.isAnyOf(['Preparation', 'Wave', 'Paused'])

const countRun = (
  model: Model,
  tally: RunTally,
  kills: KillCounts,
  isWin: boolean,
): Model => {
  const isFirstCount = RunTally.isAnyOf(['Uncounted'])(tally)
  const newKills = RunTally.match(tally, {
    Uncounted: () => kills,
    Counted: ({ kills: countedKills }) => killsSince(kills, countedKills),
  })
  const killsByKind = addKills(model.bests.killsByKind, newKills)
  const counted = modifyFields(model, {
    bests: bests =>
      modifyFields(bests, {
        runsPlayed: runs => (isFirstCount ? runs + 1 : runs),
        totalKills: total => total + killTotal(newKills),
        killsByKind: () => killsByKind,
      }),
    runTally: () => RunTally.Counted({ kills }),
    home: home =>
      modifyFields(home, {
        newEntries: fresh =>
          Array.union(
            fresh,
            newlyDiscovered(model.bests.killsByKind, killsByKind),
          ),
      }),
  })
  return isWin
    ? withBests(counted, bests =>
        modifyFields(bests, {
          maybeFastestWinMs: maybeFastestMs =>
            fasterWin(maybeFastestMs, model.stats.runMs),
        }),
      )
    : counted
}

// NOTE: a run is counted when it ends: on Game Over, on Victory, and when
// the player leaves it for the menu. Counting then and not every frame means
// the save is written once a run.
export const countRunFrom = (before: Model, after: Model): Model => {
  if (!isEndScreen(before.phase) && isEndScreen(after.phase)) {
    return countRun(
      after,
      after.runTally,
      after.stats.kills,
      hasJustWon(before, after),
    )
  } else if (isInRun(before.phase) && isOnHome(after.phase)) {
    return modifyFields(
      countRun(after, before.runTally, before.stats.kills, false),
      { runTally: () => RunTally.Uncounted() },
    )
  } else {
    return after
  }
}

// NOTE: the NEW ENTRY pop stays up on the end screen and the menu until the
// entry is opened or another run starts. The dot on the rail stays until the
// entry is opened.
export const forgetNewEntriesFrom = (before: Model, after: Model): Model =>
  !isInRun(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase) &&
  Array.isReadonlyArrayNonEmpty(after.home.newEntries)
    ? modifyFields(after, {
        home: home => modifyFields(home, { newEntries: () => [] }),
      })
    : after

// FEEDBACK

// NOTE: the end screens ask for feedback only on a player's first few runs.
// The run on the end screen is already counted, so a first run shows 1.
export const FEEDBACK_RUNS = 3

export const isAskingForFeedback = (model: Model): boolean =>
  model.bests.runsPlayed <= FEEDBACK_RUNS

export const feedbackSentence = (model: Model): string =>
  isAskingForFeedback(model) ? ` ${FEEDBACK_LINE}` : ''
