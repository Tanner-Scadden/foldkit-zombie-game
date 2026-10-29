import { message } from 'foldkit/story'

import { Message } from './main'

export const FIRE_THUMB = 70

export const holdFire = message(
  Message.PressedPointer({
    pointerId: FIRE_THUMB,
    device: 'Touch',
    clientX: 600,
    clientY: 200,
  }),
)

export const releaseFire = message(
  Message.ReleasedPointer({ pointerId: FIRE_THUMB }),
)
