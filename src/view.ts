import { Array, Effect, Option, Queue, Result, Stream, pipe } from 'effect'
import { Mount } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'

import { FEEDBACK_LINE, GAME_TITLE } from './constants'
import { gameStageView } from './layers'
import { Message, isSideways } from './main'
import {
  audioButtonsView,
  debutCardView,
  debutPitch,
  modeChoiceView,
  sidewaysView,
  toSentenceCase,
} from './menus'
import {
  DebutCard,
  type Model,
  Phase,
  type PointerDevice,
  RunMode,
  type RunStats,
} from './model'
import { isPracticeGateHeld } from './onboarding'
import { BOOST_KIND_ORDER, PICKUPS, isBoosted } from './powerups'
import { isShopOpenFor } from './shop'
import { shopDialogView } from './shopView'
import {
  accuracyPercent,
  defeatVerdict,
  runTimeLabel,
  totalKills,
  victoryVerdict,
} from './stats'
import {
  ghostSticksView,
  gunButtonsView,
  preparationControlsView,
  stickView,
} from './touchControls'
import { TRAPS, TRAP_KIND_ORDER } from './traps'
import { FINAL_WAVE, isRoundActive, roundWave } from './waves'
import {
  SIDEARM,
  WEAPONS,
  heldTier,
  heldWeapon,
  maxTier,
  maybeSpare,
  tierName,
} from './weapons'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from './zombies'

// MOUNT

type MeasuredGameSurface = typeof Message.MeasuredGameSurface.Type

const measure = (element: Element): MeasuredGameSurface => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return Message.MeasuredGameSurface({ left, top, width, height })
}

export const MeasureGameSurface = Mount.defineStream('MeasureGameSurface', {
  messages: [Message.MeasuredGameSurface],
  execute: ({ element }) =>
    Stream.callback<MeasuredGameSurface>(queue =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const emitMeasurement = (): void => {
            Queue.offerUnsafe(queue, measure(element))
          }
          const resizeObserver = new ResizeObserver(emitMeasurement)
          resizeObserver.observe(element)
          window.addEventListener('resize', emitMeasurement)
          return { resizeObserver, emitMeasurement }
        }),
        ({ resizeObserver, emitMeasurement }) =>
          Effect.sync(() => {
            resizeObserver.disconnect()
            window.removeEventListener('resize', emitMeasurement)
          }),
      ).pipe(Effect.flatMap(() => Effect.never)),
    ),
})

// STATUS

const statusWave = (model: Model, wave: number): string =>
  RunMode.match(model.mode, {
    Campaign: () => `wave ${wave} of ${FINAL_WAVE}`,
    Endless: () => `endless wave ${wave}`,
  })

const shopHint = (model: Model): string =>
  isShopOpenFor(model.phase)
    ? ' The shop stall in the bottom right corner is open. Walk up to it from any side to browse.'
    : ''

const PLAY_AGAIN =
  'Press Enter or choose Campaign for 8 waves, or press E or choose Endless to fight until you fall.'

const KEEP_GOING = `Press K or choose Keep going to carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps.`

const killLabel = (stats: RunStats): string =>
  pipe(
    ZOMBIE_KIND_ORDER,
    Array.map(kind => `${stats.kills[kind]} ${ZOMBIE_KINDS[kind].name}`),
    Array.join(', '),
  )

const waveStatsLabel = (model: Model): string =>
  RunMode.match(model.mode, {
    Campaign: () =>
      `Waves cleared: ${model.stats.wavesCleared} of ${FINAL_WAVE}.`,
    Endless: () =>
      `Wave reached: ${roundWave(model.phase)}. ${Option.match(
        model.maybeBestEndlessWave,
        {
          onNone: () => '',
          onSome: best => `Best this session: wave ${best}.`,
        },
      )}`,
  })

const statsLabel = (model: Model): string => {
  const { stats } = model
  return `${waveStatsLabel(model)} Zombies splatted: ${totalKills(stats)} (${killLabel(stats)}). Run time ${runTimeLabel(stats)}. Accuracy ${accuracyPercent(stats)} percent. Money earned $${model.wallet.earned}. Hearts lost ${stats.heartsLost}. Traps placed ${stats.trapsPlaced}. Score ${model.score}.`
}

const debutCardStatus = (model: Model): Option.Option<string> =>
  DebutCard.match(model.debutCard, {
    Hidden: () => Option.none(),
    Showing: ({ kind }) =>
      Option.some(
        `New zombie: ${ZOMBIE_KINDS[kind].name}. ${debutPitch(kind)} The wave starts in a moment. Press Enter or choose Got it to start now.`,
      ),
  })

const practiceGateNote = (model: Model): string =>
  isPracticeGateHeld(model)
    ? ' The wave waits until you try moving, aiming, and firing.'
    : ''

