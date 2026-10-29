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
  HAND_KEYS,
  HOME_BUTTONS,
  HOME_KEYS,
  KEEP_TUTORIAL_BUTTON_ID,
  type KeyedHandCard,
  RESET_TUTORIAL_BUTTON_ID,
  dealtCards,
  handCardId,
  homeButtonId,
  isNewsUnseen,
  isOnHome,
  steppedHandCard,
} from './home'
import {
  AIM_ICON,
  CHARACTER_ICON,
  COFFEE_ICON,
  DEVICES_ICON,
  FULLSCREEN_ICON,
  HAND_ICON,
  HELP_ICON,
  MUNCHOPEDIA_ICON,
  MUSIC_OFF_ICON,
  MUSIC_ON_ICON,
  NEWS_ICON,
  PADLOCK_ICON,
  SETTINGS_ICON,
  SHAKE_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
  STATS_ICON,
  TURN_PHONE_ICON,
} from './icons'
import { Message } from './message'
import {
  type Difficulty,
  DifficultyCard,
  type HandCard,
  type HomeButton,
  type HomeMode,
  type MenuPanel,
  type Model,
  Phase,
} from './model'
import {
  ENTRY_COUNT,
  discoveredKinds,
  entryName,
  hasUnopenedEntry,
} from './munchopedia'
import { helpLabel, howToPlayView } from './pauseHelp'
import {
  LinkFlow,
  SyncState,
  devicesStatusText,
  linkProblemText,
} from './playerSync'
import { isPortrait } from './screen'
import { durationLabel } from './stats'
import { FINAL_WAVE } from './waves'
import { whatsNewBodyView, whatsNewText } from './whatsNewView'

// KEY BADGES

const isKeyboard = (model: Model): boolean =>
  model.lastDevice === 'KeyboardMouse'

const keyCapView = (
  model: Model,
  cap: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  isKeyboard(model)
    ? [h.span([h.Class('home-key'), h.AriaHidden(true)], [cap])]
    : []

const keyBadgeView = (
  model: Model,
  button: HomeButton,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => keyCapView(model, HOME_KEYS[button].cap, h)

const homeButtonAttributes = (button: HomeButton, h: HtmlBuilder<Message>) => [
  h.Type('button'),
  h.Id(homeButtonId(button)),
  h.AriaKeyshortcuts(HOME_KEYS[button].name),
  h.OnFocus(Message.FocusedHomeButton({ button })),
  h.OnBlur(Message.BlurredHomeButton()),
]

const iconView = (
  className: string,
  icon: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.span([
    h.Class(className),
    h.AriaHidden(true),
    h.Style({ backgroundImage: icon }),
  ])

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
      h.span([h.Class('home-play-detail')], [look.detail]),
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
      h.Class('home-pick home-mode'),
      h.AriaLabel(
        `Mode: ${modeName(model.home.mode)}. Switch to ${modeName(otherMode(model.home.mode))}`,
      ),
      h.OnClick(Message.ClickedModeButton(), { propagation: 'Stop' }),
    ],
    [
      h.span([h.Class('home-pick-title')], ['MODE']),
      h.span(
        [h.Class('home-mode-options')],
        [
          modeOptionView(model, 'Campaign', h),
          modeOptionView(model, 'Endless', h),
        ],
      ),
      ...keyBadgeView(model, 'Mode', h),
    ],
  )

// NOTE: the difficulty sits by PLAY, so the run is picked where it starts.
// It opens the picker anchored just above this cluster.
const difficultyButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const name = DIFFICULTIES[model.difficulty.chosen].name
  return h.button(
    [
      ...homeButtonAttributes('Difficulty', h),
      h.Class('home-pick home-difficulty'),
      h.DataAttribute('difficulty', model.difficulty.chosen),
      h.AriaLabel(`Difficulty: ${name}. Change it`),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedDifficultyBadge(), { propagation: 'Stop' }),
    ],
    [
      h.span([h.Class('home-pick-title')], ['DIFFICULTY']),
      h.span([h.Class('home-difficulty-name')], [name]),
      ...keyBadgeView(model, 'Difficulty', h),
    ],
  )
}

