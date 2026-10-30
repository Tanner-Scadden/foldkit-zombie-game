import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { LobbyEvent, QuickPlayEvent, RoomEvent } from '@munch/netcode/browser'

import { CoopProblem, Share } from './model'

// MESSAGE

export const Message = defineMessageUnion({
  ClickedQuickPlayButton: {},
  ClickedCodeButton: {},
  ClickedCreateButton: {},
  ClickedBackButton: {},
  ClickedCloseButton: {},
  UpdatedCode: { value: Schema.String },
  SubmittedCode: {},
  SucceededRequestRoom: { code: Schema.String, slot: Schema.Number },
  FailedRequestRoom: { problem: CoopProblem },
  ReceivedQuickPlayEvent: { event: QuickPlayEvent },
  ClickedAcceptOfferButton: {},
  ClickedKeepWaitingButton: {},
  ClickedCancelQueueButton: {},
  CompletedAnswerOffer: {},
  CompletedCancelQuickPlay: {},
  ReceivedLobbyEvent: { event: LobbyEvent },
  ReceivedRoomEvent: { event: RoomEvent, atMs: Schema.Number },
  TickedRoomFrame: { nowMs: Schema.Number },
  CompletedSendRoomFrames: { bytes: Schema.Array(Schema.Number) },
  ClickedReadyButton: {},
  ClickedKickButton: { playerId: Schema.String },
  CompletedChangeLobby: {},
  FailedChangeLobby: { problem: CoopProblem },
  ClickedLeaveButton: {},
  CompletedLeaveRoom: {},
  ClickedShareButton: {},
  CompletedShareRoomLink: { share: Share },
  CompletedRememberRoom: {},
  CompletedFocusCoopElement: {},
})
export type Message = typeof Message.Type

// OUT MESSAGE

export const OutMessage = defineMessageUnion({
  ClosedCoop: {},
})
export type OutMessage = typeof OutMessage.Type
