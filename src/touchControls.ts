import { Array, Option, String } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { STICK_RADIUS_PX } from './constants'
import { secondsLeft } from './hud'
import { thumbOffset } from './input'
import { Message } from './main'
import { Arsenal, type Model, Phase, Stick } from './model'
import { type GhostStick, isDebutCardUp, shownGhostSticks } from './onboarding'
import {
  PlaceVerdict,
  type Placement,
  TRAPS,
  maybeNextKind,
  maybePlacement,
} from './traps'
import { wavePreviewView } from './wavePreview'
import { isRoundActive } from './waves'
import { SIDEARM, WEAPONS, heldWeapon, maybeSpare } from './weapons'

// GUN BUTTONS

const swapTarget = (model: Model): Option.Option<string> =>
  Option.map(maybeSpare(model.player.arsenal), spare =>
    Arsenal.isAnyOf(['HoldingSpare'])(model.player.arsenal)
      ? WEAPONS[SIDEARM].name
      : WEAPONS[spare.kind].name,
  )

const swapButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (!isRoundActive(model.phase) || isDebutCardUp(model)) {
    return h.empty
  }

  return Option.match(swapTarget(model), {
    onNone: () => h.empty,
    onSome: target =>
      h.button(
        [
          h.Type('button'),
          h.Class('swap-button'),
          h.AriaLabel(`Swap to the ${target}`),
          h.AriaKeyshortcuts('Q E 1 2'),
          h.OnClick(Message.ClickedSwapButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['SWAP'],
      ),
  })
}

const reloadButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isRoundActive(model.phase) &&
  model.lastDevice === 'Touch' &&
  !isDebutCardUp(model)
    ? h.button(
        [
          h.Type('button'),
          h.Class('reload-button'),
          h.AriaLabel(
            `Reload the ${WEAPONS[heldWeapon(model.player.arsenal)].name}`,
          ),
          h.AriaKeyshortcuts('R'),
          h.OnClick(Message.ClickedReloadButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['RELOAD'],
      )
    : h.empty

export const gunButtonsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('gun-buttons')],
    [reloadButtonView(model, h), swapButtonView(model, h)],
  )

// STICKS

export const stickView = (
  stick: Stick,
  label: string,
  h: HtmlBuilder<Message>,
): Html =>
  Stick.match(stick, {
    Idle: () => h.empty,
    Active: active => {
      const offset = thumbOffset(active)
      return h.div(
        [
          h.Class('touch-stick'),
          h.DataAttribute('stick', label),
          h.AriaHidden(true),
          h.Style({
            left: `${active.originX - STICK_RADIUS_PX}px`,
            top: `${active.originY - STICK_RADIUS_PX}px`,
            width: `${STICK_RADIUS_PX * 2}px`,
            height: `${STICK_RADIUS_PX * 2}px`,
          }),
        ],
        [
          h.div([
            h.Class('touch-stick-thumb'),
            h.Style({
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }),
          ]),
        ],
      )
    },
  })

// PREPARATION

const preparationTimerView = (
  wave: number,
  remainingMs: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.p(
    [h.Class('sr-only'), h.Role('timer')],
    [`${secondsLeft(remainingMs)} seconds until wave ${wave}.`],
  )

const startWaveButtonView = (wave: number, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('start-wave-button'),
      h.AriaLabel(`Start wave ${wave} now`),
      h.AriaKeyshortcuts('Enter'),
      h.OnClick(Message.ClickedStartWaveButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['START WAVE'],
  )

const PLACE_REASON_ID = 'place-trap-reason'

const placeButtonView = (
  model: Model,
  { kind, verdict }: Placement,
  h: HtmlBuilder<Message>,
): Html => {
  const { name } = TRAPS[kind]
  const isBlocked = PlaceVerdict.isAnyOf(['Blocked'])(verdict)
  return h.button(
    [
      h.Type('button'),
      h.Class('place-button'),
      h.AriaLabel(`Place a ${name}`),
      h.AriaKeyshortcuts('T'),
      ...(isBlocked
        ? [h.AriaDisabled(true), h.AriaDescribedBy(PLACE_REASON_ID)]
        : []),
      h.OnClick(Message.ClickedPlaceTrapButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      h.span([h.Class('place-button-label')], ['PLACE']),
      h.span(
        [h.Class('place-button-stock')],
        [`${String.toUpperCase(name)} x${model.trapStock[kind]}`],
      ),
    ],
  )
}

const placeReasonView = (
  { verdict }: Placement,
  h: HtmlBuilder<Message>,
): Html =>
  PlaceVerdict.match(verdict, {
    Placeable: () => h.empty,
    Blocked: ({ reason }) =>
      h.p([h.Id(PLACE_REASON_ID), h.Class('place-reason')], [reason]),
  })

const nextTrapButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(maybeNextKind(model), {
    onNone: () => h.empty,
    onSome: kind =>
      h.button(
        [
          h.Type('button'),
          h.Class('next-trap-button'),
          h.AriaLabel(`Switch to the ${TRAPS[kind].name}`),
          h.AriaKeyshortcuts('G'),
          h.OnClick(Message.ClickedNextTrapButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['NEXT'],
      ),
  })

const trapControlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(maybePlacement(model), {
    onNone: () => h.empty,
    onSome: placement =>
      h.div(
        [h.Class('trap-controls')],
        [
          placeReasonView(placement, h),
          h.div(
            [h.Class('trap-buttons')],
            [
              placeButtonView(model, placement, h),
              nextTrapButtonView(model, h),
            ],
          ),
        ],
      ),
  })

export const preparationControlsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  Phase.match(model.phase, {
    Ready: () => h.empty,
    Preparation: ({ wave, remainingMs, spawns }) =>
      h.div(
        [h.Class('preparation-controls')],
        [
          preparationTimerView(wave, remainingMs, h),
          wavePreviewView(wave, spawns, h),
          trapControlsView(model, h),
          startWaveButtonView(wave, h),
        ],
      ),
    Wave: () => h.empty,
    Paused: () => h.empty,
    Victory: () => h.empty,
    GameOver: () => h.empty,
  })

// GHOST STICKS

const GHOST_LABELS: Readonly<Record<GhostStick, string>> = {
  Move: 'MOVE',
  Aim: 'AIM + FIRE',
}

export const ghostSticksView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Array.match(shownGhostSticks(model), {
    onEmpty: () => h.empty,
    onNonEmpty: ghosts =>
      h.div(
        [h.Class('ghost-sticks'), h.AriaHidden(true)],
        Array.map(ghosts, ghost =>
          h.keyed('div')(
            ghost,
            [h.Class('ghost-stick'), h.DataAttribute('ghost', ghost)],
            [
              h.div([h.Class('ghost-stick-thumb')]),
              h.span([h.Class('ghost-stick-label')], [GHOST_LABELS[ghost]]),
            ],
          ),
        ),
      ),
  })
