import {
  Duration,
  Effect,
  Layer,
  MutableRef,
  Option,
  Predicate,
  Queue,
  Ref,
  Schedule,
  type Scope,
  Stream,
  pipe,
} from 'effect'
import type { SqlClient } from 'effect/sql'

import {
  ChannelMessage,
  Persistence,
  Request,
  type Response,
  decodeChannelMessage,
  decodeResponse,
  encodeChannelMessage,
  encodeRequest,
} from './Protocol'
import { type Remote, type Sender, makeRemote } from './Remote'
import {
  type ClientOptions,
  DEFAULT_OPEN_TIMEOUT,
  type DatabaseFile,
  type Role,
  SqliteClient,
  SqliteOpenError,
  type Status,
  layerFromClient,
  makeClient,
  openThrough,
} from './SqliteClient'

// OPTIONS

export interface BrowserOptions extends ClientOptions {
  readonly worker: () => Worker
  readonly name?: string | undefined
  readonly file?: string | undefined
  readonly openTimeout?: Duration.Input | undefined
}

const DEFAULT_NAME = 'sqlite-wasm-effect'
const DEFAULT_FILE = '/main.sqlite3'
const FOLLOWER_ASK_INTERVAL: Duration.Input = '1 second'

const describe = (error: unknown): string =>
  Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)
    ? error.message
    : String(error)

// LOCKS

type LockResult = 'Granted' | 'Held'

type LockMode = 'IfAvailable' | 'Wait'

const hasLocks = (): boolean =>
  Predicate.hasProperty(globalThis, 'navigator') &&
  Predicate.hasProperty(globalThis.navigator, 'locks')

// NOTE: the lock is held by a promise that settles when the scope closes, so
// it lasts as long as the layer, and the browser frees it when the tab goes.
// Waiting is aborted if the scope closes first.
const acquireLock = (
  name: string,
  mode: LockMode,
): Effect.Effect<LockResult, never, Scope.Scope> =>
  Effect.gen(function* () {
    const release = MutableRef.make<() => void>(() => {})
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => MutableRef.get(release)()),
    )
    return yield* Effect.callback<LockResult>((resume, signal) => {
      const hold = (lock: Lock | null): Promise<void> | undefined => {
        if (lock === null) {
          resume(Effect.succeed('Held'))
          return undefined
        }
        resume(Effect.succeed('Granted'))
        return new Promise<void>(settle => {
          MutableRef.set(release, settle)
        })
      }
      const request =
        mode === 'IfAvailable'
          ? navigator.locks.request(name, { ifAvailable: true }, hold)
          : navigator.locks.request(name, { signal }, hold)
      request.catch(() => undefined)
    })
  })

// MESSAGES

const messagesOf = (
  target: Pick<Worker, 'addEventListener' | 'removeEventListener'>,
): Stream.Stream<unknown> =>
  Stream.callback<unknown>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = (event: MessageEvent): void => {
          Queue.offerUnsafe(queue, event.data)
        }
        target.addEventListener('message', listener)
        return listener
      }),
      listener =>
        Effect.sync(() => target.removeEventListener('message', listener)),
    ),
  )

const errorsOf = (worker: Worker): Stream.Stream<string> =>
  Stream.callback<string>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = (event: ErrorEvent): void => {
          Queue.offerUnsafe(queue, event.message || 'The worker failed to load')
        }
        worker.addEventListener('error', listener)
        return listener
      }),
      listener =>
        Effect.sync(() => worker.removeEventListener('error', listener)),
    ),
  )

const post =
  (target: { postMessage: (message: unknown) => void }) =>
  (message: unknown): Effect.Effect<void> =>
    pipe(
      Effect.try(() => target.postMessage(message)),
      Effect.ignore,
    )

const postChannel = (
  channel: Option.Option<BroadcastChannel>,
  message: ChannelMessage,
): Effect.Effect<void> =>
  Option.match(channel, {
    onNone: () => Effect.void,
    onSome: open =>
      pipe(
        encodeChannelMessage(message),
        Effect.flatMap(post(open)),
        Effect.ignore,
      ),
  })

const isOwn = (session: string, response: Response): boolean =>
  response._tag === 'Changed' ||
  (Predicate.hasProperty(response, 'id') &&
    Predicate.isString(response.id) &&
    response.id.startsWith(`${session}:`))

// STATUS

const leading = (persistence: Persistence): Status => ({
  role: 'Leader',
  persistence,
})

const following = (persistence: Persistence): Status => ({
  role: 'Follower',
  persistence,
})

// LEADER

// NOTE: the leader runs the worker. Its own responses go to its Remote;
// anyone else's go back over the channel as Answers. Changed goes to both, so
// every tab hears every commit.
const lead = (
  remote: Remote,
  worker: Ref.Ref<Option.Option<Worker>>,
  channel: Option.Option<BroadcastChannel>,
  options: BrowserOptions,
): Effect.Effect<Sender, never, Scope.Scope> =>
  Effect.gen(function* () {
    const started = yield* Effect.acquireRelease(
      Effect.sync(() => options.worker()),
      running => Effect.sync(() => running.terminate()),
    )
    yield* Ref.set(worker, Option.some(started))
    const sendToWorker = (request: Request): Effect.Effect<void> =>
      pipe(encodeRequest(request), Effect.flatMap(post(started)), Effect.ignore)
    const sender: Sender = { send: sendToWorker }

    yield* pipe(
      messagesOf(started),
      Stream.runForEach(data =>
        pipe(
          decodeResponse(data),
          Effect.flatMap(response =>
            Effect.andThen(
              isOwn(remote.session, response)
                ? remote.receive(response)
                : Effect.void,
              isOwn(remote.session, response) && response._tag !== 'Changed'
                ? Effect.void
                : postChannel(
                    channel,
                    ChannelMessage.cases.Answer.make({ response }),
                  ),
            ),
          ),
          Effect.ignore,
        ),
      ),
      Effect.forkScoped,
    )

    yield* pipe(
      errorsOf(started),
      Stream.runForEach(reason =>
        remote.useSender(sender, `The database worker failed: ${reason}`),
      ),
      Effect.forkScoped,
    )

    return sender
  })

