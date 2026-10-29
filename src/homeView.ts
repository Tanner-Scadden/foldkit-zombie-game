import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import { dialogShell } from './dialogs'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
  bestsFor,
  isLocked,
} from './difficulty'
import { munchopediaBodyView, munchopediaText } from './guideView'
import {
  HOME_BUTTONS,
  HOME_KEYS,
  KEEP_TUTORIAL_BUTTON_ID,
  RAIL_BUTTONS,
  RESET_TUTORIAL_BUTTON_ID,
  type RailButton,
  homeButtonId,
  isNewsUnseen,
  isOnHome,
} from './home'
import {
  CHARACTER_ICON,
  FULLSCREEN_ICON,
  HELP_ICON,
  MUNCHOPEDIA_ICON,
  NEWS_ICON,
  PADLOCK_ICON,
  SETTINGS_ICON,
} from './icons'
import { Message } from './message'
import {
  type Difficulty,
  DifficultyCard,
  type HomeButton,
  type HomeMode,
  type MenuPanel,
  type Model,
  Phase,
} from './model'
import { entryName, hasUnopenedEntry } from './munchopedia'
import { helpLabel, howToPlayView } from './pauseHelp'
import {
  LinkFlow,
  SyncState,
  linkProblemText,
  syncStateText,
} from './playerSync'
import { durationLabel } from './stats'
import { FINAL_WAVE } from './waves'
import { whatsNewBodyView, whatsNewText } from './whatsNewView'

// KEY BADGES

const isKeyboard = (model: Model): boolean =>
  model.lastDevice === 'KeyboardMouse'

const keyBadgeView = (
  model: Model,
  button: HomeButton,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  isKeyboard(model)
    ? [
        h.span(
          [h.Class('home-key'), h.AriaHidden(true)],
          [HOME_KEYS[button].cap],
        ),
      ]
    : []

const homeButtonAttributes = (button: HomeButton, h: HtmlBuilder<Message>) => [
  h.Type('button'),
  h.Id(homeButtonId(button)),
  h.AriaKeyshortcuts(HOME_KEYS[button].name),
  h.OnFocus(Message.FocusedHomeButton({ button })),
  h.OnBlur(Message.BlurredHomeButton()),
]

// PLAY

type ModeLook = Readonly<{
  label: string
  detail: string
  playLabel: string
}>

const MODE_LOOKS: Readonly<Record<HomeMode, ModeLook>> = {
  Campaign: {
    label: 'CAMPAIGN',
    detail: `${FINAL_WAVE} WAVES`,
    playLabel: `Play the campaign: ${FINAL_WAVE} waves, then victory`,
  },
  Endless: {
    label: 'ENDLESS',
    detail: 'UNTIL YOU DROP',
    playLabel: 'Play endless: waves keep coming until you fall',
  },
}

const otherMode = (mode: HomeMode): HomeMode =>
  mode === 'Campaign' ? 'Endless' : 'Campaign'

const modeName = (mode: HomeMode): string =>
  mode === 'Campaign' ? 'Campaign' : 'Endless'

const playButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const look = MODE_LOOKS[model.home.mode]
  return h.button(
    [
      ...homeButtonAttributes('Play', h),
      h.Class('home-play'),
      h.DataAttribute('mode', model.home.mode),
      h.AriaLabel(look.playLabel),
      h.OnClick(Message.ClickedPlayButton(), { propagation: 'Stop' }),
    ],
    [
      h.span([h.Class('home-play-label')], ['PLAY']),
      h.span([h.Class('home-play-detail')], [`${look.label} · ${look.detail}`]),
      ...keyBadgeView(model, 'Play', h),
    ],
  )
}

const modeOptionView = (
  model: Model,
  mode: HomeMode,
  h: HtmlBuilder<Message>,
): Html =>
  h.span(
    [
      h.Class('home-mode-option'),
      h.DataAttribute('state', model.home.mode === mode ? 'Chosen' : 'Other'),
    ],
    [MODE_LOOKS[mode].label],
  )

const modeButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      ...homeButtonAttributes('Mode', h),
      h.Class('home-mode'),
      h.AriaLabel(
        `Mode: ${modeName(model.home.mode)}. Switch to ${modeName(otherMode(model.home.mode))}`,
      ),
      h.OnClick(Message.ClickedModeButton(), { propagation: 'Stop' }),
    ],
    [
      h.span([h.Class('home-mode-title')], ['MODE']),
      modeOptionView(model, 'Campaign', h),
      modeOptionView(model, 'Endless', h),
      ...keyBadgeView(model, 'Mode', h),
    ],
  )

const playClusterView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('home-play-cluster'), h.Role('group'), h.AriaLabel('Play')],
    [playButtonView(model, h), modeButtonView(model, h)],
  )

// RAIL

type RailLook = Readonly<{
  label: string
  ariaLabel: string
  icon: string
  message: Message
}>

const RAIL_LOOKS: Readonly<Record<RailButton, RailLook>> = {
  WhatsNew: {
    label: "WHAT'S NEW",
    ariaLabel: "What's new: the latest changes",
    icon: NEWS_ICON,
    message: Message.ClickedWhatsNewButton(),
  },
  Munchopedia: {
    label: 'MUNCHOPEDIA',
    ariaLabel: 'Munchopedia: every zombie you have splatted',
    icon: MUNCHOPEDIA_ICON,
    message: Message.ClickedMunchopediaButton(),
  },
  Character: {
    label: 'CHARACTER',
    ariaLabel: 'Character: change how you look',
    icon: CHARACTER_ICON,
    message: Message.ClickedCharacterButton(),
  },
  HowToPlay: {
    label: 'HOW TO PLAY',
    ariaLabel: 'How to play: the controls and some tips',
    icon: HELP_ICON,
    message: Message.ClickedHowToPlayButton(),
  },
  Settings: {
    label: 'SETTINGS',
    ariaLabel: 'Settings: sound, music, shake, and full screen',
    icon: SETTINGS_ICON,
    message: Message.ClickedSettingsButton(),
  },
}

const hasRailDot = (model: Model, button: RailButton): boolean => {
  if (button === 'WhatsNew') {
    return isNewsUnseen(model)
  } else if (button === 'Munchopedia') {
    return hasUnopenedEntry(model)
  } else {
    return false
  }
}

const railButtonView = (
  model: Model,
  button: RailButton,
  h: HtmlBuilder<Message>,
): Html => {
  const look = RAIL_LOOKS[button]
  const hasDot = hasRailDot(model, button)
  return h.li(
    [h.Class('home-rail-item')],
    [
      h.button(
        [
          ...homeButtonAttributes(button, h),
          h.Class('home-rail-button'),
          h.DataAttribute('rail', button),
          h.AriaLabel(
            hasDot ? `${look.ariaLabel}. Something new` : look.ariaLabel,
          ),
          h.AriaHasPopup('dialog'),
          h.OnClick(look.message, { propagation: 'Stop' }),
        ],
        [
          h.span([
            h.Class('home-rail-icon'),
            h.AriaHidden(true),
            h.Style({ backgroundImage: look.icon }),
          ]),
          h.span([h.Class('home-rail-label')], [look.label]),
          ...(hasDot
            ? [h.span([h.Class('home-rail-dot'), h.AriaHidden(true)])]
            : []),
          ...keyBadgeView(model, button, h),
        ],
      ),
    ],
  )
}

const railView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.Class('home-rail'), h.AriaLabel('Main menu')],
    [
      h.ul(
        [h.Class('home-rail-list')],
        Array.map(RAIL_BUTTONS, button => railButtonView(model, button, h)),
      ),
    ],
  )

// BESTS

type Best = Readonly<{ label: string; value: string }>

