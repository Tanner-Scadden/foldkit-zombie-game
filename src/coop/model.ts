import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Lobby, RoomCode } from '@munch/netcode'

import { RoomSession, WorldState } from './seam'

// NOTE: co-op's own state, a Submodel the root Model holds. Nothing here is
// saved: a room lasts as long as the page, and a reload rejoins it from the
// `?room=CODE` link (see MULTIPLAYER.md, "What Phases 2 and 3 built").

// PROBLEMS

// NOTE: what can go wrong, each shown as an icon and a word or two.
export const CoopProblem = Schema.Literals([
  'Offline',
  'NoRoom',
  'Full',
  'Started',
  'Busy',
  'NotACode',
  'Kicked',
  'Dropped',
])
export type CoopProblem = typeof CoopProblem.Type

// LOBBY CHANGES

// NOTE: what a player writes to the room's lobby scope. The service fills
// in who it is for (`by`), so the update never needs the player id.
export const LobbyChange = defineTaggedUnion({
  ChangedReady: { ready: Schema.Boolean },
  KickedPlayer: { playerId: Schema.String },
})
export type LobbyChange = typeof LobbyChange.Type

// REQUESTS

export const RoomRequest = defineTaggedUnion({
  Create: {},
  Join: { code: RoomCode },
})
export type RoomRequest = typeof RoomRequest.Type

export const RoomTicket = Schema.Struct({ code: RoomCode, slot: Schema.Number })
export type RoomTicket = typeof RoomTicket.Type

// QUEUE

export const OfferAnswer = Schema.Literals([
  'Unanswered',
  'Accepted',
  'Waiting',
])
export type OfferAnswer = typeof OfferAnswer.Type

export const Queue = Schema.Struct({
  names: Schema.Array(Schema.String),
  waiting: Schema.Number,
  position: Schema.Number,
  groupSize: Schema.Number,
  offerPlayers: Schema.Number,
  accepted: Schema.Number,
  answer: OfferAnswer,
})
export type Queue = typeof Queue.Type

// ROOM

export const Link = Schema.Literals(['Connecting', 'Online', 'Reconnecting'])
export type Link = typeof Link.Type

export const Share = Schema.Literals(['Idle', 'Shared', 'Copied'])
export type Share = typeof Share.Type

export const Departure = Schema.Literals(['Staying', 'Leaving'])
export type Departure = typeof Departure.Type

export const Room = Schema.Struct({
  code: RoomCode,
  slot: Schema.Number,
  maybePlayerId: Schema.Option(Schema.String),
  maybeLobby: Schema.Option(Lobby),
  link: Link,
  session: RoomSession,
  maybeWorld: Schema.Option(WorldState),
  share: Share,
  departure: Departure,
})
export type Room = typeof Room.Type

// SCREENS

export const Screen = defineTaggedUnion({
  Closed: {},
  Hub: { maybeProblem: Schema.Option(CoopProblem) },
  Code: { typed: Schema.String, maybeProblem: Schema.Option(CoopProblem) },
  Asking: { request: RoomRequest },
  Queue: { queue: Queue },
  InRoom: { room: Room },
})
export type Screen = typeof Screen.Type

// CONTROLS

export const ArenaPoint = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type ArenaPoint = typeof ArenaPoint.Type

export const Model = Schema.Struct({
  screen: Screen,
  name: Schema.String,
  heldKeys: Schema.Array(Schema.String),
  maybePointer: Schema.Option(ArenaPoint),
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  screen: Screen.Closed(),
  name: '',
  heldKeys: [],
  maybePointer: Option.none(),
}

export const emptyQueue: Queue = {
  names: [],
  waiting: 0,
  position: 0,
  groupSize: 4,
  offerPlayers: 0,
  accepted: 0,
  answer: 'Unanswered',
}
