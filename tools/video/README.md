# Video

Clips of the game for devlogs and the launch video (`RELEASE_VIDEO.md`), rendered offline from scripted runs, so a new build re-renders every clip with one command:

```sh
bun run video -- tools/video/shots/devlog.json            # every clip
bun run video -- tools/video/shots/devlog.json --only coop-looks
bun run video -- tools/video/shots/devlog.json --frames-only  # no ffmpeg needed
```

It runs through the heavy guard as a CPU job and writes to `tools/video/out/` (gitignored): `<clip>.mp4`, `<clip>.gif` when the clip asks for one, and `<clip>/` with the frames, the soundtrack WAV, and `hashes.txt`. It needs ffmpeg for the MP4 and GIF (`brew install ffmpeg`), and stops with that hint when it is missing, unless `--frames-only`. Playwright comes from `tools/audit` (`cd tools/audit && bun install` once).

## How it works

| Step     | File                                       | What it does                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Director | `tools/audit/harness/director.ts`          | With `director` in the harness query the page never ticks by itself. Each `step(n)` plays n fixed 1/60 s ticks, the shot's script first: keys, the mouse or touch sticks, a co-op room's World stepped with every seat played by a bot           |
| Frames   | `frames.ts`                                | Plays a shot one step at a time and captures each frame at six screen pixels a game pixel: 1920x1080 (16:9, mouse) or 1080x1920 (9:16, upright touch phone, the portrait layout). CSS animations are set to the shot's clock before each capture |
| Sound    | `soundtrack.ts`, `audioPage.ts`            | The sounds and music cues the game asked for, logged by tick, rendered by the game's own audio engine (`src/audio.ts`, `src/music.ts`) around an `OfflineAudioContext` in headless Chrome, into a 48 kHz stereo WAV                              |
| Encode   | `encode.ts`                                | ffmpeg: H.264 MP4 (yuv420p, AAC, fast start) and a half size 30 fps GIF on one palette, both bitexact                                                                                                                                              |

Captions (the game's pixel font, `src/font.ts`) and fades are drawn over the page before each capture, so a frame on disk is the finished frame. Slow motion repeats frames, and a hold repeats one; a repeat is a hard link.

The frames are deterministic: two renders of a shot list give the same files (compare `hashes.txt`). The soundtrack is the same tune and the same sounds on the same frames, but Chrome sums a node's inputs in an order of its own, so a few samples can differ in the last bit between renders, and so can the AAC in the MP4.

## The shot list

A JSON file of clips (see `shotList.ts` for the Schema and `shots/devlog.json` for examples). A clip has a `name`, a `format` (`16:9` or `9:16`), and shots played one after another; `gif: true` adds a GIF and `music: false` drops the music. A shot has:

- `scene`: an audit harness query (`tools/audit/README.md`), with a `seed`.
- `ticks`: how long it plays, and `step`: ticks per captured frame (1 is 60 fps).
- `segments`: from and to a tick, `keys` held, a touch `move` direction, `aim` (`"nearest"` or an offset from the player) bent by `turn` degrees, and `fire`.
- `taps` (a key on a tick) and `clicks` (a CSS selector on a tick, for HTML such as the shop's rows).
- `coop`: `seed`, `preroll` ticks played before the first frame, and `difficulty`, for a room staged with `coop=host` (four seats) or `coop=arena` (three).
- `captions` (three or four words, `place` Top, Middle, or Bottom, a font `tone`), `slowMotion`, `holds`, `fadeIn`, `fadeOut`, and `hideHud`.
