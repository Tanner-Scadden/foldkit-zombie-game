import { Array, Effect, Option, Order, Schema, String, pipe } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type ApplyContext,
  CODE_ALPHABET,
  type DeviceActor,
  MutationRejected,
  type Row,
  defineMutation,
  defineScope,
  parseScopeId,
  scopeId,
} from '@munch/sync-engine'

import { ClosedReason } from './Protocol'

// NOTE: a co-op room's lobby and record, the `room:<code>` sync scope
// (MULTIPLAYER.md, "How it fits the sync engine"). Members read it and
// write their own READY; when everyone is READY the run starts, in the same
// mutation, and after a run everyone presses READY again to keep going
// (decision 12). The host, the room's creator, may kick and may end a run
// early. The room itself (the GameRoom Durable Object) creates it, seats
// joiners while it is in its lobby (no late join, decision 11), and
// records each run's result. A room is Private (joined by code or link) or
// Public (made by QUICK PLAY, which fills its free seats). The realtime
// game is not here: it is the binary channel in Protocol.ts, in the same
// Durable Object.
//
// Every mutation a player writes names the player it acts for in `by`, and
// `authorize` checks that is the sender, so the apply can check the rest
// (is `by` the host, is the room in the lobby) against the rows alone and
// replay the same on every side.

export const ROOM_SCOPE_KIND = 'room'
export const ROOM_CODE_LENGTH = 5
export const MAX_PLAYERS = 4

// CODES

// NOTE: five symbols from the pairing alphabet (no 0, O, 1, or I), about
// 33 million codes. A byte maps to a symbol with `& 31` without bias.
export const RoomCode = Schema.String.check(
  Schema.isPattern(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/),
)
export type RoomCode = typeof RoomCode.Type

const isRoomCode = Schema.is(RoomCode)

export const roomCodeFromBytes = (bytes: Uint8Array): string =>
  pipe(
    globalThis.Array.from(bytes),
    Array.take(ROOM_CODE_LENGTH),
    Array.map(byte => CODE_ALPHABET.charAt(byte & 31)),
    Array.join(''),
  )

export const makeRoomCode: Effect.Effect<string> = Effect.sync(() =>
  roomCodeFromBytes(crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))),
)

// NOTE: what a player types or a link carries: any case, spaces and dashes
// ignored.
export const normalizeRoomCode = (input: string): Option.Option<RoomCode> => {
  const cleaned = pipe(
    input,
    String.toUpperCase,
    String.replaceAll(/[\s-]/g, ''),
  )
  return isRoomCode(cleaned) ? Option.some(cleaned) : Option.none()
}

export const roomScopeId = (code: string): string =>
  scopeId(ROOM_SCOPE_KIND, code)

export const roomCodeOfScope = (scope: string): Option.Option<RoomCode> =>
  pipe(
    parseScopeId(scope),
    Option.filter(address => address.kind === ROOM_SCOPE_KIND),
    Option.flatMap(address => normalizeRoomCode(address.key)),
    Option.filter(code => code === scope.slice(ROOM_SCOPE_KIND.length + 1)),
  )

// NAMES

// NOTE: a player's display name: up to 12 characters, not unique, shown in
// lobbies, the Quick Play queue, and above teammates. Whatever a client
// sends is cleaned the same way on every side: control characters out,
// spaces trimmed and collapsed, cut to 12 characters (code points, so an
// emoji is not split). An empty name becomes "Player N" by seat.
export const MAX_NAME_LENGTH = 12
export const MAX_NAME_INPUT = 64

const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g

export const defaultName = (slot: number): string => `Player ${slot + 1}`

export const cleanName = (raw: string): string =>
  globalThis.Array.from(raw.replace(CONTROL, '').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_NAME_LENGTH)
    .join('')
    .trim()

export const displayName = (raw: string, slot: number): string => {
  const cleaned = cleanName(raw)
  return cleaned === '' ? defaultName(slot) : cleaned
}

export const NameInput = Schema.String.check(Schema.isMaxLength(MAX_NAME_INPUT))

// ROWS

export const RoomStatus = Schema.Literals(['Lobby', 'Playing', 'Closed'])
export type RoomStatus = typeof RoomStatus.Type

export const RoomVisibility = Schema.Literals(['Private', 'Public'])
export type RoomVisibility = typeof RoomVisibility.Type

export const RoomMode = Schema.Literals(['StandIn'])
export type RoomMode = typeof RoomMode.Type

export const RoomScore = Schema.Struct({
  playerId: Schema.String,
  slot: Schema.Number,
  score: Schema.Number,
})
export type RoomScore = typeof RoomScore.Type

