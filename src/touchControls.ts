import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import { isOutOfGuns } from './ammoWarning'
import type { ApplicationViewBuilder } from './composition'
import { STICK_RADIUS_PX } from './constants'
import { MELEE_SLOT_INDEX, gunClusterBox, gunSlotBox, secondsLeft } from './hud'
import { NEXT_TRAP_ICON, RELOAD_ICON, TRAP_BUTTON_ICONS } from './icons'
import { thumbOffset } from './input'
import { Message, type PressedHudSlot } from './message'
import {
  BreakClock,
  type GunSlot,
  type Model,
  Phase,
  Stick,
  TrapHint,
} from './model'
import {
  type GhostStick,
  isDebutCardUp,
  isStartWaveBeckoning,
  shownGhostSticks,
} from './onboarding'
import { isCoop, leadSeatOf } from './party'
import { holdButtonView } from './purchaseHud'
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
  canReload,
  gunsOf,
  heldLoaded,
  heldSlotOf,
  heldStats,
  heldWeapon,
  isWieldingMelee,
  meleeNameOf,
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
  h: ApplicationViewBuilder,
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
  h: ApplicationViewBuilder,
): Html =>
  isOnTouch(model)
    ? h.empty
    : h.span([h.Class('key-badge'), h.AriaHidden(true)], [key])

const percentOf = (part: number, whole: number): string =>
  `${(part * 100) / whole}%`

// GUN SLOTS

type SlotGun = Readonly<{ slot: GunSlot; name: string }>

const SLOT_ORDER: ReadonlyArray<GunSlot> = ['First', 'Second']

const slotGuns = (model: Model): ReadonlyArray<SlotGun> =>
  Array.zipWith(SLOT_ORDER, gunsOf(model.player.arsenal), (slot, gun) => ({
    slot,
    name: tierName(gun.kind, gun.tier),
  }))

const heldSlot = (model: Model): GunSlot => heldSlotOf(model.player.arsenal)

const SLOT_INDEX: Readonly<Record<GunSlot, number>> = { First: 0, Second: 1 }

const PRIMARY_MOUSE_BUTTON = 0

// NOTE: every press on a slot, by its pointer's type, before its click. A
// mouse press mid-wave is a shot at the world beneath and its click passes
// through (isSlotPressAShot in src/update/play.ts); a touch keeps the tap.
const toPressedHudSlot = (
  pointerType: string,
  button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  clientX: number,
  clientY: number,
  pointerId: number,
): Option.Option<PressedHudSlot> =>
  pointerType === 'mouse' && button !== PRIMARY_MOUSE_BUTTON
    ? Option.none()
    : Option.some(
        Message.PressedHudSlot({
          pointerId,
          device: pointerType === 'mouse' ? 'Mouse' : 'Touch',
          clientX,
          clientY,
        }),
      )

// NOTE: the key that reaches a gun slot: R reloads the held gun, Q swaps
// to the other; with the knife out, Q goes back to the last gun held.
const gunSlotKey = (model: Model, slot: GunSlot): Option.Option<string> => {
  const isLastHeld = slot === heldSlot(model)
  if (isWieldingMelee(model.player)) {
    return isLastHeld ? Option.some('Q') : Option.none()
  } else {
    return Option.some(isLastHeld ? 'R' : 'Q')
  }
}

const slotSpan = (
  screen: Screen,
  index: number,
): Readonly<{ left: string; width: string }> => {
  const box = gunSlotBox(screen, index)
  const cluster = gunClusterBox(screen)
  return {
    left: percentOf(box.x - cluster.x, cluster.width),
    width: percentOf(box.width, cluster.width),
  }
}

