import {
  Context,
  Data,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Scope,
  Semaphore,
  Stream,
  pipe,
} from 'effect'

import { API_ORIGIN } from './analyticsBeacon'
import {
  type LinkProblem,
  type PlayerChange,
  type RunSettled,
  SyncState,
} from './playerSync'
import { type PlayerSave, readLegacySave, writeLegacySave } from './save'
import type { LegacySave, PlayerDatabase, StoreEvent } from './storeSqlite'

// STORE

// NOTE: everything that must last across reloads goes through PlayerStore.
// It keeps the PlayerSave in the player sync scope (src/playerScope.ts) on
// on-device SQLite: every change is a mutation in the outbox, applied to the
// view the game reads, and pushed to the player's Durable Object when the
// build has a sync server. The SQLite code, the sync engine, its worker,
// and its wasm load lazily on the first load, behind the splash, so the
// first paint never waits on them.
//
// Where the save lives, by backend:
// - Opfs: SQLite in the origin private file system. localStorage is read
//   once, to import an older save, and never written again.
// - Memory: SQLite opened in memory, as in a private window or a browser
//   without OPFS sync access handles. The legacy localStorage copy is still
//   written, so the save outlives the tab where localStorage does.
// - LocalStorage: SQLite did not open in time, or not at all. The legacy
//   localStorage copy is read and written for this page session, and
//   nothing syncs.
type Backend = Data.TaggedEnum<{
  Sqlite: { readonly database: PlayerDatabase }
  LocalStorage: { readonly reason: string }
}>
const Backend = Data.taggedEnum<Backend>()

class StoreError extends Data.TaggedError('StoreError')<{
  readonly reason: string
}> {}

class LinkError extends Data.TaggedError('LinkError')<{
  readonly problem: LinkProblem
}> {}

export class PlayerStore extends Context.Service<
  PlayerStore,
  {
    readonly load: Effect.Effect<Option.Option<PlayerSave>, StoreError>
    readonly write: (
      save: PlayerSave,
      changes: ReadonlyArray<PlayerChange>,
    ) => Effect.Effect<Option.Option<string>, StoreError>
    readonly awaitSettled: (id: string) => Effect.Effect<RunSettled, StoreError>
    readonly events: Stream.Stream<StoreEvent>
    readonly requestLinkCode: Effect.Effect<string, LinkError>
    readonly redeemLinkCode: (code: string) => Effect.Effect<void, LinkError>
  }
>()('munch-manor/PlayerStore') {}

// NOTE: long enough for the wasm on a slow phone network, short enough that
// a stuck worker never holds the splash for good.
const SQLITE_OPEN_TIMEOUT: Duration.Input = '12 seconds'

const legacy: LegacySave = { read: readLegacySave, write: writeLegacySave }

const toStoreError = (error: { readonly reason: string }): StoreError =>
  new StoreError({ reason: error.reason })

const toLinkError = (error: { readonly problem: LinkProblem }): LinkError =>
  new LinkError({ problem: error.problem })

const readLegacy = pipe(legacy.read, Effect.mapError(toStoreError))

const writeLegacy = (save: PlayerSave) =>
  pipe(legacy.write(save), Effect.mapError(toStoreError))

const openSqlite = (
  scope: Scope.Scope,
): Effect.Effect<PlayerDatabase, StoreError> =>
  pipe(
    Effect.tryPromise({
      try: () => import('./storeSqlite'),
      catch: error => new StoreError({ reason: String(error) }),
    }),
    Effect.flatMap(module =>
      pipe(
        module.openPlayerDatabase(legacy, API_ORIGIN),
        Effect.mapError(toStoreError),
      ),
    ),
    Scope.provide(scope),
  )

const loadFrom = (backend: Backend) =>
  Backend.$match(backend, {
    Sqlite: ({ database }) =>
      pipe(
        database.load,
        Effect.mapError(toStoreError),
        Effect.catch(error =>
          Effect.andThen(
            Effect.logError(
              'SQLite could not read the save, so it reads localStorage',
              error.reason,
            ),
            readLegacy,
          ),
        ),
      ),
    LocalStorage: () => readLegacy,
  })