const playClusterView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('home-play-cluster'), h.Role('group'), h.AriaLabel('Play')],
    [
      playButtonView(model, h),
      h.div(
        [h.Class('home-loadout')],
        [modeButtonView(model, h), difficultyButtonView(model, h)],
      ),
    ],
  )

// THE MANOR HAND

type CardLook = Readonly<{
  title: string
  ariaLabel: string
  icon: string
}>

const CARD_LOOKS: Readonly<Record<HandCard, CardLook>> = {
  Character: {
    title: 'CHARACTER',
    ariaLabel: 'Character: change how you look',
    icon: CHARACTER_ICON,
  },
  Munchopedia: {
    title: 'MUNCHOPEDIA',
    ariaLabel: 'Munchopedia: every zombie you have splatted',
    icon: MUNCHOPEDIA_ICON,
  },
  WhatsNew: {
    title: "WHAT'S NEW",
    ariaLabel: "What's new: the latest changes",
    icon: NEWS_ICON,
  },
  HowToPlay: {
    title: 'HOW TO PLAY',
    ariaLabel: 'How to play: the controls',
    icon: HELP_ICON,
  },
  Support: {
    title: 'TIP JAR',
    ariaLabel:
      'Tip jar: buy the shopkeeper a coffee to support the game. Opens in a new tab',
    icon: COFFEE_ICON,
  },
}

// NOTE: show, don't explain. A card is its picture and its name. Only the
// Munchopedia adds a tally, since it changes as the player finds zombies.
const maybeCardTally = (model: Model, card: HandCard): Option.Option<string> =>
  card === 'Munchopedia'
    ? Option.some(
        `${discoveredKinds(model.bests.killsByKind).length}/${ENTRY_COUNT}`,
      )
    : Option.none()

const CARD_MESSAGES: Readonly<Record<KeyedHandCard, Message>> = {
  Character: Message.ClickedCharacterButton(),
  Munchopedia: Message.ClickedMunchopediaButton(),
  WhatsNew: Message.ClickedWhatsNewButton(),
  HowToPlay: Message.ClickedHowToPlayButton(),
}

const hasNews = (model: Model, card: HandCard): boolean => {
  if (card === 'WhatsNew') {
    return isNewsUnseen(model)
  } else if (card === 'Munchopedia') {
    return hasUnopenedEntry(model)
  } else {
    return false
  }
}

const cardAriaLabel = (model: Model, card: HandCard): string =>
  hasNews(model, card)
    ? `${CARD_LOOKS[card].ariaLabel}. Something new`
    : CARD_LOOKS[card].ariaLabel

const newsCards = (model: Model): ReadonlyArray<HandCard> =>
  Array.filter(dealtCards(model), card => hasNews(model, card))

const NEWS_NAMES: Readonly<Record<HandCard, string>> = {
  Character: 'Character',
  Munchopedia: 'the Munchopedia',
  WhatsNew: "What's new",
  HowToPlay: 'How to play',
  Support: 'the tip jar',
}

const manorAriaLabel = (model: Model): string =>
  Array.match(newsCards(model), {
    onEmpty: () => 'Manor: character, Munchopedia, what is new, and more',
    onNonEmpty: cards =>
      `Manor: character, Munchopedia, what is new, and more. Something new in ${Array.join(
        Array.map(cards, card => NEWS_NAMES[card]),
        ' and ',
      )}`,
  })

// NOTE: the badges of the cards inside bubble up to the closed MANOR button
// as little pips, each the card's own icon with a red dot, so What's New and
// the Munchopedia still show their news without opening the hand.
const manorPipsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Array.match(newsCards(model), {
    onEmpty: () => h.empty,
    onNonEmpty: cards =>
      h.span(
        [h.Class('manor-pips'), h.AriaHidden(true)],
        Array.map(cards, card =>
          h.span(
            [h.Class('manor-pip'), h.DataAttribute('card', card)],
            [iconView('manor-pip-icon', CARD_LOOKS[card].icon, h)],
          ),
        ),
      ),
  })

const manorButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      ...homeButtonAttributes('Manor', h),
      h.Class('home-manor'),
      h.AriaLabel(manorAriaLabel(model)),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedManorButton(), { propagation: 'Stop' }),
    ],
    [
      iconView('home-manor-icon', HAND_ICON, h),
      h.span([h.Class('home-manor-label')], ['MANOR']),
      manorPipsView(model, h),
      ...keyBadgeView(model, 'Manor', h),
    ],
  )

const handKeyMessage = (
  model: Model,
  card: HandCard,
  key: string,
): Option.Option<Message> => {
  const step =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? 1
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? -1
        : 0
  return step === 0
    ? Option.none()
    : Option.map(steppedHandCard(dealtCards(model), card, step), next =>
        Message.SteppedHandFocus({ card: next }),
      )
}

// NOTE: the card button stays square to the screen so a tap anywhere in it
// lands, and only its face tilts into the fan. The face takes no taps.
const cardBodyView = (
  model: Model,
  card: HandCard,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.span(
    [h.Class('hand-card-face')],
    [
      h.span(
        [h.Class('hand-card-art')],
        [iconView('hand-card-icon', CARD_LOOKS[card].icon, h)],
      ),
      h.span([h.Class('hand-card-title')], [CARD_LOOKS[card].title]),
      ...Option.match(maybeCardTally(model, card), {
        onNone: () => [],
        onSome: tally => [h.span([h.Class('hand-card-tally')], [tally])],
      }),
      ...(hasNews(model, card)
        ? [h.span([h.Class('hand-card-new'), h.AriaHidden(true)], ['NEW'])]
        : []),
      ...(card === 'Support' ? [] : keyCapView(model, HAND_KEYS[card].cap, h)),
    ],
  ),
]

const handCardView = (
  model: Model,
  card: HandCard,
  index: number,
  count: number,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): Html => {
  const shared = [
    ...(index === 0 ? renderInfo.initialFocus : []),
    h.Id(handCardId(card)),
    h.Class('hand-card'),
    h.DataAttribute('card', card),
    h.Style({ '--i': `${index}`, '--n': `${count}` }),
    h.AriaLabel(cardAriaLabel(model, card)),
    ...(card === 'Support' ? [] : [h.AriaKeyshortcuts(HAND_KEYS[card].name)]),
    h.OnKeyDownPreventDefault(key => handKeyMessage(model, card, key)),
  ]
  return h.li(
    [h.Class('hand-slot')],
    [
      card === 'Support'
        ? h.a(
            [
              ...shared,
              h.Href(Option.getOrElse(model.maybeSupportUrl, () => '')),
              h.Target('_blank'),
              h.Rel('noopener noreferrer'),
            ],
            cardBodyView(model, card, h),
          )
        : h.button(
            [
              ...shared,
              h.Type('button'),
              h.AriaHasPopup('dialog'),
              h.OnClick(CARD_MESSAGES[card], { propagation: 'Stop' }),
            ],
            cardBodyView(model, card, h),
          ),
    ],
  )
}

const HAND_TITLE = 'The manor'

const handView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const cards = dealtCards(model)
  return [
    h.h2([...renderInfo.title, h.Class('sr-only')], [HAND_TITLE]),
    h.p(
      [...renderInfo.description, h.Class('sr-only')],
      ['Pick a card. Arrow keys move between them.'],
    ),
    h.ul(
      [h.Class('hand-cards')],
      Array.map(cards, (card, index) =>
        handCardView(model, card, index, cards.length, renderInfo, h),
      ),
    ),
    h.button(
      [
        ...renderInfo.closeButton,
        h.Class('hand-close'),
        h.AriaLabel('Close the manor'),
        h.AriaKeyshortcuts('Escape'),
      ],
      [
        h.span([h.Class('hand-close-x'), h.AriaHidden(true)], ['✕']),
        h.span([h.Class('home-manor-label')], ['CLOSE']),
        ...keyCapView(model, 'ESC', h),
      ],
    ),
  ]
}

