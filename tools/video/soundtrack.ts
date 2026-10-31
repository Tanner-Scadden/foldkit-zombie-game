import { Array, Data, Effect, FileSystem, Path, Schema } from 'effect'
import type { Browser } from 'playwright-core'

import { FRAMES_PER_SECOND } from './shotList'
import { type ClipCue, SoundtrackRequestJson, cueAt } from './soundtrackRequest'

// THE SOUNDTRACK
//
// NOTE: renders a clip's sound and music cues with the game's own audio
// engine in headless Chrome (audioPage.ts, bundled here), offline, and
// writes the mix as a 16 bit stereo WAV.

class SoundtrackFailed extends Data.TaggedError('SoundtrackFailed')<{
  readonly reason: string
}> {}

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const BYTES_PER_SAMPLE = 2
const TAIL_FADE_SECONDS = 0.25

// NOTE: what Vite gives a production build, which the bundled game code
// reads.
const PRODUCTION_ENV = '{"DEV":false,"PROD":true,"MODE":"production"}'

const bundleAudioPage = Effect.gen(function* () {
  const path = yield* Path.Path
  const entry = path.join(import.meta.dir, 'audioPage.ts')
  const result = yield* Effect.tryPromise({
    try: () =>
      Bun.build({
        entrypoints: [entry],
        target: 'browser',
        format: 'iife',
        minify: false,
        define: {
          'import.meta.env': PRODUCTION_ENV,
        },
      }),
    catch: error => new SoundtrackFailed({ reason: String(error) }),
  })
  const output = result.outputs[0]
  if (!result.success || output === undefined) {
    return yield* new SoundtrackFailed({
      reason: result.logs.map(log => log.message).join('\n'),
    })
  }
  return yield* Effect.tryPromise({
    try: () => output.text(),
    catch: error => new SoundtrackFailed({ reason: String(error) }),
  })
})

const wavHeader = (dataBytes: number): Uint8Array => {
  const header = new DataView(new ArrayBuffer(44))
  const ascii = (offset: number, text: string) =>
    Array.forEach(text.split(''), (char, index) =>
      header.setUint8(offset + index, char.charCodeAt(0)),
    )
  ascii(0, 'RIFF')
  header.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, CHANNELS, true)
  header.setUint32(24, SAMPLE_RATE, true)
  header.setUint32(28, SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, true)
  header.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true)
  header.setUint16(34, BYTES_PER_SAMPLE * 8, true)
  ascii(36, 'data')
  header.setUint32(40, dataBytes, true)
  return new Uint8Array(header.buffer)
}

// NOTE: the last quarter second fades out, so a clip never ends on a click.
const fadeTail = (pcm: Int16Array): Int16Array => {
  const frames = pcm.length / CHANNELS
  const fadeFrames = Math.min(
    frames,
    Math.round(TAIL_FADE_SECONDS * SAMPLE_RATE),
  )
  const faded = pcm.slice()
  for (let index = 0; index < fadeFrames; index++) {
    const frame = frames - fadeFrames + index
    const gain = 1 - (index + 1) / fadeFrames
    for (let channel = 0; channel < CHANNELS; channel++) {
      const at = frame * CHANNELS + channel
      faded[at] = Math.round((faded[at] ?? 0) * gain)
    }
  }
  return faded
}

export const renderSoundtrack = (
  browser: Browser,
  cues: ReadonlyArray<ClipCue>,
  frames: number,
  outPath: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const script = yield* bundleAudioPage
    const seconds = frames / FRAMES_PER_SECOND
    const request = yield* Schema.encodeEffect(SoundtrackRequestJson)({
      seconds,
      sampleRate: SAMPLE_RATE,
      cues: Array.map(cues, cue => cueAt(cue, FRAMES_PER_SECOND)),
    })
    const base64 = yield* Effect.tryPromise({
      try: async () => {
        const context = await browser.newContext()
        try {
          const page = await context.newPage()
          await page.setContent('<!doctype html><title>soundtrack</title>')
          await page.addScriptTag({ content: script })
          return await page.evaluate(
            json => (window as any).__renderAudio(json) as Promise<string>,
            request,
          )
        } finally {
          await context.close()
        }
      },
      catch: error => new SoundtrackFailed({ reason: String(error) }),
    })
    const bytes = Buffer.from(base64, 'base64')
    const pcm = fadeTail(
      new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2),
    )
    const data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const wav = new Uint8Array(44 + data.byteLength)
    wav.set(wavHeader(data.byteLength), 0)
    wav.set(data, 44)
    yield* fs.writeFile(outPath, wav)
    return seconds
  })
