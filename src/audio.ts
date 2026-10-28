import {
  Array,
  Data,
  Effect,
  MutableRef,
  Schema,
  type Scope,
  pipe,
} from 'effect'
import { ManagedResource } from 'foldkit'

import {
  type MusicCue,
  type MusicDeck,
  cueMusic,
  makeMusicDeck,
  runMusicScheduler,
} from './music'
import { generateMany, nextRandom } from './prng'

// SOUND

export const SoundEffect = Schema.Literals([
  'Shot',
  'ShotgunBlast',
  'SmgShot',
  'DryClick',
  'MagOut',
  'MagIn',
  'Swap',
  'ZombieHit',
  'ZombieDeath',
  'RunnerHit',
  'RunnerDeath',
  'TankHit',
  'TankDeath',
  'ExploderHit',
  'ExploderFuse',
  'Boom',
  'Stomp',
  'PlayerHurt',
  'Start',
  'ShopBell',
  'Purchase',
  'PowerUp',
  'Denied',
  'Payday',
  'TurretShot',
  'Thunk',
  'Crack',
  'Crash',
  'Pop',
  'Groan',
  'DinnerBell',
])
export type SoundEffect = typeof SoundEffect.Type

export const Playback = Schema.Literals(['Running', 'Suspended'])
export type Playback = typeof Playback.Type

export const PlayOutcome = Schema.Literals([
  'Played',
  'DroppedAtVoiceLimit',
  'DroppedWhileSuspended',
])
export type PlayOutcome = typeof PlayOutcome.Type

// ENGINE

export type AudioEngine = Readonly<{
  context: AudioContext
  output: GainNode
  noise: AudioBuffer
  activeVoices: MutableRef.MutableRef<number>
  music: MusicDeck
}>

export const AudioEngineResource =
  ManagedResource.tag<AudioEngine>()('AudioEngine')

export class AudioEngineError extends Data.TaggedError('AudioEngineError')<{
  readonly reason: string
}> {}

const MASTER_VOLUME = 0.55
const NOISE_SECONDS = 0.5
const NOISE_SEED = 0x2f6b9d13
const MAX_VOICES = 10
const SILENCE = 0.0001
const STOP_PADDING_SECONDS = 0.02
const RESUME_TIMEOUT = '600 millis'

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const whiteNoise = (sampleCount: number): Float32Array<ArrayBuffer> => {
  const [_nextState, samples] = generateMany(
    NOISE_SEED,
    sampleCount,
    drawState => {
      const { value, nextState } = nextRandom(drawState)
      return [nextState, value * 2 - 1]
    },
  )
  return Float32Array.from(samples)
}

const buildEngine = (): AudioEngine => {
  const context = new AudioContext({ latencyHint: 'interactive' })
  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -14
  compressor.knee.value = 12
  compressor.ratio.value = 4
  compressor.attack.value = 0.002
  compressor.release.value = 0.12
  compressor.connect(context.destination)

  const output = context.createGain()
  output.gain.value = MASTER_VOLUME
  output.connect(compressor)

  const sampleCount = Math.floor(context.sampleRate * NOISE_SECONDS)
  const noise = context.createBuffer(1, sampleCount, context.sampleRate)
  noise.copyToChannel(whiteNoise(sampleCount), 0)

  return {
    context,
    output,
    noise,
    activeVoices: MutableRef.make(0),
    music: makeMusicDeck(context, compressor, noise),
  }
}

export const acquireAudioEngine: Effect.Effect<
  AudioEngine,
  AudioEngineError,
  Scope.Scope
> = pipe(
  Effect.try({
    try: buildEngine,
    catch: error => new AudioEngineError({ reason: describeError(error) }),
  }),
  Effect.tap(engine => Effect.forkScoped(runMusicScheduler(engine.music))),
)

export const releaseAudioEngine = (engine: AudioEngine): Effect.Effect<void> =>
  pipe(
    Effect.tryPromise(() => engine.context.close()),
    Effect.ignore,
  )

const currentPlayback = (engine: AudioEngine): Playback =>
  engine.context.state === 'running' ? 'Running' : 'Suspended'

export const resumeAudio = (
  engine: AudioEngine,
): Effect.Effect<Playback, AudioEngineError> =>
  currentPlayback(engine) === 'Running'
    ? Effect.succeed(currentPlayback(engine))
    : pipe(
        Effect.tryPromise({
          try: () => engine.context.resume(),
          catch: error =>
            new AudioEngineError({ reason: describeError(error) }),
        }),
        Effect.timeoutOption(RESUME_TIMEOUT),
        Effect.map(() => currentPlayback(engine)),
      )

