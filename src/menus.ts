import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import { dialogShell } from './dialogs'
import { END_MENU_BUTTON_ID, endOffer } from './home'
import { pauseMenuButtonView } from './homeView'
import {
  ADD_TO_HOME_SCREEN_ICON,
  FULLSCREEN_ICON,
  MUSIC_OFF_ICON,
  MUSIC_ON_ICON,
  PAUSE_ICON,
  SHARE_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
} from './icons'
import { Message } from './message'
import { DebutCard, type Model, Phase, type ZombieKind } from './model'
import { canSkipDebutCard } from './onboarding'
import { iconButtonView } from './touchControls'
import { FINAL_WAVE } from './waves'
import { ZOMBIE_KINDS } from './zombies'

// TEXT

export const toSentenceCase = (shouted: string): string =>
  shouted
    .toLowerCase()
    .replace(
      /(^|[.!?]\s+)([a-z])/g,
      (_match, lead: string, letter: string) => lead + letter.toUpperCase(),
    )

export const debutPitch = (kind: ZombieKind): string =>
  toSentenceCase(ZOMBIE_KINDS[kind].pitch)

// CORNER BUTTONS

const muteButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const isMuted = model.soundSetting === 'Muted'
  return iconButtonView(
    {
      className: 'corner-button mute-button',
      label: 'Mute sound',
      icon: isMuted ? SOUND_OFF_ICON : SOUND_ON_ICON,
      keys: 'M',
      message: Message.ClickedMuteButton(),
      maybePressed: isMuted,
    },
    h,
  )
}

const musicButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const isOn = model.musicSetting === 'On'
  return iconButtonView(
    {
      className: 'corner-button music-button',
      label: 'Music',
      icon: isOn ? MUSIC_ON_ICON : MUSIC_OFF_ICON,
      keys: 'N',
      message: Message.ClickedMusicButton(),
      maybePressed: isOn,
    },
    h,
  )
}

const pauseButtonView = (h: HtmlBuilder<Message>): Html =>
  iconButtonView(
    {
      className: 'corner-button pause-button',
      label: 'Pause',
      icon: PAUSE_ICON,
      keys: 'Escape',
      message: Message.ClickedPauseButton(),
    },
    h,
  )

const fullscreenButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.screenFit === 'Fullscreen'
    ? iconButtonView(
        {
          className: 'corner-button fullscreen-button',
          label: 'Full screen',
          icon: FULLSCREEN_ICON,
          message: Message.ClickedFullscreenButton(),
          maybePressed: model.fullscreen === 'On',
        },
        h,
      )
    : h.empty

const cornerButtons = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const audioButtons = [musicButtonView(model, h), muteButtonView(model, h)]
  return Phase.match(model.phase, {
    Ready: () => [],
    Preparation: () => [pauseButtonView(h)],
    Wave: () => [pauseButtonView(h)],
    Paused: () => [
      pauseMenuButtonView(model, h),
      fullscreenButtonView(model, h),
      ...audioButtons,
    ],
    Victory: () => audioButtons,
    GameOver: () => audioButtons,
  })
}

const isPickingCharacter = (model: Model): boolean =>
  model.profile.dialog.isOpen

export const cornerButtonsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  isPickingCharacter(model)
    ? h.empty
    : h.div([h.Class('corner-buttons')], cornerButtons(model, h))

// HOME SCREEN TIP

export const homeScreenTipView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  model.screenFit === 'HomeScreen' &&
  model.homeScreenTip === 'Unseen' &&
  Phase.isAnyOf(['Ready'])(model.phase) &&
  !isPickingCharacter(model)
    ? h.div(
        [h.Class('home-screen-tip')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('home-screen-tip-open'),
              h.AriaHasPopup('dialog'),
              h.OnClick(Message.ClickedHomeScreenTip()),
            ],
            ['Play full screen: how?'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Class('home-screen-tip-close'),
              h.AriaLabel('Dismiss the tip'),
              h.OnClick(Message.ClickedDismissHomeScreenTip(), {
                focusSelector: '.game-surface',
              }),
            ],
            ['×'],
          ),
        ],
      )
    : h.empty

const stepGlyphView = (icon: string, h: HtmlBuilder<Message>): Html =>
  h.span([
    h.Class('home-screen-step-glyph'),
    h.AriaHidden(true),
    h.Style({ backgroundImage: icon }),
  ])

