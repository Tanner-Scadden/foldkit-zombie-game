import { Array, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { PlayerInput } from '@munch/netcode'

import type { Room as CoopRoom } from './coop/model'
import { isInLobby, maybeRoomOf } from './coop/update'
import { isAtExit } from './exits'
import {
  advanceCosmetics,
  clampFrameDelta,
  leanFor,
  refreshIntent,
} from './frame'
import { stopForHits, thawTick } from './juice'
import { type Model, Phase } from './model'
import { ageDebutCard, raiseDebutCardFrom } from './onboarding'
import { isCoop, shopOf } from './party'
import { inputOfIntent, ownWorldOf } from './roomWorld'
import { freshRun } from './runReset'
import { isBrowsing } from './shop'
import { tallyFrame } from './stats'
import { enterExit } from './update/exit'
import { closeShop, enterShop } from './update/shop'
import {
  frameSoundCues,
  isOwnShot,
  playSounds,
  playStartSoundWhen,
  shotSoundCue,
} from './update/sound'
import type { UpdateStep } from './update/step'
import { isRoundActive } from './waves'
import { type World, withWorld } from './world'
import {
  type Difficulty,
  GameEvent,
  HitStop,
  type ShopState,
  type Vector,
} from './worldSchema'
import { footfallNearness } from './zombies'

// The root's half of an online co-op run (MULTIPLAYER.md, Phase 2): the
// game's own scene, HUD, shop, and touch controls drawn from the room's
// World. Each frame the client derives its intent from its own input and
// camera, the co-op Submodel sends it with any press and hands back the
// World to draw (everyone else 100 ms behind, its own player predicted)
// and the events the drawing reached. The root puts its own seat in the
// World's player fields (focusSeat), so every view draws it as the player,
// then makes particles, shake, popups, and sounds from the events with its
// own cosmetic stream, and freezes its own picture for hit-stop. The room
// alone decides hits, money, and deaths.

// NOTE: a room whose run is on, its lobby Playing.
export const maybeRunRoom = (model: Model): Option.Option<CoopRoom> =>
  Option.filter(maybeRoomOf(model.coop), room => !isInLobby(room))

// NOTE: a run is drawn from the room once its first World has come.
export const isOnlineRun = (model: Model): boolean =>
  Option.exists(maybeRunRoom(model), room => Option.isSome(room.maybeWorld))

// NOTE: the World a room run left in the root, after its room is gone.
export const isLeftFromRoom = (model: Model): boolean =>
  isCoop(model) &&
  model.localPlayers <= 1 &&
  !Phase.isAnyOf(['Ready'])(model.phase) &&
  Option.isNone(maybeRoomOf(model.coop))

// NOTE: the difficulty a run plays on: the room's, which its host picked,
// while the player is in a room that has sent a World, else their own.
export const runDifficultyOf = (model: Model): Difficulty =>
  Option.getOrElse(
    Option.flatMap(maybeRoomOf(model.coop), room =>
      Option.map(
        room.maybeWorld,
        roomWorld => roomWorld.world.difficulty.chosen,
      ),
    ),
    () => model.difficulty.chosen,
  )

// THE ROOM'S WORLD IN THE ROOT

// NOTE: the fields the room owns, from the World with this client's own
// seat in the player fields. The rest stay the client's: its intent, the
// run's stats and the gates, the save's difficulty, the money count-up,
// the shop's open tab, and its focused row while it browses.
const takeRoomWorld = (
  model: Model,
  world: World,
  events: ReadonlyArray<GameEvent>,
): Model =>
  modifyFields(model, {
    phase: () => world.phase,
    pacing: () => world.pacing,
    boss: () => world.boss,
    frenzyPacks: () => world.frenzyPacks,
    intensity: () => world.intensity,
    mode: () => world.mode,
    player: () => world.player,
    zombies: () => world.zombies,
    bullets: () => world.bullets,
    wallet: wallet => modifyFields(world.wallet, { shown: () => wallet.shown }),
    elapsedMs: () => world.elapsedMs,
    frameEvents: () => events,
    traps: () => world.traps,
    pickups: () => world.pickups,
    boosts: () => world.boosts,
    trapStock: () => world.trapStock,
    selectedTrap: () => world.selectedTrap,
    level: () => world.level,
    ovens: () => world.ovens,
    laserSight: () => world.laserSight,
    shop: shop =>
      isBrowsing(shop) && isBrowsing(world.shop) ? shop : world.shop,
    party: () => world.party,
  })

const isFrozen = HitStop.isAnyOf(['Frozen'])

// NOTE: the room scores a footstep against its lead seat; this client hears
// it, and shakes for it, by how near it is to its own player.
const heardBy = (
  listener: Vector,
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<GameEvent> =>
  Array.map(events, event =>
    GameEvent.isAnyOf(['Footfall'])(event)
      ? GameEvent.Footfall({
          ...event,
          nearness: footfallNearness(
            event.kind,
            Math.hypot(event.x - listener.x, event.y - listener.y),
          ),
        })
      : event,
  )

type Drawn = Readonly<{ room: CoopRoom; world: World }>

const maybeDrawnOf = (model: Model): Option.Option<Drawn> =>
  Option.flatMap(maybeRunRoom(model), room =>
    Option.map(room.maybeWorld, roomWorld => ({
      room,
      world: ownWorldOf(roomWorld, room.slot),
    })),
  )

const ownShopOf = (model: Model): Option.Option<ShopState> =>
  Option.flatMap(maybeDrawnOf(model), ({ room, world }) =>
    shopOf(world, room.slot),
  )

const isEntering = (
  maybeBefore: Option.Option<ShopState>,
  after: ShopState,
  isThere: (shop: ShopState) => boolean,
): boolean =>
  isThere(after) && !Option.exists(maybeBefore, before => isThere(before))

// NOTE: the drawing of one frame. A run starting (or the next one after the
// end screen) resets the client's run fields first. While the client's own
// hit-stop holds, the picture stays, and the events wait in the session.
const drawRoom =
  (frameMs: number, maybeShopBefore: Option.Option<ShopState>): UpdateStep =>
  stepModel =>
    Option.match(maybeDrawnOf(stepModel), {
      onNone: () => ({ model: stepModel }),
      onSome: ({ room, world }) => {
        const isStart =
          !isRoundActive(stepModel.phase) && isRoundActive(world.phase)
        const base = isStart
          ? { ...stepModel, ...freshRun(stepModel) }
          : stepModel
        const thaw = thawTick(base.hitStop, frameMs)
        const events = heardBy(world.player, room.frameEvents)
        if (isFrozen(thaw.hitStop)) {
          return {
            model: modifyFields(base, {
              hitStop: () => thaw.hitStop,
              frameEvents: () => [],
            }),
          }
        }
        const applied = withWorld(
          takeRoomWorld(
            modifyFields(base, { hitStop: () => thaw.hitStop }),
            world,
            events,
          ),
          taken => stopForHits(taken, frameMs),
        )
        const drawn = ageDebutCard(
          raiseDebutCardFrom(
            base,
            leanFor(
              advanceCosmetics(
                tallyFrame(base, applied, frameMs),
                frameMs,
                frameMs,
              ),
              frameMs,
            ),
          ),
          frameMs,
        )
        const shopNow = world.shop
        return Update.combine(drawn, [
          playSounds([
            ...(room.predictedShots > 0 ? [shotSoundCue(world.player)] : []),
            ...frameSoundCues(
              Array.filter(events, event => !isOwnShot(event, room.slot)),
            ),
          ]),
          playStartSoundWhen(isStart),
          ...(isEntering(maybeShopBefore, shopNow, isBrowsing)
            ? [enterShop]
            : []),
          ...(isEntering(maybeShopBefore, shopNow, isAtExit)
            ? [enterExit]
            : []),
          ...(drawn.shopDialog.isOpen && !isBrowsing(shopNow)
            ? [closeShop]
            : []),
        ])
      },
    })

// NOTE: one frame of an online run: the controls go to the room through
// the co-op Submodel's `tickRoom` (`tickCoop`, folded by the caller), then
// the root draws what came back.
export const playRoomFrame =
  (
    nowMs: number,
    tickCoop: (controls: PlayerInput, isPictureHeld: boolean) => UpdateStep,
  ): UpdateStep =>
  stepModel => {
    const maybeBefore = maybeRunRoom(stepModel)
    const frameMs = clampFrameDelta(
      Option.match(maybeBefore, {
        onNone: () => 0,
        onSome: room => nowMs - room.session.renderedMs,
      }),
    )
    const intended = refreshIntent(stepModel)
    return Update.combine(intended, [
      tickCoop(
        inputOfIntent(intended.intent, 0),
        isFrozen(thawTick(stepModel.hitStop, frameMs).hitStop),
      ),
      drawRoom(frameMs, ownShopOf(stepModel)),
    ])
  }
