import { Array, Option, String } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { DOORS } from './arena'
import {
  DOOR_HALF_WIDTH_PX,
  STICK_RADIUS_PX,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from './constants'
import { gunSlotBox, secondsLeft } from './hud'
import { NEXT_TRAP_ICON, RELOAD_ICON, TRAP_BUTTON_ICONS } from './icons'
import { thumbOffset } from './input'
import { Message, isSideways } from './main'
import {
  Arsenal,
  BreakClock,
  type GunSlot,
  type Model,
  Phase,
  Stick,
} from './model'
import { type GhostStick, isDebutCardUp, shownGhostSticks } from './onboarding'
import { gunName } from './shop'
import {
  PlaceVerdict,
  type Placement,
  TRAPS,
  maybeNextKind,
  maybePlacement,
} from './traps'
import { wavePreviewView } from './wavePreview'
import { isRoundActive } from './waves'
import {
  SIDEARM,
  canReload,
  heldLoaded,
  heldStats,
  heldWeapon,
  maybeSpare,
  tierName,
} from './weapons'

// ICON BUTTONS

export type IconButton = Readonly<{
  className: string
  label: string
  icon: string
  keys?: string
  message: Message
  maybePressed?: boolean
}>

export const iconButtonView = (
  button: IconButton,
  h: HtmlBuilder<Message>,
  children: ReadonlyArray<Html> = [],
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(`icon-button ${button.className}`),
      h.AriaLabel(button.label),
      ...(button.keys === undefined ? [] : [h.AriaKeyshortcuts(button.keys)]),
      ...(button.maybePressed === undefined
        ? []
        : [h.AriaPressed(button.maybePressed ? 'true' : 'false')]),
      h.OnClick(button.message, { focusSelector: '.game-surface' }),
    ],
    [
      h.span([
        h.Class('icon-button-glyph'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: button.icon }),
      ]),
      ...children,
    ],
  )

const isTouchHudUp = (model: Model): boolean =>
  model.lastDevice === 'Touch' &&
  isRoundActive(model.phase) &&
  !isDebutCardUp(model) &&
  !isSideways(model)

// GUN BUTTONS

const swapTarget = (model: Model): Option.Option<string> =>
  Option.map(maybeSpare(model.player.arsenal), spare =>
    Arsenal.isAnyOf(['HoldingSpare'])(model.player.arsenal)
      ? gunName(model, SIDEARM)
      : gunName(model, spare.kind),
  )

const swapButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (
    !isRoundActive(model.phase) ||
    isDebutCardUp(model) ||
    model.lastDevice === 'Touch'
  ) {
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
          h.AriaKeyshortcuts('Q'),
          h.OnClick(Message.ClickedSwapButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['SWAP'],
      ),
  })
}

export const gunButtonsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div([h.Class('gun-buttons')], [swapButtonView(model, h)])

// GUN SLOTS

type SlotGun = Readonly<{ slot: GunSlot; name: string }>

const slotGuns = (model: Model): ReadonlyArray<SlotGun> => {
  const { player } = model
  return [
    { slot: 'Sidearm', name: tierName(SIDEARM, player.pistolTier) },
    ...Option.match(maybeSpare(player.arsenal), {
      onNone: () => [],
      onSome: spare => [
        { slot: 'Spare' as const, name: tierName(spare.kind, spare.tier) },
      ],
    }),
  ]
}

const heldSlot = (model: Model): GunSlot =>
  Arsenal.isAnyOf(['HoldingSpare'])(model.player.arsenal) ? 'Spare' : 'Sidearm'

const SLOT_INDEX: Readonly<Record<GunSlot, number>> = { Sidearm: 0, Spare: 1 }

// NOTE: the second slot's drawing reaches over the south doorway. Its tap
// area stops at the doorway so a thumb there still reaches the room.
const SOUTH_DOOR_LEFT = DOORS.South.center.x - DOOR_HALF_WIDTH_PX

const percentOfWidth = (arenaPx: number): string =>
  `${(arenaPx * 100) / VIEW_WIDTH}%`

const percentOfHeight = (arenaPx: number): string =>
  `${(arenaPx * 100) / VIEW_HEIGHT}%`

const gunSlotButtonView = (
  model: Model,
  { slot, name }: SlotGun,
  h: HtmlBuilder<Message>,
): Html => {
  const isHeld = slot === heldSlot(model)
  const box = gunSlotBox(SLOT_INDEX[slot])
  const width = Math.min(box.width, SOUTH_DOOR_LEFT - box.x)
  return h.keyed('button')(slot, [
    h.Type('button'),
    h.Class('gun-slot-button'),
    h.DataAttribute('held', isHeld ? 'true' : 'false'),
    h.AriaLabel(isHeld ? `Reload the ${name}` : `Switch to the ${name}`),
    h.AriaKeyshortcuts(isHeld ? 'R' : 'Q'),
    ...(isHeld && !canReload(model.player) ? [h.AriaDisabled(true)] : []),
    h.Style({
      left: percentOfWidth(box.x),
      bottom: percentOfHeight(VIEW_HEIGHT - box.y - box.height),
      width: percentOfWidth(width),
      height: `max(44px, ${percentOfHeight(box.height)})`,
    }),
    h.OnClick(Message.ClickedGunSlot({ slot }), {
      focusSelector: '.game-surface',
    }),
  ])
}