export const manorHandView = (model: Model, h: HtmlBuilder<Message>): Html =>
  dialogShell(
    {
      dialog: model.handDialog,
      dialogClass: 'hand-dialog',
      backdropClass: 'hand-backdrop',
      panelClass: 'hand',
      dialogAttributes: [h.DataAttribute('device', model.lastDevice)],
      panelView: renderInfo => handView(model, renderInfo, h),
      toParentMessage: message => Message.GotHandDialogMessage({ message }),
    },
    h,
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
    ? [{ label: 'Splatted', value: `${model.bests.totalKills}` }]
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
            [
              h.Class('home-bests-level'),
              h.DataAttribute('difficulty', model.difficulty.chosen),
            ],
            [` · ${DIFFICULTIES[model.difficulty.chosen].name}`],
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

// STAGE

// NOTE: the player walks on the spot in the middle of the stage, drawn on
// the canvas by screens.ts. This button sits over them, so a tap on your
// character opens the picker. The hand's Character card is the one a
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
          h.Class('home-corner-button home-fullscreen'),
          h.AriaLabel('Full screen'),
          h.AriaPressed(model.fullscreen === 'On' ? 'true' : 'false'),
          h.OnClick(Message.ClickedFullscreenButton(), { propagation: 'Stop' }),
        ],
        [iconView('home-corner-icon', FULLSCREEN_ICON, h)],
      )
    : h.empty

// NOTE: the gear sits in the corner itself, and full screen, where the
// browser can do it, sits just inside it.
const settingsButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      ...homeButtonAttributes('Settings', h),
      h.Class('home-corner-button home-settings'),
      h.AriaLabel('Settings: sound, music, shake, and devices'),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedSettingsButton(), { propagation: 'Stop' }),
    ],
    [
      iconView('home-corner-icon', SETTINGS_ICON, h),
      ...keyBadgeView(model, 'Settings', h),
    ],
  )

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

// NOTE: the end screens only tell. The entry opens from the menu.
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

// TURN HINT

export const TURN_HINT_TEXT = 'Turn your phone sideways to see the whole room'

// NOTE: portrait zooms in on part of the room, so a phone held upright gets a
// small nudge to turn: only the tipping phone, no words, with its line for a
// screen reader. It sits above the controls, takes no taps, and is gone the
// moment the phone turns. isPortrait is false on a keyboard and mouse.
const turnHintView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isPortrait(model)
    ? h.div(
        [h.Class('home-turn-hint'), h.Role('img'), h.AriaLabel(TURN_HINT_TEXT)],
        [iconView('home-turn-icon', TURN_PHONE_ICON, h)],
      )
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
              manorButtonView(model, h),
              bestsView(model, h),
              heroButtonView(h),
              newEntryButtonView(model, h),
              turnHintView(model, h),
              h.div(
                [h.Class('home-corner')],
                [fullscreenButtonView(model, h), settingsButtonView(model, h)],
              ),
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
  Play: 'play',
  Mode: 'mode',
  Difficulty: 'difficulty',
  Manor: 'manor',
  Settings: 'settings',
}

const CARD_KEY_ACTIONS: Readonly<Record<KeyedHandCard, string>> = {
  Character: 'character',
  Munchopedia: 'Munchopedia',
  WhatsNew: "what's new",
  HowToPlay: 'how to play',
}

const HAND_KEY_CARDS: ReadonlyArray<KeyedHandCard> = [
  'Character',
  'Munchopedia',
  'WhatsNew',
  'HowToPlay',
]

