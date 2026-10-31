import { Console, Data, Effect } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import { FRAMES_PER_SECOND } from './shotList'

// ASSEMBLY
//
// NOTE: ffmpeg only encodes: the frames are finished (captions and fades
// are drawn in the page) and the soundtrack is mixed. The MP4 is H.264 in
// yuv420p with AAC sound and the index up front, what X takes. The GIF is
// half size at 30 frames a second, scaled by whole pixels, one palette.

class EncodeFailed extends Data.TaggedError('EncodeFailed')<{
  readonly reason: string
}> {}

export const INSTALL_FFMPEG = [
  'ffmpeg is not installed, so the clips cannot be encoded.',
  'Install it, then run the same command again:',
  '  macOS:  brew install ffmpeg',
  '  Linux:  sudo apt install ffmpeg',
  'To render frames and sound without encoding, add --frames-only.',
].join('\n')

export const hasFfmpeg = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* spawner
    .exitCode(
      ChildProcess.make('ffmpeg', ['-version'], {
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    )
    .pipe(
      Effect.map(code => code === 0),
      Effect.orElseSucceed(() => false),
    )
})

const ffmpeg = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const code = yield* spawner
      .exitCode(
        ChildProcess.make(
          'ffmpeg',
          ['-hide_banner', '-loglevel', 'error', ...args],
          {
            stdout: 'inherit',
            stderr: 'inherit',
          },
        ),
      )
      .pipe(
        Effect.mapError(error => new EncodeFailed({ reason: String(error) })),
      )
    if (code !== 0) {
      return yield* new EncodeFailed({ reason: `ffmpeg exited with ${code}` })
    }
  })

// NOTE: bitexact and no metadata, so the same frames and sound encode to
// the same file.
const REPEATABLE = [
  '-fflags',
  '+bitexact',
  '-flags:v',
  '+bitexact',
  '-flags:a',
  '+bitexact',
  '-map_metadata',
  '-1',
]

export const encodeMp4 = (frames: string, wav: string, out: string) =>
  Effect.andThen(
    ffmpeg([
      '-y',
      '-framerate',
      String(FRAMES_PER_SECOND),
      '-i',
      frames,
      '-i',
      wav,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-tune',
      'animation',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      ...REPEATABLE,
      out,
    ]),
    Console.log(`  wrote ${out}`),
  )

export const encodeGif = (frames: string, out: string) =>
  Effect.andThen(
    ffmpeg([
      '-y',
      '-framerate',
      String(FRAMES_PER_SECOND),
      '-i',
      frames,
      '-vf',
      'fps=30,scale=iw/2:ih/2:flags=neighbor,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none',
      '-loop',
      '0',
      ...REPEATABLE,
      out,
    ]),
    Console.log(`  wrote ${out}`),
  )
