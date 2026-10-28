import { Array, Data, Effect, MutableRef, Schema, pipe } from 'effect'
import { ManagedResource } from 'foldkit'

import { generateMany, nextRandom } from './prng'

// SOUND

export const SoundEffect = Schema.Literals([
  'Shot',
  'ShotgunBlast',
  'SmgShot',
  'DryClick',
  'Swap',
  'ZombieHit',
  'ZombieDeath',
  'PlayerHurt',
  'Start',
  'ShopBell',
  'Purchase',
  'Denied',
  'Payday',
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

  return { context, output, noise, activeVoices: MutableRef.make(0) }
}

export const acquireAudioEngine: Effect.Effect<AudioEngine, AudioEngineError> =
  Effect.try({
    try: buildEngine,
    catch: error => new AudioEngineError({ reason: describeError(error) }),
  })

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
  ZombieHit: {
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
  },
  ZombieDeath: {
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
