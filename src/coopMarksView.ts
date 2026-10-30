import { Array, Option, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Camera, worldToView } from './camera'
import { maybeRoomOf } from './coop/update'
import { textShapes } from './font'
import type { Model } from './model'
import { isBledOut, isCoop, leadSeatOf, playersOf } from './party'
import { seatColorOf } from './partyView'
import { bakeShapes, placeAt } from './sprite'
import { Phase, type PlayerSlot } from './worldSchema'

// What an online co-op run adds over the players (MULTIPLAYER.md, Phase
// 2): each teammate's name over their head, READY over everyone who is
// ready in a break, and a teammate off screen as a small badge of their
// seat's color at the screen's edge, toward them (decided 4, the one
// exception to "No off-screen hints"). Zombies and doors get nothing.

// NOTE: names come from the room's lobby; a seat nobody named is its
// number, as the room names it.
const namesOf = (model: Model): ReadonlyMap<PlayerSlot, string> =>
  new Map(
    Option.match(
      Option.flatMap(maybeRoomOf(model.coop), room => room.maybeLobby),
      {
        onNone: () => [],
        onSome: lobby =>
          Array.map(
            lobby.members,
            member => [member.slot, member.name.toUpperCase()] as const,
          ),
      },
    ),
  )

const isOnline = (model: Model): boolean =>
  isCoop(model) && Option.isSome(maybeRoomOf(model.coop))

const NAME_LIFT_PX = 27
const READY_LIFT_PX = 33

const isBreak = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase)

// NOTE: in the world's own pixels, drawn with the players' overheads.
export const coopNameShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (!isOnline(model)) {
    return []
  }
  const names = namesOf(model)
  const ownSlot = leadSeatOf(model).slot
  return Array.flatMap(playersOf(model), ({ slot, seat, player }) =>
    isBledOut(seat)
      ? []
      : [
          ...(slot === ownSlot
            ? []
            : textShapes(
                names.get(slot) ?? `P${slot + 1}`,
                'Plain',
                player.x,
                player.y - NAME_LIFT_PX,
                'Center',
              )),
          ...(isBreak(model) && seat.readiness === 'Ready'
            ? textShapes(
                'READY',
                'Title',
                player.x,
                player.y - READY_LIFT_PX,
                'Center',
              )
            : []),
        ],
  )
}

// EDGE BADGES

const BADGE_PX = 9
const BADGE_EDGE = '#1a0f14'
const EDGE_INSET_PX = 3

const badgeOf = (color: string): ReadonlyArray<Canvas.Shape> =>
  bakeShapes([
    Canvas.Rect({
      x: 1,
      y: 0,
      width: BADGE_PX - 2,
      height: BADGE_PX,
      fill: BADGE_EDGE,
    }),
    Canvas.Rect({
      x: 0,
      y: 1,
      width: BADGE_PX,
      height: BADGE_PX - 2,
      fill: BADGE_EDGE,
    }),
    Canvas.Rect({
      x: 1,
      y: 1,
      width: BADGE_PX - 2,
      height: BADGE_PX - 2,
      fill: color,
    }),
    Canvas.Rect({
      x: 3,
      y: 3,
      width: BADGE_PX - 6,
      height: BADGE_PX - 6,
      fill: BADGE_EDGE,
    }),
  ])

const BADGES: ReadonlyArray<ReadonlyArray<Canvas.Shape>> = Array.map(
  [0, 1, 2, 3],
  slot => badgeOf(seatColorOf(slot)),
)

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

// NOTE: in the overlay canvas's pixels, from the screen camera.
export const coopEdgeShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => {
  if (!isOnline(model)) {
    return []
  }
  const ownSlot = leadSeatOf(model).slot
  const left = camera.left + EDGE_INSET_PX
  const top = camera.top + EDGE_INSET_PX
  const right = camera.left + camera.width * camera.scale - EDGE_INSET_PX
  const bottom = camera.top + camera.height * camera.scale - EDGE_INSET_PX
  return pipe(
    playersOf(model),
    Array.filter(({ slot, seat }) => slot !== ownSlot && !isBledOut(seat)),
    Array.flatMap(({ slot, player }) => {
      const at = worldToView(camera, player)
      const isOnScreen =
        at.x >= left && at.x <= right && at.y >= top && at.y <= bottom
      if (isOnScreen) {
        return []
      }
      const x = Math.round(clamp(at.x, left, right - BADGE_PX))
      const y = Math.round(clamp(at.y, top, bottom - BADGE_PX))
      return [placeAt(x, y, BADGES[slot % BADGES.length] ?? [])]
    }),
  )
}
