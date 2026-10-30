import { Effect, Fiber, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'

// TESTING

// NOTE: for tests that run sync on the TestClock, where the heartbeat, the
// silence watchdog, the resend timer, the backoff, and the follower poll
// move only when the test moves time. A loaded machine then cannot make a
// server look quiet and drop a session halfway through a test.

const STEP = '10 millis'
const TURNS_PER_STEP = 20
const MAX_STEPS = 3000

// NOTE: waits for an event, not for time. The wait runs in its own fiber
// while this one hands the other fibers turns and moves the TestClock a step
// at a time, so a backoff or a poll in the way still elapses. A wait that
// never ends fails after 30 seconds of test clock, not of real time.
export const settle = <A, E, R>(
  wait: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(wait, { startImmediately: true })
    const drive = (turn: number): Effect.Effect<A, E> => {
      const exit = fiber.pollUnsafe()
      if (exit !== undefined) {
        return exit
      }
      if (turn >= MAX_STEPS * TURNS_PER_STEP) {
        return Effect.andThen(
          Fiber.interrupt(fiber),
          Effect.die(new Error('Still waiting after 30 s of test clock')),
        )
      }
      return Effect.andThen(
        turn % TURNS_PER_STEP === TURNS_PER_STEP - 1
          ? TestClock.adjust(STEP)
          : Effect.yieldNow,
        Effect.suspend(() => drive(turn + 1)),
      )
    }
    return yield* drive(0)
  })

// NOTE: the first value a stream shows that passes, waited for with settle.
// The status streams start with the current value, so nothing is missed.
export const first = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  isDone: (value: A) => boolean,
): Effect.Effect<A, E, R> =>
  settle(
    Effect.flatMap(Stream.runHead(Stream.filter(stream, isDone)), maybe =>
      Option.match(maybe, {
        onNone: () => Effect.die(new Error('The stream ended')),
        onSome: Effect.succeed,
      }),
    ),
  )
