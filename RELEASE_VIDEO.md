# Release video

The plan for the launch video. It is shot once co-op works (multiplayer Phase 3, with lobbies and invite codes), because "bring your friends" is the hook. Planned on 2026-10-29. Not decided until the owner signs off on the cut.

## Direction

- **One idea:** a dinner party where you are the dinner. Goofy first, gory second, never mean.
- **Silent first.** X autoplays muted, so the story must read with no sound: big pixel-font words on screen, three or four words at a time. Sound is the bonus: the game's own music and splats.
- **Hook in the first two seconds.** No logo first. Open on chaos: a door splinters, a horde pours in, four players back to back on the rug.
- **Real gameplay only.** Every shot is the game itself, recorded from scripted runs. No mockups.
- **Show, don't explain.** The same rule as the game: no feature lists, no paragraphs.

## The 30 second cut (16:9)

| Time | Shot | On-screen words |
| --- | --- | --- |
| 0 to 2 s | The north door splinters, Groaners pour in, four players on the rug open fire | (none) |
| 2 to 4 s | Title slam over the fireplace, with drips | MUNCH MANOR |
| 4 to 7 s | The pixel couch: four characters on phones, then four device frames joining one room code | BRING 3 FRIENDS |
| 7 to 13 s | Montage, about a second each: shotgun knockback, the Big Lug's armor flying off, a Kaboomer chain, Ankle Biters popping up, the kitchen oven belching fire, a zombie slipping in soup | (none) |
| 13 to 16 s | Boards smash as the kitchen opens | GUN OR ROOM? |
| 16 to 19 s | Rattles' shop, the MINE! stamp, coin spray | (none) |
| 19 to 25 s | Uncle Chunk. A player goes down, a teammate revives with a second left | DON'T GET EATEN |
| 25 to 30 s | End card: logo, the chomping Groaner, the URL | FREE. PHONE OR COMPUTER. |

## Other cuts

- **9:16 vertical (1080x1920)** for TikTok, Reels, and Shorts, shot in the portrait layout, which already exists. The same beats, with tighter framing.
- **A 6 second loop** for a pinned reply: the door bursting and the horde on the rug, looping cleanly.
- **Players together, mocked (owner decision 2026-10-29).** No filmed footage. Two mocked shots instead: a short pixel-art cutscene in the game's style of four player characters (built from the character looks) squished on a couch, each holding a phone, flinching and cheering in sync with the action; and a split screen of four device frames (three phones and a laptop) showing the same room from each player's camera at the same moment, which also proves the co-op is real.

## How it is made

- **Scripted, deterministic runs.** Multiplayer Phase 0 makes the game step deterministic, so a shot is a seed plus recorded inputs that replay exactly, as many times as the edit needs.
- **Rendered offline, frame by frame.** A director mode in the audit harness steps the game one fixed tick at a time and saves each frame at a whole-number scale (crisp pixels at 1080p, no dropped frames, no capture lag). It can hide the HUD, frame the camera, and slow a moment down.
- **Audio from the game itself.** The music is data in `src/music.ts`, so it renders through an `OfflineAudioContext`, and the sound effects are placed at the frames their events fire. No licensed music.
- **Assembled with ffmpeg** from a shot list file, so a new build can re-render the whole cut with one command (`bun run video`).
- **Text overlays** use the game's own pixel font, so they match.

The first slice is built: `tools/video` (see its README) with the director mode in `tools/audit/harness/director.ts`, and four devlog clips in `tools/video/shots/devlog.json`.

## Before the shoot

- **Now, while co-op is built:** short devlog clips to build an audience. The parlour before and after, Rattles' MINE! stamp, and portrait play all make good 10 second posts. These need only the director mode, not co-op.
- **Needed from co-op:** four-player rooms, room codes, revives, and teammate avatars at the edge.
- **Needed from the owner:** the X account to post from and the final URL (a custom domain would read better than the workers.dev address).

## Copy

Short, in the game's voice, with the link and the video. For example: "We made a co-op zombie game you play in your browser. Bring 3 friends. Try not to get eaten." Then the link. The reply carries the 6 second loop and "free, no download, phone or computer".
