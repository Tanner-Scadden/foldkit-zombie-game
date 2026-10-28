# Game Design

This document keeps the vision for the game in one place. It separates what is decided from what is only an idea, so a later reader can tell which is which.

## Inspiration

[Zombie Estate 2](https://www.mobygames.com/game/74771/zombie-estate-ii/) is the reason this exists. It was a top-down zombie shooter that a group of brothers played through the night. What made it fun, in the author's words:

- The weapons.
- The upgrades and traps between waves.
- Working out which room to try to survive the next round in.
- The different zombie types.

Those four things are the pillars. Everything else serves them. The art, names, and characters here are original. Only the shape of the fun is borrowed.

## Decided

- **Platform.** One game that works on desktop and on phones, not just with a keyboard.
- **View.** Top-down pixel art on a 320×180 canvas, scaled to fit the screen with crisp pixels.
- **The map.** One scrolling map made of rooms joined by doors. It is not a set of separate screens. The camera follows the player. Doors are the chokepoints that make choosing a room a real decision.
- **Controls.** Twin-stick on every device.
  - Keyboard: WASD or arrow keys move.
  - Mouse: aim at the pointer, hold the button to fire.
  - Touch: the left thumb moves, the right thumb aims, and the player fires while the right thumb is held. Two thumbs at once must work.
- **The loop.** Preparation, then a wave, then preparation again, until the player dies or wins.
- **How the code is organized.** One Foldkit Model. A pure, deterministic `update` driven by animation-frame Messages. Randomness comes from a seeded generator whose state lives in the Model, so the same seed and the same inputs give the same game.

### The first playable

Decided on 2026-10-27. The first playable is a fun one-screen arena that a stranger can open from a link. The scrolling estate comes after it.

- **Audience.** Strangers on the web. The first 30 seconds have to hook someone who knows nothing about the game.
- **Run length.** 5 to 10 minutes when a run goes well.
- **Tone.** Goofy-gory cartoon. Chunky, bright, bouncy sprites, cartoon splatter, and zombies that are funny more than scary.
- **Liveliness.** Every sprite moves. That means walk cycles and idle motion, hit feedback (white flash, knockback, squash and stretch, death animations, gibs), screen juice (shake, muzzle flash, shell casings, hit-stop, damage numbers), and world life (blood decals that stay, dust, particles, shadows).
- **The arena.** One 320×180 room with some cover and three or four doorways that zombies come through. It teaches that doors are chokepoints before the estate exists.
- **Waves.** 8 waves. The last is a Tank-heavy horde, and Victory follows it. This changes the casual target of 15 from "Waves" below for the first playable. 15 waves and an endless mode come later.
- **Preparation.** About 20 seconds, with a visible timer, and the player can skip it.
- **Shop.** A stall in the room. The player walks onto it to open the shop overlay.
- **Weapons.** The player starts with a pistol, buys more in the shop, carries two, and swaps between them.
- **Ammo.** The pistol never runs out. Other guns have limited ammo that costs money.
- **Zombies.** Shambler, Runner, Tank, and Exploder.
- **Traps.** One or two simple kinds, likely a barricade for doorways and a turret.
- **Health.** A few hearts. A hit knocks the player back and gives a short invulnerable blink. Hearts are bought in the shop and rarely dropped.
- **Onboarding.** Wave 1 is the tutorial. Control hints for the current device fade in, and the first zombies are a few slow Shamblers. No walls of text. See "Onboarding" below for the practice gate and the new zombie card.
- **Working title.** Munch Manor. It lives in `GAME_TITLE` in `src/constants.ts`, which builds the title screen logo, the document title, and the page heading. `index.html` repeats it for the first paint, and a Scene test checks the two agree.
- **Sound.** Sound effects with an audio-unlock on the first input, and synthesized chiptune music that follows the run. See "Music" below.

#### Onboarding

Built on 2026-10-28 after a first-time phone player said the right stick was never taught, the tutorial was too easy to dismiss, and new zombies came in unexplained. The logic lives in `src/onboarding.ts`.

- **Hints clear on practice, not on any input.** WASD MOVES clears once the player has walked 24 px of their own movement. MOUSE AIMS, CLICK FIRES clears after 3 shots fired while aiming, with the mouse or the right stick. A tap on the right half fires along the facing without aiming, so it does not count. Neither hint clears before it has been up for 2.5 seconds of play. Other keys, buttons, audio toggles, and mouse moves leave them alone.
- **Touch teaches both thumbs.** The touch hints say DRAG YOUR LEFT THUMB TO MOVE and DRAG YOUR RIGHT THUMB TO AIM AND FIRE. During wave 1, pulsing ghost sticks labelled MOVE and AIM + FIRE sit on each half of the screen until that lesson is learned. A ghost hides while its thumb is down and comes back on release if the lesson is still pending, so the AIM + FIRE ghost stays until the player has really aimed with the right stick and fired.
- **The practice gate.** Wave 1's 6 second countdown does not start until the player has learned to move and to aim and fire. The HUD says TRY THE CONTROLS FIRST, and START WAVE (Enter) skips the gate. R stays reload. A returning player who learned both earlier in the session never sees it.
- **The new zombie card.** When Preparation begins for a wave holding a kind not yet introduced this session, a card shows the kind's walk cycle large, its name, and a two-line pitch. It is drawn on the canvas, with an HTML dialog behind it that carries the name and pitch for screen readers and a GOT IT button. While it is up the whole game is frozen, so the Preparation timer loses nothing. Only GOT IT, Enter, or Space put it away, and only after it has been up 0.7 seconds, so a fire key or a stray tap cannot skip it. Movement, the mouse, the sticks, and the other buttons do nothing to it. Escape still pauses. Each kind is introduced once per page session, in campaign or endless, and nothing is saved. The door preview tags a door with NEW when it brings a kind that debuts that wave.

| Kind    | Card pitch                                                             |
| ------- | ---------------------------------------------------------------------- |
| Groaner | SLOW, HUNGRY, AND NOT VERY BRIGHT. BACK UP AND KEEP SHOOTING.          |
| Hotfoot | ALL LEGS, NO BRAINS, MADE OF PAPER. AIM EARLY. ONE GOOD SHOT DROPS IT. |
| Gasbag  | POPS WHEN IT DIES. KEEP YOUR DISTANCE, OR POP IT IN A CROWD.           |
| Big Lug | A WALL OF MEAT THAT WALKS. KEEP MOVING AND POUR IT ON.                 |

#### Music

Added on 2026-10-28, after the first playable. The music is original and synthesized with Web Audio: no audio files. It is a goofy, swung haunted-house groove in E minor: a bouncy filtered-square bass, a square-and-sine organ with a shared vibrato, offbeat stabs, a wobbly sine "theremin", and a noise kit. The patterns are data in `src/music.ts`, written one token per eighth note.

- **Moods.** The title and Preparation share Creep, a sneaky 100 BPM shuffle. A wave plays Romp, a driving 138 BPM loop. Wave 8 plays Stampede, a heavier 152 BPM variation with a four-on-the-floor kick and a tritone bass. Victory and Game Over silence the loop.
- **Stingers.** A cleared wave plays a short rising fanfare before Creep returns. Victory plays a major-key fanfare. Game Over plays a descending "wah wah" phrase.
- **Transitions.** Loops change on the next bar line so they stay in time. Stingers start on the next beat so they land with the moment. Pause ducks the music to under a third of its volume, and resuming brings it back at once.
- **Mixing.** Music runs through its own bus into the shared compressor, below the sound effects. Mute (M) silences everything. Music has its own toggle: N, or the MUSIC button under MUTE.
- **Who owns what.** `update` decides only the mood, its level, and any stinger, from the phase and the two settings. It sends a `CueMusic` Command when that cue changes. Music plays only once audio is Ready, music is on, and sound is not muted. The scheduler lives with the audio engine: a fiber forked into the audio resource's scope, so releasing the resource stops it. Every 40 ms it schedules notes up to 0.2 s ahead on the `AudioContext` clock. Music never feeds back into the Model, so the game stays deterministic.

#### Proposed balance

Proposed on 2026-10-28 for step 4. These are starting numbers to play against, not decisions. They live in `src/constants.ts`, `src/weapons.ts`, and `src/shop.ts`.

- **Money.** Each kill pays the bounty of its kind (see the horde below). Clearing wave _n_ pays $20 + $5 × _n_, so wave 1 pays $25 and wave 8 pays $60. A full run earns about $1,490 (see "Balance pass" below).
- **The shop.** It opens from the wave 2 preparation onward. Wave 1 is the tutorial, the player has no money yet, and its preparation is only 6 seconds, so the stall sleeps behind a CLOSED sign until wave 1 is cleared.
- **Slots.** The pistol always stays in the first slot. A bought gun goes in the second slot and replaces whatever is there, along with its ammo. A new gun comes out in the player's hands.

| Item                  | Price | What it does                                                                                                      |
| --------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Pop Pistol            | Start | 1 damage, 150 ms between shots, a 14 round magazine, 0.8 s reload, never runs out                                 |
| Barn Buster (shotgun) | $35   | 5 pellets in a 0.75 radian spray, 1 damage each, short range, 620 ms between shots, 6 shells a load, 1.3 s reload |
| Shell Sack            | $10   | 16 more shells, up to 48. The shotgun comes with 16                                                               |
| Chatterbox (SMG)      | $100  | 1 damage, 70 ms between shots, a slight random spread, a 30 round magazine, 1.2 s reload                          |
| Chatter Drum          | $15   | 120 more rounds, up to 360. The SMG comes with 150                                                                |
| Pickled Heart         | $25   | One heart, never past the maximum of 5                                                                            |

Proposed on 2026-10-28 after the first playtest ("the pistol should have to reload, and a lower rate of fire"). Every gun fires from a magazine. The magazine size and reload time are columns in the weapon table in `src/weapons.ts`, and the upgrade tiers can change them.

- **The pistol** keeps its infinite reserve: a reload always fills its magazine. Retuned on 2026-10-28 with the packs below, because the first reload numbers (250 ms, 8 rounds, 1.1 s) fired only 2.6 shots a second over a fight and the bot lost every run on wave 3. It now fires 6.7 shots a second while the magazine lasts and 4.75 a second sustained, counting the reload: 14 / (14 × 0.15 + 0.8). That is 33% below the pre-reload pistol's 7.1 a second. A magazine lasts 2.1 seconds of held fire, so a reload lands in the middle of every peak and is safe during a relax.
- **The shotgun and the SMG** load their magazines from their limited rounds. The HUD shows the magazine and the loose rounds as `30/90`, and the pistol as `8/∞`. When the last round is gone, the next pull of the trigger clicks, pops EMPTY, and swaps to the pistol, as before.
- **Reloading.** An empty magazine reloads on its own once the gun has cycled after its last shot, with a dry click if the trigger is still held. R reloads early on a keyboard, and a RELOAD button above SWAP does it on touch. Start wave moved to Enter only. A reload plays a mag-out sound, drops a spent magazine (pistol and SMG) that stays on the floor, fills a bar over the player, turns the HUD readout yellow, and ends with a mag-in click. A reload stands still while the game is paused or the shop is open.
- **Swapping cancels a reload.** Each gun keeps its own magazine, so swapping to a loaded pistol is faster than waiting out a reload. Swapping back means reloading again.

Proposed on 2026-10-28 for step 5, the horde. These are starting numbers to play against, not decisions. The kind stats live in `src/zombies.ts` and the wave arc in `src/waves.ts`.

| Kind     | Name    | Speed (px/s) | Health | Bite     | Radius | Bounty | Notes                                                                                  |
| -------- | ------- | ------------ | ------ | -------- | ------ | ------ | -------------------------------------------------------------------------------------- |
| Shambler | Groaner | 16 to 28     | 3      | 1 heart  | 4      | $2     | The baseline                                                                           |
| Runner   | Hotfoot | 44 to 52     | 2      | 1 heart  | 3.5    | $3     | Light, so it is shoved around and knocked back further                                 |
| Tank     | Big Lug | 11 to 14     | 30     | 2 hearts | 6.5    | $20    | Takes 12% of knockback, shoves the crowd aside, shows a health bar once hurt           |
| Exploder | Gasbag  | 20 to 25     | 3      | none     | 4.5    | $3     | Bursts 140 ms after it dies, or 220 ms after it touches the player, which pays nothing |

- **The burst.** Radius 28 px. It costs the player 1 heart unless they are blinking, and deals 6 damage to every zombie it reaches. A Gasbag caught in a burst bursts 150 ms later, so chains ripple instead of going off at once. At most 2 bursts go off in one frame and the rest wait their turn.
- **Speed.** Each wave scales every spawn's speed, from ×1 on wave 1 to ×1.49 on wave 8. By wave 8 the fastest Hotfoots outrun the player (72 px/s).
- **Health.** Waves 5 to 8 scale every spawn's health by ×1.12, ×1.22, ×1.32, and ×1.45, rounded per zombie. See "Shop categories and the price ramp".

Rewritten on 2026-10-28 after a playtest ("zombies should come out more in groups, and it is a bit too easy"). Each wave is learn, test, combine, or twist, built from the packs and the sawtooth described under "Packs and pacing" below. Health is the expected total, Groaner 3, Hotfoot 2, Gasbag 3, Big Lug 30.

| Wave | Zombies | Health | Cycles | What is new or special                                                                                                                        |
| ---- | ------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 6       | 18     | 1      | The tutorial. Four slow Groaners from the north door, 3 seconds apart, then the last two as a pair                                            |
| 2    | 31      | 83     | 2      | Groaner squads of 3 from the north and west. After a relax, NEW: Hotfoot, in pairs from the east, with two more Groaner squads                |
| 3    | 48      | 130    | 2      | A Groaner trickle and squads from the sides, then the first pincer: Groaner squads of 4 from opposite doors. After a relax, a Hotfoot rush    |
| 4    | 72      | 202    | 2      | NEW: Gasbag, alone from the west while Groaner squads come from the north and east. A pincer peak, a relax, then Gasbags inside Groaner packs |
| 5    | 60      | 215    | 2      | NEW: Big Lug, alone from the north, with a squad of escorts walking in behind it. A second Big Lug from the south leads the second peak       |
| 6    | 61      | 219    | 2      | The first full sawtooth: a pincer peak with a Big Lug, a relax, then a small horde from every door                                            |
| 7    | 64      | 220    | 3      | A Big Lug from the west timed with a Hotfoot pack from the east, then the same trick mirrored, then a pincer led by a third Big Lug           |
| 8    | 54      | 252    | 3      | The finale. Three rising peaks: a pincer, a pincer with two Big Lugs, then a horde from every door with the last two Big Lugs, then Victory   |

Each wave is a list of groups and a list of holds. A group has a count, a pack size, the gap inside a pack, a door pattern (One, Pincer, or All), the doors it uses, a start time, the gap between volleys, and weights for each kind. The door of every pack, the pincer's order and lag, the timing jitter, and every spawn's kind and offset are drawn from the seeded generator when Preparation begins, so the door preview shows exactly what will come. A kind's first wave uses a group of only that kind, so the "NEW" banner never promises a zombie the roll left out.

#### Packs and pacing

Added on 2026-10-28. Proposed, not decided. The packs live in `src/waves.ts` and the beats, telegraphs, doorway rule, and intensity in `src/pacing.ts`.

- **Packs.** Zombies come in packs, not a drizzle. A volley draws its door once and sends a pack through it, one zombie every 180 ms (a horde: 220 ms). A Squad is one pack from one door. A Pincer is two packs from opposite doors (north and south, or west and east), the second 1.5 to 3 seconds after the first. A Horde is a pack from every door at once. A Trickle is a pack of one.
- **Sawtooth.** A wave runs two or three cycles of Build (a trickle and squads), Peak (a pincer or a horde, 5 to 8 seconds), Fade, and Relax. A hold marks the end of a peak. At a hold the wave clock stops until fewer than 4 zombies are alive and nothing waits at a door, then rests 4.5 to 6 seconds with no spawns. A fade gives up after 20 seconds so a zombie stuck out of reach cannot stall the wave. The last cycle's peak is the wave's biggest. The clock in `Phase.Wave` is this paused spawn clock.
- **Telegraphs.** Every pack warns about 1 second before it enters: its door rattles (two jittering planks and a pair of red eyes in the doorway), a dust puff rises at the threshold, and a synthesized Groan plays. A horde rings the DINNER BELL instead, with a short bell and groan sound and a DINNER BELL! banner for 2.2 seconds.
- **Doorway camping.** A pack that comes due while the player stands within 16 px of its doorway waits at that door until the player steps away. Only its timing changes, never its door or kinds, so the preview stays exact.
- **The alive cap** still holds at 20. A horde peak often reaches it, and the extra zombies wait at their doors.

#### Mercy rules

Added on 2026-10-28. Proposed, not decided. Both are invisible and deterministic. Neither draws from the seeded generator, and neither changes which zombie comes or from which door.

- **Last-heart grace.** A hit that leaves the player on 1 heart blinks for 1.5 s (`LAST_HEART_INVULNERABLE_MS`) instead of 1 s (`PLAYER_INVULNERABLE_MS`).
- **Pacing intensity.** `intensity` in the Model is a number from 0 to 1. It rises by 0.35 for each heart lost and by 0.12 a second for each walking zombie within 24 px, and decays by about 11% a second. While it is at least 0.4 when a relax ends, the relax keeps going, for up to 4 more seconds (`RELAX_EXTEND_MAX_MS`). It never shortens anything and never adds or removes a zombie.

#### Difficulty principles

Added on 2026-10-28 from the research behind the packs. These guide tuning. They are not rules the code enforces.

- **Stay in the flow channel.** Challenge should rise about as fast as the player's skill and gear do. Each wave teaches one thing, tests it, combines it with an earlier thing, or twists it.
- **Sawtooth intensity.** Tension should climb to a peak, then fall to a real rest, several times a wave. During a peak, incoming zombie health a second should briefly reach 1.5 to 2.5 times the player's damage a second. During a relax it should be near zero. Constant pressure is less fun than rising and falling pressure, even at the same average.
- **Telegraph every threat.** A pack that warns before it enters is fair even when it is big. Surprise should come from what the warning means, not from a zombie that appears without one.
- **Invisible mercy.** Small, hidden, deterministic help at the edge of death (a longer blink at the last heart, a longer rest after a beating) makes close calls more common than deaths.
- **No rubber banding.** The game never makes waves easier because the player is losing or harder because they are winning. What comes, and from where, is fixed by the seed when Preparation begins.
- **Measure with the bot.** The targets below are for `tools/balance/simulate.ts`, not for people. Playtest before trusting them.

Proposed on 2026-10-28 for step 6, traps. These are starting numbers to play against, not decisions. The trap table lives in `src/traps.ts`, the chewing rates in `src/zombies.ts`, and the reach and range numbers in `src/constants.ts`.

| Trap      | Name           | Price  | Health | Most at once | What it does                                                                                                         |
| --------- | -------------- | ------ | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Barricade | Plank Pile     | $20    | 30     | 4            | Boards up one doorway. Blocks zombies and the player. The player's shots and the gnome's peas fly through the gaps   |
| Turret    | Grumpy Gnome   | $50    | 16     | 2            | Sits on a floor tile and shoots a pea (1 damage, 520 ms apart) at the nearest walking zombie it can see within 84 px |
| Repair    | Glue and Nails | Varies | -      | -            | Restores every damaged trap. Costs half of each trap's price, scaled by the share of health it is missing            |

- **Buying and placing.** Traps are bought at the stall and go into a trap pack shown in the HUD. The shop refuses a kind once the player owns its most at once, placed or not. During Preparation, T or the PLACE button puts the selected trap down, and G or the NEXT button switches kinds when both are owned. A Plank Pile goes in the doorway the player stands in or next to (within 16 px). A Grumpy Gnome goes on the tile in front of the player, never on a wall, cover, the stall or the tile in front of it, a doorway, another trap, the player, or a zombie. A ghost shows where it would go, green or red, and a refused placement says why on the button and above the player. The first trap bought turns on a hint, PRESS T / TAP PLACE IN A DOORWAY, until the first one is placed.
- **Chewing.** A walking zombie that touches a trap chews it: a Groaner 3 health a second, a Hotfoot 2, a Big Lug 12. A Gasbag that touches a trap fuses as if it had touched the player. A Plank Pile cracks at two thirds and one third of its health, shedding planks, and breaks with a crash. A Grumpy Gnome breaks with a pop.
- **Bursts.** A Gasbag burst deals 15 damage to every trap it reaches.
- **Pathing.** A barricaded doorway stays in the flow field at a toll of 25 extra tiles, and a gnome's tile at 6. A zombie outside a boarded door compares walking around the outside of the room to another door against chewing through, and takes the cheaper. The flow fields are recomputed when the player changes tile or a trap is placed or breaks.
- **Between waves.** Traps stay where they were placed and keep their damage. Broken traps are gone. A new run clears every trap and the trap pack. The wave preview stays exact: spawns are rolled when Preparation begins, and traps change only a zombie's path, never its door.

#### Balance pass

Proposed on 2026-10-28 for step 7. Still proposed, not decided. A headless bot played the game's own `update` many times to find numbers where a decent player usually falls in the second half and a full win takes about 8 minutes. Real players have not tested them yet.

- **The bot.** `bun tools/balance/simulate.ts [runs] [firstSeed]` runs it at 30 frames a second. It keeps away from the nearest zombie once one is within 36 px, otherwise drifts to the middle of the room. It re-aims every 5 frames at the nearest zombie it can see, with up to 0.22 radians of hand shake, and holds the trigger while it has a target. From wave 2 it walks to the stall and shops (see "The bot's shopping" under "Shop categories and the price ramp"), nails its Plank Piles into the door with the most spawns, and sets its Grumpy Gnomes down a little off the middle of the room, where it fights. Then it starts the wave at once, so Preparation costs only the walking. Every run is deterministic for its seed. `NO_GNOME=1` keeps it from buying gnomes, and `TUNE=path/to/tune.ts` edits the tables in place before the runs so an idea can be tried without touching `src`.
- **History.** The step 7 pass (drizzle waves, the pre-reload pistol) had the bot win 11 of 40 runs. After the first reload numbers it won 0 of 20 and died on wave 3. After the packs and the pistol retune, with the old prices and a bot that never bought a gnome, it won 22% (default) and 34% (`SWAP=1`). Those figures are superseded by the measurements below.
- **The metrics.** Besides survival, money, and hearts by kind, the bot reports for each wave the hearts lost, pressure (seconds with 6 or more zombies within 48 px), relax (seconds with none alive), the wave's length, and the most alive at once, plus close calls: the share of wins that fell to 1 heart. It also reports the money it has on arriving at each shop visit and what it buys there.
- **The targets.** The default bot wins 15 to 25% of runs and the `SWAP=1` bot 35 to 45%. Under 3% of runs die in waves 1 and 2, under 10% in 3 and 4, about 25 to 35% in 5 and 6, and the most in 7 and 8, with wave 8 the single biggest. A median win takes 7 to 9 minutes. 30 to 50% of wins are close calls.
- **Measured** on 2026-10-28 after the shop categories, the price ramp, the shopping bot, and the wave 5 to 8 health scales: 200 runs per bot from seed 1, upgrades and gnomes on. "Died" is the share of all runs that died on that wave. The other columns are means over the runs that played the wave.

  | Wave | Died (default) | Died (`SWAP=1`) | Hearts lost (default) | Pressure s | Relax s | Length s | Peak alive |
  | ---- | -------------- | --------------- | --------------------- | ---------- | ------- | -------- | ---------- |
  | 1    | 0%             | 0%              | 0.00                  | 0.0        | 6.3     | 18       | 2.0        |
  | 2    | 0%             | 0%              | 0.04                  | 0.0        | 5.6     | 43       | 7.4        |
  | 3    | 0%             | 0%              | 0.17                  | 0.3        | 6.9     | 50       | 11.0       |
  | 4    | 2%             | 1%              | 0.86                  | 0.7        | 8.3     | 73       | 15.3       |
  | 5    | 6%             | 3%              | 1.32                  | 0.7        | 11.2    | 79       | 14.5       |
  | 6    | 18%            | 10%             | 2.20                  | 1.3        | 10.9    | 68       | 18.0       |
  | 7    | 26%            | 12%             | 2.33                  | 0.9        | 9.4     | 72       | 13.7       |
  | 8    | 28%            | 35%             | 3.52                  | 0.4        | 16.2    | 86       | 17.4       |

  | Bot                    | Wins            | Close calls    | Median run | Median win | Money by the end of wave 8 |
  | ---------------------- | --------------- | -------------- | ---------- | ---------- | -------------------------- |
  | Default                | 43 of 200 (22%) | 12 of 43 (28%) | 7.9 min    | 8.9 min    | $1,485                     |
  | `SWAP=1`               | 81 of 200 (41%) | 20 of 81 (25%) | 8.7 min    | 8.8 min    | $1,487                     |
  | `NO_GNOME=1` (default) | 2 of 200 (1%)   | 1 of 2         | 6.1 min    | 9.4 min    | $1,478                     |

  Both bots end with spare gun tier 2 and pistol tier 1 (about $440 on upgrades) and place a median of 3 gnomes a run, replacing broken ones. For the default bot, Big Lugs cost about 29% of lost hearts, Gasbags 28%, Hotfoots 27%, and Groaners the rest.

- **Against the targets.** Both bots win inside their ranges, deaths in waves 1 to 4 stay under 3%, and wave 8 is the single biggest wall for both. Waves 5 and 6 together take 24% of default runs, at the bottom of the 25 to 35% target. Close calls are 25 to 28% of wins, a little under the 30 to 50% target. A median win takes 8.8 to 8.9 minutes.
- **The gnome carries the balance.** The bot that never buys a gnome wins 1% of runs at these numbers, and with the old prices a bot that bought gnomes won 62% (default) and 68% (`SWAP=1`) instead of 22% and 34%. Two gnomes in the middle of the room nearly double the bot's damage a second for $100. A player who skips traps will find the campaign much harder than these numbers say. If playtests agree, the next lever is a weaker gnome (pea every 800 ms and 12 health took the bot from 74% to 54% at the ramp prices) with gentler wave health scales.
- **Caveats.** The bot never stands in a doorway, plays Preparation in a few seconds, does not dodge Gasbags, and never reacts to a telegraph. Pressure stays low because it backs away from anything within 36 px. A person who does not will feel the peaks far more than these numbers say. Playtest it before trusting any of this.

#### Shop categories and the price ramp

Added on 2026-10-28 after a playtest ("Shop should have categories, and be more of a ramp up. Everything is so expensive."). Proposed, not decided. The categories and prices live in `src/shop.ts`, the trap prices in `src/traps.ts`, and the upgrade tiers in `src/weapons.ts`.

- **Categories.** The shop is four tabs: GUNS (Barn Buster, Chatterbox, and the spare slot rule), SUPPLIES (Pickled Heart, Shell Sack, Chatter Drum), UPGRADES (one row per gun's next tier), and TRAPS (Plank Pile, Grumpy Gnome, Glue and Nails). The tabs are the `@foldkit/ui` Tabs component with automatic activation: Left and Right arrows, Home, and End move between tabs and select them, a click or tap selects one, and focus moves to the chosen tab. Up and Down, Home, and End move between the rows of the open tab, and Enter buys. Tabs are at least 48 px tall (44 px on a short landscape phone).
- **Remembering.** The chosen tab is `shopCategory` in the Model. The shop opens on it at every visit with its first row focused, and a new run starts on GUNS.
- **Affordable at a glance.** Each tab shows a badge with how many of its rows the player can buy now (green, or grey at zero), and the tab's accessible name says it ("Traps, 1 you can buy"). The header shows the balance and "2 things you can buy now". Prices are green when the row can be bought, and grey with a red reason ("Need $63 more") when not.
- **Phones.** On a screen under 500 px tall, the panel widens to 760 px, the balance moves beside the title, the greeting hides, and the rows of a tab sit side by side, so every tab fits without scrolling on a landscape phone.

The ramp gives the first visit a real choice, makes mid-game items attainable, and keeps the top tiers as goals for waves 6 to 8. Wave 1 pays $37 (six Groaners and the $25 clear bonus), so the first visit buys a gun.

| Item              | Old price        | New price        | Category |
| ----------------- | ---------------- | ---------------- | -------- |
| Barn Buster       | $75              | $35              | Guns     |
| Chatterbox        | $120             | $100             | Guns     |
| Pickled Heart     | $25              | $25              | Supplies |
| Shell Sack        | $15              | $10              | Supplies |
| Chatter Drum      | $20              | $15              | Supplies |
| Plank Pile        | $30              | $20              | Traps    |
| Grumpy Gnome      | $70              | $50              | Traps    |
| Barn Buster tiers | $110, $220, $380 | $40, $140, $320  | Upgrades |
| Chatterbox tiers  | $150, $280, $450 | $60, $180, $400  | Upgrades |
| Pop Pistol tiers  | $300, $500, $750 | $200, $500, $750 | Upgrades |

Glue and Nails keeps its formula (half of each trap's price, scaled by the share of health it is missing), so it gets cheaper with the traps. The bounties and the clear bonus are unchanged.

- **Money at each visit.** Measured with the default bot, 200 runs from seed 1: the median money on arriving at the stall, and what the bot bought there (a share over 100% means more than one per visit).

  | Visit         | Money (median) | What it can afford                                    | What the bot bought                               |
  | ------------- | -------------- | ----------------------------------------------------- | ------------------------------------------------- |
  | Before wave 2 | $37            | A gun ($35), a plank, or a heart                      | Barn Buster (all runs). Before the ramp: nothing  |
  | Before wave 3 | $104           | The Chatterbox ($100), or shotgun tier 1 and supplies | Chatterbox (all runs)                             |
  | Before wave 4 | $149           | Ammo, two planks, a gnome                             | Two drums, two planks, a gnome in a third of runs |
  | Before wave 5 | $284           | Chatterbox tier 1 ($60), a gnome, hearts              | Chatterbox tier 1, a heart, a gnome               |
  | Before wave 6 | $383           | Chatterbox tier 2 ($180), a second gnome              | Chatterbox tier 2, gnomes, hearts                 |
  | Before wave 7 | $317           | Pistol tier 1 ($200), repairs, hearts                 | Hearts, a gnome, pistol tier 1 in 60% of runs     |
  | Before wave 8 | $346           | Saving toward Chatterbox tier 3 ($400)                | Hearts, a replacement gnome, repairs              |

  Before the ramp the first visit bought nothing, the spare gun came before wave 3, and the bot carried $420 to $480 unspent into waves 7 and 8. With the ramp a typical run has a spare gun before wave 2, the Chatterbox before wave 3, and two spare gun tiers by wave 6.

- **The pistol line.** Only the first pistol tier got cheaper ($300 to $200). It adds 3 rounds to the magazine and a bigger shove, about 5% more sustained fire. The rate tier stays at $500 and the damage tier at $750, because a cheap pistol damage tier broke the balance before (see "Upgrade tiers").
- **Wave pressure.** Cheaper items and a bot that spends its money made the campaign far easier, so waves 5 to 8 got tougher instead of the shop getting expensive again: every spawn's health is scaled by ×1.12, ×1.22, ×1.32, and ×1.45 on waves 5, 6, 7, and 8 (`hpScale` in `WAVE_PLANS`, rounded per zombie). At ×1.12 only a Big Lug changes (34 health instead of 30). On wave 8 a Groaner has 4, a Hotfoot 3, and a Big Lug 44. The scaling is invisible: the campaign shows no BEEFIER banner.
- **The bot's shopping.** It buys a heart at 3 hearts or fewer, the Chatterbox when it can afford it (else the Barn Buster), the Chatterbox over a tier 0 Barn Buster, ammo below half, two Plank Piles, a heart at 4 or fewer, Glue and Nails when it costs $25 or less, then spare gun tier 1, one gnome, the remaining spare gun tiers, pistol tiers once the spare gun is at tier 2, and a second gnome. It keeps $30 back after an upgrade or a gnome.
- **Tuning log.** 200 runs unless noted. The first two lines use the old prices.

  | Try | Change                                                               | Default | `SWAP=1` |
  | --- | -------------------------------------------------------------------- | ------- | -------- |
  | 0   | Old bot, old prices (the baseline)                                   | 22%     | 34%      |
  | 1   | Shopping bot with gnomes, old prices                                 | 62%     | 68%      |
  | 2   | Shopping bot, ramp prices                                            | 74%     | 85%      |
  | 3   | Ramp, no gnomes (100 runs)                                           | 29%     |          |
  | 4   | Ramp, wave health ×1.15 to ×1.4 on waves 4 to 8 (100 runs)           | 16%     |          |
  | 5   | Ramp, gnome pea every 800 ms and 12 health (100 runs)                | 54%     |          |
  | 6   | Try 5 with wave health ×1.1 to ×1.3 on waves 4 to 8 (100 runs)       | 12%     | 25%      |
  | 7   | Ramp, health ×1.1, 1.2, 1.3, 1.45 on waves 5 to 8 (100 runs)         | 33%     | 42%      |
  | 8   | Ramp, health ×1.05 to ×1.5 on waves 4 to 8 (100 runs)                | 17%     | 32%      |
  | 9   | Ramp, health ×1.05 to ×1.55, wave 7 lower (200 runs)                 | 13%     | 29%      |
  | 10  | Ramp, health ×1.05, 1.15, 1.22, 1.28, 1.5 on waves 4 to 8 (100 runs) | 19%     | 28%      |
  | 11  | Ramp, health ×1.12, 1.22, 1.32, 1.45 on waves 5 to 8 (kept)          | 22%     | 41%      |
  | 12  | Ramp, health ×1.12, 1.22, 1.3, 1.42                                  | 27%     | 41%      |

  Try 11 is the only one with both bots inside their targets and wave 8 the biggest wall for both. Try 12 shows how sensitive the default bot is: two hundredths less health on waves 7 and 8 is 5 points of wins.

### Upgrade tiers and endless mode

Added on 2026-10-28, after the first playable. Proposed, not decided. Real players have not tested any of it.

#### Upgrade tiers

Each gun has three tiers beyond its base, sold at Rattles' stall between waves. A tier is a row in `UPGRADE_TIERS` in `src/weapons.ts`: a name, a price, and a boost that adds to damage, the time between shots, the magazine, the reload time, spread, pellets, knockback, and the ammo cap. Tiers stack, and firing reads the held gun's stats at its tier through `statsAt`. Adding a tier is a data change. The bullet carries its damage and knockback, so a shot keeps the tier it was fired with.

- **Where tiers live.** The pistol's tier is on the player. The spare gun's tier is on the carried gun, so buying a different spare gun replaces the slot and its upgrades. The shop says so in its rule line and on the gun's row. A new run resets every tier.
- **In the shop.** One row per gun, named for the next tier ("Upgrade to Gossip Box"), with the changes spelled out ("Hits for 2 instead of 1"), the price, and the current tier. A row is disabled with a reason when the gun is not carried, the gun is maxed ("Fully upgraded", price shown as MAX), or the player is short.
- **Feedback.** The gun's highlight changes color per tier (blue, pink, then gold), the muzzle flash throws more sparks per tier, and each HUD slot shows three tier pips. Buying a tier plays the cha-ching and a rising PowerUp arpeggio.

| Gun         | Tier | Name               | Price | What changes                                                             |
| ----------- | ---- | ------------------ | ----- | ------------------------------------------------------------------------ |
| Pop Pistol  | 1    | Shovey Popper      | $200  | Knockback +25, magazine 14 to 17                                         |
| Pop Pistol  | 2    | Golden Grandpopper | $500  | Reload 0.8 to 0.5 s, 150 to 130 ms between shots                         |
| Pop Pistol  | 3    | Double-Dip Popper  | $750  | Damage 1 to 2, knockback +15                                             |
| Barn Buster | 1    | Barn Buster Plus   | $40   | 5 to 7 pellets, spray +0.1 radian                                        |
| Barn Buster | 2    | Silo Splitter      | $140  | 620 to 500 ms between shots, reload 1.3 to 1.0 s, knockback +40, cap +16 |
| Barn Buster | 3    | Hayloft Howitzer   | $320  | Damage 1 to 2 per pellet, cap +16                                        |
| Chatterbox  | 1    | Gossip Box         | $60   | Spread 0.22 to 0.14, knockback +10                                       |
| Chatterbox  | 2    | Rumor Mill         | $180  | 70 to 58 ms between shots, magazine 30 to 40, cap 360 to 480             |
| Chatterbox  | 3    | Blabbermouth 3000  | $400  | Damage 1 to 2                                                            |

The pistol line is expensive on purpose. The campaign is balanced on a knife edge, and the pistol is the gun that never runs dry: in early tuning a $110 tier that doubled pistol damage took the bot from 28% wins to 100%, and even a 10% faster pistol for $100 took it to about 60%. The first pistol tier (a bigger magazine and shove) dropped to $200 with the price ramp, and the bot buys it before wave 7 in most runs. The rate tier stays at $500 and the damage tier at $750, which is for endless.

#### Modes

The run mode is a tagged union, `Campaign` or `Endless`, chosen per run and kept in the Model.

- **Choosing.** The title, Game Over, and Victory screens show CAMPAIGN and ENDLESS buttons, which are ordinary HTML buttons for touch and mouse. On a keyboard, Enter or Space starts a campaign and E starts endless. The canvas prompt names the keys on a keyboard and says PICK A MODE BELOW on touch. A tap or click on the game itself still starts a campaign from the title and Game Over. On Victory it does nothing, so a stray tap cannot throw away Keep going: only the three buttons and their keys act there.
- **Keep going.** Victory also offers KEEP GOING (K), which carries the same run into endless wave 9 with its money, guns, tiers, traps, hearts, score, and stats.
- **Endless waves.** Waves 1 to 8 are the hand-made campaign waves. From wave 9, each wave _n_ (depth _d_ = _n_ - 8) is generated from the seeded generator when Preparation begins, so the door preview stays exact and a seed replays the same waves:
  - Health ×(1 + 0.12 _d_): wave 9 is ×1.12, wave 15 ×1.84, wave 20 ×2.44. `Zombie.maxHp` keeps the Big Lug health bar honest.
  - Three sawtooth cycles, built from the campaign's blocks. Each cycle has 18 seconds of squads from a random pair of doors, then a 7 second peak. The first two peaks are pincers and the last is a horde from every door. A fade and a relax of 6 seconds (200 ms shorter a wave, down to 4) follow each of the first two peaks.
  - 90 + 6 _d_ escorts split 30%, 32%, and 38% across the cycles. Squads hold 4 + ⌊_d_ / 3⌋ zombies, up to 7. Pincer packs are one bigger and horde packs two smaller, at least 3. Gasbag weight is 2 + 0.25 _d_ against 3 Groaners and 2 Hotfoots.
  - 4 + ⌊_d_ / 2⌋ Big Lugs, in pincers just before each peak: a third of them each before the first two peaks and the rest before the horde.
  - Speed ×(1.49 + 0.01 _d_), capped at ×1.6.
- **The alive cap.** At most 20 zombies are in the room at once, in every mode. A spawn that comes due while the room is full waits at its door and walks in when a place frees up. Without the cap the campaign bot peaked at 21 or 22 zombies in a typical run and 29 at worst, so the cap trims the busiest moments of the late campaign waves as well as endless. The balance below was measured with it.
- **What stays the same.** Preparation, the shop, traps, the wave preview, and the music (wave 9 onward plays Stampede) work as in the campaign. Endless waves bring no NEW banner, since every kind has already appeared. A THEY GOT BEEFIER banner with the health bonus shows instead, and the screen-reader preview reads it out. The HUD shows WAVE 12 without "/ 8".
- **Game Over in endless** shows the wave reached and the best wave this session. The best lives in the Model and is not saved anywhere.

#### Balance with upgrades

Superseded on 2026-10-28 by the measurements under "Balance pass" above,, which were taken with upgrades on.

- **Endless.** `MODE=endless`, 200 runs from seed 1, after the price ramp: the median run reaches wave 7, the best wave 16, and the worst wave 4. Of the 44 runs that reach wave 9, about 8 die there, 22 on wave 10, and 10 on wave 11, and the rest go further. Before the ramp the same 44 runs reached wave 9, 32 died there, and none passed wave 10: cheaper top tiers and gnomes carry a run deeper once it survives the campaign.

## Core loop

| Phase         | What the player does                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| `Ready`       | Sees a title and a prompt to start.                                           |
| `Preparation` | Walks the estate, spends money, upgrades weapons, places traps, picks a room. |
| `Wave`        | Survives. Zombies spawn at entrances and path toward the player.              |
| `GameOver`    | Sees the score and starts again. A `Victory` ending follows the final wave.   |

The phase is a tagged union, never a set of booleans.

## The estate

- A grid of tiles holds floors, walls, and doors. Rooms are the spaces between walls.
- Zombies find the player through the doors. A flow field (a distance map computed outward from the player) is the likely approach. It needs measuring on a throttled phone before it is trusted.
- The player decides where to make a stand. A small room with one door is easy to defend and easy to get cornered in. A large room has more space and more entrances.
- Before each wave the game previews the next wave: which zombie types are coming and from which entrances. Without that preview the choice of room would be a guess.

## Preparation phase

- It lasts a limited time, with a visible timer, and can be ended early.
- The player moves around the estate and can reach any room.
- The shop and upgrade screens are ordinary Foldkit views over the canvas, not drawn inside it. That gives large touch targets, normal layout, and keyboard and screen-reader support.
- Money comes from killing zombies.

## Weapons and upgrades

- Weapons are data: fire rate, damage, spread, ammo, reload, and upgrade tiers. Adding a weapon is a data change, not new logic.
- Each weapon upgrades in a few tiers, paid for between waves. Built: three tiers per gun, see "Upgrade tiers" under the first playable.
- Later: stat-boosting hats and characters with different stats.

## Traps

Traps are placed on tiles or in doorways during Preparation. Each kind is a variant of a tagged union that carries its own state, such as armed or cooling down, and is handled by an exhaustive match.

The barricade (Plank Pile) and the turret (Grumpy Gnome) are built. Their numbers are under "Proposed balance" above.

Ideas to try first:

- Barricade: blocks a door and takes damage until it breaks.
- Spikes: damage zombies that walk over them.
- Turret: fires automatically at zombies in range.
- Fire: a damage zone that lasts a short time.

## Zombie types

Zombie types are a table of speed, health, and damage, plus a behavior tag. Each wave draws from a weighted spawn table using the seeded generator, so waves are reproducible.

The first four are built. Their numbers are under "Proposed balance" above.

| Type     | Name shown to players | Idea                                                    |
| -------- | --------------------- | ------------------------------------------------------- |
| Shambler | Groaner               | The baseline. Slow, average health.                     |
| Runner   | Hotfoot               | Fast and fragile. Punishes a room with many doors.      |
| Tank     | Big Lug               | Slow and very tough. Rewards traps and strong guns.     |
| Spitter  | Not built yet         | Attacks from range, so a closed door alone is not safe. |
| Exploder | Gasbag                | Bursts when killed, damaging nearby traps and players.  |

- **Data, not logic.** A kind is a row in a table: speed, health, bite, radius, mass, knockback, bounty, a behavior tag (`Brawler` bites, `Bomber` fuses and bursts), how it dies, its gibs, its sounds, and its footfalls. Its sprites are a row in a second table keyed by the same kind. Both tables are exhaustive records, so a new kind will not compile until it has both rows.
- **Big zombies path differently.** The Big Lug is wider than one tile, so it follows its own flow field that only steps between tiles sharing an open 2×2 block. It goes around the one-tile gaps above the crates and the piano that a Groaner squeezes through.
- **Bursts hit anything.** Burst damage is applied through one function that takes any list of targets: the player, zombies, and traps.

## Waves

- Casual play runs a set number of waves and ends in `Victory`. The target is 15.
- An endless mode keeps going until the player dies. Built: see "Modes" under the first playable.
- Wave contents come from spawn tables that grow harder with the wave number.

## Technical notes

- The world is drawn with Foldkit's `Canvas` module. It has `Rect`, `Circle`, `Path`, `Text`, and `Group`, and no image shape yet. Sprites and tiles are built from rectangles, merged into runs to keep the shape count down. A tile map makes an image shape much more valuable. See [foldkit/foldkit#1831](https://github.com/foldkit/foldkit/issues/1831).
- The canvas repaints the whole scene on every frame. Frame time on a mid-range phone was the main risk. It was measured on 2026-10-28 with a throttled desktop Chrome, not yet on a real phone. See "Performance" under Risks.
- Scene code builds Groups with the `group` helper in `src/sprite.ts`, not `Canvas.Group`. Foldkit's `Canvas.Group` parses every nested shape through Schema on each call, because its `shapes` field is recursive, and that cost more than everything else in the view.
- Frame ticks and pointer moves are kept out of DevTools history so it stays readable.
- Touch input uses a document-level pointer Subscription that tracks each finger by `pointerId`, because the canvas pointer callbacks do not say which pointer fired.
- Game logic is covered by Story tests that replay Messages. Determinism is itself tested.

## Roadmap

The roadmap leads to the first playable. The order puts feel first: juice is built on the arena that exists today, so every later system looks and sounds good the day it lands. Each step ends with something playable.

| Step | Goal                                                                                                                                                                                                                                                                                                                                                                                           | Status                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | **Controls and the bare arena.** Twin-stick on desktop and touch, chasing zombies, shooting, score.                                                                                                                                                                                                                                                                                            | Done                                                                    |
| 2    | **Feel.** Animation frames driven by Model time, walk cycles and idle bob, hit flash, knockback, squash and stretch, death animations and gibs, particles, blood decals that stay, shadows, screen shake, muzzle flash, shell casings, hit-stop, damage numbers. Hearts with knockback and an invulnerable blink. Sound effects with an audio unlock. Measure frame time on a mid-range phone. | Built. Frame time measured with CPU throttling, not yet on a real phone |
| 3    | **The room and the loop.** One screen with cover and three or four doorways, collision, zombies that spawn at doorways and steer around cover. Waves with a preview of which doorways they come from, and a Preparation phase with a 20 second timer that can be skipped.                                                                                                                      | Built                                                                   |
| 4    | **Money and the shop.** Money from kills and a bonus for each wave cleared. A shop stall to walk onto, and an overlay with weapons, ammo, and hearts. Weapons as data: pistol, shotgun, SMG. Carry two and swap. Ammo for everything but the pistol.                                                                                                                                           | Built. Balance not yet playtested                                       |
| 5    | **The horde.** Runner, Tank, and Exploder beside the Shambler, with chain explosions. Spawn tables for each wave from the seeded generator. The 8 wave arc, with a Tank-heavy finale and Victory.                                                                                                                                                                                              | Built. Balance not yet playtested                                       |
| 6    | **Traps.** A barricade for doorways and a turret, placed during Preparation.                                                                                                                                                                                                                                                                                                                   | Built. Balance not yet playtested                                       |
| 7    | **Ready for strangers.** Wave 1 as the tutorial with hints for the current device, a title screen, Game Over and Victory screens with run stats, a balance pass so a run takes 5 to 10 minutes, a phone performance pass, and a public link.                                                                                                                                                   | Built. The real-phone check and the public link wait on the owner       |

After the first playable, roughly in this order:

- The tile-map estate with rooms, doors, a scrolling camera, and flow-field pathing.
- Content depth: more weapons, hats, Spitter, and the 15-wave campaign.
- Upgrade tiers. Done on 2026-10-28: see "Upgrade tiers and endless mode" under the first playable.
- An endless mode. Done on 2026-10-28, with Keep going from Victory: see "Upgrade tiers and endless mode".
- Music. Done on 2026-10-28: see "Music" under the first playable.
- Co-op.

### Risks

- **Phone frame time.** Particles, decals, and animation add shapes on every frame. Decals may still need to be baked if a real phone disagrees with the numbers below, which is a strong reason for [foldkit/foldkit#1831](https://github.com/foldkit/foldkit/issues/1831).
- **Performance.** Measured on 2026-10-28 on an Apple silicon Mac in headless Google Chrome, 1280×720, with the production build. Chrome DevTools Protocol `Emulation.setCPUThrottlingRate` at 4× and 6× stands in for a mid-range phone. It slows JavaScript but not the GPU, so a real phone still needs checking.
  - **Method.** A harness in `tools/audit` (see its README) boots the game's own `init`, `update`, and `view` at a chosen state and records `requestAnimationFrame` deltas in the page for 6 seconds, plus the time spent in `update` and in `view` each frame. Playwright drives real mouse input and an aim bot holds the SMG trigger on the nearest zombie. The scenarios are an idle wave 2 Preparation, a busy wave 6 after 12 seconds of spawning, and the worst case: wave 8 with 30 extra zombies (4 Big Lugs) already in the room, decals at their cap of 220, and particles near their cap of 160 from constant fire, with hearts refilled so the run does not end. A one or two second CPU profile of the worst case at 4× gives the cost breakdown. To rerun it, make a scratch directory, `bun add playwright-core`, add a Vite entry that imports `src/main.ts` and `src/view.ts` and builds the Model for each scenario, symlink the repo's `node_modules` into it so the Foldkit Vite plugin resolves, and point Playwright at `/Applications/Google Chrome.app`. Nothing here is a dependency of the game.
  - **Results.** Headless Chrome paced frames at 120 Hz, so the median delta is 8.3 ms whenever a frame fits. "Long" counts frames over 16.7 ms in the 6 second window.

    | Scenario | Throttle | Median ms | p95 ms | Max ms | Long frames | `update` mean ms | `view` mean ms | Shapes |
    | -------- | -------- | --------- | ------ | ------ | ----------- | ---------------- | -------------- | ------ |
    | Idle     | 1×       | 8.3       | 9.7    | 10.3   | 0           | 0.3              | 0.5            | 515    |
    | Idle     | 4×       | 8.3       | 10.1   | 10.4   | 0           | 0.1              | 0.4            | 515    |
    | Idle     | 6×       | 8.3       | 10.1   | 10.4   | 0           | 0.2              | 0.5            | 515    |
    | Busy     | 1×       | 8.3       | 9.1    | 10.4   | 0           | 0.3              | 0.7            | 1,016  |
    | Busy     | 4×       | 8.3       | 10.1   | 10.3   | 0           | 0.5              | 1.3            | 1,011  |
    | Busy     | 6×       | 8.3       | 10.5   | 25.4   | 6           | 0.8              | 2.0            | 1,043  |
    | Worst    | 1×       | 8.3       | 9.2    | 10.3   | 0           | 0.5              | 0.6            | 1,583  |
    | Worst    | 4×       | 8.3       | 10.1   | 17.8   | 1           | 0.9              | 1.3            | 1,417  |
    | Worst    | 6×       | 8.3       | 16.6   | 33.7   | 22          | 1.4              | 2.1            | 1,432  |

  - **What it costs.** In the worst case at 4×, `update` is about 12% of the main thread, building the scene about 7%, and Foldkit's canvas paint about 12%, with garbage collection under 2% and the rest idle or browser work. Inside `update`, the variant checks of tagged unions (`guards`) run a full Schema check on each call and show up in particle and zombie stepping. In paint, each shape costs a `save` and `restore` and an Effect `Match`. Before the `group` helper, `view` took 4.3 ms a frame in the worst case at 4× and 6.7 ms at 6×.
  - **Verdict.** p95 stays under 16.7 ms at 4× in every scenario. At 6× the worst case sits right at the 60 fps budget and drops some frames. Measure on a real mid-range phone before adding more shapes per frame.
  - **Remeasured for step 7.** The pixel font draws every HUD and overlay string from cached glyph sprites, so text costs more shapes than `Canvas.Text` did (idle went from 515 to 1,055 shapes) but is crisp at every scale. Same method, built harness: worst case p95 9.4 ms at 1×, 10.2 ms at 4×, and 16.7 ms at 6× (23 long frames). `view` means 0.8, 1.9, and 2.9 ms. Busy at 4× has p95 10.1 ms. p95 stays under 16.7 ms at 4×.
  - **Endless and the alive cap.** Measured on 2026-10-28, same method, built harness, at 4×. Two new scenarios: endless wave 15 after 15 seconds of spawning with a tier 3 SMG and full decals, and the worst endless case, where the room is held at the alive cap (as many zombies as the cap, with 40 times their health, full decals, constant fire). Endless wave 15 at 4×: p95 10.2 and 10.3 ms in two runs. The at-cap case was measured at four caps, two runs each at 4×: 36 gave p95 16.7 ms, 30 gave 16.4 and 16.4 ms, 24 gave 10.3 and 14.8 ms, and 20 gave 10.2 and 10.3 ms with 6 long frames, `update` 1.65 ms and `view` 2.3 ms a frame. The cap is 20, which leaves real headroom under the 16.7 ms budget for a phone. At 30 the capped room at 6× dropped frames (p95 about 25 ms); 20 was not measured at 6×. The cap is what bounds the cost: an endless wave spawns 100 to 150 zombies, and without it they would all be in the room at once.
- **Packs and the frame budget.** Measured on 2026-10-28 with `src/perf.scene.test.ts`. The worst case now also has every door rattling and the DINNER BELL! banner up. That built 2,209 shapes, over the old 2,200 budget, so the shapes-built budget is 2,250. Steady paint went from 1,376 to 1,392 operations, inside the unchanged 1,500 budget. The banner has no subtitle to keep it cheap.
- **Determinism and juice.** Animation, particles, and shake live in the Model and use the seeded generator, so they stay reproducible. Sound and music play through Commands and never feed back into the game.

## Open questions

- Do traps break, wear out, or get rebuilt each preparation phase? Proposed for step 6, not yet decided: traps stay where they were placed between waves and keep their damage, the shop sells a repair for all of them priced by the missing health, broken traps are gone, and a new run clears them. See "Proposed balance".
- Does a dropped heart exist, and how rare is it?
- Co-op: local play with gamepads on desktop is one path. Online play is another, and the deterministic `update` is what would make a lockstep approach possible. Phones cannot share a screen, so mobile co-op means online.
- Where do zombies spawn in the estate: only at the map edge, or also inside rooms and corners?
- Is there a second, permanent currency for unlocks, separate from the money spent within a run?

## Reference notes: Zombie Estate 2

These notes come from the [Zombie Estate Wiki](https://zombie-estate.fandom.com/wiki/Zombie_Estate_2), a fan-written wiki. Many of its pages are marked as stubs, its stat tables are mostly empty, and none of it has been checked against the game itself. Treat it as a record of what the game did, not as a specification. Nothing here is decided.

The names, items, prices, and numbers below describe the original game. This game uses its own.

### The original game

Zombie Estate 2 was developed and published by Sad Spaghetti Entertainment. It released on Steam for Windows on January 13, 2017, after an earlier release on Xbox. The official Steam description calls it an online co-op wave-based shooter with 35 characters, over 100 weapons, 30 stat-boosting hats, and 6 levels.

### Levels and the room choice

The [Levels](https://zombie-estate.fandom.com/wiki/Levels) page lists six maps: Estate, Zombie High, The Mall, Skyscraper, Desert Town, and Office. Each map's page has a "Strategies" section, and they agree with each other:

- **Open areas are where to fight.** Hallways, courtyards, outdoor areas, and the center of the mall are the recommended places to make a stand.
- **Small rooms are dangerous.** Cubicles, bathrooms, classrooms, and shops are described as places where a horde overwhelms you.
- **Zombies spawn inside some of the map.** The Office page says zombies spawn in the plank-floor rooms, and the Desert Town page says they spawn in the corners.
- **Layouts differ in kind.** The Estate is a house with a central hallway and several rooms. Skyscraper is a set of buildings joined by narrow wooden bridges, which the page says to cross only when no zombies are near. Zombie High is mostly indoors, with hallways, a gym, and an outdoor area.

### The shop

On the [Shop](https://zombie-estate.fandom.com/wiki/Shop) page, the shop is a character behind a "SHOP" sign somewhere on the map. The player walks there and presses a key to open it. It is locked while a wave is running and opens again when the wave is complete. Each level page says where its shop is, so the shop's position is part of the level's design.

### Modes

From the [Modes](https://zombie-estate.fandom.com/wiki/Modes) page:

| Mode      | Waves     | Continues | Zombies                                      |
| --------- | --------- | --------- | -------------------------------------------- |
| Casual    | Up to 15  | Up to 3   | Less health than in hard mode                |
| Hard      | Up to 15  | Up to 3   | More health than in casual mode              |
| Unlimited | Unlimited | None      | Gain health progressively as the waves go on |

### Currencies

- **Money** ([page](https://zombie-estate.fandom.com/wiki/Money)) is earned by fighting enemies and completing waves. It resets to zero for every game and buys ammo and weapons for that run only.
- **Points** ([page](https://zombie-estate.fandom.com/wiki/Points)), shown as a red "Z", are earned when a game ends. The amount depends on the waves completed and on badges, including damage, tank, heal, and minion badges. They are spent on unlocking new characters and hats, and they persist between games.

### Ammo

The [Ammo](https://zombie-estate.fandom.com/wiki/Ammo) page describes four kinds of ammo, each usable only by certain weapons: assault, shell, heavy, and explosive. Ammo is bought in the shop, and zombies sometimes drop it.

| Ammo      | Quantity per purchase | Cost |
| --------- | --------------------- | ---- |
| Assault   | 40                    | $20  |
| Shell     | 12                    | $20  |
| Heavy     | 100                   | $30  |
| Explosive | 4                     | $30  |

### Zombies, weapons, hats, and controls

- **Zombies.** The [Zombies](https://zombie-estate.fandom.com/wiki/Zombies) page lists 14 enemy types: normal, skeleton, banshee, hazmat, goliath, Dr. Zombie, fire witch, ice goliath, ghost, slime, slop or tar, fat, hamburger or munching, and brain or nerd. The health, speed, damage, and special-ability columns are empty.
- **Weapons.** The [Weapons](https://zombie-estate.fandom.com/wiki/Weapons) page lists about 50 with no stats. They include guns, melee weapons, and deployables such as healing and armor totems, a mini robot, and a turret launcher. Each character has a starting weapon and a super weapon.
- **Hats.** The [Hats](https://zombie-estate.fandom.com/wiki/Hats) page lists 30. Every hat has at least one buff and some also carry a debuff. For example, a Top Hat gives health and critical chance, and a party hat gives health but lowers armor. Hats cost points to unlock.
- **Controls.** The [Controls](https://zombie-estate.fandom.com/wiki/Controls) page lists WASD to move, left click to fire, R to reload, Space to jump or open the shop, F to heal, Q and E to switch weapons, and Left Shift to view stats.

### Traps

The pages above do not mention traps. The closest things are the deployables in the weapons list: totems, a mini robot, and a turret launcher. If the original had traps between waves, the wiki does not document them.

### What this suggests for this game

These are ideas to weigh, not decisions.

- **Put the shop on the map.** Walking to the shop makes the preparation phase a matter of position and routes, and it ties the shop to the room choice.
- **Make small rooms risky.** If zombies can spawn inside rooms and corners, a small room is not automatically safe, and the choice of where to stand becomes a trade between space and exposure.
- **Use two currencies.** Money that resets each run keeps every run fresh, and a permanent currency gives reasons to come back.
- **Give maps different shapes.** One map of connected rooms, one of buildings joined by bridges, and one mostly outdoors would make the same weapons and zombies play differently.
- **Offer three modes.** A fixed number of waves with continues, a harder version, and an endless mode with scaling health is a small set that covers casual and dedicated players.

## Not now

- Procedurally generated estates. The first estate is hand-made.
- Server-side anything.
- Accounts, leaderboards, or saved progress.