const menuKeysView = (h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class('menu-keys'), h.AriaLabelledBy(MENU_KEYS_TITLE_ID)],
    [
      h.h3(
        [h.Id(MENU_KEYS_TITLE_ID), h.Class('menu-keys-title')],
        ['On the menu'],
      ),
      h.ul(
        [h.Class('help-extra')],
        [
          ...Array.map(HOME_BUTTONS, button =>
            h.li(
              [h.Class('help-extra-item')],
              [
                h.kbd([h.Class('menu-key')], [HOME_KEYS[button].name]),
                ` ${MENU_KEY_ACTIONS[button]}`,
              ],
            ),
          ),
          ...Array.map(HAND_KEY_CARDS, card =>
            h.li(
              [h.Class('help-extra-item')],
              [
                h.kbd([h.Class('menu-key')], [HAND_KEYS[card].name]),
                ` ${CARD_KEY_ACTIONS[card]}`,
              ],
            ),
          ),
        ],
      ),
    ],
  )

// SETTINGS

type Toggle = Readonly<{
  label: string
  shortLabel: string
  isOn: boolean
  onIcon: string
  offIcon: string
  maybeKey: Option.Option<string>
  states?: Readonly<{ on: string; off: string }>
  message: Message
}>

const ON_OFF = { on: 'ON', off: 'OFF' } as const

export const SHARE_STATS_NOTE = 'Wave, kills, and run time. Nothing personal.'

// NOTE: the quick toggles are icon tiles in one row: sound, music, shake,
// the big cursor on a mouse, full screen where the browser can do it, and, on a phone that can lock
// how it turns, ROTATE: off keeps it sideways, on lets it follow the phone.
const settingTiles = (model: Model): ReadonlyArray<Toggle> => [
  {
    label: 'Sound',
    shortLabel: 'SOUND',
    isOn: model.soundSetting === 'On',
    onIcon: SOUND_ON_ICON,
    offIcon: SOUND_OFF_ICON,
    maybeKey: Option.some('M'),
    message: Message.ClickedMuteButton(),
  },
  {
    label: 'Music',
    shortLabel: 'MUSIC',
    isOn: model.musicSetting === 'On',
    onIcon: MUSIC_ON_ICON,
    offIcon: MUSIC_OFF_ICON,
    maybeKey: Option.some('N'),
    message: Message.ClickedMusicButton(),
  },
  {
    label: 'Screen shake',
    shortLabel: 'SHAKE',
    isOn: model.shakeSetting === 'On',
    onIcon: SHAKE_ICON,
    offIcon: SHAKE_ICON,
    maybeKey: Option.none(),
    message: Message.ClickedShakeButton(),
  },
  ...(isKeyboard(model)
    ? [
        {
          label: 'Big cursor',
          shortLabel: 'CURSOR',
          isOn: model.cursorSetting === 'Bold',
          onIcon: AIM_ICON,
          offIcon: AIM_ICON,
          maybeKey: Option.none(),
          states: { on: 'BIG', off: 'THIN' },
          message: Message.ClickedCursorButton(),
        },
      ]
    : []),
  ...(model.screenFit === 'Fullscreen'
    ? [
        {
          label: 'Full screen',
          shortLabel: 'FULL',
          isOn: model.fullscreen === 'On',
          onIcon: FULLSCREEN_ICON,
          offIcon: FULLSCREEN_ICON,
          maybeKey: Option.none(),
          message: Message.ClickedFullscreenButton(),
        },
      ]
    : []),
  ...(model.orientationLock === 'Supported'
    ? [
        {
          label: 'Turn with the phone',
          shortLabel: 'ROTATE',
          isOn: model.rotationSetting === 'Auto',
          onIcon: TURN_PHONE_ICON,
          offIcon: TURN_PHONE_ICON,
          maybeKey: Option.none(),
          states: { on: 'AUTO', off: 'LOCKED' },
          message: Message.ClickedRotationButton(),
        },
      ]
    : []),
]

