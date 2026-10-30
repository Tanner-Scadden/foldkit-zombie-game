import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { isOpen as isCoopOpen } from './coop/update'
import { END_MENU_BUTTON_ID, endOffer } from './home'
import { pauseMenuButtonView } from './homeView'
import {
  FULLSCREEN_ICON,
  GIFT_BOX_ICON,
  GIFT_LID_ICON,
  MUSIC_OFF_ICON,
  MUSIC_ON_ICON,
  PAUSE_ICON,
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
  // NOTE: a co-op room has no pause (decided 7); its LEAVE takes the
  // corner instead (src/coop/view.ts).
  const pause = isCoopOpen(model.coop) ? [] : [pauseButtonView(h)]
  return Phase.match(model.phase, {
    Ready: () => [],
    Preparation: () => pause,
    Wave: () => pause,
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
  ariaLabel: 'Menu: back home, where a new version is waiting',
}

// NOTE: a newer build waits on the menu, so the MENU button carries a
// little gift that bobs on its corner, the same one the menu shows.
const updateGiftBadgeView = (h: HtmlBuilder<Message>): Html =>
  h.span([
    h.Class('mode-button-gift'),
    h.AriaHidden(true),
    h.Style({ backgroundImage: `${GIFT_LID_ICON}, ${GIFT_BOX_ICON}` }),
  ])

const modeButtonView = (
  model: Model,
  button: ModeButton,
  h: HtmlBuilder<Message>,
  badges: ReadonlyArray<Html> = [],
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
      ...badges,
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
    [modeButtonView(model, UPDATE_MENU_BUTTON, h, [updateGiftBadgeView(h)])],
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