// RECIPES

type PitchPoint = Readonly<{ atSeconds: number; frequency: number }>

type Envelope = Readonly<{
  delaySeconds: number
  peak: number
  attackSeconds: number
  decaySeconds: number
}>

type ToneLayer = Readonly<{
  wave: OscillatorType
  pitch: ReadonlyArray<PitchPoint>
  envelope: Envelope
}>

type NoiseLayer = Readonly<{
  filter: BiquadFilterType
  quality: number
  cutoff: ReadonlyArray<PitchPoint>
  envelope: Envelope
}>

type Recipe = Readonly<{
  variationCents: number
  tones: ReadonlyArray<ToneLayer>
  noises: ReadonlyArray<NoiseLayer>
}>

const envelope = (
  peak: number,
  attackSeconds: number,
  decaySeconds: number,
  delaySeconds = 0,
): Envelope => ({ delaySeconds, peak, attackSeconds, decaySeconds })

const at = (atSeconds: number, frequency: number): PitchPoint => ({
  atSeconds,
  frequency,
})

const ZOMBIE_HIT_RECIPE: Recipe = {
  variationCents: 160,
  tones: [
    {
      wave: 'sine',
      pitch: [at(0, 210), at(0.07, 70)],
      envelope: envelope(0.45, 0.003, 0.08),
    },
  ],
  noises: [
    {
      filter: 'lowpass',
      quality: 4,
      cutoff: [at(0, 1600), at(0.08, 260)],
      envelope: envelope(0.6, 0.002, 0.09),
    },
  ],
}

const ZOMBIE_DEATH_RECIPE: Recipe = {
  variationCents: 220,
  tones: [
    {
      wave: 'triangle',
      pitch: [at(0, 180), at(0.05, 720), at(0.24, 85)],
      envelope: envelope(0.5, 0.008, 0.26),
    },
  ],
  noises: [
    {
      filter: 'bandpass',
      quality: 7,
      cutoff: [at(0, 2800), at(0.2, 240)],
      envelope: envelope(0.55, 0.004, 0.2, 0.02),
    },
  ],
}

const CENTS_PER_OCTAVE = 1200

const shiftPoints = (
  points: ReadonlyArray<PitchPoint>,
  factor: number,
): ReadonlyArray<PitchPoint> =>
  Array.map(points, point => at(point.atSeconds, point.frequency * factor))

const pitched = (recipe: Recipe, cents: number): Recipe => {
  const factor = 2 ** (cents / CENTS_PER_OCTAVE)
  return {
    variationCents: recipe.variationCents,
    tones: Array.map(recipe.tones, tone => ({
      wave: tone.wave,
      pitch: shiftPoints(tone.pitch, factor),
      envelope: tone.envelope,
    })),
    noises: Array.map(recipe.noises, noise => ({
      filter: noise.filter,
      quality: noise.quality,
      cutoff: shiftPoints(noise.cutoff, factor),
      envelope: noise.envelope,
    })),
  }
}

