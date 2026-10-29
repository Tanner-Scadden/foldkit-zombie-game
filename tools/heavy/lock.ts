import {
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

import { type LockHolder, encodeLockHolder, isSameHolder } from './decision'

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

const releaseLock = (
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