// NOTE: in memory, the localStorage copy is the one that outlives the tab,
// so it is written even when the SQLite write fails. Either failure fails
// the write, so the game sends the changes again with the next one. What
// comes back is a recorded run's mutation id, when a server will confirm it.
const writeTo = (
  backend: Backend,
  save: PlayerSave,
  changes: ReadonlyArray<PlayerChange>,
): Effect.Effect<Option.Option<string>, StoreError> =>
  Backend.$match(backend, {
    Sqlite: ({ database }) => {
      const written = pipe(
        database.write(save, changes),
        Effect.mapError(toStoreError),
      )
      return database.persistence._tag === 'Opfs'
        ? written
        : Effect.gen(function* () {
            const legacyWritten = yield* Effect.exit(writeLegacy(save))
            const maybeRunId = yield* written
            yield* legacyWritten
            return maybeRunId
          })
    },
    LocalStorage: () => Effect.as(writeLegacy(save), Option.none<string>()),
  })

const localOnly: Stream.Stream<StoreEvent> = Stream.make({
  _tag: 'SyncStatus',
  state: SyncState.LocalOnly(),
})

// NOTE: SQLite opens in a fiber of the store's own scope, so a timeout here
// only stops waiting: the database is not torn down under a later write.
export const layer: Layer.Layer<PlayerStore> = Layer.effect(
  PlayerStore,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const backend = yield* Effect.cached(
      Effect.gen(function* () {
        const opening = yield* Effect.forkIn(openSqlite(scope), scope)
        return yield* pipe(
          Fiber.join(opening),
          Effect.map(database => Backend.Sqlite({ database })),
          Effect.timeoutOrElse({
            duration: SQLITE_OPEN_TIMEOUT,
            orElse: () =>
              Effect.succeed(
                Backend.LocalStorage({ reason: 'SQLite did not open in time' }),
              ),
          }),
          Effect.catch(error =>
            Effect.succeed(Backend.LocalStorage({ reason: error.reason })),
          ),
          Effect.tap(opened =>
            Backend.$match(opened, {
              Sqlite: () => Effect.void,
              LocalStorage: ({ reason }) =>
                Effect.logWarning(
                  'The save falls back to localStorage for this page',
                  reason,
                ),
            }),
          ),
        )
      }),
    )
    const writes = yield* Semaphore.make(1)
    const database = Effect.flatMap(backend, current =>
      Backend.$match(current, {
        Sqlite: ({ database: opened }) => Effect.succeed(opened),
        LocalStorage: () =>
          Effect.fail(new LinkError({ problem: 'Unavailable' })),
      }),
    )
    return {
      load: Effect.flatMap(backend, loadFrom),
      write: (save, changes) =>
        writes.withPermit(
          pipe(
            Effect.flatMap(backend, next => writeTo(next, save, changes)),
            Effect.tapError(error =>
              Effect.logError('The save was not written', error.reason),
            ),
          ),
        ),
      awaitSettled: id =>
        Effect.flatMap(
          Effect.mapError(database, error => new StoreError({ reason: error.problem })),
          opened => Effect.mapError(opened.awaitSettled(id), toStoreError),
        ),
      events: Stream.unwrap(
        Effect.map(backend, current =>
          Backend.$match(current, {
            Sqlite: ({ database: opened }) => opened.events,
            LocalStorage: () => localOnly,
          }),
        ),
      ),
      requestLinkCode: Effect.flatMap(database, opened =>
        Effect.mapError(opened.requestLinkCode, toLinkError),
      ),
      redeemLinkCode: code =>
        Effect.flatMap(database, opened =>
          Effect.mapError(opened.redeemLinkCode(code), toLinkError),
        ),
    }
  }),
)