const tileView = (
  model: Model,
  toggle: Toggle,
  h: HtmlBuilder<Message>,
): Html =>
  h.li(
    [h.Class('setting-tile-item')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('setting-tile'),
          h.AriaLabel(toggle.label),
          h.AriaPressed(toggle.isOn ? 'true' : 'false'),
          ...Option.match(toggle.maybeKey, {
            onNone: () => [],
            onSome: key => [h.AriaKeyshortcuts(key)],
          }),
          h.OnClick(toggle.message, { propagation: 'Stop' }),
        ],
        [
          iconView(
            'setting-tile-icon',
            toggle.isOn ? toggle.onIcon : toggle.offIcon,
            h,
          ),
          h.span([h.Class('setting-tile-label')], [toggle.shortLabel]),
          h.span(
            [h.Class('setting-tile-state'), h.AriaHidden(true)],
            [
              toggle.isOn
                ? (toggle.states ?? ON_OFF).on
                : (toggle.states ?? ON_OFF).off,
            ],
          ),
          ...Option.match(toggle.maybeKey, {
            onNone: () => [],
            onSome: key => keyCapView(model, key, h),
          }),
        ],
      ),
    ],
  )

const shareStatsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class('setting-row')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('setting-switch'),
          h.AriaLabel('Share anonymous play stats'),
          h.AriaPressed(model.shareStats === 'On' ? 'true' : 'false'),
          h.AriaDescribedBy(SHARE_STATS_NOTE_ID),
          h.OnClick(Message.ClickedShareStatsButton(), { propagation: 'Stop' }),
        ],
        [
          iconView('setting-row-icon', STATS_ICON, h),
          h.span(
            [h.Class('setting-switch-text')],
            [
              h.span([h.Class('setting-label')], ['Share anonymous stats']),
              h.span(
                [h.Id(SHARE_STATS_NOTE_ID), h.Class('setting-note')],
                [SHARE_STATS_NOTE],
              ),
            ],
          ),
          h.span(
            [h.Class('setting-state'), h.AriaHidden(true)],
            [model.shareStats === 'On' ? 'ON' : 'OFF'],
          ),
        ],
      ),
    ],
  )

const SHARE_STATS_NOTE_ID = 'share-stats-note'

const resetTutorialButtonView = (h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(RESET_TUTORIAL_BUTTON_ID),
      h.Class('panel-button panel-quiet'),
      h.OnClick(Message.ClickedResetTutorialButton(), { propagation: 'Stop' }),
    ],
    ['Reset tutorial'],
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
  iconView('difficulty-padlock', PADLOCK_ICON, h)

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