export const RoomResult = Schema.Struct({
  round: Schema.Number,
  reason: ClosedReason,
  ticks: Schema.Number,
  scores: Schema.Array(RoomScore),
})
export type RoomResult = typeof RoomResult.Type

const RoomResultJson = Schema.fromJsonString(RoomResult)

export const RoomRow = Schema.Struct({
  code: Schema.String,
  host: Schema.String,
  status: RoomStatus,
  visibility: RoomVisibility,
  mode: RoomMode,
  round: Schema.Number,
  created_ms: Schema.Number,
  updated_ms: Schema.Number,
  result: Schema.NullOr(RoomResultJson),
})
export type RoomRow = typeof RoomRow.Type

export const MemberRow = Schema.Struct({
  player_id: Schema.String,
  name: Schema.String,
  slot: Schema.Number,
  ready: Schema.Number,
  joined_ms: Schema.Number,
})
export type MemberRow = typeof MemberRow.Type

const decodeRoomRows = Schema.decodeUnknownEffect(Schema.Array(RoomRow))
const decodeMemberRows = Schema.decodeUnknownEffect(Schema.Array(MemberRow))
const encodeResult = Schema.encodeSync(RoomResultJson)

// LOBBY

export const LobbyMember = Schema.Struct({
  playerId: Schema.String,
  name: Schema.String,
  slot: Schema.Number,
  ready: Schema.Boolean,
  joinedMs: Schema.Number,
})
export type LobbyMember = typeof LobbyMember.Type

export const Lobby = Schema.Struct({
  code: Schema.String,
  host: Schema.String,
  status: RoomStatus,
  visibility: RoomVisibility,
  mode: RoomMode,
  round: Schema.Number,
  createdMs: Schema.Number,
  updatedMs: Schema.Number,
  result: Schema.Option(RoomResult),
  members: Schema.Array(LobbyMember),
})
export type Lobby = typeof Lobby.Type

const bySlot = Order.mapInput(
  Order.Number,
  (member: LobbyMember) => member.slot,
)

export const lobbyOfRows = (
  room: RoomRow,
  members: ReadonlyArray<MemberRow>,
): Lobby => ({
  code: room.code,
  host: room.host,
  status: room.status,
  visibility: room.visibility,
  mode: room.mode,
  round: room.round,
  createdMs: room.created_ms,
  updatedMs: room.updated_ms,
  result: Option.fromNullishOr(room.result),
  members: pipe(
    members,
    Array.map(member => ({
      playerId: member.player_id,
      name: member.name,
      slot: member.slot,
      ready: member.ready !== 0,
      joinedMs: member.joined_ms,
    })),
    Array.sort(bySlot),
  ),
})

const decodeSnapshotRoom = Schema.decodeUnknownOption(Schema.Array(RoomRow))
const decodeSnapshotMembers = Schema.decodeUnknownOption(
  Schema.Array(MemberRow),
)

// NOTE: the lobby from a scope Snapshot's tables, for a client that follows
// the scope without a local database (the dev page).
export const lobbyOfSnapshot = (
  tables: Readonly<Record<string, ReadonlyArray<Row>>>,
): Option.Option<Lobby> =>
  Option.flatMap(decodeSnapshotRoom(tables['room'] ?? []), rooms =>
    Option.flatMap(Array.head(rooms), room =>
      Option.map(decodeSnapshotMembers(tables['members'] ?? []), members =>
        lobbyOfRows(room, members),
      ),
    ),
  )

export const readLobby = (
  context: ApplyContext,
): Effect.Effect<
  Option.Option<Lobby>,
  SqlError.SqlError | MutationRejected,
  SqlClient.SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rooms = yield* rejectBadRows(
      decodeRoomRows(
        yield* sql`SELECT code, host, status, visibility, mode, round, created_ms, updated_ms, result
          FROM ${context.table('room')} WHERE id = 1`,
      ),
    )
    const members = yield* rejectBadRows(
      decodeMemberRows(
        yield* sql`SELECT player_id, name, slot, ready, joined_ms
          FROM ${context.table('members')}`,
      ),
    )
    return Option.map(Array.head(rooms), room => lobbyOfRows(room, members))
  })

const rejectBadRows = <A>(effect: Effect.Effect<A, Schema.SchemaError>) =>
  Effect.mapError(
    effect,
    error => new MutationRejected({ reason: error.message }),
  )

// RULES