const shownBests = (model: Model): ReadonlyArray<Best> => [
  ...Option.match(bestsFor(model).maybeBestEndlessWave, {
    onNone: () => [],
    onSome: wave => [{ label: 'Best endless', value: `Wave ${wave}` }],
  }),
  ...Option.match(bestsFor(model).maybeFastestWinMs, {
    onNone: () => [],
    onSome: runMs => [{ label: 'Fastest win', value: durationLabel(runMs) }],
  }),
  ...(model.bests.totalKills > 0
    ? [{ label: 'Zombies splatted', value: `${model.bests.totalKills}` }]
    : []),
]

const bestView = ({ label, value }: Best, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('home-best')],
    [
      h.dt([h.Class('home-best-label')], [label]),
      h.dd([h.Class('home-best-value')], [value]),
    ],
  )

const BESTS_TITLE_ID = 'home-bests-title'

const bestsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('home-bests'), h.AriaLabelledBy(BESTS_TITLE_ID)],
    [
      h.h2(
        [h.Id(BESTS_TITLE_ID), h.Class('home-bests-title')],
        [
          'Your bests',
          h.span(
            [h.Class('sr-only')],
            [`, ${DIFFICULTIES[model.difficulty.chosen].name}`],
          ),
        ],
      ),
      Array.match(shownBests(model), {
        onEmpty: () =>
          h.p(
            [h.Class('home-bests-empty')],
            ['No bests yet. Go get chewed on.'],
          ),
        onNonEmpty: bests =>
          h.dl(
            [h.Class('home-bests-list')],
            Array.map(bests, best => bestView(best, h)),
          ),
      }),
    ],
  )

// STATUS

const difficultyBadgeView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const name = DIFFICULTIES[model.difficulty.chosen].name
  return h.button(
    [
      h.Type('button'),
      h.Class('home-difficulty'),
      h.DataAttribute('difficulty', model.difficulty.chosen),
      h.AriaLabel(`Difficulty: ${name}. Change it`),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedDifficultyBadge(), { propagation: 'Stop' }),
    ],
    [
      h.span([h.Class('home-difficulty-title')], ['DIFFICULTY']),
      h.span([h.Class('home-difficulty-name')], [name]),
    ],
  )
}

const statusView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('home-status')],
    [difficultyBadgeView(model, h), bestsView(model, h)],
  )

// STAGE

// NOTE: the player walks on the spot in the middle of the stage, drawn on
// the canvas by screens.ts. This button sits over them, so a tap on your
// character opens the picker. The rail's Character button is the one a
// keyboard or a screen reader reaches.
const heroButtonView = (h: HtmlBuilder<Message>): Html =>
  h.button([
    h.Type('button'),
    h.Class('home-hero'),
    h.Tabindex(-1),
    h.AriaLabel('Your character: change how you look'),
    h.AriaHasPopup('dialog'),
    h.OnClick(Message.ClickedCharacterButton(), { propagation: 'Stop' }),
  ])

// CORNER

const fullscreenButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.screenFit === 'Fullscreen'
    ? h.button(
        [
          h.Type('button'),
          h.Class('home-fullscreen'),
          h.AriaLabel('Full screen'),
          h.AriaPressed(model.fullscreen === 'On' ? 'true' : 'false'),
          h.OnClick(Message.ClickedFullscreenButton(), { propagation: 'Stop' }),
        ],
        [
          h.span([
            h.Class('home-fullscreen-icon'),
            h.AriaHidden(true),
            h.Style({ backgroundImage: FULLSCREEN_ICON }),
          ]),
        ],
      )
    : h.empty

// NEW ENTRY

const newEntryText = (model: Model): Option.Option<string> =>
  Option.map(Array.head(model.home.newEntries), kind =>
    model.home.newEntries.length > 1
      ? `${entryName(kind)} and ${model.home.newEntries.length - 1} more`
      : entryName(kind),
  )

const newEntryButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(Array.head(model.home.newEntries), {
    onNone: () => h.empty,
    onSome: kind =>
      h.button(
        [
          h.Type('button'),
          h.Class('new-entry'),
          h.AriaLabel(
            `New Munchopedia entry: ${Option.getOrElse(newEntryText(model), () => '')}. Open it`,
          ),
          h.OnClick(Message.ClickedNewEntryButton({ kind }), {
            propagation: 'Stop',
          }),
        ],
        [
          h.span([h.Class('new-entry-flag')], ['NEW ENTRY!']),
          h.span(
            [h.Class('new-entry-name')],
            [Option.getOrElse(newEntryText(model), () => '')],
          ),
        ],
      ),
  })

const isEndScreen = Phase.isAnyOf(['Victory', 'GameOver'])

// NOTE: the end screens only tell. The entry opens from the menu's rail.
export const newEntryNoticeView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  isEndScreen(model.phase)
    ? Option.match(newEntryText(model), {
        onNone: () => h.empty,
        onSome: text =>
          h.div(
            [h.Class('new-entry new-entry-notice'), h.Role('status')],
            [
              h.span([h.Class('new-entry-flag')], ['NEW ENTRY!']),
              h.span([h.Class('new-entry-name')], [text]),
              h.span(
                [h.Class('new-entry-where')],
                ['In the Munchopedia on the menu'],
              ),
            ],
          ),
      })
    : h.empty

// HOME MENU

export const homeMenuView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isOnHome(model.phase)
    ? h.div(
        [
          h.Class('home-frame'),
          h.DataAttribute('device', model.lastDevice),
          h.DataAttribute('fit', model.screenFit),
        ],
        [
          h.div(
            [h.Class('home-stage')],
            [
              playClusterView(model, h),
              railView(model, h),
              statusView(model, h),
              heroButtonView(h),
              newEntryButtonView(model, h),
              h.div([h.Class('home-corner')], [fullscreenButtonView(model, h)]),
            ],
          ),
        ],
      )
    : h.empty

// PAUSE MENU BUTTON

export const pauseMenuButtonView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  Phase.isAnyOf(['Paused'])(model.phase)
    ? h.button(
        [
          h.Type('button'),
          h.Class('pause-menu-button'),
          h.AriaLabel('Menu: leave this run'),
          h.AriaKeyshortcuts('H'),
          h.AriaHasPopup('dialog'),
          h.OnClick(Message.ClickedMenuButton(), { propagation: 'Stop' }),
        ],
        [
          'MENU',
          ...(model.lastDevice === 'KeyboardMouse'
            ? [h.span([h.Class('home-button-key'), h.AriaHidden(true)], ['H'])]
            : []),
        ],
      )
    : h.empty

// PANELS

const MENU_KEYS_TITLE_ID = 'menu-keys-title'

const MENU_KEY_ACTIONS: Readonly<Record<HomeButton, string>> = {
  Play: 'Play',
  Mode: 'Switch mode',
  WhatsNew: "What's new",
  Munchopedia: 'Munchopedia',
  Character: 'Character',
  HowToPlay: 'How to play',
  Settings: 'Settings',
}

const menuKeysView = (h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('menu-keys'), h.AriaLabelledBy(MENU_KEYS_TITLE_ID)],
    [
      h.h3(
        [h.Id(MENU_KEYS_TITLE_ID), h.Class('menu-keys-title')],
        ['On the menu'],
      ),
      h.ul(
        [h.Class('menu-keys-list')],
        Array.map(HOME_BUTTONS, button =>
          h.li(
            [h.Class('menu-keys-item')],
            [
              h.kbd([h.Class('pause-help-key')], [HOME_KEYS[button].name]),
              ` ${MENU_KEY_ACTIONS[button]}`,
            ],
          ),
        ),
      ),
    ],
  )

type Toggle = Readonly<{
  label: string
  isOn: boolean
  maybeKey: Option.Option<string>
  maybeNote: Option.Option<string>
  message: Message
}>

export const SHARE_STATS_NOTE =
  'Sends the wave, kills, and run time when a run ends. Nothing personal.'