const RECIPES: Readonly<Record<SoundEffect, Recipe>> = {
  Shot: {
    variationCents: 70,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 620), at(0.07, 95)],
        envelope: envelope(0.22, 0.002, 0.08),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 0.9,
        cutoff: [at(0, 2600), at(0.05, 900)],
        envelope: envelope(0.5, 0.001, 0.05),
      },
    ],
  },
  ShotgunBlast: {
    variationCents: 60,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 260), at(0.16, 42)],
        envelope: envelope(0.3, 0.002, 0.18),
      },
      {
        wave: 'sine',
        pitch: [at(0, 120), at(0.2, 38)],
        envelope: envelope(0.55, 0.002, 0.22),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.8,
        cutoff: [at(0, 3800), at(0.22, 260)],
        envelope: envelope(0.85, 0.001, 0.24),
      },
    ],
  },
  SmgShot: {
    variationCents: 90,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 980), at(0.035, 240)],
        envelope: envelope(0.16, 0.001, 0.04),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 0.7,
        cutoff: [at(0, 3400), at(0.03, 1600)],
        envelope: envelope(0.36, 0.001, 0.03),
      },
    ],
  },
  DryClick: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 1900), at(0.012, 1100)],
        envelope: envelope(0.12, 0.001, 0.012),
      },
      {
        wave: 'square',
        pitch: [at(0, 1500), at(0.012, 900)],
        envelope: envelope(0.1, 0.001, 0.012, 0.06),
      },
    ],
    noises: [],
  },
  MagOut: {
    variationCents: 60,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 620), at(0.05, 260)],
        envelope: envelope(0.12, 0.002, 0.06),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 180), at(0.08, 120)],
        envelope: envelope(0.2, 0.002, 0.08, 0.05),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 2400), at(0.06, 1200)],
        envelope: envelope(0.22, 0.002, 0.06),
      },
    ],
  },
  MagIn: {
    variationCents: 60,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 1300), at(0.015, 700)],
        envelope: envelope(0.14, 0.001, 0.02),
      },
      {
        wave: 'square',
        pitch: [at(0, 1700), at(0.015, 900)],
        envelope: envelope(0.16, 0.001, 0.025, 0.07),
      },
      {
        wave: 'sine',
        pitch: [at(0, 160), at(0.06, 90)],
        envelope: envelope(0.3, 0.001, 0.07, 0.07),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 0.8,
        cutoff: [at(0, 3600), at(0.02, 2200)],
        envelope: envelope(0.18, 0.001, 0.02, 0.07),
      },
    ],
  },
  Swap: {
    variationCents: 0,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 420), at(0.03, 380)],
        envelope: envelope(0.22, 0.002, 0.04),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 640), at(0.03, 700)],
        envelope: envelope(0.22, 0.002, 0.05, 0.06),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1,
        cutoff: [at(0, 4200), at(0.02, 2600)],
        envelope: envelope(0.2, 0.001, 0.02, 0.06),
      },
    ],
  },
  ZombieHit: ZOMBIE_HIT_RECIPE,
  ZombieDeath: ZOMBIE_DEATH_RECIPE,
  RunnerHit: pitched(ZOMBIE_HIT_RECIPE, 700),
  RunnerDeath: pitched(ZOMBIE_DEATH_RECIPE, 600),
  TankHit: {
    variationCents: 120,
    tones: [
      ...pitched(ZOMBIE_HIT_RECIPE, -1000).tones,
      {
        wave: 'sine',
        pitch: [at(0, 90), at(0.1, 40)],
        envelope: envelope(0.5, 0.002, 0.11),
      },
    ],
    noises: pitched(ZOMBIE_HIT_RECIPE, -900).noises,
  },
  TankDeath: {
    variationCents: 80,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 140), at(0.08, 190), at(0.5, 45)],
        envelope: envelope(0.32, 0.01, 0.52),
      },
      {
        wave: 'sine',
        pitch: [at(0, 70), at(0.3, 30)],
        envelope: envelope(0.7, 0.004, 0.34, 0.18),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.3, 120)],
        envelope: envelope(0.6, 0.004, 0.3, 0.18),
      },
    ],
  },
  ExploderHit: {
    variationCents: 180,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 420), at(0.06, 160)],
        envelope: envelope(0.35, 0.002, 0.07),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 9,
        cutoff: [at(0, 900), at(0.07, 2400)],
        envelope: envelope(0.5, 0.002, 0.08),
      },
    ],
  },
  ExploderFuse: {
    variationCents: 120,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 520), at(0.14, 1500)],
        envelope: envelope(0.1, 0.004, 0.15),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 2,
        cutoff: [at(0, 2400), at(0.14, 6200)],
        envelope: envelope(0.3, 0.01, 0.14),
      },
    ],
  },
  Boom: {
    variationCents: 90,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 150), at(0.45, 32)],
        envelope: envelope(0.9, 0.003, 0.5),
      },
      {
        wave: 'square',
        pitch: [at(0, 220), at(0.12, 50)],
        envelope: envelope(0.25, 0.002, 0.14),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.7,
        cutoff: [at(0, 5200), at(0.55, 150)],
        envelope: envelope(1, 0.002, 0.6),
      },
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 1800), at(0.2, 500)],
        envelope: envelope(0.45, 0.01, 0.22, 0.04),
      },
    ],
  },
  Stomp: {
    variationCents: 60,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 80), at(0.09, 38)],
        envelope: envelope(0.5, 0.003, 0.1),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 500), at(0.08, 120)],
        envelope: envelope(0.3, 0.002, 0.08),
      },
    ],
  },
  PlayerHurt: {
    variationCents: 50,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 190), at(0.05, 240), at(0.22, 60)],
        envelope: envelope(0.7, 0.006, 0.24),
      },
      {
        wave: 'sine',
        pitch: [at(0, 90), at(0.14, 42)],
        envelope: envelope(0.6, 0.003, 0.16),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 700), at(0.06, 200)],
        envelope: envelope(0.4, 0.002, 0.06),
      },
    ],
  },
  Start: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 330), at(0.06, 330)],
        envelope: envelope(0.14, 0.004, 0.08),
      },
      {
        wave: 'square',
        pitch: [at(0, 440), at(0.06, 440)],
        envelope: envelope(0.14, 0.004, 0.08, 0.09),
      },
      {
        wave: 'square',
        pitch: [at(0, 660), at(0.05, 880)],
        envelope: envelope(0.16, 0.004, 0.18, 0.18),
      },
    ],
    noises: [],
  },
  ShopBell: {
    variationCents: 0,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 1046), at(0.4, 1040)],
        envelope: envelope(0.22, 0.003, 0.42),
      },
      {
        wave: 'sine',
        pitch: [at(0, 1568), at(0.4, 1560)],
        envelope: envelope(0.16, 0.003, 0.46, 0.1),
      },
    ],
    noises: [],
  },
  Purchase: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 1318), at(0.05, 1318)],
        envelope: envelope(0.12, 0.002, 0.06, 0.07),
      },
      {
        wave: 'square',
        pitch: [at(0, 1760), at(0.2, 1760)],
        envelope: envelope(0.14, 0.002, 0.26, 0.13),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 2400), at(0.06, 1400)],
        envelope: envelope(0.5, 0.001, 0.06),
      },
      {
        filter: 'highpass',
        quality: 3,
        cutoff: [at(0, 7000), at(0.24, 5200)],
        envelope: envelope(0.18, 0.002, 0.24, 0.13),
      },
    ],
  },
  PowerUp: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 523), at(0.18, 523)],
        envelope: envelope(0.1, 0.002, 0.06, 0.12),
      },
      {
        wave: 'square',
        pitch: [at(0, 659), at(0.24, 659)],
        envelope: envelope(0.1, 0.002, 0.06, 0.18),
      },
      {
        wave: 'square',
        pitch: [at(0, 784), at(0.3, 784)],
        envelope: envelope(0.1, 0.002, 0.06, 0.24),
      },
      {
        wave: 'triangle',
        pitch: [at(0.3, 1046), at(0.6, 1568)],
        envelope: envelope(0.14, 0.004, 0.3, 0.3),
      },
    ],
    noises: [],
  },
  Denied: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 180), at(0.16, 140)],
        envelope: envelope(0.16, 0.004, 0.16),
      },
    ],
    noises: [],
  },
  Payday: {
    variationCents: 0,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 988), at(0.05, 988)],
        envelope: envelope(0.12, 0.002, 0.06),
      },
      {
        wave: 'square',
        pitch: [at(0, 1318), at(0.05, 1318)],
        envelope: envelope(0.12, 0.002, 0.06, 0.07),
      },
      {
        wave: 'square',
        pitch: [at(0, 1976), at(0.2, 1976)],
        envelope: envelope(0.13, 0.002, 0.24, 0.14),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 3,
        cutoff: [at(0, 6800), at(0.3, 5000)],
        envelope: envelope(0.16, 0.002, 0.3, 0.14),
      },
    ],
  },
  TurretShot: {
    variationCents: 140,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 900), at(0.05, 420)],
        envelope: envelope(0.1, 0.001, 0.05),
      },
      {
        wave: 'sine',
        pitch: [at(0, 520), at(0.04, 260)],
        envelope: envelope(0.22, 0.001, 0.05),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 3,
        cutoff: [at(0, 3000), at(0.04, 1500)],
        envelope: envelope(0.18, 0.001, 0.03),
      },
    ],
  },
  Thunk: {
    variationCents: 40,
    tones: [
      {
        wave: 'sine',
        pitch: [at(0, 170), at(0.12, 55)],
        envelope: envelope(0.7, 0.002, 0.14),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 320), at(0.05, 140)],
        envelope: envelope(0.25, 0.001, 0.06),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 1.5,
        cutoff: [at(0, 1400), at(0.1, 200)],
        envelope: envelope(0.5, 0.001, 0.1),
      },
    ],
  },
  Crack: {
    variationCents: 160,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 240), at(0.06, 110)],
        envelope: envelope(0.16, 0.001, 0.07),
      },
    ],
    noises: [
      {
        filter: 'highpass',
        quality: 1.2,
        cutoff: [at(0, 2600), at(0.08, 900)],
        envelope: envelope(0.7, 0.001, 0.08),
      },
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 700), at(0.1, 300)],
        envelope: envelope(0.4, 0.002, 0.1, 0.03),
      },
    ],
  },
  Crash: {
    variationCents: 90,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 180), at(0.3, 50)],
        envelope: envelope(0.25, 0.003, 0.32),
      },
      {
        wave: 'sine',
        pitch: [at(0, 110), at(0.25, 40)],
        envelope: envelope(0.6, 0.002, 0.28),
      },
    ],
    noises: [
      {
        filter: 'lowpass',
        quality: 0.8,
        cutoff: [at(0, 4200), at(0.4, 300)],
        envelope: envelope(0.9, 0.002, 0.42),
      },
      {
        filter: 'bandpass',
        quality: 4,
        cutoff: [at(0, 1200), at(0.15, 500)],
        envelope: envelope(0.5, 0.004, 0.16, 0.08),
      },
    ],
  },
  Groan: {
    variationCents: 260,
    tones: [
      {
        wave: 'sawtooth',
        pitch: [at(0, 92), at(0.18, 128), at(0.55, 70)],
        envelope: envelope(0.2, 0.06, 0.5),
      },
      {
        wave: 'square',
        pitch: [at(0, 138), at(0.2, 190), at(0.5, 104)],
        envelope: envelope(0.07, 0.08, 0.42),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 6,
        cutoff: [at(0, 380), at(0.25, 620), at(0.55, 300)],
        envelope: envelope(0.28, 0.05, 0.5),
      },
      {
        filter: 'lowpass',
        quality: 1,
        cutoff: [at(0, 900), at(0.1, 250)],
        envelope: envelope(0.3, 0.002, 0.12),
      },
    ],
  },
  DinnerBell: {
    variationCents: 0,
    tones: [
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.12, 1560)],
        envelope: envelope(0.24, 0.002, 0.14),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.12, 1560)],
        envelope: envelope(0.24, 0.002, 0.14, 0.16),
      },
      {
        wave: 'triangle',
        pitch: [at(0, 1568), at(0.3, 1550)],
        envelope: envelope(0.26, 0.002, 0.34, 0.32),
      },
      {
        wave: 'sawtooth',
        pitch: [at(0, 82), at(0.3, 118), at(0.8, 64)],
        envelope: envelope(0.16, 0.1, 0.7, 0.3),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 5,
        cutoff: [at(0, 340), at(0.4, 560), at(0.9, 260)],
        envelope: envelope(0.22, 0.1, 0.7, 0.3),
      },
    ],
  },
  Pop: {
    variationCents: 120,
    tones: [
      {
        wave: 'square',
        pitch: [at(0, 520), at(0.04, 1400), at(0.16, 200)],
        envelope: envelope(0.18, 0.002, 0.18),
      },
      {
        wave: 'sine',
        pitch: [at(0, 140), at(0.2, 45)],
        envelope: envelope(0.6, 0.002, 0.22),
      },
    ],
    noises: [
      {
        filter: 'bandpass',
        quality: 2,
        cutoff: [at(0, 3600), at(0.2, 700)],
        envelope: envelope(0.6, 0.001, 0.2),
      },
    ],
  },
}

