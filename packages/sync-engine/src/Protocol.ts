import { Schema } from 'effect'

// NOTE: the wire protocol between a client and a scope's authority. Every
// message is JSON, decoded with these Schemas on both ends. The same
// messages travel over a WebSocket or, batched, over HTTP. A client that
// speaks another PROTOCOL_VERSION is refused with Failed { VersionMismatch }.
export const PROTOCOL_VERSION = 1

// VALUES

export const MutationId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/),
)
export type MutationId = typeof MutationId.Type

// NOTE: snapshot rows carry SQLite values that JSON can hold. Blobs and
// bigints are not synced.
export const RowValue = Schema.Union([
  Schema.Null,
  Schema.Number,
  Schema.String,
])
export type RowValue = typeof RowValue.Type

export const Row = Schema.Record(Schema.String, RowValue)
export type Row = typeof Row.Type

// NOTE: a mutation on its way to the server. `args` is the JSON encoding of
// the mutation's args Schema, kept as a string so the outbox and the log
// store it as is.
export const Envelope = Schema.Struct({
  id: MutationId,
  name: Schema.String,
  version: Schema.Number,
  args: Schema.String,
})
export type Envelope = typeof Envelope.Type

export const Origin = Schema.Literals(['Client', 'Server'])
export type Origin = typeof Origin.Type

// NOTE: a mutation the server applied, at its place in the scope's log,
// with the server's timestamp. Clients apply it to their confirmed tables.
export const Delta = Schema.Struct({
  seq: Schema.Number,
  id: MutationId,
  name: Schema.String,
  version: Schema.Number,
  args: Schema.String,
  timestampMs: Schema.Number,
  origin: Origin,
})
export type Delta = typeof Delta.Type

export const RejectCode = Schema.Literals([
  'UnknownMutation',
  'Outdated',
  'Forbidden',
  'InvalidArgs',
  'Precondition',
  'Unavailable',
])
export type RejectCode = typeof RejectCode.Type

export const FailCode = Schema.Literals([
  'Unauthorized',
  'Forbidden',
  'VersionMismatch',
  'BadMessage',
  'NotReady',
  'Unavailable',
])
export type FailCode = typeof FailCode.Type

// NOTE: Catchup asks for the deltas after lastSeq, or a snapshot when the
// log no longer reaches back that far. Snapshot always asks for one, as a
// client does when its confirmed state can no longer follow the deltas.
export const HelloMode = Schema.Literals(['Catchup', 'Snapshot'])
export type HelloMode = typeof HelloMode.Type

// CLIENT TO SERVER

export const ClientMessage = Schema.TaggedUnion({
  Hello: {
    protocol: Schema.Number,
    scope: Schema.String,
    lastSeq: Schema.Number,
    mode: HelloMode,
    clientId: Schema.String,
    token: Schema.String,
    versions: Schema.Record(Schema.String, Schema.Number),
  },
  Push: { mutations: Schema.Array(Envelope) },
  Ping: {},
})
export type ClientMessage = typeof ClientMessage.Type
export type HelloMessage = typeof ClientMessage.cases.Hello.Type

// SERVER TO CLIENT

export const ServerMessage = Schema.TaggedUnion({
  Snapshot: {
    scope: Schema.String,
    seq: Schema.Number,
    tables: Schema.Record(Schema.String, Schema.Array(Row)),
  },
  Deltas: {
    scope: Schema.String,
    head: Schema.Number,
    deltas: Schema.Array(Delta),
  },
  Acked: { id: MutationId, seq: Schema.Number },
  Rejected: { id: MutationId, code: RejectCode, reason: Schema.String },
  Failed: { code: FailCode, reason: Schema.String },
  Pong: {},
})
export type ServerMessage = typeof ServerMessage.Type
export type SnapshotMessage = typeof ServerMessage.cases.Snapshot.Type
export type DeltasMessage = typeof ServerMessage.cases.Deltas.Type
export type AckedMessage = typeof ServerMessage.cases.Acked.Type
export type RejectedMessage = typeof ServerMessage.cases.Rejected.Type

// NOTE: the HTTP fallback sends a batch of client messages, the first one a
// Hello, and gets back everything the server would have sent on a socket.
export const Exchange = Schema.Array(ClientMessage)
export type Exchange = typeof Exchange.Type

export const ExchangeReply = Schema.Array(ServerMessage)
export type ExchangeReply = typeof ExchangeReply.Type

// CODECS

export const ClientMessageJson = Schema.fromJsonString(ClientMessage)
export const ServerMessageJson = Schema.fromJsonString(ServerMessage)
export const ExchangeJson = Schema.fromJsonString(Exchange)
export const ExchangeReplyJson = Schema.fromJsonString(ExchangeReply)

export const decodeClientMessage = Schema.decodeUnknownEffect(ClientMessageJson)
export const encodeClientMessage = Schema.encodeEffect(ClientMessageJson)
export const decodeServerMessage = Schema.decodeUnknownEffect(ServerMessageJson)
export const encodeServerMessage = Schema.encodeEffect(ServerMessageJson)
export const decodeExchange = Schema.decodeUnknownEffect(ExchangeJson)
export const encodeExchange = Schema.encodeEffect(ExchangeJson)
export const decodeExchangeReply = Schema.decodeUnknownEffect(ExchangeReplyJson)
export const encodeExchangeReply = Schema.encodeEffect(ExchangeReplyJson)

// NOTE: the exact strings the Durable Object's WebSocket auto-response
// matches, so a heartbeat never wakes a hibernating object.
export const PING_JSON = '{"_tag":"Ping"}'
export const PONG_JSON = '{"_tag":"Pong"}'
