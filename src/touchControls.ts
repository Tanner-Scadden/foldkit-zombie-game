import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { STICK_RADIUS_PX } from './constants'
import { gunClusterBox, gunSlotBox, secondsLeft } from './hud'
import { NEXT_TRAP_ICON, RELOAD_ICON, TRAP_BUTTON_ICONS } from './icons'
import { thumbOffset } from './input'
import { Message } from './message'
import {
  Arsenal,
  BreakClock,
  type GunSlot,
  type Model,
  Phase,
  Stick,
} from './model'
import { type GhostStick, isDebutCardUp, shownGhostSticks } from './onboarding'
import { type Screen, screenOf } from './screen'
import { STALL_BOX, gunName } from './shop'
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

type IconButton = Readonly<{
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

const isOnTouch = (model: Model): boolean => model.lastDevice === 'Touch'

const isClusterUp = (model: Model): boolean =>
  isRoundActive(model.phase) && !isDebutCardUp(model)

const keyBadgeView = (
  model: Model,
  key: string,
  h: HtmlBuilder<Message>,
): Html =>
  isOnTouch(model)
    ? h.empty
    : h.span([h.Class('key-badge'), h.AriaHidden(true)], [key])

const percentOf = (part: number, whole: number): string =>
  `${(part * 100) / whole}%`

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

const gunSlotButtonView = (
  model: Model,
  screen: Screen,
  { slot, name }: SlotGun,
  h: HtmlBuilder<Message>,
): Html => {
  const isHeld = slot === heldSlot(model)
  const box = gunSlotBox(screen, SLOT_INDEX[slot])
  const cluster = gunClusterBox(screen)
  return h.keyed('button')(
    slot,
    [
      h.Type('button'),
      h.Class('gun-slot-button'),
      h.DataAttribute('held', isHeld ? 'true' : 'false'),
      h.AriaLabel(isHeld ? `Reload the ${name}` : `Switch to the ${name}`),
      h.AriaKeyshortcuts(isHeld ? 'R' : 'Q'),
      ...(isHeld && !canReload(model.player) ? [h.AriaDisabled(true)] : []),
      h.Style({
        left: percentOf(box.x - cluster.x, cluster.width),
        width: percentOf(box.width, cluster.width),
      }),
      h.OnClick(Message.ClickedGunSlot({ slot }), {
        focusSelector: '.game-surface',
      }),
    ],
    [keyBadgeView(model, isHeld ? 'R' : 'Q', h)],
  )
}

const gunSlotsView = (
  model: Model,
  screen: Screen,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('gun-slots'), h.Role('group'), h.AriaLabel('Your guns')],
    Array.map(slotGuns(model), gun => gunSlotButtonView(model, screen, gun, h)),
  )

// UTILITY ICONS

const isMagazineLow = (model: Model): boolean =>
  heldLoaded(model.player) * 2 < heldStats(model.player).magazine

const reloadIconView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isOnTouch(model) && isMagazineLow(model) && canReload(model.player)
    ? iconButtonView(
        {
          className: 'cluster-button reload-icon-button',
          label: `Reload the ${gunName(model, heldWeapon(model.player.arsenal))}`,
          icon: RELOAD_ICON,
          keys: 'R',
          message: Message.ClickedReloadButton(),
        },
        h,
      )
    : h.empty

const PLACE_REASON_ID = 'place-trap-reason'

const placeReasonView = (
  { verdict }: Placement,
  h: HtmlBuilder<Message>,
): Html =>
  PlaceVerdict.match(verdict, {
    Placeable: () => h.empty,
    Blocked: ({ reason }) =>
      h.span([h.Id(PLACE_REASON_ID), h.Class('sr-only')], [reason]),
  })

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
      h.Class('icon-button cluster-button place-icon-button'),
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
      keyBadgeView(model, 'T', h),
      placeReasonView(placement, h),
    ],
  )
}

const nextTrapIconView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(maybeNextKind(model), {
    onNone: () => h.empty,
    onSome: kind =>
      iconButtonView(
        {
          className: 'cluster-button next-trap-icon-button',
          label: `Switch to the ${TRAPS[kind].name}`,
          icon: NEXT_TRAP_ICON,
          keys: 'G',
          message: Message.ClickedNextTrapButton(),
        },
        h,
        [keyBadgeView(model, 'G', h)],
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

// NOTE: the icons beside the guns wrap upward before they reach the stall's
// outline, so a narrow phone stacks them instead of covering the stall. In
// portrait the stall is up in the world window, so they run to the edge.
const SIDE_GAP = 2
const SIDE_MARGIN = 4

const sideRight = (screen: Screen): number =>
  screen.layout === 'Landscape'
    ? STALL_BOX.left - 10
    : screen.width - SIDE_MARGIN

const clusterSideView = (
  model: Model,
  screen: Screen,
  h: HtmlBuilder<Message>,
): Html => {
  const cluster = gunClusterBox(screen)
  const room = sideRight(screen) - cluster.x - cluster.width
  return h.div(
    [
      h.Class('gun-cluster-side'),
      h.Style({
        left: percentOf(cluster.width + SIDE_GAP, cluster.width),
        width: percentOf(room - SIDE_GAP, cluster.width),
      }),
    ],
    [reloadIconView(model, h), ...trapIconsView(model, h)],
  )
}

// START WAVE

const startWaveButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Phase.match(model.phase, {
    Ready: () => h.empty,
    Preparation: ({ wave }) =>
      h.div(
        [h.Class('gun-cluster-top')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class(
                isOnTouch(model) ? 'start-wave-pill' : 'start-wave-button',
              ),
              h.AriaLabel(`Start wave ${wave} now`),
              h.AriaKeyshortcuts('Enter'),
              h.OnClick(Message.ClickedStartWaveButton(), {
                focusSelector: '.game-surface',
              }),
            ],
            ['START WAVE', keyBadgeView(model, 'ENTER', h)],
          ),
        ],
      ),
    Wave: () => h.empty,
    Paused: () => h.empty,
    Victory: () => h.empty,
    GameOver: () => h.empty,
  })

// GUN CLUSTER

const clusterView = (
  model: Model,
  screen: Screen,
  h: HtmlBuilder<Message>,
): Html => {
  const cluster = gunClusterBox(screen)
  return h.div(
    [h.Class('hud-tap-frame')],
    [
      h.div(
        [h.Class('hud-tap-stage')],
        [
          h.div(
            [
              h.Class('gun-cluster'),
              h.DataAttribute('device', model.lastDevice),
              h.DataAttribute('layout', screen.layout),
              h.Style({
                left: percentOf(cluster.x, screen.width),
                width: percentOf(cluster.width, screen.width),
                bottom: percentOf(
                  screen.height - cluster.y - cluster.height,
                  screen.height,
                ),
                height: `max(48px, ${percentOf(cluster.height, screen.height)})`,
              }),
            ],
            [
              gunSlotsView(model, screen, h),
              clusterSideView(model, screen, h),
              startWaveButtonView(model, h),
            ],
          ),
        ],
      ),
    ],
  )
}

export const gunClusterView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isClusterUp(model) ? clusterView(model, screenOf(model), h) : h.empty

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

export const preparationControlsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  Phase.match(model.phase, {
    Ready: () => h.empty,
    Preparation: ({ wave, remainingMs, spawns, clock }) =>
      h.div(
        [],
        [
          preparationTimerView(wave, remainingMs, clock, h),
          wavePreviewView(wave, spawns, model.traps, model.boss, h),
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
  Aim: 'AIM + SHOOT',
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