const settingToggles = (model: Model): ReadonlyArray<Toggle> => [
  {
    label: 'Sound',
    isOn: model.soundSetting === 'On',
    maybeKey: Option.some('M'),
    maybeNote: Option.none(),
    message: Message.ClickedMuteButton(),
  },
  {
    label: 'Music',
    isOn: model.musicSetting === 'On',
    maybeKey: Option.some('N'),
    maybeNote: Option.none(),
    message: Message.ClickedMusicButton(),
  },
  {
    label: 'Screen shake',
    isOn: model.shakeSetting === 'On',
    maybeKey: Option.none(),
    maybeNote: Option.none(),
    message: Message.ClickedShakeButton(),
  },
  {
    label: 'Share anonymous play stats',
    isOn: model.shareStats === 'On',
    maybeKey: Option.none(),
    maybeNote: Option.some(SHARE_STATS_NOTE),
    message: Message.ClickedShareStatsButton(),
  },
  ...(model.screenFit === 'Fullscreen'
    ? [
        {
          label: 'Full screen',
          isOn: model.fullscreen === 'On',
          maybeKey: Option.none(),
          maybeNote: Option.none(),
          message: Message.ClickedFullscreenButton(),
        },
      ]
    : []),
]

const toggleView = (toggle: Toggle, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class('setting-row')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('setting-toggle'),
          h.AriaPressed(toggle.isOn ? 'true' : 'false'),
          ...Option.match(toggle.maybeKey, {
            onNone: () => [],
            onSome: key => [h.AriaKeyshortcuts(key)],
          }),
          h.OnClick(toggle.message, { propagation: 'Stop' }),
        ],
        [
          h.span([h.Class('setting-label')], [toggle.label]),
          h.span(
            [h.Class('setting-state'), h.AriaHidden(true)],
            [toggle.isOn ? 'ON' : 'OFF'],
          ),
        ],
      ),
      ...Option.match(toggle.maybeNote, {
        onNone: () => [],
        onSome: note => [h.p([h.Class('setting-note')], [note])],
      }),
    ],
  )

const resetTutorialButtonView = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(RESET_TUTORIAL_BUTTON_ID),
      h.Class('setting-toggle setting-reset'),
      h.OnClick(Message.ClickedResetTutorialButton(), { propagation: 'Stop' }),
    ],
    [
      h.span([h.Class('setting-label')], ['Reset tutorial']),
      h.span([h.Class('setting-state'), h.AriaHidden(true)], ['RESET']),
    ],
  )

const askResetTutorialView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [
      h.Class('setting-confirm'),
      h.Role('group'),
      h.AriaLabel('Reset tutorial'),
    ],
    [
      h.p([h.Class('setting-note')], ['Show the tips and zombie cards again?']),
      h.div(
        [h.Class('panel-actions')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('panel-button panel-leave'),
              h.OnClick(Message.ClickedConfirmResetTutorialButton(), {
                propagation: 'Stop',
              }),
            ],
            ['Reset'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Id(KEEP_TUTORIAL_BUTTON_ID),
              h.Class('panel-button panel-stay'),
              h.OnClick(Message.ClickedCancelResetTutorialButton(), {
                propagation: 'Stop',
              }),
            ],
            ['Keep'],
          ),
        ],
      ),
    ],
  )

// DIFFICULTY

const padlockView = (h: HtmlBuilder<Message>): Html =>
  h.span([
    h.Class('difficulty-padlock'),
    h.AriaHidden(true),
    h.Style({ backgroundImage: PADLOCK_ICON }),
  ])

