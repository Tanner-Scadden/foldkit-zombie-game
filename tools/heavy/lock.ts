import {
  Array,
  Data,
  Effect,
  FileSystem,
  Option,
  Predicate,
  Result,
  type Scope,
  pipe,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'

import {
  type LockHolder,
  LockState,
  type SharedSlot,
  classifyLock,
  encodeLockHolder,
  isSameHolder,
} from './decision'

export class LockTaken extends Data.TaggedError('LockTaken')<{}> {}

const hasErrorCode = (error: unknown, code: string): boolean =>
  Predicate.hasProperty(error, 'code') && error.code === code

// NOTE: signal 0 checks that the pid exists without touching it. EPERM means
// the process exists but belongs to another user, so it is still alive.
export const isProcessAlive = (pid: number): boolean =>
  pipe(
    Result.try(() => process.kill(pid, 0)),
    Result.match({
      onSuccess: () => true,
      onFailure: error => hasErrorCode(error, 'EPERM'),
    }),
  )

export const readTextIfPresent = (
  path: string,
): Effect.Effect<Option.Option<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path).pipe(
      Effect.map(Option.some),
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeedNone),
    )
  })

// NOTE: the holder is written to a draft first and hard linked into place.
// The link fails when the lock exists, so taking the lock is atomic and no
// reader ever sees a half written lock file.
const createLock = (
  path: string,
  holder: LockHolder,
): Effect.Effect<void, LockTaken | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const draft = `${path}.${holder.pid}.draft`
    yield* fs.writeFileString(draft, encodeLockHolder(holder))
    yield* fs.link(draft, path).pipe(
      Effect.catchReason('PlatformError', 'AlreadyExists', () =>
        Effect.fail(new LockTaken()),
      ),
      Effect.ensuring(Effect.ignore(fs.remove(draft, { force: true }))),
    )
  })

// NOTE: removes the lock only while it still names this holder, so a
// second release, or one after another guard took the file, does nothing.
export const releaseLock = (
  path: string,
  holder: LockHolder,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const maybeText = yield* readTextIfPresent(path)
    if (isSameHolder(maybeText, holder)) {
      yield* fs.remove(path, { force: true })
    }
  }).pipe(Effect.ignore)

export const acquireLock = (
  path: string,
  holder: LockHolder,
): Effect.Effect<
  void,
  LockTaken | PlatformError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Effect.acquireRelease(createLock(path, holder), () =>
    releaseLock(path, holder),
  )

// NOTE: the lock is removed only when it still holds the text that was judged
// stale, so a guard that took the lock in the meantime keeps it.
export const clearStaleLock = (
  path: string,
  maybeStaleText: Option.Option<string>,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const maybeText = yield* readTextIfPresent(path)
    if (
      Option.isSome(maybeText) &&
      Option.contains(maybeStaleText, maybeText.value)
    ) {
      yield* fs.remove(path, { force: true })
    }
  })

// THE LOCK DIRECTORY

// NOTE: the Exclusive lock keeps the old name, `munch-manor-heavy.lock`,
// beside this directory, so a guard that predates Shared slots still waits
// for an Exclusive job and still blocks Shared ones. The directory holds one
// file per Shared slot, `shared-<n>.lock`, and one marker per waiting
// Exclusive job, `exclusive-waiting-<pid>.json`.
const SHARED_SLOT_FILE = /^shared-(\d+)\.lock$/
const WAITER_FILE = /^exclusive-waiting-\d+\.json$/

export const sharedSlotPath = (directory: string, slot: number): string =>
  `${directory}/shared-${slot}.lock`

const waiterPath = (directory: string, pid: number): string =>
  `${directory}/exclusive-waiting-${pid}.json`

const listDirectory = (
  directory: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs
      .readDirectory(directory)
      .pipe(
        Effect.catchReason('PlatformError', 'NotFound', () =>
          Effect.succeed<ReadonlyArray<string>>([]),
        ),
      )
  })

export const ensureLockDirectory = (
  directory: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(directory, { recursive: true })
  })

const slotNumberOf = (name: string): ReadonlyArray<number> =>
  pipe(
    Option.fromNullishOr(SHARED_SLOT_FILE.exec(name)),
    Option.flatMap(match => Option.fromNullishOr(match[1])),
    Option.map(digits => parseInt(digits, 10)),
    Option.toArray,
  )

export const readSharedSlots = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<SharedSlot>,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const names = yield* listDirectory(directory)
    return yield* Effect.forEach(Array.flatMap(names, slotNumberOf), slot =>
      readTextIfPresent(sharedSlotPath(directory, slot)).pipe(
        Effect.map((maybeText): SharedSlot => ({
          slot,
          lock: classifyLock(maybeText, isProcessAlive),
        })),
      ),
    )
  })

// NOTE: a marker whose pid is gone is removed as it is found, so a guard
// killed while it waited never blocks anyone.
export const readExclusiveWaiters = (
  directory: string,
): Effect.Effect<
  ReadonlyArray<LockHolder>,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const names = Array.filter(yield* listDirectory(directory), name =>
      WAITER_FILE.test(name),
    )
    const found = yield* Effect.forEach(names, name =>
      readTextIfPresent(`${directory}/${name}`).pipe(
        Effect.map(maybeText => ({
          name,
          state: classifyLock(maybeText, isProcessAlive),
        })),
      ),
    )
    yield* Effect.forEach(
      Array.filter(found, ({ state }) => LockState.$is('Stale')(state)),
      ({ name }) => Effect.ignore(fs.remove(`${directory}/${name}`)),
      { discard: true },
    )
    return Array.flatMap(found, ({ state }) =>
      LockState.$is('Held')(state) ? [state.holder] : [],
    )
  })

// NOTE: the marker is written to a draft and renamed into place, so a
// reader never sees half of it. It is removed once the job holds the lock,
// gives up, or is stopped.
export const whileWaitingExclusive = <A, E, R>(
  directory: string,
  holder: LockHolder,
  wait: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | PlatformError, R | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = waiterPath(directory, holder.pid)
    const draft = `${path}.draft`
    return yield* Effect.acquireUseRelease(
      fs
        .writeFileString(draft, encodeLockHolder(holder))
        .pipe(Effect.andThen(fs.rename(draft, path))),
      () => wait,
      () => Effect.ignore(fs.remove(path, { force: true })),
    )
  })

// NOTE: clears a lock or slot file only while it still reads as stale or
// corrupt, and only that same text, so a live job that took it in the
// meantime keeps it.
export const clearIfNotHeld = (
  path: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const maybeText = yield* readTextIfPresent(path)
    if (!LockState.$is('Held')(classifyLock(maybeText, isProcessAlive))) {
      yield* clearStaleLock(path, maybeText)
    }
  })
