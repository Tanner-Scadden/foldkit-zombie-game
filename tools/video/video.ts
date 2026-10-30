// Renders the clips of a shot list to MP4 (and GIF) in tools/video/out:
//   bun run video -- tools/video/shots/devlog.json [--only <clip>] [--frames-only]
// It runs through the heavy guard as a CPU job. See tools/video/README.md.
import { Array, Console, Data, Effect, FileSystem, Option, Path } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { launch, useHarness } from '../audit/lib'
import { yieldTurn } from '../heavy/turn'
import { INSTALL_FFMPEG, encodeGif, encodeMp4, hasFfmpeg } from './encode'
import { captureShot, frameName, openShotPage, outputSize } from './frames'
import { type Clip, FRAMES_PER_SECOND, decodeShotList } from './shotList'
import { renderSoundtrack } from './soundtrack'
import type { ClipCue } from './soundtrackRequest'

class VideoExit extends Data.TaggedError('VideoExit')<{
  readonly message: string
}> {}

const USAGE =
  'usage: bun run video -- <shot list.json> [--only <clip>] [--frames-only]'

type Options = Readonly<{
  listPath: string
  maybeOnly: Option.Option<string>
  isFramesOnly: boolean
}>

const optionsOf = (args: ReadonlyArray<string>): Option.Option<Options> => {
  const onlyAt = args.indexOf('--only')
  const maybeOnly =
    onlyAt >= 0 ? Option.fromNullishOr(args[onlyAt + 1]) : Option.none()
  const positional = Array.filter(
    args,
    (arg, index) =>
      !arg.startsWith('--') && (onlyAt < 0 || index !== onlyAt + 1),
  )
  return Option.map(Array.head(positional), listPath => ({
    listPath,
    maybeOnly,
    isFramesOnly: args.includes('--frames-only'),
  }))
}

const hashOf = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0, 16)

// NOTE: each frame's hash and the soundtrack's, one a line, in
// hashes.txt beside them, and one hash of the lot, so two renders of the
// same shot list can be compared at a glance and, when they differ, frame
// by frame.
const hashFiles = (paths: ReadonlyArray<string>, listPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const lines = yield* Effect.forEach(paths, file =>
      Effect.map(
        fs.readFile(file),
        bytes => `${hashOf(bytes)} ${path.basename(file)}`,
      ),
    )
    const text = `${lines.join('\n')}\n`
    yield* fs.writeFileString(listPath, text)
    return hashOf(new TextEncoder().encode(text))
  })

const renderClip = (
  browser: Awaited<ReturnType<typeof launch>>,
  clip: Clip,
  outDir: string,
  canEncode: boolean,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const startedMs = Date.now()
    const clipDir = path.join(outDir, clip.name)
    const framesDir = path.join(clipDir, 'frames')
    yield* fs.remove(clipDir, { recursive: true }).pipe(Effect.ignore)
    yield* fs.makeDirectory(framesDir, { recursive: true })
    const size = outputSize(clip.format)
    yield* Console.log(
      `${clip.name}: ${clip.format}, ${size.width}x${size.height}`,
    )
    const page = yield* openShotPage(browser, clip.format)
    let frames = 0
    const cues: Array<ClipCue> = []
    for (const shot of clip.shots) {
      yield* yieldTurn(`video ${clip.name} ${shot.name}`)
      const result = yield* captureShot(
        page,
        shot,
        clip.format,
        framesDir,
        frames,
        line => Console.log(line),
      )
      cues.push(...result.cues)
      frames += result.frameCount
    }
    yield* Effect.promise(() => page.context().close())
    const wav = path.join(clipDir, `${clip.name}.wav`)
    const sounds =
      clip.music === false
        ? Array.filter(cues, ({ cue }) => cue._tag !== 'Music')
        : cues
    const seconds = yield* renderSoundtrack(browser, sounds, frames, wav)
    const hash = yield* hashFiles(
      [
        ...Array.makeBy(frames, frame =>
          path.join(framesDir, frameName(frame)),
        ),
        wav,
      ],
      path.join(clipDir, 'hashes.txt'),
    )
    const outputs: Array<string> = [wav]
    if (canEncode) {
      const pattern = path.join(framesDir, 'frame-%06d.png')
      const mp4 = path.join(outDir, `${clip.name}.mp4`)
      yield* encodeMp4(pattern, wav, mp4)
      outputs.push(mp4)
      if (clip.gif === true) {
        const gif = path.join(outDir, `${clip.name}.gif`)
        yield* encodeGif(pattern, gif)
        outputs.push(gif)
      }
    }
    const sizes = yield* Effect.forEach(outputs, file =>
      Effect.map(
        fs.stat(file),
        info => `${file} (${(Number(info.size) / 1e6).toFixed(1)} MB)`,
      ),
    )
    yield* Console.log(
      [
        `${clip.name}: ${frames} frames, ${seconds.toFixed(2)} s at ${FRAMES_PER_SECOND} fps, rendered in ${((Date.now() - startedMs) / 1000).toFixed(1)} s`,
        `  frames and sound hash ${hash}`,
        ...Array.map(sizes, line => `  ${line}`),
      ].join('\n'),
    )
  })

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const fs = yield* FileSystem.FileSystem
  const options = yield* Effect.fromOption(
    optionsOf(process.argv.slice(2)),
  ).pipe(Effect.mapError(() => new VideoExit({ message: USAGE })))
  const canEncode = !options.isFramesOnly && (yield* hasFfmpeg)
  if (!options.isFramesOnly && !canEncode) {
    return yield* new VideoExit({ message: INSTALL_FFMPEG })
  }
  const list = yield* decodeShotList(yield* fs.readFileString(options.listPath))
  const clips = Option.match(options.maybeOnly, {
    onNone: () => list.clips,
    onSome: only => Array.filter(list.clips, clip => clip.name === only),
  })
  if (clips.length === 0) {
    return yield* new VideoExit({ message: 'no clip by that name' })
  }
  const outDir = path.join(import.meta.dir, 'out')
  yield* Effect.promise(() => useHarness())
  yield* Effect.acquireUseRelease(
    Effect.promise(() => launch()),
    browser =>
      Effect.forEach(
        clips,
        clip => renderClip(browser, clip, outDir, canEncode),
        {
          discard: true,
        },
      ),
    browser => Effect.promise(() => browser.close()),
  )
})

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTag('VideoExit', exit =>
      Effect.andThen(
        Console.error(exit.message),
        Effect.sync(() => process.exit(1)),
      ),
    ),
    Effect.provide(NodeServices.layer),
  ),
)
