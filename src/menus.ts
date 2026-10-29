import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { GAME_TITLE, RESTART_GRACE_MS } from './constants'
import {
  FULLSCREEN_ICON,
  MUSIC_OFF_ICON,
  MUSIC_ON_ICON,
  PAUSE_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
} from './icons'
import { Message, isSideways } from './main'
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
    Ready: () => [fullscreenButtonView(model, h), ...audioButtons],
    Preparation: () => [pauseButtonView(h)],
    Wave: () => [pauseButtonView(h)],
    Paused: () => [fullscreenButtonView(model, h), ...audioButtons],
    Victory: () => audioButtons,
    GameOver: () => audioButtons,
  })
}

const isPickingCharacter = (model: Model): boolean =>
  model.character.dialog.isOpen

export const cornerButtonsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  isSideways(model) || isPickingCharacter(model)
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
  !isSideways(model) &&
  !isPickingCharacter(model)
    ? h.div(
        [h.Class('home-screen-tip'), h.Role('note')],
        [
          h.p(
            [h.Class('home-screen-tip-text')],
            ['Add to Home Screen to play full screen'],
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

// MODE BUTTONS

type ModeButton = Readonly<{
  className: string
  label: string
  detail: string
  key: string
  keyName: string
  ariaLabel: string
  message: Message
}>

const CAMPAIGN_BUTTON: ModeButton = {
  className: 'mode-button',
  label: 'CAMPAIGN',
  detail: `${FINAL_WAVE} WAVES`,
  key: 'ENTER',
  keyName: 'Enter',
  ariaLabel: `Campaign: ${FINAL_WAVE} waves, then victory`,
  message: Message.ClickedCampaignButton(),
}

const ENDLESS_BUTTON: ModeButton = {
  className: 'mode-button',
  label: 'ENDLESS',
  detail: 'UNTIL YOU DROP',
  key: 'E',
  keyName: 'E',
  ariaLabel: 'Endless: waves keep coming until you fall',
  message: Message.ClickedEndlessButton(),
}

const KEEP_GOING_BUTTON: ModeButton = {
  className: 'mode-button keep-going-button',
  label: 'KEEP GOING',
  detail: `ON TO WAVE ${FINAL_WAVE + 1}`,
  key: 'K',
  keyName: 'K',
  ariaLabel: `Keep going: carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps`,
  message: Message.ClickedKeepGoingButton(),
}

const CHARACTER_BUTTON: ModeButton = {
  className: 'mode-button character-button',
  label: 'CHARACTER',
  detail: 'YOUR LOOK',
  key: 'C',
  keyName: 'C',
  ariaLabel: 'Character: change how you look',
  message: Message.ClickedCharacterButton(),
}

const modeButtonView = (
  model: Model,
  button: ModeButton,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(button.className),
      h.AriaLabel(button.ariaLabel),
      h.AriaKeyshortcuts(button.keyName),
      h.OnClick(button.message, { focusSelector: '.game-surface' }),
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
  Phase.match(model.phase, {
    Ready: () => [CAMPAIGN_BUTTON, ENDLESS_BUTTON],
    Preparation: () => [],
    Wave: () => [],
    Paused: () => [],
    Victory: () =>
      model.screenMs >= RESTART_GRACE_MS
        ? [KEEP_GOING_BUTTON, CAMPAIGN_BUTTON, ENDLESS_BUTTON]
        : [],
    GameOver: () =>
      model.screenMs >= RESTART_GRACE_MS
        ? [CAMPAIGN_BUTTON, ENDLESS_BUTTON]
        : [],
  })

export const modeChoiceView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isSideways(model)
    ? h.empty
    : Array.match(modeButtons(model), {
        onEmpty: () => h.empty,
        onNonEmpty: buttons =>
          h.div(
            [h.Class('mode-choice')],
            [
              h.div(
                [
                  h.Class('mode-group'),
                  h.Role('group'),
                  h.AriaLabel('Choose a mode'),
                ],
                Array.map(buttons, button => modeButtonView(model, button, h)),
              ),
              modeButtonView(model, CHARACTER_BUTTON, h),
            ],
          ),
      })

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
  isSideways(model) || !Phase.isAnyOf(['Wave'])(model.phase)
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

// ROTATE NOTICE

const ROTATE_TITLE_ID = 'rotate-title'
const ROTATE_BODY_ID = 'rotate-body'

export const sidewaysView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isSideways(model)
    ? h.div(
        [
          h.Class('rotate-overlay'),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabelledBy(ROTATE_TITLE_ID),
          h.AriaDescribedBy(ROTATE_BODY_ID),
        ],
        [
          h.div([h.Class('rotate-phone'), h.AriaHidden(true)]),
          h.h2(
            [h.Id(ROTATE_TITLE_ID), h.Class('rotate-title')],
            ['Turn your phone sideways'],
          ),
          h.p(
            [h.Id(ROTATE_BODY_ID), h.Class('rotate-body')],
            [
              `${GAME_TITLE} plays in landscape. The game waits until you turn it.`,
            ],
          ),
        ],
      )
    : h.empty