export const gunSlotsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isTouchHudUp(model)
    ? h.div(
        [h.Class('hud-tap-frame')],
        [
          h.div(
            [
              h.Class('hud-tap-stage'),
              h.Role('group'),
              h.AriaLabel('Your guns'),
            ],
            Array.map(slotGuns(model), gun => gunSlotButtonView(model, gun, h)),
          ),
        ],
      )
    : h.empty

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
  clock: BreakClock,
  h: HtmlBuilder<Message>,
): Html =>
  h.p(
    [h.Class('sr-only'), h.Role('timer')],
    [
      BreakClock.match(clock, {
        Counting: () =>
          `${secondsLeft(remainingMs)} seconds until wave ${wave}.`,
        Waiting: () => `Wave ${wave} starts when you are ready.`,
      }),
    ],
  )

const startWaveButtonView = (
  model: Model,
  wave: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(
        model.lastDevice === 'Touch' ? 'start-wave-pill' : 'start-wave-button',
      ),
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
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  PlaceVerdict.match(verdict, {
    Placeable: () => h.empty,
    Blocked: ({ reason }) =>
      h.p([h.Id(PLACE_REASON_ID), h.Class(className)], [reason]),
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
          placeReasonView(placement, 'place-reason', h),
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
    Preparation: ({ wave, remainingMs, spawns, clock }) =>
      h.div(
        [
          h.Class('preparation-controls'),
          h.DataAttribute('device', model.lastDevice),
        ],
        [
          preparationTimerView(wave, remainingMs, clock, h),
          wavePreviewView(wave, spawns, model.boss, h),
          model.lastDevice === 'Touch' ? h.empty : trapControlsView(model, h),
          startWaveButtonView(model, wave, h),
        ],
      ),
    Wave: () => h.empty,
    Paused: () => h.empty,
    Victory: () => h.empty,
    GameOver: () => h.empty,
  })

// ACTION ARC

const isMagazineLow = (model: Model): boolean =>
  heldLoaded(model.player) * 2 < heldStats(model.player).magazine

const reloadIconView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isMagazineLow(model) && canReload(model.player)
    ? iconButtonView(
        {
          className: 'arc-button reload-icon-button',
          label: `Reload the ${gunName(model, heldWeapon(model.player.arsenal))}`,
          icon: RELOAD_ICON,
          keys: 'R',
          message: Message.ClickedReloadButton(),
        },
        h,
      )
    : h.empty

const placeIconView = (
  model: Model,
  placement: Placement,
  h: HtmlBuilder<Message>,
): Html => {
  const { kind, verdict } = placement
  const isBlocked = PlaceVerdict.isAnyOf(['Blocked'])(verdict)
  return h.button(
    [
      h.Type('button'),
      h.Class('icon-button arc-button place-icon-button'),
      h.AriaLabel(`Place a ${TRAPS[kind].name}`),
      h.AriaKeyshortcuts('T'),
      ...(isBlocked
        ? [h.AriaDisabled(true), h.AriaDescribedBy(PLACE_REASON_ID)]
        : []),
      h.OnClick(Message.ClickedPlaceTrapButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      h.span([
        h.Class('icon-button-glyph'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: TRAP_BUTTON_ICONS[kind] }),
      ]),
      h.span(
        [h.Class('icon-button-badge'), h.AriaHidden(true)],
        [`x${model.trapStock[kind]}`],
      ),
      placeReasonView(placement, 'sr-only', h),
    ],
  )
}

const nextTrapIconView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(maybeNextKind(model), {
    onNone: () => h.empty,
    onSome: kind =>
      iconButtonView(
        {
          className: 'arc-button next-trap-icon-button',
          label: `Switch to the ${TRAPS[kind].name}`,
          icon: NEXT_TRAP_ICON,
          keys: 'G',
          message: Message.ClickedNextTrapButton(),
        },
        h,
      ),
  })

const trapIconsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Phase.isAnyOf(['Preparation'])(model.phase)
    ? Option.match(maybePlacement(model), {
        onNone: () => [],
        onSome: placement => [
          placeIconView(model, placement, h),
          nextTrapIconView(model, h),
        ],
      })
    : []

export const actionArcView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isTouchHudUp(model)
    ? h.div(
        [h.Class('action-arc')],
        [...trapIconsView(model, h), reloadIconView(model, h)],
      )
    : h.empty

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