const freshBadgeView = (
  model: Model,
  difficulty: Difficulty,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  difficulty === 'Nightmare' && model.difficulty.nightmare === 'JustUnlocked'
    ? [h.span([h.Class('difficulty-new'), h.AriaHidden(true)], ['NEW!'])]
    : []

const difficultyLabel = (model: Model, difficulty: Difficulty): string =>
  isLocked(model.difficulty, difficulty)
    ? `${DIFFICULTIES[difficulty].name}, locked. ${NIGHTMARE_LOCK_NOTE}`
    : `${DIFFICULTIES[difficulty].name}: ${DIFFICULTIES[difficulty].blurb}`

const isAskingFirst = (model: Model): boolean =>
  DifficultyCard.isAnyOf(['Asking'])(model.difficultyCard)

const difficultyChoiceView = (
  model: Model,
  difficulty: Difficulty,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): Html => {
  const locked = isLocked(model.difficulty, difficulty)
  const isChosen = difficulty === model.difficulty.chosen
  return h.button(
    [
      ...(isChosen ? renderInfo.initialFocus : []),
      h.Type('button'),
      h.Class('difficulty-choice'),
      h.DataAttribute('difficulty', difficulty),
      ...(isChosen && !isAskingFirst(model)
        ? [h.DataAttribute('chosen', 'Chosen')]
        : []),
      h.AriaLabel(difficultyLabel(model, difficulty)),
      ...(locked ? [h.AriaDisabled(true)] : []),
      h.OnClick(Message.ClickedDifficultyCardButton({ difficulty }), {
        focusSelector: '.game-surface',
        propagation: 'Stop',
      }),
    ],
    [
      h.span(
        [h.Class('difficulty-name')],
        [
          ...(locked ? [padlockView(h)] : []),
          DIFFICULTIES[difficulty].name,
          ...freshBadgeView(model, difficulty, h),
        ],
      ),
      h.span(
        [h.Class('difficulty-blurb')],
        [locked ? NIGHTMARE_LOCK_NOTE : DIFFICULTIES[difficulty].blurb],
      ),
    ],
  )
}

const difficultySettingView = (
  model: Model,
  difficulty: Difficulty,
  h: HtmlBuilder<Message>,
): Html => {
  const locked = isLocked(model.difficulty, difficulty)
  return h.button(
    [
      h.Type('button'),
      h.Class('difficulty-option'),
      h.DataAttribute('difficulty', difficulty),
      h.AriaLabel(difficultyLabel(model, difficulty)),
      h.AriaPressed(model.difficulty.chosen === difficulty ? 'true' : 'false'),
      ...(locked ? [h.AriaDisabled(true)] : []),
      h.OnClick(Message.ClickedDifficultySettingButton({ difficulty }), {
        propagation: 'Stop',
      }),
    ],
    [
      ...(locked ? [padlockView(h)] : []),
      DIFFICULTIES[difficulty].name,
      ...freshBadgeView(model, difficulty, h),
    ],
  )
}

const DIFFICULTY_ROW_ID = 'setting-difficulty'

const difficultyRowView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('difficulty-setting')],
    [
      h.span(
        [h.Id(DIFFICULTY_ROW_ID), h.Class('difficulty-setting-label')],
        ['Difficulty'],
      ),
      h.div(
        [
          h.Class('difficulty-options'),
          h.Role('group'),
          h.AriaLabelledBy(DIFFICULTY_ROW_ID),
        ],
        Array.map(DIFFICULTY_ORDER, difficulty =>
          difficultySettingView(model, difficulty, h),
        ),
      ),
      h.p(
        [h.Class('difficulty-setting-note')],
        [
          isLocked(model.difficulty, 'Nightmare')
            ? `${DIFFICULTIES[model.difficulty.chosen].blurb}. ${NIGHTMARE_LOCK_NOTE} Nightmare.`
            : `${DIFFICULTIES[model.difficulty.chosen].blurb}.`,
        ],
      ),
    ],
  )

const tutorialResetView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class('setting-row')],
    model.tutorialReset === 'Asking'
      ? [askResetTutorialView(h)]
      : [
          resetTutorialButtonView(h),
          h.p(
            [h.Class('setting-note'), h.Role('status')],
            model.tutorialReset === 'Done' ? ['Tips will show again.'] : [],
          ),
        ],
  )

// DEVICES

const LINK_CODE_INPUT_ID = 'link-code-input'

