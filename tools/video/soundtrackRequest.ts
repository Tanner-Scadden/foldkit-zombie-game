import { Schema } from 'effect'

import { MusicLevel, MusicMood, MusicStinger } from '../../src/music'
import { SoundEffect } from '../../src/soundEffect'

// NOTE: what the tool asks the soundtrack page for (audioPage.ts): the
// sounds and music cues at their second, the length, and the sample rate.

export const SoundCue = Schema.TaggedStruct('Sound', {
  seconds: Schema.Finite,
  sound: SoundEffect,
  variation: Schema.Finite,
})

export const MusicCue = Schema.TaggedStruct('Music', {
  seconds: Schema.Finite,
  mood: MusicMood,
  level: MusicLevel,
  stinger: MusicStinger,
})

export const Cue = Schema.Union([SoundCue, MusicCue])
export type Cue = typeof Cue.Type

export const SoundtrackRequest = Schema.Struct({
  cues: Schema.Array(Cue),
  seconds: Schema.Finite,
  sampleRate: Schema.Int,
})
export type SoundtrackRequest = typeof SoundtrackRequest.Type

export const SoundtrackRequestJson = Schema.fromJsonString(SoundtrackRequest)

// NOTE: the director's log (tools/audit/harness/director.ts): each sound
// and music cue the game asked for, by the tick it asked on.
export const LoggedCue = Schema.Union([
  Schema.TaggedStruct('Sound', {
    tick: Schema.Finite,
    sound: SoundEffect,
    variation: Schema.Finite,
  }),
  Schema.TaggedStruct('Music', {
    tick: Schema.Finite,
    mood: MusicMood,
    level: MusicLevel,
    stinger: MusicStinger,
  }),
])
export type LoggedCue = typeof LoggedCue.Type

export const decodeAudioLog = Schema.decodeUnknownEffect(
  Schema.Array(LoggedCue),
)

// NOTE: a cue at the clip frame it is heard on.
export type ClipCue = Readonly<{ frame: number; cue: LoggedCue }>

export const cueAt = ({ frame, cue }: ClipCue, framesPerSecond: number): Cue =>
  cue._tag === 'Sound'
    ? SoundCue.make({
        seconds: frame / framesPerSecond,
        sound: cue.sound,
        variation: cue.variation,
      })
    : MusicCue.make({
        seconds: frame / framesPerSecond,
        mood: cue.mood,
        level: cue.level,
        stinger: cue.stinger,
      })
