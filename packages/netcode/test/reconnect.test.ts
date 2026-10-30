import { Effect, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, test } from 'vitest'

import { type Ended, backoffUpTo, reconnecting } from '../src/Reconnect'

// NOTE: a connection that ends as scripted, recording each attempt number
// and the clock when it started.
const play = (script: ReadonlyArray<Ended>) =>
  Effect.gen(function* () {
    const tries = yield* Ref.make<ReadonlyArray<readonly [number, number]>>([])
    const fiber = yield* Effect.forkChild(
      reconnecting(
        attempt =>
          Effect.gen(function* () {
            const done = yield* Ref.get(tries)
            const atMs = yield* Effect.clockWith(clock =>
              Effect.succeed(clock.currentTimeMillisUnsafe()),
            )
            yield* Ref.set(tries, [...done, [attempt, atMs]])
            return script[done.length] ?? 'Stopped'
          }),
        backoffUpTo(5000),
      ),
    )
    yield* TestClock.adjust('60 seconds')
    yield* Fiber.join(fiber)
    return yield* Ref.get(tries)
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise)

describe('reconnecting', () => {
  test('backs off while no try is heard, and stops when told', async () => {
    const tries = await play(['Unheard', 'Unheard', 'Unheard', 'Stopped'])
    expect(tries.map(([attempt]) => attempt)).toEqual([0, 1, 2, 3])
    const gaps = tries
      .slice(1)
      .map(([, atMs], index) => atMs - (tries[index]?.[1] ?? 0))
    expect(gaps[1]!).toBeGreaterThan(gaps[0]!)
    expect(gaps[2]!).toBeGreaterThan(gaps[1]!)
  })

  test('a heard connection starts the attempts and the backoff over', async () => {
    const tries = await play([
      'Unheard',
      'Unheard',
      'Unheard',
      'Heard',
      'Unheard',
      'Stopped',
    ])
    expect(tries.map(([attempt]) => attempt)).toEqual([0, 1, 2, 3, 0, 1])
    const gapAt = (index: number) =>
      (tries[index]?.[1] ?? 0) - (tries[index - 1]?.[1] ?? 0)
    expect(gapAt(4)).toBeLessThan(gapAt(3))
    expect(gapAt(5)).toBeLessThan(gapAt(3))
  })
})