// NOTE: linking never merges. The device that types the code takes on the
// other device's player, and what it had saved is left behind (see
// "Device linking" in PLATFORM.md), so the form says so before Link.
export const LINK_TAKES_PROGRESS_NOTE =
  "Type the code from your other device. This device will use the other device's progress. What was saved on this device is replaced, not merged."

const panelButton = (
  label: string,
  message: Message,
  h: HtmlBuilder<Message>,
  tone: 'Stay' | 'Leave' = 'Stay',
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(
        tone === 'Stay'
          ? 'panel-button panel-stay'
          : 'panel-button panel-leave',
      ),
      h.OnClick(message, { propagation: 'Stop' }),
    ],
    [label],
  )

const linkNote = (text: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class('setting-note'), h.Role('status')], [text])

const linkActions = (
  buttons: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html => h.div([h.Class('panel-actions')], buttons)

const codeEntryView = (code: string, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Class('setting-link-form'), h.OnSubmit(Message.SubmittedLinkCode())],
    [
      h.label(
        [h.For(LINK_CODE_INPUT_ID), h.Class('setting-note')],
        [LINK_TAKES_PROGRESS_NOTE],
      ),
      h.input([
        h.Id(LINK_CODE_INPUT_ID),
        h.Class('setting-link-input'),
        h.Type('text'),
        h.Name('code'),
        h.Value(code),
        h.Maxlength(7),
        h.Autocomplete('off'),
        h.Autocapitalize('characters'),
        h.Spellcheck(false),
        h.OnInput(value => Message.UpdatedLinkCode({ value })),
      ]),
      linkActions(
        [
          h.button(
            [h.Type('submit'), h.Class('panel-button panel-stay')],
            ['Link'],
          ),
          panelButton('Cancel', Message.ClickedCancelLinkButton(), h, 'Leave'),
        ],
        h,
      ),
    ],
  )

const linkFlowView = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  LinkFlow.match(model.linkFlow, {
    Idle: () => [
      linkActions(
        [
          panelButton(
            'Link another device',
            Message.ClickedLinkDeviceButton(),
            h,
          ),
          panelButton('Use a code', Message.ClickedUseCodeButton(), h),
        ],
        h,
      ),
    ],
    Requesting: () => [linkNote('Getting a code', h)],
    Showing: ({ code }) => [
      linkNote(
        'On your other device, open SETTINGS, choose Use a code, and type:',
        h,
      ),
      h.p(
        [
          h.Class('setting-link-code'),
          h.AriaLabel(`Link code ${Array.join(code.split(''), ' ')}`),
        ],
        [code],
      ),
      linkNote(
        "The code works once, for 10 minutes. The device that types it in will use this device's progress.",
        h,
      ),
      linkActions(
        [panelButton('Done', Message.ClickedCancelLinkButton(), h)],
        h,
      ),
    ],
    Entering: ({ code }) => [codeEntryView(code, h)],
    Redeeming: () => [linkNote('Linking', h)],
    Linked: () => [
      linkNote("Linked. This device now uses your other device's progress.", h),
      linkActions(
        [panelButton('Done', Message.ClickedCancelLinkButton(), h)],
        h,
      ),
    ],
    Failed: ({ problem }) => [
      linkNote(linkProblemText(problem), h),
      linkActions(
        [
          panelButton('Use a code', Message.ClickedUseCodeButton(), h),
          panelButton('Cancel', Message.ClickedCancelLinkButton(), h, 'Leave'),
        ],
        h,
      ),
    ],
  })

const devicesView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class('setting-row setting-devices')],
    [
      h.div(
        [h.Class('setting-sync')],
        [
          h.span([h.Class('setting-label')], ['Devices']),
          h.span(
            [
              h.Class('setting-sync-state'),
              h.Role('status'),
              h.DataAttribute('sync', model.syncState._tag),
            ],
            [syncStateText(model.syncState)],
          ),
        ],
      ),
      ...(SyncState.isAnyOf(['LocalOnly'])(model.syncState)
        ? []
        : linkFlowView(model, h)),
    ],
  )

type PanelText = Readonly<{ title: string; blurb: string }>