export const freeSlot = (lobby: Lobby): Option.Option<number> =>
  Array.findFirst(
    Array.range(0, MAX_PLAYERS - 1),
    slot => !Array.some(lobby.members, member => member.slot === slot),
  )

export const isMember = (lobby: Lobby, playerId: string): boolean =>
  Array.some(lobby.members, member => member.playerId === playerId)

export const everyoneReady = (lobby: Lobby): boolean =>
  Array.isReadonlyArrayNonEmpty(lobby.members) &&
  Array.every(lobby.members, member => member.ready)

// NOTE: only a room in its lobby seats players: no late join.
export const canJoin = (lobby: Lobby): boolean =>
  lobby.status === 'Lobby' && lobby.members.length < MAX_PLAYERS

// NOTE: what a public room tells QUICK PLAY: open while it seats players.
export const isOpenToQuickPlay = (lobby: Lobby): boolean =>
  lobby.visibility === 'Public' && canJoin(lobby)

const reject = (reason: string) => Effect.fail(new MutationRejected({ reason }))

const requireLobby = (context: ApplyContext) =>
  Effect.flatMap(
    readLobby(context),
    Option.match({
      onNone: () => reject('No such room'),
      onSome: lobby => Effect.succeed(lobby),
    }),
  )

const requireHost = (lobby: Lobby, by: string) =>
  lobby.host === by ? Effect.void : reject('Only the host may do that')

const requireMember = (lobby: Lobby, playerId: string) =>
  isMember(lobby, playerId) ? Effect.void : reject('Not in this room')

const touch = (
  context: ApplyContext,
  columns: Record<string, string | number>,
) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    sql =>
      sql`UPDATE ${context.table('room')}
      SET ${sql.update({ ...columns, updated_ms: context.timestampMs })}
      WHERE id = 1`,
  )

const isSender = (args: { readonly by: string }, actor: DeviceActor) =>
  args.by === actor.playerId

const ByArgs = Schema.Struct({ by: Schema.String })

// MUTATIONS

export const CreatedRoom = defineMutation({
  name: 'CreatedRoom',
  version: 1,
  args: Schema.Struct({
    code: RoomCode,
    host: Schema.String,
    hostName: NameInput,
    mode: RoomMode,
    visibility: RoomVisibility,
  }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: ({ code, host, hostName, mode, visibility }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (Option.isSome(yield* readLobby(context))) {
        return yield* reject('This room already exists')
      }
      yield* sql`INSERT INTO ${context.table('room')} ${sql.insert({
        id: 1,
        code,
        host,
        status: 'Lobby',
        visibility,
        mode,
        round: 0,
        created_ms: context.timestampMs,
        updated_ms: context.timestampMs,
        result: null,
      })}`
      yield* sql`INSERT INTO ${context.table('members')} ${sql.insert({
        player_id: host,
        name: displayName(hostName, 0),
        slot: 0,
        ready: 0,
        joined_ms: context.timestampMs,
      })}`
    }),
})

export const JoinedRoom = defineMutation({
  name: 'JoinedRoom',
  version: 1,
  args: Schema.Struct({ playerId: Schema.String, name: NameInput }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: ({ playerId, name }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      if (isMember(lobby, playerId)) {
        return yield* reject('Already in this room')
      }
      if (!canJoin(lobby)) {
        return yield* reject(
          lobby.members.length >= MAX_PLAYERS ? 'The room is full' : 'Started',
        )
      }
      const slot = yield* Option.match(freeSlot(lobby), {
        onNone: () => reject('The room is full'),
        onSome: free => Effect.succeed(free),
      })
      yield* sql`INSERT INTO ${context.table('members')} ${sql.insert({
        player_id: playerId,
        name: displayName(name, slot),
        slot,
        ready: 0,
        joined_ms: context.timestampMs,
      })}`
      yield* touch(context, {})
    }),
})

export const ChangedReady = defineMutation({
  name: 'ChangedReady',
  version: 1,
  args: Schema.Struct({ by: Schema.String, ready: Schema.Boolean }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, ready }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireMember(lobby, by)
      if (lobby.status !== 'Lobby') {
        return yield* reject('Not in the lobby')
      }
      yield* sql`UPDATE ${context.table('members')}
        SET ready = ${ready ? 1 : 0} WHERE player_id = ${by}`
      const after = Array.map(lobby.members, member =>
        member.playerId === by ? { ...member, ready } : member,
      )
      if (everyoneReady({ ...lobby, members: after })) {
        yield* sql`UPDATE ${context.table('members')} SET ready = 0`
        return yield* touch(context, {
          status: 'Playing',
          round: lobby.round + 1,
        })
      }
      yield* touch(context, {})
    }),
})