const tutorialResetView = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.tutorialReset === 'Asking'
    ? askResetTutorialView(h)
    : h.div(
        [h.Class('setting-footer-note'), h.Role('status')],
        [
          ...(model.tutorialReset === 'Done'
            ? [h.p([h.Class('setting-note')], ['Tips will show again.'])]
            : []),
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
  tone: 'Stay' | 'Leave' | 'Quiet' = 'Stay',
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(
        tone === 'Stay'
          ? 'panel-button panel-stay'
          : tone === 'Leave'
            ? 'panel-button panel-leave'
            : 'panel-button panel-quiet',
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

// NOTE: while idle, the two link buttons sit in the devices row itself, so
// the section is one line until the player starts linking.
const isLinkIdle = (model: Model): boolean =>
  LinkFlow.isAnyOf(['Idle'])(model.linkFlow)

const linkFlowView = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  LinkFlow.match(model.linkFlow, {
    Idle: () => [],
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

const devicesView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const canLink = !SyncState.isAnyOf(['LocalOnly'])(model.syncState)
  return h.li(
    [h.Class('setting-row setting-devices')],
    [
      h.div(
        [h.Class('setting-sync')],
        [
          iconView('setting-row-icon', DEVICES_ICON, h),
          h.span(
            [h.Class('setting-switch-text')],
            [
              h.span([h.Class('setting-label')], ['Devices']),
              h.span(
                [
                  h.Class('setting-sync-state'),
                  h.Role('status'),
                  h.DataAttribute('sync', model.syncState._tag),
                  h.DataAttribute('scope', model.playerScopeStatus._tag),
                  h.DataAttribute('last-run', model.lastRunSync._tag),
                ],
                [devicesStatusText(model.syncState, model.playerScopeStatus)],
              ),
            ],
          ),
          ...(canLink && isLinkIdle(model)
            ? [
                h.div(
                  [h.Class('setting-sync-actions')],
                  [
                    panelButton(
                      'Link another device',
                      Message.ClickedLinkDeviceButton(),
                      h,
                      'Quiet',
                    ),
                    panelButton(
                      'Use a code',
                      Message.ClickedUseCodeButton(),
                      h,
                      'Quiet',
                    ),
                  ],
                ),
              ]
            : []),
        ],
      ),
      ...(canLink ? linkFlowView(model, h) : []),
    ],
  )
}

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
    return isAskingFirst(model)
      ? {
          title: 'How tough are you?',
          blurb: 'Pick a difficulty. You can change it any time beside PLAY.',
        }
      : {
          title: 'Difficulty',
          blurb: 'Pick how tough the zombies are.',
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
  focus: 'TakesInitialFocus' | 'LeavesInitialFocus' = 'TakesInitialFocus',
): Html =>
  h.button(
    [
      ...closeButton,
      ...(focus === 'TakesInitialFocus' ? initialFocus : []),
      h.Class('panel-button panel-done'),
      h.AriaKeyshortcuts('Escape'),
    ],
    ['Done'],
  )

const settingsBodyView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.ul(
    [h.Class('setting-tiles'), h.AriaLabel('Quick toggles')],
    Array.map(settingTiles(model), toggle => tileView(model, toggle, h)),
  ),
  h.ul(
    [h.Class('setting-list')],
    [shareStatsView(model, h), devicesView(model, h)],
  ),
  tutorialResetView(model, h),
  ...(model.tutorialReset === 'Asking'
    ? []
    : [
        h.div(
          [h.Class('panel-actions')],
          [resetTutorialButtonView(h), doneButtonView(renderInfo, h)],
        ),
      ]),
]

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
    return settingsBodyView(model, renderInfo, h)
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
        : [
            h.div(
              [h.Class('panel-actions')],
              [doneButtonView(renderInfo, h, 'LeavesInitialFocus')],
            ),
          ]),
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

// NOTE: show, don't explain. Settings, How to play, and the difficulty
// picker by PLAY speak through their icons, so their blurb is only read
// aloud.
const isBlurbShown = (model: Model): boolean =>
  model.panel === 'WhatsNew' ||
  model.panel === 'Munchopedia' ||
  model.panel === 'LeaveRun' ||
  (model.panel === 'Difficulty' && isAskingFirst(model))

const panelView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const text = panelText(model, model.panel)
  return [
    h.h2([...renderInfo.title, h.Class('panel-title')], [text.title]),
    h.p(
      [
        ...renderInfo.description,
        h.Class(isBlurbShown(model) ? 'panel-blurb' : 'panel-blurb sr-only'),
      ],
      [text.blurb],
    ),
    ...panelBodyView(model, renderInfo, h),
  ]
}

// NOTE: the difficulty picker opened beside PLAY hangs just above that
// cluster. The first-run question before a first run stays centered.
const panelAnchor = (model: Model): string =>
  model.panel === 'Difficulty' && !isAskingFirst(model) ? 'Play' : 'Center'

export const menuPanelView = (model: Model, h: HtmlBuilder<Message>): Html =>
  dialogShell(
    {
      dialog: model.panelDialog,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel',
      dialogAttributes: [
        h.DataAttribute('panel', model.panel),
        h.DataAttribute('anchor', panelAnchor(model)),
      ],
      panelView: renderInfo => panelView(model, renderInfo, h),
      toParentMessage: message => Message.GotPanelDialogMessage({ message }),
    },
    h,
  )