// SYNTHESIS

type Chain = Readonly<{
  source: AudioScheduledSourceNode
  nodes: ReadonlyArray<AudioNode>
  stopAt: number
}>

const envelopeEnd = (
  startAt: number,
  { delaySeconds, attackSeconds, decaySeconds }: Envelope,
): number =>
  startAt + delaySeconds + attackSeconds + decaySeconds + STOP_PADDING_SECONDS

const applyEnvelope = (
  gain: AudioParam,
  startAt: number,
  { delaySeconds, peak, attackSeconds, decaySeconds }: Envelope,
): void => {
  const attackStart = startAt + delaySeconds
  gain.setValueAtTime(SILENCE, startAt)
  gain.setValueAtTime(SILENCE, attackStart)
  gain.exponentialRampToValueAtTime(peak, attackStart + attackSeconds)
  gain.exponentialRampToValueAtTime(
    SILENCE,
    attackStart + attackSeconds + decaySeconds,
  )
}

const applyPitch = (
  param: AudioParam,
  startAt: number,
  points: ReadonlyArray<PitchPoint>,
): void => {
  Array.forEach(points, ({ atSeconds, frequency }, index) => {
    if (index === 0) {
      param.setValueAtTime(frequency, startAt + atSeconds)
    } else {
      param.exponentialRampToValueAtTime(frequency, startAt + atSeconds)
    }
  })
}