export const statusText = (model: Model): string => {
  if (isSideways(model)) {
    return 'Paused. Turn your phone sideways to play.'
  }

  return Phase.match(model.phase, {
    Ready: () => `${GAME_TITLE}, an early alpha. ${PLAY_AGAIN}`,
    Preparation: ({ wave }) =>
      `Get ready for ${statusWave(model, wave)}. Press Enter, or use the Start wave button, to start it now.${practiceGateNote(model)}${shopHint(model)}`,
    Wave: ({ wave }) =>
      Option.getOrElse(
        debutCardStatus(model),
        () => `Fighting ${statusWave(model, wave)}.`,
      ),
    Paused: ({ round }) =>
      `Paused during ${statusWave(model, round.wave)}. Tap, click, or press Enter to resume.`,
    Victory: () =>
      `Victory. ${victoryVerdict(model.stats)}. ${statsLabel(model)} ${KEEP_GOING} ${PLAY_AGAIN} ${FEEDBACK_LINE}`,
    GameOver: ({ wave }) =>
      `Game over. ${defeatVerdict(wave, model.stats)}. ${statsLabel(model)} ${PLAY_AGAIN} ${FEEDBACK_LINE}`,
  })
}

const gunLabel = (model: Model): string => {
  const { player } = model
  const held = tierName(heldWeapon(player.arsenal), heldTier(player))
  return Option.match(maybeSpare(player.arsenal), {
    onNone: () => `Holding the ${held}. Your second slot is empty.`,
    onSome: spare =>
      `Holding the ${held}. Second slot: ${tierName(spare.kind, spare.tier)}, upgrade tier ${spare.tier} of ${maxTier(spare.kind)}, with ${spare.rounds} ${WEAPONS[spare.kind].roundsLabel}. Pistol upgrade tier ${player.pistolTier} of ${maxTier(SIDEARM)}.`,
  })
}

const trapLabel = (model: Model): string => {
  const ready = Array.filterMap(TRAP_KIND_ORDER, kind =>
    model.trapStock[kind] > 0
      ? Result.succeed(`${model.trapStock[kind]} ${TRAPS[kind].name}`)
      : Result.failVoid,
  )
  return Array.isReadonlyArrayEmpty(ready)
    ? ''
    : ` Traps ready to place: ${Array.join(ready, ', ')}.`
}

const boostLabel = (model: Model): string => {
  const running = Array.filterMap(BOOST_KIND_ORDER, kind =>
    isBoosted(model.boosts, kind)
      ? Result.succeed(toSentenceCase(PICKUPS[kind].name))
      : Result.failVoid,
  )
  return Array.isReadonlyArrayEmpty(running)
    ? ''
    : ` Power-ups running: ${Array.join(running, ', ')}.`
}

const loadoutView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isRoundActive(model.phase)
    ? h.p(
        [h.Class('sr-only')],
        [
          `You have $${model.wallet.balance}. ${gunLabel(model)}${trapLabel(model)}${boostLabel(model)}`,
        ],
      )
    : h.empty

// POINTER

const PRIMARY_MOUSE_BUTTON = 0

const toPointerDevice = (pointerType: string): PointerDevice =>
  pointerType === 'mouse' ? 'Mouse' : 'Touch'

const toPressedPointer = (
  pointerType: string,
  button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  clientX: number,
  clientY: number,
  pointerId: number,
): Option.Option<Message> => {
  const device = toPointerDevice(pointerType)
  if (device === 'Mouse' && button !== PRIMARY_MOUSE_BUTTON) {
    return Option.none()
  } else {
    return Option.some(
      Message.PressedPointer({ pointerId, device, clientX, clientY }),
    )
  }
}

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: GAME_TITLE,
  body: h.main(
    [h.Class('game-root')],
    [
      h.h1([h.Class('sr-only')], [GAME_TITLE]),
      h.p([h.Class('sr-only'), h.Role('status')], [statusText(model)]),
      h.div(
        [
          h.Class('game-surface'),
          h.Role('application'),
          h.AriaLabel('Game surface'),
          h.Tabindex(-1),
          h.OnMount(MeasureGameSurface()),
          h.OnPointerDown(toPressedPointer),
          h.OnContextMenu(Message.SuppressedContextMenu()),
        ],
        [
          gameStageView(model, h),
          ghostSticksView(model, h),
          stickView(model.input.moveStick, 'move', h),
          stickView(model.input.aimStick, 'aim', h),
        ],
      ),
      loadoutView(model, h),
      preparationControlsView(model, h),
      gunButtonsView(model, h),
      debutCardView(model, h),
      modeChoiceView(model, h),
      audioButtonsView(model, h),
      shopDialogView(model, h),
      sidewaysView(model, h),
    ],
  ),
})
