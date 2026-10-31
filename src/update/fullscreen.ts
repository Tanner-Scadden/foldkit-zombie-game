import { Effect, pipe } from 'effect'

import { makeCommand } from '../definition'
import { Message } from '../message'
import { FullscreenSetting } from '../model'
import type { UpdateStep } from './step'

// COMMAND

// NOTE: the rotation lock is ApplyRotation's, issued once full screen is on.
const enterFullscreen = Effect.tryPromise(() =>
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
)

const exitFullscreen = Effect.tryPromise(() =>
  document.fullscreenElement === null
    ? Promise.resolve()
    : document.exitFullscreen(),
)

export const SetFullscreen = makeCommand('SetFullscreen', {
  args: { fullscreen: FullscreenSetting },
  messages: [Message.CompletedSetFullscreen, Message.FailedSetFullscreen],
  handler: function* () {
    return ({ fullscreen }) =>
      pipe(
        fullscreen === 'On' ? enterFullscreen : exitFullscreen,
        Effect.as(Message.CompletedSetFullscreen({ fullscreen })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedSetFullscreen({ reason: String(error) }),
          ),
        ),
      )
  },
})

// FULL SCREEN

export const toggleFullscreen: UpdateStep = model => ({
  model,
  commands: [
    SetFullscreen({ fullscreen: model.fullscreen === 'On' ? 'Off' : 'On' }),
  ],
})