const gunSlotButtonView = (
  model: Model,
  screen: Screen,
  { slot, name }: SlotGun,
  h: ApplicationViewBuilder,
): Html => {
  const isHeld = !isWieldingMelee(model.player) && slot === heldSlot(model)
  const maybeKey = gunSlotKey(model, slot)
  return h.keyed('button')(
    slot,
    [
      h.Type('button'),
      h.Class('gun-slot-button'),
      h.DataAttribute('slot', slot),
      h.DataAttribute('held', isHeld ? 'true' : 'false'),
      h.AriaLabel(isHeld ? `Reload the ${name}` : `Switch to the ${name}`),
      ...Option.match(maybeKey, {
        onNone: () => [],
        onSome: key => [h.AriaKeyshortcuts(key)],
      }),
      ...(isHeld && !canReload(model.player) ? [h.AriaDisabled(true)] : []),
      h.Style(slotSpan(screen, SLOT_INDEX[slot])),
      h.OnPointerDown(toPressedHudSlot),
      h.OnClick(Message.ClickedGunSlot({ slot }), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      Option.match(maybeKey, {
        onNone: () => h.empty,
        onSome: key => keyBadgeView(model, key, h),
      }),
    ],
  )
}

// NOTE: the melee slot, right of the guns: a tap draws the knife or the
// Pan, and a tap on the one in hand does nothing.
const meleeSlotButtonView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html => {
  const isHeld = isWieldingMelee(model.player)
  const name = meleeNameOf(model.player)
  return h.keyed('button')(
    'Melee',
    [
      h.Type('button'),
      h.Class('gun-slot-button'),
      h.DataAttribute('slot', 'Melee'),
      h.DataAttribute('held', isHeld ? 'true' : 'false'),
      h.DataAttribute('out', isOutOfGuns(model.player) ? 'true' : 'false'),
      h.AriaLabel(isHeld ? `The ${name} is in hand` : `Switch to the ${name}`),
      h.AriaKeyshortcuts('F'),
      ...(isHeld ? [h.AriaDisabled(true)] : []),
      h.Style(slotSpan(screen, MELEE_SLOT_INDEX)),
      h.OnPointerDown(toPressedHudSlot),
      h.OnClick(Message.ClickedMeleeSlot(), {
        focusSelector: '.game-surface',
      }),
    ],
    [isHeld ? h.empty : keyBadgeView(model, 'F', h)],
  )
}

const gunSlotsView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [
      h.Class('gun-slots'),
      h.Role('group'),
      h.AriaLabel('Your guns'),
      h.DataAttribute(
        'click',
        Phase.isAnyOf(['Wave'])(model.phase) ? 'World' : 'Slot',
      ),
    ],
    [
      ...Array.map(slotGuns(model), gun =>
        gunSlotButtonView(model, screen, gun, h),
      ),
      meleeSlotButtonView(model, screen, h),
    ],
  )

// UTILITY ICONS

const isMagazineLow = (model: Model): boolean =>
  heldLoaded(model.player) * 2 < heldStats(model.player).magazine

const reloadIconView = (model: Model, h: ApplicationViewBuilder): Html =>
  isOnTouch(model) &&
  !isWieldingMelee(model.player) &&
  isMagazineLow(model) &&
  canReload(model.player)
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
  h: ApplicationViewBuilder,
): Html =>
  PlaceVerdict.match(verdict, {
    Placeable: () => h.empty,
    Blocked: ({ reason }) =>
      h.span([h.Id(PLACE_REASON_ID), h.Class('sr-only')], [reason]),
  })

const placeIconView = (
  model: Model,
  placement: Placement,
  h: ApplicationViewBuilder,
): Html => {
  const { kind, verdict } = placement
  const isBlocked = PlaceVerdict.isAnyOf(['Blocked'])(verdict)
  return h.button(
    [
      h.Type('button'),
      h.Class('icon-button cluster-button place-icon-button'),
      h.DataAttribute(
        'beckon',
        TrapHint.isAnyOf(['Showing'])(model.trapHint) ? 'true' : 'false',
      ),
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

const nextTrapIconView = (model: Model, h: ApplicationViewBuilder): Html =>
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
  h: ApplicationViewBuilder,
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
  h: ApplicationViewBuilder,
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
    [
      holdButtonView(model, h),
      reloadIconView(model, h),
      ...trapIconsView(model, h),
    ],
  )
}

// START WAVE

// NOTE: in co-op the button is the player's READY, and it says so once
// pressed while the others still choose (decided 7).
const startWaveWord = (model: Model): string => {
  if (!isCoop(model)) {
    return 'START WAVE'
  }
  return leadSeatOf(model).readiness === 'Ready' ? 'READY!' : 'READY'
}

const startWaveLabel = (model: Model, wave: number): string => {
  if (!isCoop(model)) {
    return `Start wave ${wave} now`
  }
  return leadSeatOf(model).readiness === 'Ready'
    ? 'Ready, waiting for the others'
    : `Ready for wave ${wave}`
}

const startWaveButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
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
              h.AriaLabel(startWaveLabel(model, wave)),
              h.DataAttribute('ready', leadSeatOf(model).readiness),
              h.DataAttribute(
                'beckon',
                isStartWaveBeckoning(model) ? 'true' : 'false',
              ),
              h.AriaKeyshortcuts('Enter'),
              h.OnClick(Message.ClickedStartWaveButton(), {
                focusSelector: '.game-surface',
              }),
            ],
            [startWaveWord(model), keyBadgeView(model, 'ENTER', h)],
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
  h: ApplicationViewBuilder,
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

export const gunClusterView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  isClusterUp(model) ? clusterView(model, screenOf(model), h) : h.empty

// STICKS

export const stickView = (
  stick: Stick,
  label: string,
  h: ApplicationViewBuilder,
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
  h: ApplicationViewBuilder,
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
  h: ApplicationViewBuilder,
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

export const ghostSticksView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
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