const homeScreenStepsPanelView = (
  { title, description, initialFocus }: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.h2([...title, h.Class('home-screen-steps-title')], ['Play full screen']),
  h.p(
    [...description, h.Class('home-screen-steps-blurb')],
    ['Put Munch Manor on your Home Screen:'],
  ),
  h.ol(
    [h.Class('home-screen-steps-list')],
    [
      h.li(
        [],
        [
          'Tap Share ',
          stepGlyphView(SHARE_ICON, h),
          '. No Share? Tap ••• by the address bar first.',
        ],
      ),
      h.li(
        [],
        [
          'Choose Add to Home Screen ',
          stepGlyphView(ADD_TO_HOME_SCREEN_ICON, h),
          '.',
        ],
      ),
      h.li([], ['Tap Add.']),
      h.li([], ['Open Munch Manor from your Home Screen.']),
    ],
  ),
  h.button(
    [
      ...initialFocus,
      h.Type('button'),
      h.Class('home-screen-steps-done'),
      h.OnClick(Message.ClickedHomeScreenStepsDoneButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['Got it'],
  ),
]

export const homeScreenStepsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  dialogShell(
    {
      dialog: model.homeScreenSteps,
      dialogClass: 'home-screen-steps-dialog',
      backdropClass: 'home-screen-steps-backdrop',
      panelClass: 'home-screen-steps-panel',
      panelView: renderInfo => homeScreenStepsPanelView(renderInfo, h),
      toParentMessage: message =>
        Message.GotHomeScreenStepsMessage({ message }),
    },
    h,
  )

// MODE BUTTONS

type ModeButton = Readonly<{
  id: string
  className: string
  label: string
  detail: string
  key: string
  keyName: string
  ariaLabel: string
  message: Message
}>

const CAMPAIGN_BUTTON: ModeButton = {
  id: 'end-campaign-button',
  className: 'mode-button',
  label: 'CAMPAIGN',
  detail: `${FINAL_WAVE} WAVES`,
  key: 'ENTER',
  keyName: 'Enter',
  ariaLabel: `Campaign: ${FINAL_WAVE} waves, then victory`,
  message: Message.ClickedCampaignButton(),
}

const ENDLESS_BUTTON: ModeButton = {
  id: 'end-endless-button',
  className: 'mode-button',
  label: 'ENDLESS',
  detail: 'UNTIL YOU DROP',
  key: 'E',
  keyName: 'E',
  ariaLabel: 'Endless: waves keep coming until you fall',
  message: Message.ClickedEndlessButton(),
}

const KEEP_GOING_BUTTON: ModeButton = {
  id: 'end-keep-going-button',
  className: 'mode-button keep-going-button',
  label: 'KEEP GOING',
  detail: `ON TO WAVE ${FINAL_WAVE + 1}`,
  key: 'K',
  keyName: 'K',
  ariaLabel: `Keep going: carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps`,
  message: Message.ClickedKeepGoingButton(),
}

const MENU_BUTTON: ModeButton = {
  id: END_MENU_BUTTON_ID,
  className: 'mode-button menu-button is-primary',
  label: 'MENU',
  detail: 'BACK HOME',
  key: 'H',
  keyName: 'H',
  ariaLabel: 'Menu: back to the home screen',
  message: Message.ClickedMenuButton(),
}

const UPDATE_MENU_BUTTON: ModeButton = {
  ...MENU_BUTTON,
  key: 'ENTER',
  keyName: 'Enter H',
}

const UPDATE_NOTE = 'A new version is waiting on the menu.'

const modeButtonView = (
  model: Model,
  button: ModeButton,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(button.id),
      h.Class(button.className),
      h.AriaLabel(button.ariaLabel),
      h.AriaKeyshortcuts(button.keyName),
      h.OnClick(button.message, {
        focusSelector: '.game-surface',
        propagation: 'Stop',
      }),
    ],
    [
      h.span([h.Class('mode-button-label')], [button.label]),
      h.span([h.Class('mode-button-detail')], [button.detail]),
      ...(model.lastDevice === 'KeyboardMouse'
        ? [
            h.span(
              [h.Class('mode-button-key'), h.AriaHidden(true)],
              [button.key],
            ),
          ]
        : []),
    ],
  )

const modeButtons = (model: Model): ReadonlyArray<ModeButton> =>
  Phase.isAnyOf(['Victory'])(model.phase)
    ? [KEEP_GOING_BUTTON, CAMPAIGN_BUTTON, ENDLESS_BUTTON]
    : [CAMPAIGN_BUTTON, ENDLESS_BUTTON]

const menuOnlyView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('mode-choice is-update-waiting')],
    [
      h.p([h.Class('mode-choice-note')], [UPDATE_NOTE]),
      modeButtonView(model, UPDATE_MENU_BUTTON, h),
    ],
  )

const menuAndModesView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('mode-choice')],
    [
      modeButtonView(model, MENU_BUTTON, h),
      h.div(
        [h.Class('mode-group'), h.Role('group'), h.AriaLabel('Choose a mode')],
        Array.map(modeButtons(model), button =>
          modeButtonView(model, button, h),
        ),
      ),
    ],
  )

export const modeChoiceView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const offer = endOffer(model)
  if (offer === 'MenuOnly') {
    return menuOnlyView(model, h)
  } else if (offer === 'MenuAndModes') {
    return menuAndModesView(model, h)
  } else {
    return h.empty
  }
}

// DEBUT CARD

const DEBUT_TITLE_ID = 'debut-title'
const DEBUT_BODY_ID = 'debut-body'

const debutCardButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  canSkipDebutCard(model)
    ? h.button(
        [
          h.Type('button'),
          h.Class('debut-card-button'),
          h.DataAttribute('device', model.lastDevice),
          h.AriaKeyshortcuts('Enter'),
          h.OnClick(Message.ClickedDebutCardButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        model.lastDevice === 'Touch'
          ? ['TAP TO CONTINUE']
          : [
              'CONTINUE',
              h.kbd([h.Class('debut-card-key'), h.AriaHidden(true)], ['ENTER']),
            ],
      )
    : h.empty

export const debutCardView = (model: Model, h: HtmlBuilder<Message>): Html =>
  !Phase.isAnyOf(['Wave'])(model.phase)
    ? h.empty
    : DebutCard.match(model.debutCard, {
        Hidden: () => h.empty,
        Showing: ({ kind }) =>
          h.div(
            [
              h.Class('debut-card'),
              h.Role('group'),
              h.AriaLabelledBy(DEBUT_TITLE_ID),
              h.AriaDescribedBy(DEBUT_BODY_ID),
            ],
            [
              h.h2(
                [h.Id(DEBUT_TITLE_ID), h.Class('sr-only')],
                [`New zombie: ${ZOMBIE_KINDS[kind].name}`],
              ),
              h.p(
                [h.Id(DEBUT_BODY_ID), h.Class('sr-only')],
                [debutPitch(kind)],
              ),
              debutCardButtonView(model, h),
            ],
          ),
      })
