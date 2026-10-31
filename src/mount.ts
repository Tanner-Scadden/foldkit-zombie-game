import { Effect, Queue, Stream } from 'effect'

import { ApplicationDefinition } from './definition'
import {
  type MeasuredGameSurface,
  Message,
  type TappedWithTouch,
} from './message'
import { listenForTouchTaps } from './touchTaps'

const measure = (element: Element): MeasuredGameSurface => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return Message.MeasuredGameSurface({ left, top, width, height })
}

// NOTE: the game surface's place on the page, measured when it mounts and
// again whenever it or the window resizes, so pointer input maps onto it.
export const MeasureGameSurface = ApplicationDefinition.makeMountStream(
  'MeasureGameSurface',
  {
    messages: [Message.MeasuredGameSurface],
    handler: function* () {
      return ({ element }) =>
        Stream.callback<MeasuredGameSurface>(queue =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const emitMeasurement = (): void => {
                Queue.offerUnsafe(queue, measure(element))
              }
              const resizeObserver = new ResizeObserver(emitMeasurement)
              resizeObserver.observe(element)
              window.addEventListener('resize', emitMeasurement)
              window.visualViewport?.addEventListener('resize', emitMeasurement)
              return { resizeObserver, emitMeasurement }
            }),
            ({ resizeObserver, emitMeasurement }) =>
              Effect.sync(() => {
                resizeObserver.disconnect()
                window.removeEventListener('resize', emitMeasurement)
                window.visualViewport?.removeEventListener(
                  'resize',
                  emitMeasurement,
                )
              }),
          ).pipe(Effect.flatMap(() => Effect.never)),
        )
    },
  },
)

// NOTE: taps on touch screens come from each finger's own pointer events,
// so a button works with another finger on the glass (src/touchTaps.ts).
// The tapped button's own OnClick sends its Message; this Mount only says a
// finger tapped.
export const ListenForTouchTaps = ApplicationDefinition.makeMountStream(
  'ListenForTouchTaps',
  {
    messages: [Message.TappedWithTouch],
    handler: function* () {
      return ({ element }) =>
        Stream.callback<TappedWithTouch>(queue =>
          Effect.acquireRelease(
            Effect.sync(() =>
              element instanceof HTMLElement
                ? listenForTouchTaps(element, () => {
                    Queue.offerUnsafe(queue, Message.TappedWithTouch())
                  })
                : () => undefined,
            ),
            stopListening => Effect.sync(stopListening),
          ).pipe(Effect.flatMap(() => Effect.never)),
        )
    },
  },
)

export const mounts = [MeasureGameSurface, ListenForTouchTaps]
