import { Schema } from 'effect'

import { Difficulty } from '../../src/playerData'

// THE SHOT LIST
//
// NOTE: a shot list file is JSON: clips, each made of shots played one
// after another. A shot is a harness scene (the query string the audit
// harness reads, with a `seed`), how many game ticks it plays, and the
// script the director plays it with (tools/audit/harness/director.ts).
// Everything in it is counted in ticks of 1/60 s, so a shot plays the same
// however long a frame takes to capture.

const Ticks = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Positive = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

// NOTE: 16:9 is 1920x1080 at six screen pixels a game pixel, the
// landscape layout with a mouse. 9:16 is 1080x1920, an upright phone
// with touch, so the portrait layout and its thumb area.
export const Format = Schema.Literals(['16:9', '9:16'])
export type Format = typeof Format.Type

export const Segment = Schema.Struct({
  from: Ticks,
  to: Ticks,
  keys: Schema.optionalKey(Schema.Array(Schema.String)),
  move: Schema.optionalKey(Schema.Tuple([Schema.Finite, Schema.Finite])),
  aim: Schema.optionalKey(
    Schema.Union([
      Schema.Literal('nearest'),
      Schema.Tuple([Schema.Finite, Schema.Finite]),
    ]),
  ),
  turn: Schema.optionalKey(Schema.Finite),
  fire: Schema.optionalKey(Schema.Boolean),
})

export const Tap = Schema.Struct({ at: Ticks, key: Schema.String })

// NOTE: a click on the page between ticks, for HTML such as the shop's rows.
export const Click = Schema.Struct({ at: Ticks, selector: Schema.String })

export const CoopPlan = Schema.Struct({
  seed: Schema.Finite,
  preroll: Ticks,
  difficulty: Schema.optionalKey(Difficulty),
})

// NOTE: slow motion repeats each captured frame of the ticks from `from` up
// to before `to` `repeat` times; a hold shows the frame at `at` for
// `frames` more frames.
export const SlowMotion = Schema.Struct({
  from: Ticks,
  to: Ticks,
  repeat: Positive,
})
export const Hold = Schema.Struct({ at: Ticks, frames: Positive })

// NOTE: a caption shows over the ticks from `from` up to before `to`, in
// the game's pixel font: three or four words at most.
export const Caption = Schema.Struct({
  from: Ticks,
  to: Ticks,
  text: Schema.String,
  place: Schema.optionalKey(Schema.Literals(['Top', 'Middle', 'Bottom'])),
  tone: Schema.optionalKey(
    Schema.Literals(['Plain', 'Prompt', 'Title', 'Victory', 'Defeat', 'Fresh']),
  ),
})
export type Caption = typeof Caption.Type

export const Shot = Schema.Struct({
  name: Schema.String,
  scene: Schema.String,
  ticks: Positive,
  // NOTE: ticks per captured frame: 1 is 60 frames a second.
  step: Schema.optionalKey(Positive),
  hideHud: Schema.optionalKey(Schema.Boolean),
  segments: Schema.optionalKey(Schema.Array(Segment)),
  taps: Schema.optionalKey(Schema.Array(Tap)),
  clicks: Schema.optionalKey(Schema.Array(Click)),
  coop: Schema.optionalKey(CoopPlan),
  slowMotion: Schema.optionalKey(Schema.Array(SlowMotion)),
  holds: Schema.optionalKey(Schema.Array(Hold)),
  captions: Schema.optionalKey(Schema.Array(Caption)),
  // NOTE: frames of fade from black at the start and to black at the end;
  // without them shots cut.
  fadeIn: Schema.optionalKey(Ticks),
  fadeOut: Schema.optionalKey(Ticks),
})
export type Shot = typeof Shot.Type

export const Clip = Schema.Struct({
  name: Schema.String,
  format: Format,
  gif: Schema.optionalKey(Schema.Boolean),
  music: Schema.optionalKey(Schema.Boolean),
  shots: Schema.NonEmptyArray(Shot),
})
export type Clip = typeof Clip.Type

export const ShotList = Schema.Struct({ clips: Schema.NonEmptyArray(Clip) })
export type ShotList = typeof ShotList.Type

export const decodeShotList = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ShotList),
)

export const FRAMES_PER_SECOND = 60

// NOTE: what the director in the page plays a shot with, as the JSON its
// `start` takes (the harness decodes it with its own copy of this Schema).
export const DirectorPlan = Schema.Struct({
  segments: Schema.Array(Segment),
  taps: Schema.Array(Tap),
  coop: Schema.optionalKey(CoopPlan),
})

export const encodePlan = Schema.encodeEffect(
  Schema.fromJsonString(DirectorPlan),
)