// LAYER

// NOTE: one tab leads at a time, chosen with the Web Locks API. The leader
// runs the worker and the database. Every other tab follows: it sends its
// statements to the leader over a BroadcastChannel, and waits in line for
// the lock. When the leader tab closes, the next tab in line takes the lock,
// starts its own worker, opens the same file, and says LeaderChanged, so the
// other followers drop what they were waiting on. A browser without Web
// Locks leads on its own, with no guard between tabs.
export const layer = (
  options: BrowserOptions,
): Layer.Layer<SqliteClient | SqlClient.SqlClient, SqliteOpenError> =>
  layerFromClient(
    Effect.gen(function* () {
      const name = options.name ?? DEFAULT_NAME
      const database: DatabaseFile = {
        file: options.file ?? DEFAULT_FILE,
        directory: `.${name}`,
      }
      const openTimeout = options.openTimeout ?? DEFAULT_OPEN_TIMEOUT
      const session = yield* Effect.sync(() => crypto.randomUUID())
      const channel = yield* pipe(
        Effect.acquireRelease(
          Effect.try(() => new BroadcastChannel(`${name}:channel`)),
          open => Effect.sync(() => open.close()),
        ),
        Effect.option,
      )
      const worker = yield* Ref.make<Option.Option<Worker>>(Option.none())
      const role = yield* Ref.make<Role>('Follower')

      const askLeader: Sender = {
        send: request =>
          postChannel(channel, ChannelMessage.cases.Ask.make({ request })),
      }
      const remote = yield* makeRemote(session, askLeader)

      const firstLock: LockResult = hasLocks()
        ? yield* acquireLock(`${name}:leader`, 'IfAvailable')
        : 'Granted'

      const status = yield* Ref.make<Status>({
        role: 'Follower',
        persistence: Persistence.cases.Memory.make({ reason: 'Not open yet' }),
      })

      const openAsLeader = Effect.gen(function* () {
        const sender = yield* lead(remote, worker, channel, options)
        yield* Ref.set(role, 'Leader')
        yield* remote.useSender(sender, 'This tab became the leader')
        const persistence = yield* openThrough(remote, database, openTimeout)
        yield* Ref.set(status, leading(persistence))
        yield* postChannel(
          channel,
          ChannelMessage.cases.LeaderChanged.make({ leader: session }),
        )
      })

      const openAsFollower = pipe(
        openThrough(remote, database, FOLLOWER_ASK_INTERVAL),
        Effect.retry(Schedule.spaced('100 millis')),
        Effect.timeoutOrElse({
          duration: openTimeout,
          orElse: () =>
            Effect.fail(
              new SqliteOpenError({ reason: 'No leader tab answered' }),
            ),
        }),
        Effect.flatMap(persistence => Ref.set(status, following(persistence))),
      )

      const handleChannel = (
        message: ChannelMessage,
      ): Effect.Effect<void, never, Scope.Scope> =>
        Effect.gen(function* () {
          const current = yield* Ref.get(role)
          if (current === 'Leader' && message._tag === 'Ask') {
            const running = yield* Ref.get(worker)
            yield* Option.match(running, {
              onNone: () => Effect.void,
              onSome: started =>
                pipe(
                  encodeRequest(message.request),
                  Effect.flatMap(post(started)),
                  Effect.ignore,
                ),
            })
          } else if (current === 'Follower' && message._tag === 'Answer') {
            yield* remote.receive(message.response)
          } else if (
            current === 'Follower' &&
            message._tag === 'LeaderChanged'
          ) {
            yield* remote.useSender(askLeader, 'The leader tab changed')
            yield* pipe(openAsFollower, Effect.ignore, Effect.forkScoped)
          }
        })

      yield* Option.match(channel, {
        onNone: () => Effect.void,
        onSome: open =>
          pipe(
            messagesOf(open),
            Stream.runForEach(data =>
              pipe(
                decodeChannelMessage(data),
                Effect.flatMap(handleChannel),
                Effect.ignore,
              ),
            ),
            Effect.forkScoped,
            Effect.asVoid,
          ),
      })

      if (firstLock === 'Granted') {
        yield* openAsLeader.pipe(
          Effect.mapError(
            error => new SqliteOpenError({ reason: describe(error) }),
          ),
        )
      } else {
        yield* openAsFollower
        yield* pipe(
          acquireLock(`${name}:leader`, 'Wait'),
          Effect.andThen(openAsLeader),
          Effect.ignore,
          Effect.forkScoped,
        )
      }

      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Ref.get(role), current =>
          current === 'Follower'
            ? askLeader.send(Request.cases.Release.make({ session }))
            : Effect.void,
        ),
      )

      return yield* makeClient(remote, status, options)
    }),
  )
