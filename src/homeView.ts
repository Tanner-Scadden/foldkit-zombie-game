import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
  bestsFor,
  isLocked,
} from './difficulty'
import {
  HOME_BUTTONS,
  KEEP_TUTORIAL_BUTTON_ID,
  RESET_TUTORIAL_BUTTON_ID,
  homeButtonId,
  isOnHome,
} from './home'
import { PADLOCK_ICON } from './icons'
import { Message, isSideways } from './main'
import {
  type Difficulty,
  type HomeButton,
  type MenuPanel,
  type Model,
  Phase,
} from './model'
import { helpLabel, howToPlayView } from './pauseHelp'
import { durationLabel } from './stats'
import { FINAL_WAVE } from './waves'

// HOME BUTTONS

type HomeButtonLook = Readonly<{
  label: string
  detail: string
  maybeKey: Option.Option<Readonly<{ cap: string; name: string }>>
  ariaLabel: string
  className: string
  message: Message
  hasPopup: boolean
}>

const HOME_BUTTON_LOOKS: Readonly<Record<HomeButton, HomeButtonLook>> = {
  Play: {
    label: 'PLAY',
    detail: `CAMPAIGN · ${FINAL_WAVE} WAVES`,
    maybeKey: Option.some({ cap: 'ENTER', name: 'Enter' }),
    ariaLabel: `Play the campaign: ${FINAL_WAVE} waves, then victory`,
    className: 'home-button home-button-big home-play',
    message: Message.ClickedCampaignButton(),
    hasPopup: false,
  },
  Endless: {
    label: 'ENDLESS',
    detail: 'UNTIL YOU DROP',
    maybeKey: Option.some({ cap: 'E', name: 'E' }),
    ariaLabel: 'Endless: waves keep coming until you fall',
    className: 'home-button home-button-big home-endless',
    message: Message.ClickedEndlessButton(),
    hasPopup: false,
  },
  Character: {
    label: 'CHARACTER',
    detail: 'YOUR LOOK',
    maybeKey: Option.some({ cap: 'C', name: 'C' }),
    ariaLabel: 'Character: change how you look',
    className: 'home-button home-character',
    message: Message.ClickedCharacterButton(),
    hasPopup: true,
  },
  HowToPlay: {
    label: 'HOW TO PLAY',
    detail: 'KEYS AND TIPS',
    maybeKey: Option.none(),
    ariaLabel: 'How to play: the controls and some tips',
    className: 'home-button home-how-to-play',
    message: Message.ClickedHowToPlayButton(),
    hasPopup: true,
  },
  Settings: {
    label: 'SETTINGS',
    detail: 'SOUND AND STUFF',
    maybeKey: Option.none(),
    ariaLabel: 'Settings: sound, music, shake, and full screen',
    className: 'home-button home-settings',
    message: Message.ClickedSettingsButton(),
    hasPopup: true,
  },
}

const homeButtonView = (
  model: Model,
  button: HomeButton,
  h: HtmlBuilder<Message>,
): Html => {
  const look = HOME_BUTTON_LOOKS[button]
  return h.button(
    [
      h.Type('button'),
      h.Id(homeButtonId(button)),
      h.Class(look.className),
      h.AriaLabel(look.ariaLabel),
      ...Option.match(look.maybeKey, {
        onNone: () => [],
        onSome: ({ name }) => [h.AriaKeyshortcuts(name)],
      }),
      ...(look.hasPopup ? [h.AriaHasPopup('dialog')] : []),
      h.OnFocus(Message.FocusedHomeButton({ button })),
      h.OnBlur(Message.BlurredHomeButton()),
      h.OnClick(look.message, { propagation: 'Stop' }),
    ],
    [
      h.span([h.Class('home-button-label')], [look.label]),
      h.span([h.Class('home-button-detail')], [look.detail]),
      ...(model.lastDevice === 'KeyboardMouse'
        ? Option.match(look.maybeKey, {
            onNone: () => [],
            onSome: ({ cap }) => [
              h.span([h.Class('home-button-key'), h.AriaHidden(true)], [cap]),
            ],
          })
        : []),
    ],
  )
}

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
        [`Your bests, ${DIFFICULTIES[model.difficulty.chosen].name}`],
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

// HOME MENU

const [PLAY_ROW, MORE_ROW] = Array.splitAt(HOME_BUTTONS, 2)

export const homeMenuView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isOnHome(model.phase) && !isSideways(model)
    ? h.div(
        [h.Class('home-frame')],
        [
          h.div(
            [h.Class('home-column')],
            [
              h.nav(
                [h.Class('home-menu'), h.AriaLabel('Main menu')],
                [
                  h.div(
                    [h.Class('home-row home-row-play')],
                    Array.map(PLAY_ROW, button =>
                      homeButtonView(model, button, h),
                    ),
                  ),
                  h.div(
                    [h.Class('home-row home-row-more')],
                    Array.map(MORE_ROW, button =>
                      homeButtonView(model, button, h),
                    ),
                  ),
                ],
              ),
              bestsView(model, h),
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
  Phase.isAnyOf(['Paused'])(model.phase) && !isSideways(model)
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

const difficultyChoiceView = (
  model: Model,
  difficulty: Difficulty,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): Html => {
  const locked = isLocked(model.difficulty, difficulty)
  return h.button(
    [
      ...(difficulty === 'Normal' ? renderInfo.initialFocus : []),
      h.Type('button'),
      h.Class('difficulty-choice'),
      h.DataAttribute('difficulty', difficulty),
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
        howToPlayView(model.lastDevice, h),
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
        ],
      ),
      h.div([h.Class('panel-actions')], [doneButtonView(renderInfo, h)]),
    ]
  } else if (model.panel === 'Difficulty') {
    return [
      h.div(
        [h.Class('difficulty-choices')],
        Array.map(DIFFICULTY_ORDER, difficulty =>
          difficultyChoiceView(model, difficulty, renderInfo, h),
        ),
      ),
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
  h.submodel({
    slotId: model.panelDialog.id,
    model: model.panelDialog,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: renderInfo =>
        h.dialog(
          [
            ...renderInfo.dialog,
            h.Class('panel-dialog'),
            h.DataAttribute('panel', model.panel),
          ],
          renderInfo.isVisible
            ? [
                h.div([...renderInfo.backdrop, h.Class('panel-backdrop')]),
                h.div(
                  [...renderInfo.panel, h.Class('panel')],
                  panelView(model, renderInfo, h),
                ),
              ]
            : [],
        ),
    },
    toParentMessage: message => Message.GotPanelDialogMessage({ message }),
  })
