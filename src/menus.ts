import { Array } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { GAME_TITLE, RESTART_GRACE_MS } from './constants'
import { Message, isSideways } from './main'
import { DebutCard, type Model, Phase, type ZombieKind } from './model'
import { FINAL_WAVE, isRoundActive } from './waves'
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
  return h.button(
    [
      h.Type('button'),
      h.Class('mute-button'),
      h.AriaLabel('Mute sound'),
      h.AriaPressed(isMuted ? 'true' : 'false'),
      h.AriaKeyshortcuts('M'),
      h.OnClick(Message.ClickedMuteButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['MUTE'],
  )
}

const musicButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('music-button'),
      h.AriaLabel('Music'),
      h.AriaPressed(model.musicSetting === 'On' ? 'true' : 'false'),
      h.AriaKeyshortcuts('N'),
      h.OnClick(Message.ClickedMusicButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['MUSIC'],
  )

const pauseButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isRoundActive(model.phase) && !isSideways(model)
    ? h.button(
        [
          h.Type('button'),
          h.Class('pause-button'),
          h.AriaLabel('Pause'),
          h.AriaKeyshortcuts('Escape'),
          h.OnClick(Message.ClickedPauseButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['PAUSE'],
      )
    : h.empty

export const cornerButtonsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('corner-buttons')],
    [
      muteButtonView(model, h),
      musicButtonView(model, h),
      pauseButtonView(model, h),
    ],
  )

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
            [
              h.Class('mode-choice'),
              h.Role('group'),
              h.AriaLabel('Choose a mode'),
            ],
            Array.map(buttons, button => modeButtonView(model, button, h)),
          ),
      })

// DEBUT CARD

const DEBUT_TITLE_ID = 'debut-title'
const DEBUT_BODY_ID = 'debut-body'

const debutCardButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('debut-card-button'),
      h.AriaKeyshortcuts('Enter'),
      h.OnClick(Message.ClickedDebutCardButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      'GOT IT',
      ...(model.lastDevice === 'KeyboardMouse'
        ? [h.span([h.Class('debut-card-key'), h.AriaHidden(true)], ['ENTER'])]
        : []),
    ],
  )

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