const toneChain = (
  engine: AudioEngine,
  startAt: number,
  detuneCents: number,
  layer: ToneLayer,
): Chain => {
  const oscillator = engine.context.createOscillator()
  const gain = engine.context.createGain()
  oscillator.type = layer.wave
  oscillator.detune.value = detuneCents
  applyPitch(oscillator.frequency, startAt, layer.pitch)
  applyEnvelope(gain.gain, startAt, layer.envelope)
  oscillator.connect(gain)
  gain.connect(engine.output)
  return {
    source: oscillator,
    nodes: [oscillator, gain],
    stopAt: envelopeEnd(startAt, layer.envelope),
  }
}

const noiseChain = (
  engine: AudioEngine,
  startAt: number,
  detuneCents: number,
  layer: NoiseLayer,
): Chain => {
  const source = engine.context.createBufferSource()
  const filter = engine.context.createBiquadFilter()
  const gain = engine.context.createGain()
  source.buffer = engine.noise
  source.loop = true
  filter.type = layer.filter
  filter.Q.value = layer.quality
  filter.detune.value = detuneCents
  applyPitch(filter.frequency, startAt, layer.cutoff)
  applyEnvelope(gain.gain, startAt, layer.envelope)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(engine.output)
  return {
    source,
    nodes: [source, filter, gain],
    stopAt: envelopeEnd(startAt, layer.envelope),
  }
}