export const EndedGame = defineMutation({
  name: 'EndedGame',
  version: 1,
  args: ByArgs,
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      if (lobby.status !== 'Playing') {
        return yield* reject('No game is running')
      }
      yield* touch(context, {})
    }),
})

// NOTE: written by the room when a run ends, however it ended. The room is
// back in its lobby, where everyone presses READY to keep going.
export const RecordedRoomResult = defineMutation({
  name: 'RecordedRoomResult',
  version: 1,
  args: Schema.Struct({ result: RoomResult }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: ({ result }, context) =>
    Effect.gen(function* () {
      const lobby = yield* requireLobby(context)
      if (lobby.status !== 'Playing') {
        return yield* reject('No game to record')
      }
      yield* touch(context, { status: 'Lobby', result: encodeResult(result) })
    }),
})

export const KickedPlayer = defineMutation({
  name: 'KickedPlayer',
  version: 1,
  args: Schema.Struct({ by: Schema.String, playerId: Schema.String }),
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by, playerId }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireHost(lobby, by)
      yield* requireMember(lobby, playerId)
      if (playerId === by) {
        return yield* reject('The host cannot kick themselves')
      }
      yield* sql`DELETE FROM ${context.table('members')} WHERE player_id = ${playerId}`
      yield* touch(context, {})
    }),
})

// NOTE: a player leaving, or the room freeing a seat that was Away too
// long. A host who leaves hands the room to the lowest slot left; the last
// one out closes it.
export const LeftRoom = defineMutation({
  name: 'LeftRoom',
  version: 1,
  args: ByArgs,
  scopes: [ROOM_SCOPE_KIND],
  writer: 'Members',
  authorize: (args, actor) => isSender(args, actor),
  apply: ({ by }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const lobby = yield* requireLobby(context)
      yield* requireMember(lobby, by)
      yield* sql`DELETE FROM ${context.table('members')} WHERE player_id = ${by}`
      const rest = Array.filter(lobby.members, member => member.playerId !== by)
      yield* Option.match(Array.head(rest), {
        onNone: () => touch(context, { status: 'Closed' }),
        onSome: next =>
          lobby.host === by
            ? touch(context, { host: next.playerId })
            : touch(context, {}),
      })
    }),
})

// SCOPE

export const RoomScope = defineScope({
  kind: ROOM_SCOPE_KIND,
  tables: ['room', 'members'],
  readers: 'Members',
  replica: 'ReadWrite',
  mutations: [
    CreatedRoom,
    JoinedRoom,
    ChangedReady,
    EndedGame,
    RecordedRoomResult,
    KickedPlayer,
    LeftRoom,
  ],
  migrations: {
    '0001_create': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('room'))} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          code TEXT NOT NULL,
          host TEXT NOT NULL,
          status TEXT NOT NULL,
          visibility TEXT NOT NULL,
          mode TEXT NOT NULL,
          round INTEGER NOT NULL,
          created_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL,
          result TEXT
        )`
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('members'))} (
          player_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slot INTEGER NOT NULL UNIQUE,
          ready INTEGER NOT NULL,
          joined_ms INTEGER NOT NULL
        )`
      }),
  },
})

// HTTP

// NOTE: the Worker's room routes. Create and join take the sync session
// token as a bearer; the socket's Hello carries it instead.
export const ROOM_PATHS = {
  create: '/room/create',
  join: '/room/join',
  socket: '/room/socket',
  quick: '/room/quick',
}

export const JoinRequest = Schema.Struct({
  code: Schema.String,
  name: NameInput,
})

export const CreateRequest = Schema.Struct({ name: NameInput })
export type CreateRequest = typeof CreateRequest.Type
export type JoinRequest = typeof JoinRequest.Type

export const RoomTicket = Schema.Struct({ code: RoomCode, slot: Schema.Number })
export type RoomTicket = typeof RoomTicket.Type

export const RoomRefusal = Schema.TaggedUnion({
  NoRoom: {},
  Full: {},
  Started: {},
  Unauthorized: { reason: Schema.String },
  RateLimited: {},
  BadRequest: { reason: Schema.String },
  Unavailable: {},
})
export type RoomRefusal = typeof RoomRefusal.Type

export const roomRefusalStatus = (refusal: RoomRefusal): number =>
  RoomRefusal.match(refusal, {
    NoRoom: () => 404,
    Full: () => 409,
    Started: () => 409,
    Unauthorized: () => 401,
    RateLimited: () => 429,
    BadRequest: () => 400,
    Unavailable: () => 503,
  })