const panelText = (model: Model, panel: MenuPanel): PanelText => {
  if (panel === 'HowToPlay') {
    return {
      title: 'How to play',
      blurb: `Controls for ${helpLabel(model.lastDevice)}.`,
    }
  } else if (panel === 'Settings') {
    return {
      title: 'Settings',
      blurb: 'Saved on this device.',
    }
  } else if (panel === 'Difficulty') {
    return {
      title: 'How tough are you?',
      blurb: 'Pick a difficulty. You can change it later in Settings.',
    }
  } else if (panel === 'WhatsNew') {
    return whatsNewText(model)
  } else if (panel === 'Munchopedia') {
    return munchopediaText(model)
  } else {
    return {
      title: 'Leave this run?',
      blurb:
        'Your guns, cash, and traps stay behind. The zombies keep the house.',
    }
  }
}

const doneButtonView = (
  { closeButton, initialFocus }: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      ...closeButton,
      ...initialFocus,
      h.Class('panel-button panel-done'),
      h.AriaKeyshortcuts('Escape'),
    ],
    ['Done'],
  )

const panelBodyView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  if (model.panel === 'HowToPlay') {
    return [
      h.div(
        [h.Class('panel-help'), h.DataAttribute('device', model.lastDevice)],
        howToPlayView(
          model.lastDevice,
          h,
          isKeyboard(model) ? Option.some(menuKeysView(h)) : Option.none(),
        ),
      ),
      h.div([h.Class('panel-actions')], [doneButtonView(renderInfo, h)]),
    ]
  } else if (model.panel === 'Settings') {
    return [
      difficultyRowView(model, h),
      h.ul(
        [h.Class('setting-list')],
        [
          ...Array.map(settingToggles(model), toggle => toggleView(toggle, h)),
          tutorialResetView(model, h),
          devicesView(model, h),
        ],
      ),
      h.div([h.Class('panel-actions')], [doneButtonView(renderInfo, h)]),
    ]
  } else if (model.panel === 'WhatsNew') {
    return whatsNewBodyView(model, doneButtonView(renderInfo, h), h)
  } else if (model.panel === 'Munchopedia') {
    return munchopediaBodyView(model, doneButtonView(renderInfo, h), h)
  } else if (model.panel === 'Difficulty') {
    return [
      h.div(
        [h.Class('difficulty-choices')],
        Array.map(DIFFICULTY_ORDER, difficulty =>
          difficultyChoiceView(model, difficulty, renderInfo, h),
        ),
      ),
      ...(isAskingFirst(model)
        ? []
        : [h.div([h.Class('panel-actions')], [doneButtonView(renderInfo, h)])]),
    ]
  } else {
    return [
      h.div(
        [h.Class('panel-actions')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('panel-button panel-leave'),
              h.OnClick(Message.ClickedLeaveRunButton(), {
                focusSelector: '.game-surface',
                propagation: 'Stop',
              }),
            ],
            ['Leave'],
          ),
          h.button(
            [
              ...renderInfo.initialFocus,
              h.Type('button'),
              h.Class('panel-button panel-stay'),
              h.AriaKeyshortcuts('Escape'),
              h.OnClick(Message.ClickedStayButton(), { propagation: 'Stop' }),
            ],
            ['Stay'],
          ),
        ],
      ),
    ]
  }
}

const panelView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const text = panelText(model, model.panel)
  return [
    h.h2([...renderInfo.title, h.Class('panel-title')], [text.title]),
    h.p([...renderInfo.description, h.Class('panel-blurb')], [text.blurb]),
    ...panelBodyView(model, renderInfo, h),
  ]
}

export const menuPanelView = (model: Model, h: HtmlBuilder<Message>): Html =>
  dialogShell(
    {
      dialog: model.panelDialog,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel',
      dialogAttributes: [h.DataAttribute('panel', model.panel)],
      panelView: renderInfo => panelView(model, renderInfo, h),
      toParentMessage: message => Message.GotPanelDialogMessage({ message }),
    },
    h,
  )