const startVoice = (
  engine: AudioEngine,
  recipe: Recipe,
  variation: number,
): void => {
  const startAt = engine.context.currentTime
  const detuneCents = variation * recipe.variationCents
  const chains = [
    ...Array.map(recipe.tones, layer =>
      toneChain(engine, startAt, detuneCents, layer),
    ),
    ...Array.map(recipe.noises, layer =>
      noiseChain(engine, startAt, detuneCents, layer),
    ),
  ]
  const remainingChains = MutableRef.make(chains.length)
  MutableRef.increment(engine.activeVoices)
  Array.forEach(chains, ({ source, nodes, stopAt }) => {
    source.onended = () => {
      Array.forEach(nodes, node => node.disconnect())
      source.onended = null
      if (MutableRef.decrementAndGet(remainingChains) === 0) {
        MutableRef.decrement(engine.activeVoices)
      }
    }
    source.start(startAt)
    source.stop(stopAt)
  })
}

const isAtVoiceLimit = (engine: AudioEngine): boolean =>
  MutableRef.get(engine.activeVoices) >= MAX_VOICES

export const playSound = (
  engine: AudioEngine,
  sound: SoundEffect,
  variation: number,
): Effect.Effect<PlayOutcome, AudioEngineError> =>
  Effect.suspend((): Effect.Effect<PlayOutcome, AudioEngineError> => {
    if (currentPlayback(engine) === 'Suspended') {
      return Effect.succeed('DroppedWhileSuspended')
    } else if (isAtVoiceLimit(engine)) {
      return Effect.succeed('DroppedAtVoiceLimit')
    } else {
      return Effect.try({
        try: (): PlayOutcome => {
          startVoice(engine, RECIPES[sound], variation)
          return 'Played'
        },
        catch: error => new AudioEngineError({ reason: describeError(error) }),
      })
    }
  })

// MUSIC

export const playMusic = (
  engine: AudioEngine,
  cue: MusicCue,
): Effect.Effect<void, AudioEngineError> =>
  Effect.try({
    try: () => cueMusic(engine.music, cue),
    catch: error => new AudioEngineError({ reason: describeError(error) }),
  })

// VARIATION

const VARIATION_STEPS = 9
const X_MIXER = 73
const Y_MIXER = 151

export const positionVariation = (x: number, y: number): number => {
  const bucket =
    Math.abs(Math.floor(x) * X_MIXER + Math.floor(y) * Y_MIXER) %
    VARIATION_STEPS
  return (bucket / (VARIATION_STEPS - 1)) * 2 - 1
}
