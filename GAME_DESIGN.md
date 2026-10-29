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
  - Keyboard: WASD moves. Each action has exactly one key, read by its physical position so other layouts work. See "One key per action" below. Changed on 2026-10-28 at the owner's request: the arrow keys no longer move.
  - Mouse: aim at the pointer, hold the button to fire.
  - Touch: the left thumb moves, the right thumb aims, and the player fires while the right thumb is held. Two thumbs at once must work.
- **The loop.** Preparation, then a wave, then preparation again, until the player dies or wins.
- **How the code is organized.** One Foldkit Model. A pure, deterministic `update` driven by animation-frame Messages. Randomness comes from a seeded generator whose state lives in the Model, so the same seed and the same inputs give the same game.
- **Making money.** Decided with the owner on 2026-10-29. The game stays free to play.
  - **Cosmetics and a supporter pack.** One-time purchases of looks, hats, gun skins, and a founder's hat. Nothing bought changes how the game plays. Bought on the web through Stripe Checkout confirmed by a Worker, and kept in the player's synced scope so it follows linked devices. Not built yet.
  - **A tip jar.** A small "buy the shopkeeper a coffee" link. Not built yet.
  - **Never.** No ads of any kind, no pay-to-win, and no real-money loot boxes. The mystery box uses in-game money only.

### The first playable

Decided on 2026-10-27. The first playable is a fun one-screen arena that a stranger can open from a link. The scrolling estate comes after it.

Loosened on 2026-10-29, owner-approved: in portrait on a phone the arena is no longer one screen. The camera follows the player through a window narrower than the room. See "Portrait play". Landscape and desktop still show the whole room.

- **Audience.** Strangers on the web. The first 30 seconds have to hook someone who knows nothing about the game.
- **Run length.** 5 to 10 minutes when a run goes well.
- **Tone.** Goofy-gory cartoon. Chunky, bright, bouncy sprites, cartoon splatter, and zombies that are funny more than scary.
- **Liveliness.** Every sprite moves. That means walk cycles and idle motion, hit feedback (white flash, knockback, squash and stretch, death animations, gibs), screen juice (shake, muzzle flash, shell casings, hit-stop, damage numbers), and world life (blood decals that stay, dust, particles, shadows).
- **The arena.** One 320×180 room with some cover and three or four doorways that zombies come through. It teaches that doors are chokepoints before the estate exists.
- **Waves.** 8 waves. The last is a Tank-heavy horde, and Victory follows it. This changes the casual target of 15 from "Waves" below for the first playable. 15 waves and an endless mode come later. Since 2026-10-28 a boss, Uncle Chunk, comes on top of the last wave's horde (see "Wear and the boss").
- **Preparation.** About 20 seconds, with a visible timer, and the player can skip it. Changed on 2026-10-28 after a playtest, for the first break only: the break before wave 2 has no timer and waits for START WAVE (Enter), so a new player can shop and try a trap at their own pace. Every later break, from the one before wave 3, is timed as before. See "Breaks and the mobile HUD".
- **Shop.** A stall in the room. The player walks onto it to open the shop overlay.
- **Weapons.** The player starts with a pistol, buys more in the shop, carries two, and swaps between them.
- **Ammo.** The pistol never runs out. Other guns have limited ammo that costs money.
- **Zombies.** Shambler, Runner, Tank, and Exploder. Changed on 2026-10-28 at the owner's request: the roster grows to six with the Thrower (the Big Leaguer) and the Crawler (the Ankle Biter, working name Gravecrawler). The Ankle Biter comes up through the floor instead of a door, which bends "doors are the chokepoints" on purpose. It stays rare (three on wave 7, two on wave 8, one or more an endless wave), it telegraphs for 1.5 s, it never comes up near the player, and the door preview counts it as FLOOR, so the doors are still where the waves come from. See "New kinds, frenzy, and the Kaboomer pass".
- **Traps.** One or two simple kinds, likely a barricade for doorways and a turret.
  - **The plank cap.** Decided on 2026-10-28, owner-approved: at most two Plank Piles at a time, placed or in the pack. A third is refused with "Two plank piles max".
  - **Plank chewing.** Decided on 2026-10-28, owner-approved: Groaners and Big Lugs in the room walk over and chew a nearby standing Plank Pile instead of chasing the player. Fast kinds and frenzied packs ignore planks. Added on 2026-10-29 at the owner's request: a boarded doorway is no spawn point, so its packs come through the next open door.
- **Difficulty levels.** Decided on 2026-10-28, owner-approved: Easy, Normal (the default), Hard, and Nightmare scale zombie health, speed, and bites, the boss and endless too. The first PLAY or ENDLESS asks once, SETTINGS changes it after, and Nightmare is locked until a Hard campaign win. Since 2026-10-29 the choice and the unlock are kept in the on-device save. See "Difficulty levels and planks as bait".
- **Health.** A few hearts. A hit knocks the player back and gives a short invulnerable blink. Hearts are bought in the shop and rarely dropped.
- **Onboarding.** Wave 1 is the tutorial. Control hints for the current device fade in, and the first zombies are a few slow Shamblers. No walls of text. See "Onboarding" below for the practice gate and the new zombie card.
- **Working title.** Munch Manor. It lives in `GAME_TITLE` in `src/constants.ts`, which builds the title screen logo, the document title, and the page heading. `index.html` repeats it for the first paint, and a Scene test checks the two agree.
- **Sound.** Sound effects with an audio-unlock on the first input, and synthesized chiptune music that follows the run. See "Music" below.

#### Onboarding

Built on 2026-10-28 after a first-time phone player said the right stick was never taught, the tutorial was too easy to dismiss, and new zombies came in unexplained. The logic lives in `src/onboarding.ts`.

- **Hints clear on practice, not on any input.** WASD MOVES clears once the player has walked 24 px of their own movement. MOUSE AIMS, CLICK FIRES clears after 3 shots fired while aiming, with the mouse or the right stick. A tap on the right half fires along the facing without aiming, so it does not count. Neither hint clears before it has been up for 2.5 seconds of play. Other keys, buttons, audio toggles, and mouse moves leave them alone.
- **Touch teaches both thumbs.** The touch hints say DRAG YOUR LEFT THUMB TO MOVE and DRAG YOUR RIGHT THUMB TO AIM AND FIRE. During wave 1, pulsing ghost sticks labelled MOVE and AIM + FIRE sit on each half of the screen until that lesson is learned. A ghost hides while its thumb is down and comes back on release if the lesson is still pending, so the AIM + FIRE ghost stays until the player has really aimed with the right stick and fired.
- **The practice gate.** Wave 1's 6 second countdown does not start until the player has learned to move and to aim and fire. The HUD says TRY THE CONTROLS FIRST, and START WAVE (Enter) skips the gate. R stays reload. A returning player who learned both, this session or on an earlier visit, never sees it.
- **The new zombie card.** Timing superseded on 2026-10-28 by "Breaks and the mobile HUD" (5.5 s, skippable after 1.5 s, with a prompt). Changed on 2026-10-28 after a playtest: the card used to come up at the start of Preparation and freeze the game until GOT IT, which felt like a modal interruption. Now it comes up the moment the wave starts, when the countdown runs out or START WAVE is pressed, for the first kind in that wave not yet introduced this session. It is a band across the middle of the screen that slides in with the kind's walk cycle large, its name, a one-line pitch, and a bar that drains over 2.6 seconds. The world holds still while it is up, so no zombie spawns and the wave clock does not run, and then it slides away on its own and the wave begins. After 0.5 seconds, Enter, a click or tap anywhere, or the GOT IT button skip the rest. Movement keys and held thumbs are kept, so the player moves the moment it goes. Escape pauses it, and it carries on after resuming. Preparation is never held up by it. The HTML behind it is a labelled group with the name and pitch and the GOT IT button, and the screen reader status line reads the name and pitch. Each kind is introduced once, in campaign or endless, and the kinds seen are saved on the device (see "Saved on the device"). During Preparation the door preview tags a door with NEW, colors the new kind's count orange, and the NEW: banner names the kind, so the card is never the first warning.

| Kind        | Card pitch                                             |
| ----------- | ------------------------------------------------------ |
| Groaner     | HE'S SLOW. BACK UP AND KEEP SHOOTING.                  |
| Hotfoot     | ZOOMS RIGHT AT YOU. ONE SHOT DROPS IT.                 |
| Kaboomer    | HE WANTS A HUG. POP HIM FROM FAR AWAY.                 |
| Big Lug     | HE'S WEARING A KITCHEN. KNOCK IT OFF.                  |
| Big Leaguer | HE PITCHES ZOMBIES. GET CLOSE AND HE HIDES BEHIND ONE. |
| Ankle Biter | IT CLAWS UP THROUGH THE FLOOR AND GRABS YOUR ANKLES.   |

- **The door preview.** It is drawn on the overlay canvas, which never shakes, and it holds still: only the orange frame around each door's box pulses. Each box lists the kinds coming through that door with an icon and a count, on a dark backing. The North door's box hangs to the right of the doorway, so the centered banners and hints never cover it.

#### Screen shake

Changed on 2026-10-28 after a playtest said the screen shook too much while shooting. Shake comes from trauma, which moves the screen up to 3 px per unit and decays 2.5 units a second.

| Source                              | Trauma before | Trauma now      |
| ----------------------------------- | ------------- | --------------- |
| Pop Pistol shot                     | 0.25          | 0               |
| Chatterbox shot                     | 0.12          | 0.04            |
| Barn Buster shot                    | 0.65          | 0.3             |
| Groaner kill                        | 0.5           | 0.15            |
| Hotfoot kill                        | 0.4           | 0.12            |
| Kaboomer kill (its blast adds 1)    | 0.3           | 0.15            |
| Big Lug kill                        | 1             | 0.7             |
| Getting hurt, a blast, the Big Burp | 0.9, 1, 0.9   | unchanged       |
| Uncle Chunk: stomp, roar, belch     | new           | 1, 0.6, 0.3     |
| Uncle Chunk: a part off, his kill   | new           | 0.35, 1         |
| Uncle Chunk: rush, wall bonk, ram   | new           | 0.2, 1, 0.8     |
| Uncle Chunk: spit, splat, enrage    | new           | 0.08, 0.15, 0.6 |

Shots can only raise trauma to 0.3 between them, so held fire never shakes more than about 1 px. Hurts, blasts, big kills, and broken traps add on top of that, up to the cap of 1.

#### Music

Added on 2026-10-28, after the first playable. The music is original and synthesized with Web Audio: no audio files. It is a goofy, swung haunted-house groove in E minor: a bouncy filtered-square bass, a square-and-sine organ with a shared vibrato, offbeat stabs, a wobbly sine "theremin", and a noise kit. The patterns are data in `src/music.ts`, written one token per eighth note.

- **Moods.** The title and Preparation share Creep, a sneaky 100 BPM shuffle. A wave plays Romp, a driving 138 BPM loop. Wave 8 plays Stampede, a heavier 152 BPM variation with a four-on-the-floor kick and a tritone bass. Victory and Game Over silence the loop.
- **Stingers.** A cleared wave plays a short rising fanfare before Creep returns. Victory plays a major-key fanfare. Game Over plays a descending "wah wah" phrase.
- **Transitions.** Loops change on the next bar line so they stay in time. Stingers start on the next beat so they land with the moment. Pause ducks the music to under a third of its volume, and resuming brings it back at once.
- **Mixing.** Music runs through its own bus into the shared compressor, below the sound effects. Mute (M) silences everything. Music has its own toggle: N, or the music icon beside the mute icon (on the title, Game Over, Victory, and the pause screen).
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
- **Reloading.** An empty magazine reloads on its own once the gun has cycled after its last shot, with a dry click if the trigger is still held. R reloads early on a keyboard. On touch a tap on the held gun's HUD slot reloads early, and a round reload icon shows in the right thumb's corner while the magazine is below half and not reloading. Start wave moved to Enter only. A reload plays a mag-out sound, drops a spent magazine (pistol and SMG) that stays on the floor, fills a bar over the player, turns the HUD readout yellow, and ends with a mag-in click. A reload stands still while the game is paused or the shop is open.
- **Swapping cancels a reload.** Each gun keeps its own magazine, so swapping to a loaded pistol is faster than waiting out a reload. Swapping back means reloading again.

Proposed on 2026-10-28 for step 5, the horde. These are starting numbers to play against, not decisions. The kind stats live in `src/zombies.ts` and the wave arc in `src/waves.ts`.

| Kind     | Name        | Speed (px/s) | Health | Bite     | Radius | Bounty | Notes                                                                                                                                                                        |
| -------- | ----------- | ------------ | ------ | -------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shambler | Groaner     | 16 to 28     | 3      | 1 heart  | 4      | $2     | The baseline                                                                                                                                                                 |
| Runner   | Hotfoot     | 44 to 52     | 2      | 1 heart  | 3.5    | $3     | Light, so it is shoved around and knocked back further                                                                                                                       |
| Tank     | Big Lug     | 11 to 14     | 30     | 2 hearts | 6.5    | $20    | Takes 12% of knockback, shoves the crowd aside, shows a health bar once hurt                                                                                                 |
| Exploder | Kaboomer    | 14 to 17     | 6      | none     | 4.5    | $4     | Bursts 200 ms after it dies, or 340 ms after it touches the player, which pays nothing. Was 20 to 25, health 3, $3 before 2026-10-29. See "The Kaboomer and the Big Leaguer" |
| Thrower  | Big Leaguer | 13 to 16     | 14     | 1 heart  | 4.5    | $8     | Hangs back, lobs Groaners, and hides behind a held zombie. Was 17 to 21, health 8 before 2026-10-29. See "The Kaboomer and the Big Leaguer"                                  |
| Crawler  | Ankle Biter | 26 to 32     | 2      | none     | 3.5    | $3     | Comes up through the floor and grabs the player's ankles, halving their speed for 1.1 s                                                                                      |

- **The burst.** Radius 28 px. It costs the player 1 heart unless they are blinking, and deals 6 damage to every zombie it reaches. A Kaboomer caught in a burst always lights, whatever his health, and bursts 150 ms later, so chains ripple instead of going off at once. At most 2 bursts go off in one frame and the rest wait their turn.
- **Speed.** Each wave scales every spawn's speed, from ×1 on wave 1 to ×1.45 on wave 8 (×1.39 on wave 7; they were ×1.42 and ×1.49 before 2026-10-29). By wave 8 the fastest Hotfoots outrun the player (72 px/s).
- **Health.** Changed again on 2026-10-28 with the new kinds: waves 5 to 7 now scale by ×1, ×1.03, and ×1.1 (see "New kinds, frenzy, and the Kaboomer pass"). Before that, waves 5 to 8 scaled every spawn's health by ×1.03, ×1.08, ×1.17, and ×1.1, rounded per zombie: a Big Lug has 31, 32, 35, and 33, and a Groaner and a Kaboomer have 4 on wave 7 only. Wave 8 was ×1.21 until the boss's far attacks made him the step up on wave 8 (see "Boss far attacks"). Before the gnome pass they were ×1.12, ×1.22, ×1.32, and ×1.45. See "The gnome pass and spawn variety".

Rewritten on 2026-10-28 after a playtest ("zombies should come out more in groups, and it is a bit too easy"). Each wave is learn, test, combine, or twist, built from the packs and the sawtooth described under "Packs and pacing" below. Health is the expected total, Groaner 3, Hotfoot 2, Kaboomer 3, Big Lug 30.

Rewritten again on 2026-10-28 for the gnome pass ("wave 2 feels meh", "mix up the spawns"). Pack sizes are lists, so a wave mixes singles, pairs, trios, and bigger squads. Most groups draw their doors per run, and stragglers wander in from any door between packs. Health here is before the wave's scale.

| Wave | Zombies | Health | Cycles | What is new or special                                                                                                                                                                                                                                                                                                           |
| ---- | ------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 6       | 18     | 1      | The tutorial. Four slow Groaners from the north door, 3 seconds apart, then the last two as a pair                                                                                                                                                                                                                               |
| 2    | 31      | 83     | 2      | Groaner packs of 1 to 3 from two doors drawn per run, the first within 1.5 s. After a short relax, NEW: Hotfoot, in ones and twos from one drawn door, then mixed Groaner packs. No pack of four, so the first frenzy waits for wave 3                                                                                           |
| 3    | 49      | 130    | 2      | Stragglers and mixed Groaner squads from two drawn doors, then the first pincer, Groaner packs of 3 to 5. After a relax, a Hotfoot rush from one drawn door and more stragglers                                                                                                                                                  |
| 4    | 66      | 220    | 2      | NEW: Kaboomer, alone from one drawn door, while Groaner packs of 2 to 5 come from two others. A pincer peak at 15.5 s, a relax, Kaboomers in mixed squads with stragglers, then a pincer at 38 s. Trimmed on 2026-10-29 from 74 zombies and three long builds                                                                    |
| 5    | 62      | 221    | 2      | NEW: Big Lug, alone from the north, with escorts in packs of 2 to 4 behind it. Mixed squads of 2 to 6, then a second Big Lug from a drawn door leads a pincer                                                                                                                                                                    |
| 6    | 63      | 235    | 2      | NEW: Big Leaguer, two of them 16 s apart from one drawn door, hanging back to throw the Groaners in the squads. Stragglers and squads, a Big Lug and a frenzied pincer peak, a relax, then squads, stragglers, a third Big Lug, and a horde of packs of 3 to 5 from every door                                                   |
| 7    | 71      | 282    | 3      | NEW: Ankle Biter, three up through the floor 9 s apart. A Big Lug with a pincer and a Hotfoot pack from one drawn door, then squads, a Big Leaguer, a stream of eleven stragglers, and a mixed pair rush, then a pincer led by a third Big Lug                                                                                   |
| 8    | 53      | 262    | 3      | The finale. Mixed squads and a pincer, two Ankle Biters and a Big Leaguer, then squads with a pincer of two Big Lugs and a pincer, Hotfoot stragglers, then a third Big Lug, a straggler, and a horde of one volley. Two Big Lugs and two horde packs fewer since 2026-10-29, so less of the crowd shares the room with the boss |

Each wave is a list of groups and a list of holds. A group has a list of pack sizes, the gap inside a pack, a door pattern (One, Pincer, or All), the doors it may use and how many of them to draw for the run, a start time, the gap between volleys, the timing jitter, and weights for each kind. When Preparation begins the seeded generator shuffles each group's pack sizes, draws its doors, and then draws the door of every pack, the pincer's order and lag, the jitter, and every spawn's kind and offset, so the door preview shows exactly what will come and the same seed rolls the same wave. A kind's first wave uses a group of only that kind, from one door, so the "NEW" card never promises a zombie the roll left out. A straggler is a pack of one from any door with up to 1.5 s of jitter, so it wanders in between packs.

#### Packs and pacing

Added on 2026-10-28. Proposed, not decided. The packs live in `src/waves.ts` and the beats, telegraphs, doorway rule, and intensity in `src/pacing.ts`.

- **Packs.** Zombies come in packs, not a drizzle. A volley draws its door once and sends a pack through it, one zombie every 180 ms (a horde: 220 ms). A Squad is one pack from one door. A Pincer is two packs from opposite doors (north and south, or west and east), the second 1.5 to 3 seconds after the first. A Horde is a pack from every door at once. A Trickle is a pack of one.
- **Sawtooth.** A wave runs two or three cycles of Build (stragglers and squads), Peak (a pincer or a horde, 5 to 8 seconds), Fade, and Relax. A hold marks the end of a peak. At a hold the wave clock stops until fewer than 6 zombies are alive and nothing waits at a door, then rests 2 to 3 seconds (4 to 5.5 before 2026-10-29) with no planned packs. A fade gives up after 20 seconds so a zombie stuck out of reach cannot stall the wave. The last cycle's peak is the wave's biggest. The clock in `Phase.Wave` is this paused spawn clock.
- **No dead air.** Added on 2026-10-28 after a playtest ("I honestly thought the game broke for a second"). The room is quiet when no zombie is alive and no warned pack waits at a door (`quietMs` in `Pacing`). After 1.5 s of quiet (`QUIET_HURRY_MS`) the wave clock skips ahead to the next pack's warning, never past a hold, so its door starts rattling at once. A relax ends after 2.5 s of quiet (`RELAX_QUIET_MAX_MS`), or 4 s while the intensity is high (`RESTLESS_QUIET_MAX_MS`); a relax with zombies still alive runs its full length. So an empty, silent room lasts at most 2.5 s, or 4 s right after a beating. Like doorway camping, only timing changes, never a door or a kind, so the preview stays exact. It does make a wave shorter for a player who clears the room fast. Superseded on 2026-10-29 by "Tighter waves" below.
- **Tighter waves.** Added on 2026-10-29 from owner feedback: "The game pace can feel a little bit of a lull. Waves shouldn't be super long or have periods where no zombies are on screen. Wave 4 is a good example."
  - **Half a second of quiet.** After 0.5 s of quiet (`QUIET_HURRY_MS`, was 1.5 s) the clock skips to the next pack's warning, so its door rattles within about half a second of the last zombie dying. An Ankle Biter has no door to rattle, so the skip goes straight to its time instead of a second before it.
  - **A relax trickles.** A relax that turns quiet for 0.5 s (`RELAX_QUIET_MAX_MS`, was 2.5 s; 1 s while the intensity is high, `RESTLESS_QUIET_MAX_MS`, was 4 s) lets in a straggler instead of sitting silent: the soonest lone Groaner, Hotfoot, or Kaboomer of the plan walks in through its own door at once. After two (`RELAX_TRICKLE_MAX`), or when no lone one is left, the next quiet ends the relax. A relax with zombies still alive runs its length.
  - **Shorter breathers.** Relaxes are 2 to 3 s instead of 4 to 5.5 s, the restless extension is at most 2 s instead of 4, and a fade lets go below 6 alive instead of 4, so the next build starts over the last few of the peak. Endless relaxes are 3 s, falling 0.1 s a wave to 2 s.
  - **Length targets.** The bot's median wave in the snapshot pass: wave 1 at most 40 s, waves 2 to 4 at most 75 s, waves 5 to 7 at most 90 s, and wave 8 with the boss at most 120 s (`WAVE_LENGTH_TARGETS` in `tools/balance/targets.ts`; the model's faster lengths are held to the same ceilings). Wave 4 is the one the owner named: still two cycles, but 66 zombies instead of 72, its peaks at 15.5 s and 38 s instead of 18 s and 47 s, and its packs closer together, so it is denser rather than longer.
  - **Dead air is measured.** The snapshot pass reports quiet seconds: no zombie alive, nothing at a door or the boss's door, and spawns still to come. Targets: at most 3 s a wave on the mean run and no stretch over 1.2 s in any run. A Story test plays every wave for several seeds as a player who kills everything the moment it walks in and holds the longest quiet stretch to 1 s.
- **Telegraphs.** Every pack warns about 1 second before it enters: its door rattles (two jittering planks and a pair of red eyes in the doorway), a dust puff rises at the threshold, and a synthesized Groan plays. A horde rings the DINNER BELL instead, with a short bell and groan sound and a DINNER BELL! banner for 2.2 seconds.
- **Doorway camping.** A pack that comes due while the player stands within 16 px of its doorway waits at that door until the player steps away. Only its timing changes, never its door or kinds, so the preview stays exact.
- **The alive cap** still holds at 20. A horde peak often reaches it, and the extra zombies wait at their doors.

#### Mercy rules

Added on 2026-10-28. Proposed, not decided. Both are invisible and deterministic. Neither draws from the seeded generator, and neither changes which zombie comes or from which door.

- **Last-heart grace.** A hit that leaves the player on 1 heart blinks for 1.5 s (`LAST_HEART_INVULNERABLE_MS`) instead of 1 s (`PLAYER_INVULNERABLE_MS`).
- **Pacing intensity.** `intensity` in the Model is a number from 0 to 1. It rises by 0.35 for each heart lost and by 0.12 a second for each walking zombie within 24 px, and decays by about 11% a second. While it is at least 0.4 when a relax ends, the relax keeps going, for up to 2 more seconds (`RELAX_EXTEND_MAX_MS`, 4 before 2026-10-29). It never shortens anything and never adds or removes a zombie.

#### Difficulty principles

Added on 2026-10-28 from the research behind the packs. These guide tuning. They are not rules the code enforces.

- **Stay in the flow channel.** Challenge should rise about as fast as the player's skill and gear do. Each wave teaches one thing, tests it, combines it with an earlier thing, or twists it.
- **Sawtooth intensity.** Tension should climb to a peak, then fall to a real rest, several times a wave. During a peak, incoming zombie health a second should briefly reach 1.5 to 2.5 times the player's damage a second. During a relax it should be near zero. Constant pressure is less fun than rising and falling pressure, even at the same average.
- **Telegraph every threat.** A pack that warns before it enters is fair even when it is big. Surprise should come from what the warning means, not from a zombie that appears without one.
- **Invisible mercy.** Small, hidden, deterministic help at the edge of death (a longer blink at the last heart, a longer rest after a beating) makes close calls more common than deaths.
- **No rubber banding.** The game never makes waves easier because the player is losing or harder because they are winning. What comes, and from where, is fixed by the seed when Preparation begins.
- **Measure with the bot.** The targets below are for `tools/balance/simulate.ts`, not for people. Playtest before trusting them.

#### How balance is checked

Added on 2026-10-29. Three layers, cheapest first, the way studios check balance before anyone plays. The commands are in `AGENTS.md` and `tools/balance/README.md`.

- **The analytical model** (`tools/balance/model.ts`, instant, part of `bun run test`). From the real tables, for every wave and level: the wave's spawns rolled for six seeds and toughened by the level, the money the waves pay, the loadout the bot's shopping list buys with it, that loadout's sustained damage a second (magazines and reloads included), and the wave played as a flow of health through the holds, rests, quiet hurries, and the alive cap. It reports total health, incoming health a second (mean and the busiest 5 seconds), the peak against the player's damage, the wave's length and empty seconds, seconds to kill each kind with each gun, and the campaign's pay against a full kit. Its tests hold the guardrails from these principles: waves 5 to 8 peak at 1.5 to 2.5 times the player's damage, early waves are gentler, health never falls from one wave to the next on any level, the peak never drops more than 0.05 from one wave to the next, no wave runs past its length ceiling, and Easy < Normal < Hard < Nightmare. A guardrail not met yet is a `test.todo` that prints today's value; since 2026-10-29 every one is met. The model plays a quiet relax's trickle too: the soonest lone Groaner, Hotfoot, or Kaboomer comes in at once, two at most. The aim and upkeep numbers in `ASSUMPTIONS` are guesses at the bot, so the model ranks changes and spots gross mistakes; the bot has the last word.
- **Wave snapshots** (`bun run balance -- --wave 4 --runs 200`, seconds). The bot plays one wave many times from a typical run state at its start: money, guns, upgrades, traps, and hearts taken from ten campaign runs that reached it, with the wave rolled again for each run. It reports cleared, hearts lost, mean, median, and slowest tenth length, empty seconds, quiet seconds (empty, nothing at a door, spawns still to come) and the longest quiet stretch in any run, and deaths by kind. Snapshots are played on the fly and cached for the process, never stored, so they always match the current game. A three-run smoke pass of wave 2 runs in `bun run test`.
- **The nightly suite** (`bun run balance:nightly`, minutes). Every campaign bot on every level, endless, portrait passes, and the snapshot pass for every wave, held to the targets in `tools/balance/targets.ts` and to the baseline in `tools/balance/baseline.json`. It writes a Markdown report with what is in target, what drifted past its noise tolerance, and what is out of target. Since 2026-10-29 it also plays Normal default and Easy with `VIEW=portrait`, the bot seeing only the 390x844 phone's window. Portrait is held to the same win targets as landscape, and a portrait pass whose wins sit more than 8 points from its landscape twin's is listed in the summary, so a gap between the layouts shows up the night it opens.

Proposed on 2026-10-28 for step 6, traps. These are starting numbers to play against, not decisions. The trap table lives in `src/traps.ts`, the chewing rates in `src/zombies.ts`, and the reach and range numbers in `src/constants.ts`.

| Trap      | Name           | Price  | Health | Most at once | What it does                                                                                                          |
| --------- | -------------- | ------ | ------ | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Barricade | Plank Pile     | $40    | 30     | 2            | Boards up one doorway. Blocks zombies and the player. The player's shots and the gnome's peas fly through the gaps    |
| Turret    | Grumpy Gnome   | $75    | 10     | 2            | Sits on a floor tile and shoots a pea (1 damage, 1200 ms apart) at the nearest walking zombie it can see within 84 px |
| Repair    | Glue and Nails | Varies | -      | -            | Restores every damaged trap. Costs half of each trap's price, scaled by the share of health it is missing             |

- **Buying and placing.** Traps are bought at the stall and go into a trap pack shown in the HUD. The shop refuses a kind once the player owns its most at once, placed or not. During Preparation, T or the PLACE button (a round trap icon on touch) puts the selected trap down, and G or the NEXT button (a round arrows icon on touch) switches kinds when both are owned. A Plank Pile goes in the doorway the player stands in or next to (within 16 px). A Grumpy Gnome goes on the tile in front of the player, never on a wall, cover, the stall or the tile in front of it, a doorway, another trap, the player, or a zombie. A ghost shows where it would go, green or red, and a refused placement says why on the button and above the player. The first trap bought turns on a hint, PRESS T / TAP PLACE IN A DOORWAY, until the first one is placed.
- **Chewing.** Groaners and Big Lugs in the room also go after a nearby Plank Pile (see "Difficulty levels and planks as bait"). A walking zombie that touches a trap chews it: a Groaner 3 health a second, a Hotfoot 2, a Big Lug 12. A Kaboomer that touches a trap fuses as if it had touched the player. A Plank Pile cracks at two thirds and one third of its health, shedding planks, and breaks with a crash. A Grumpy Gnome breaks with a pop.
- **Bursts.** A Kaboomer burst deals 15 damage to every trap it reaches, so one burst breaks a Grumpy Gnome (10 health).
- **Pathing.** Since 2026-10-29 no pack spawns at a boarded doorway (see "Boarded doors are not spawn points"), so only the boss still starts outside one. A barricaded doorway stays in the flow field at a toll of 25 extra tiles, and a gnome's tile at 6. A zombie outside a boarded door compares walking around the outside of the room to another door against chewing through, and takes the cheaper. The flow fields are recomputed when the player changes tile or a trap is placed or breaks.
- **Between waves.** Traps stay where they were placed and keep their damage. Broken traps are gone. A new run clears every trap and the trap pack. The wave preview stays exact: spawns are rolled when Preparation begins, and traps change only a zombie's path, never its door.

#### Balance pass

Proposed on 2026-10-28 for step 7. Still proposed, not decided. A headless bot played the game's own `update` many times to find numbers where a decent player usually falls in the second half and a full win takes about 8 minutes. Real players have not tested them yet.

- **The bot.** `bun run balance [runs] [firstSeed]` runs `tools/balance/simulate.ts` through the heavy guard. It plays at 30 frames a second. It keeps away from the nearest zombie once one is within 36 px, otherwise drifts to the middle of the room. It re-aims every 5 frames at the nearest zombie it can see, with up to 0.22 radians of hand shake, and holds the trigger while it has a target. From wave 2 it walks to the stall and shops (see "The bot's shopping" under "Shop categories and the price ramp"), nails its Plank Piles into the door with the most spawns, and sets its Grumpy Gnomes down a little off the middle of the room, where it fights. Then it starts the wave at once, so Preparation costs only the walking. Every run is deterministic for its seed. `WORKERS=n` splits the runs over processes, `TIMELINE=1` adds the wave timeline audit (see "The gnome pass and spawn variety"), `NO_GNOME=1` keeps it from buying gnomes, `NO_PLANKS=1` from buying Plank Piles, and `TUNE=path/to/tune.ts` edits the tables in place before the runs so an idea can be tried without touching `src`.
- **History.** The step 7 pass (drizzle waves, the pre-reload pistol) had the bot win 11 of 40 runs. After the first reload numbers it won 0 of 20 and died on wave 3. After the packs and the pistol retune, with the old prices and a bot that never bought a gnome, it won 22% (default) and 34% (`SWAP=1`).
- **The metrics.** Besides survival, money, and hearts by kind, the bot reports for each wave the hearts lost, pressure (seconds with 6 or more zombies within 48 px), relax (seconds with none alive), the wave's length, and the most alive at once, plus close calls: the share of wins that fell to 1 heart. It also reports the money it has on arriving at each shop visit and what it buys there.
- **The targets.** The default bot wins 15 to 25% of runs and the `SWAP=1` bot 35 to 45%. Under 3% of runs die in waves 1 and 2, under 10% in 3 and 4, about 25 to 35% in 5 and 6, and the most in 7 and 8, with wave 8 the single biggest. A median win takes 7 to 9 minutes. 30 to 50% of wins are close calls.
- **Measured** on 2026-10-28 after the shop categories, the price ramp, the shopping bot, and the wave 5 to 8 health scales (200 runs a bot): the default bot won 22%, `SWAP=1` 41%, and `NO_GNOME=1` 1%, with a median win of 8.9 minutes, about $1,485 earned by the end of wave 8, and wave 8 the biggest wall. Two gnomes nearly doubled the bot's damage a second for $100, so the gnome carried the balance until "The gnome pass and spawn variety" below. Superseded by the later passes and by the nightly baseline in `tools/balance/baseline.json`.
- **Caveats.** The bot never stands in a doorway, plays Preparation in a few seconds, does not dodge Kaboomers, and never reacts to a telegraph. Pressure stays low because it backs away from anything within 36 px. A person who does not will feel the peaks far more than these numbers say. Playtest it before trusting any of this.

#### The stall entrance and the coin

Added on 2026-10-28 after a playtest ("The way to enter the shop could be clearer. I tried going to the side of it and got lost." and "The sign we use for money is poor."). Proposed, not decided. The rule lives in `src/shop.ts`, the drawing in `src/stall.ts`, the coin in `src/font.ts`, and the touch buttons in `src/styles.css`.

- **Walking in.** The shop opens when the player comes within 12 px of the stall from any open side: the top, the left, or the right (the wall is behind it). It is measured from the player's middle to the nearest edge of the stall, so corners count too. It never opens mid-wave or in the wave 1 preparation. A player who is at the stall when a wave ends gets the shop as Preparation begins.
- **Stepping away.** After LEAVE SHOP, the shop stays shut until the player is more than 22 px from the stall, so standing still, shuffling, or turning around at the counter does not open it again.
- **Signposts.** While the shop is open and the player is not in it, a gold outline pulses on the floor around the stall's three open sides, a coin and a down arrow bob over the awning, and Rattles waves a bony hand. Within 44 px a prompt says BUMP THE STALL TO SHOP. Mid-wave the stall sleeps behind its CLOSED sign, and within 44 px it says CLOSED DURING WAVES (OPENS AFTER WAVE 1 in the wave 1 preparation). The first-visit hint reads WALK UP TO THE (coin) STALL TO SHOP, or STEER UP on touch.
- **The coin.** Money shows as a chunky gold coin, 7 by 7 pixels with a dark outline, a shine on the top left, a shaded rim, and a stamped bar, drawn before the number. In canvas text the `$` character draws the coin, so the HUD balance, kill and wave bonus popups, the wave cleared banner, the stats panel, and the hint all use it, and its width counts in text layout so centered text stays centered. It stands one pixel above and below the letters. The shop dialog draws the same coin in CSS before each price, each "Need ... more", and the balance.
- **Dollars.** The money is called dollars. Screen readers hear "$70" ("70 dollars") because a hidden `$`sits behind each coin, and the aria labels, the reasons, and this document keep writing`$`. The coin is a picture of a gold dollar coin, so nothing gets renamed and nobody has to learn a new word.
- **Touch buttons.** Superseded on 2026-10-28 by "Breaks and the mobile HUD". `tools/audit/shots31.ts` checks that no button covers a door or the stall.

#### Shop categories and the price ramp

Added on 2026-10-28 after a playtest ("Shop should have categories, and be more of a ramp up. Everything is so expensive."). Proposed, not decided. The categories and prices live in `src/shop.ts`, the trap prices in `src/traps.ts`, and the upgrade tiers in `src/weapons.ts`.

- **Categories.** The shop is three tabs: GUNS (every gun, with its ammo and upgrades, see "Ammo and upgrades under the gun" below), HEALTH (Pickled Heart), and TRAPS (Plank Pile, Grumpy Gnome, Glue and Nails). The tabs are the `@foldkit/ui` Tabs component with automatic activation: Left and Right arrows, Home, and End move between tabs and select them, a click or tap selects one, and focus moves to the chosen tab. Up and Down, Home, and End move between the rows of the open tab, sub-rows included, and Enter buys. Tabs are at least 48 px tall on every screen. Changed on 2026-10-29: a short landscape phone had 44 px tabs.
- **Remembering.** The chosen tab is `shopCategory` in the Model. The shop opens on it at every visit with its first row focused, and a new run starts on GUNS.
- **Affordable at a glance.** Each tab shows a badge with how many of its rows the player can buy now (green, or grey at zero), and the tab's accessible name says it ("Traps, 1 you can buy"). The header shows the balance and "2 things you can buy now". Prices are green when the row can be bought, and grey with a red reason ("Need $63 more") when not.
- **Phones.** On a screen under 500 px tall, the panel widens to 820 px, the balance and LEAVE SHOP move beside the title, the greeting and the tab's rule line hide, the text shrinks a step, and the rows of a tab sit side by side (GUNS always in three columns, one per gun), so every tab fits without scrolling on an 844x390 or 667x375 landscape phone. Checked with `tools/audit/shots34.ts`, which fails when the open shop runs past the edge of an 844x390 phone.

#### Ammo and upgrades under the gun

Added on 2026-10-28 after a playtest ("Ammo should also be a sub section of the gun after you buy it, for fluidness."). Proposed, not decided. The layout lives in `gunShelves` in `src/shop.ts` and `src/shopView.ts`.

- **One card per gun.** GUNS lists the Barn Buster, the Chatterbox, and the Pop Pistol, always in that order so a gun never jumps around. A gun the player does not carry is a single buy row, as before. A gun they carry is a card: its name at its tier ("Barn Buster Plus"), an OWNED tag, the rounds in the magazine and in reserve ("6 loaded, 14 spare"), and tier pips. Under it sit its ammo refill and its next upgrade as sub-rows. The pistol is always a card, with "never runs dry" for its reserve and only an upgrade under it.
- **The ammo sub-row.** It shows the price and what it adds: "Adds 16 shells. You have 20 of 48.", "adds 4 shells and fills it" when it would hit the cap, and when the gun is full it is disabled with "Your Barn Buster is full". A screen reader hears "Shell Sack, ammo for Barn Buster, $10, adds 16 shells".
- **The upgrade sub-row.** As the old UPGRADES row: "Upgrade to Silo Splitter", the changes spelled out, the price, MAX once maxed. A screen reader hears "Silo Splitter, upgrade for Barn Buster Plus, $140".
- **A gun goes by the name on its card.** Changed on 2026-10-28 after review caught a Gossip Box card whose full ammo row said "Your Chatterbox is full". Everything the shop says about a gun the player carries uses its tier name: the card, its sub-rows' labels and reasons, the "Replaces your" note, and the GUNS blurb's "You always keep the" line for an upgraded pistol. A gun they do not carry goes by its plain name ("Needs the Barn Buster"), which is also its tier 0 name.
- **Why UPGRADES went away.** With each gun's upgrade under its card, the UPGRADES tab only held rows for guns the player did not carry, all disabled with "Needs the Barn Buster". Upgrades for a gun you cannot use are noise, and the old tab split one decision (what to do with my gun) across three tabs. Item ids did not change, so the balance bot is untouched.
- **Why HEALTH.** Without the ammo, SUPPLIES held only the Pickled Heart. HEALTH says what is in it, and its badge tells a hurt player at a glance whether a heart is affordable. Folding the heart into GUNS or TRAPS would hide the panic buy under a name that does not say health and make those tabs taller on a phone.
- **Focus.** Buying a gun removes its buy row, so focus moves to the new card's first sub-row, its ammo. Buying ammo or an upgrade keeps focus on the same row. A refused buy moves nothing.

The ramp gives the first visit a real choice, makes mid-game items attainable, and keeps the top tiers as goals for waves 6 to 8. Wave 1 pays $37 (six Groaners and the $25 clear bonus), so the first visit buys a gun.

| Item              | Old price        | New price                  | Category |
| ----------------- | ---------------- | -------------------------- | -------- |
| Barn Buster       | $75              | $35                        | Guns     |
| Chatterbox        | $120             | $100                       | Guns     |
| Pickled Heart     | $25              | $25                        | Health   |
| Shell Sack        | $15              | $10                        | Guns     |
| Chatter Drum      | $20              | $15                        | Guns     |
| Plank Pile        | $30              | $20 ($40 since 2026-10-29) | Traps    |
| Grumpy Gnome      | $70              | $50                        | Traps    |
| Barn Buster tiers | $110, $220, $380 | $40, $140, $320            | Guns     |
| Chatterbox tiers  | $150, $280, $450 | $60, $180, $400            | Guns     |
| Pop Pistol tiers  | $300, $500, $750 | $200, $500, $750           | Guns     |

Glue and Nails keeps its formula (half of each trap's price, scaled by the share of health it is missing), so it gets cheaper with the traps. The bounties and the clear bonus are unchanged.

- **Money at each visit.** Measured on 2026-10-28 with the default bot (200 runs, the ramp prices of that day): a median $37 before wave 2, always spent on the Barn Buster, $104 before wave 3 for the Chatterbox, and $284 to $383 before waves 5 to 8, spent on SMG tiers, gnomes, hearts, and repairs. Before the ramp the first visit bought nothing and the bot carried $420 to $480 unspent into waves 7 and 8.
- **The pistol line.** Only the first pistol tier got cheaper ($300 to $200). It adds 3 rounds to the magazine and a bigger shove, about 5% more sustained fire. The rate tier stays at $500 and the damage tier at $750, because a cheap pistol damage tier broke the balance before (see "Upgrade tiers").
- **Wave pressure.** Cheaper items and a bot that spends its money made the campaign far easier, so waves 5 to 8 got tougher instead of the shop getting expensive again: every spawn's health is scaled by ×1.12, ×1.22, ×1.32, and ×1.45 on waves 5, 6, 7, and 8 (`hpScale` in `WAVE_PLANS`, rounded per zombie). At ×1.12 only a Big Lug changes (34 health instead of 30). On wave 8 a Groaner has 4, a Hotfoot 3, and a Big Lug 44. The scaling is invisible: the campaign shows no BEEFIER banner. The gnome pass softened these to ×1.03, ×1.08, ×1.17, and ×1.21.
- **The bot's shopping.** It buys a heart at 3 hearts or fewer, the Chatterbox when it can afford it (else the Barn Buster), the Chatterbox over a tier 0 Barn Buster, ammo below half, two Plank Piles, a heart at 4 or fewer, Glue and Nails when it costs $25 or less, then spare gun tier 1, one gnome, the remaining spare gun tiers, pistol tiers once the spare gun is at its top tier (at tier 2 before 2026-10-29, when it spent its wave 8 money on the pistol and never reached the top SMG tier), and a second gnome. It keeps $30 back after an upgrade or a gnome.
- **Tuning log.** On 2026-10-28, 12 tries over the prices, the gnome, and the wave health scales moved the default bot between 12% and 74%. Try 11 (health ×1.12, 1.22, 1.32, and 1.45 on waves 5 to 8) was kept at 22% default and 41% `SWAP=1`, the only try with both bots in target and wave 8 the biggest wall. Two hundredths less health on waves 7 and 8 was 5 points of wins.

#### Power-ups

Added on 2026-10-28 after a playtest ("Temporary power ups that get dropped would be sick."). Proposed, not decided. The tables and the drop rules live in `src/powerups.ts`, and the pickups, callouts, aura, and HUD timers are drawn by `src/powerupView.ts`.

Zombies sometimes drop a goodie on the floor. The player grabs it by walking over it, with the keys or the move stick, within 8 px of its middle. Four are timed boosts and two act at once.

| Kind      | Name            | What it does                                                                                      | Lasts | Weight |
| --------- | --------------- | ------------------------------------------------------------------------------------------------- | ----- | ------ |
| RapidFire | Hot Sauce       | 0.55 times the time between shots, tops off the magazine, spends no rounds, and never reloads     | 8 s   | 24     |
| Damage    | Mean Beans      | Twice the damage and 1.5 times the knockback on every shot                                        | 8 s   | 22     |
| Speed     | Zoomy Socks     | Runs 1.4 times as fast                                                                            | 10 s  | 16     |
| Pierce    | Shish Kebullets | Each shot goes through 3 zombies and stops in the 4th                                             | 9 s   | 20     |
| Burp      | Big Burp        | At once: 5 damage and a hard shove to every walking zombie within 110 px, and pays their bounties | -     | 10     |
| Heart     | Pickled Heart   | At once: one heart, never past 5. Only drops while the player is missing one                      | -     | 8      |

- **Stacking.** Different boosts run side by side on their own timers. Grabbing a boost that is already running adds its duration, up to 1.5 times one pickup's duration, and the HUD timer starts full again. The boosts are a record of `Off` or `On` timers in the Model, and one place, `firingStats` and `playerSpeed` in `src/powerups.ts`, turns the running boosts into the gun's fire interval, damage, knockback, piercing, and ammo use and the player's speed.
- **Time.** Boosts, pickups, and callouts count down with the world: they stand still while the game is paused, the shop is open, hit-stop holds the frame, or the new zombie card is up. Boosts keep running through Preparation outside the shop. A new run clears all of it.
- **The floor.** A pickup lies on the floor for 10 seconds, bobbing in a pulsing glow of its color. It blinks for its last 3 seconds, faster in the last second, then fizzles in a puff of dust. It lands where the zombie fell, pulled inside the room and off walls, cover, and traps.
- **Feel.** A drop pops in with sparks and a soft pop sound. A grab plays a chirp and a jingle of its own (a sizzle for Hot Sauce, a growl for Mean Beans, a whoosh for Zoomy Socks, a double shing for Shish Kebullets, a long frog burp for Big Burp, and two warm notes for the heart), shakes the screen a little, throws sparks and coins, and puts the name and a one-line blurb over the player in big pixel letters for 1.6 seconds. Big Burp also throws a ring 110 px wide and a dust ring. While a boost runs, the player stands in an aura of its color (cycling when several run), shots take its glaze (orange for Hot Sauce, bigger and purple for Mean Beans, green with a long trail for Shish Kebullets), and a chip at the top left, right of the hearts, shows its icon over a draining bar (moved there on 2026-10-29 at the owner's request, from beside the gun slots and then the bottom left). The chip and the aura blink for the last 2 seconds, and a falling tone plays when a boost runs out. The screen reader loadout line lists the boosts that are running.
- **Onboarding.** The first pickup on the floor this session shows WALK OVER THE GLOWING GOODIE TO GRAB IT (STEER OVER on touch) until one is grabbed.

##### Drops

Every drop is decided by its own seeded generator, `loot.rngState` in the Model, seeded from the run's seed when a run starts. Drops never draw from the game's generator, so they never change which zombies come or from where, and the same seed and Messages drop the same pickups in the same places.

- **Wave 1** drops nothing except one Hot Sauce on its third kill, to teach the grab.
- **Each kill** from wave 2 on rolls its kind's chance: Groaner 3%, Hotfoot 3%, Kaboomer 4%, Big Lug 40% (2%, 2%, 3%, and 30% before the gnome pass). These rolls wait for 8 seconds after the last drop, so drops do not clump.
- **Peaks.** When a peak's fade begins (the beat turns `Fading`, the crest of the sawtooth), the next kill rolls 50% for a prize, whether or not the gap is over. Win or lose, the prize is spent.
- **Pity.** After 25 seconds of wave time with no drop (35 before the gnome pass), the next kill drops for sure.
- **The cap.** At most 2 pickups lie on the floor. A kill while the floor is full drops nothing and keeps the pity time and any owed prize.
- **The kind** is drawn by weight from the table, leaving out the heart while the player has every heart.

##### Power-up balance

Measured on 2026-10-28, 200 runs per bot from seed 1. The bot walks over a pickup within 90 px when nothing is inside its comfort radius and no zombie stands within 28 px of the pickup. `NO_PICKUPS=1` makes it ignore them, though it still walks over about 2 a run by accident. The bot reports pickups dropped and grabbed by kind and the share of wave time with a boost running.

Measured then: the default bot won 25%, `SWAP=1` 43%, and `NO_GNOME=1` 1% (0.5% when it ignored pickups). A run dropped about 16 goodies and the bot grabbed 12, with a boost running for 19% of wave time. Of the drops, 30% were Hot Sauce (counting the wave 1 drop), 22% Mean Beans, 20% Shish Kebullets, 16% Zoomy Socks, 11% Big Burp, and 1.6% hearts, about one heart every four runs. Wave 8 was the biggest wall, and endless reached a median wave 8 with or without pickups.

- **Against the targets.** Both bots win inside their ranges, deaths in waves 1 to 4 stay at or under 1%, and wave 8 is the biggest wall for both. Close calls fell to 21 to 24% of wins, further under the 30 to 50% target: a boost often turns a near death into a clean finish.
- **Traps still carry the balance.** Power-ups barely move the bot that never buys a gnome: 1% wins against 0.5% when it ignores them. That bot dies in waves 5 to 7 with too little damage a second, and 8 to 10 seconds of a boost every 30 seconds or so does not close that gap. Power-ups add highlight moments for every player, but they do not replace the gnome. Giving non-trap players a real path means a weaker gnome with stronger drops: a gnome firing every 700 ms with 14 health, with the first-guess drops below, took the bots to 14.5% and 26.5%, too hard, so the right mix needs its own pass. That pass is "The gnome pass and spawn variety" below.
- **Tuning log.** On 2026-10-28, drop chances from 1.5% to 4% (25% to 40% for a Big Lug) and peak prizes from 35% to every peak moved the default bot between 24.5% and 31%. Try 2 (2, 2, 3, and 30%, a 50% prize, an 8 s gap, 35 s pity) was kept; a few points either way at 200 runs is noise. `TUNE` files can also edit `DROP_CHANCE`, `DROP_RULES`, `BOOSTS`, and `PICKUPS`.

#### The gnome pass and spawn variety

Added on 2026-10-28 after a playtest: "Do the pass for Grumpy Gnome", "Wave 2 feels meh because it's just 3 zombie groups, and they're spaced out a lot. I honestly thought the game broke for a second", and "Would be cool to mix up the spawns a bit more." Proposed, not decided. The gnome lives in `src/traps.ts` and its pea in `src/weapons.ts`, the waves in `src/waves.ts`, the quiet rule in `src/pacing.ts`, and the drops in `src/powerups.ts`.

- **The gnome.** It fires a pea every 1200 ms instead of 520, has 10 health instead of 16, and costs $75 instead of $50. Its range (84 px) and the limit of 2 are unchanged. One Kaboomer burst (15) now breaks it. Two gnomes used to nearly double the bot's damage a second for $100; now they add about a fifth of the Chatterbox's for $150.
- **Wave health.** Waves 5 to 8 scale health by ×1.03, ×1.08, ×1.17, and ×1.21 instead of ×1.12, ×1.22, ×1.32, and ×1.45. Rounded per zombie, that is a Big Lug of 31, 32, 35, and 36 instead of 34, 37, 40, and 44, a Groaner and a Kaboomer of 4 on waves 7 and 8 only, and a Hotfoot of 2 throughout. The rounding makes the scales coarse: ×1.18 to ×1.21 on wave 8 differ only by one Big Lug health point.
- **Drops.** A kill drops a goodie 3% of the time (Groaner and Hotfoot), 4% (Kaboomer), or 40% (Big Lug), up from 2%, 2%, 3%, and 30%, and the pity timer is 25 s instead of 35 s. A run sees about 20 drops instead of 16, with a boost running for about a quarter of wave time.
- **Variety rules.** Every group's pack sizes are a list, shuffled per run, so a wave mixes singles, pairs, trios, and squads of up to 6 in a new order each time while its zombie count stays fixed. Most groups draw one, two, or three doors per run from all four, so a seed decides which doors a wave favors. Stragglers (packs of one from any door with up to 1.5 s of jitter) wander in between packs from wave 3. Many groups from wave 2 on mix kinds inside a pack. A kind's debut group is only that kind and comes from one drawn door. Wave 1 keeps its fixed tutorial at the north door, and the Big Lug's debut keeps the north door with its escorts behind it. Endless build squads, pincers, and hordes vary their pack sizes around the endless pack size the same way. All of it is drawn from the seeded generator when Preparation begins, so the same seed gives the same wave and the preview stays exact.
- **The timeline audit.** `TIMELINE=1 bun run balance [runs]` prints the first run's waves in wall seconds (each pack as it walks in: time, door initial, size, P for pincer and H for horde, * for mixed kinds), every stretch of at least a second with no zombie alive, and how much of it was quiet (nothing warned at a door). It then prints, per wave over all runs, the first pack's arrival, the packs, the pack sizes, the empty seconds, the longest empty stretch, and the longest quiet stretch. `WORKERS=n` splits the runs over n processes and gives the same report. Measured with the default bot, 40 runs before and 100 after:

  Before, the longest quiet stretch averaged 3.6 to 6.2 s on waves 2 to 8, with worst cases of 7 to 10 s; after, 1.8 to 2.5 s, with the 4 s restless relax as the worst. Wave 2 had been five Groaner trios 3.8 s apart and a 10.4 s gap across its relax. Superseded by the 2026-10-29 dead air numbers under "Difficulty levels and planks as bait".

- **Measured** on 2026-10-28, 400 runs a bot: the default bot won 22.5% (was 25%), `SWAP=1` 29% (was 43%), and `NO_GNOME=1` 15% (was 1%), with 33 to 45% of wins close calls and a median win of 8.5 to 8.6 minutes. Wave 8 killed 40 to 48% of runs, waves 1 to 4 at most 1%. Endless reached a median wave 8, best 12.

- **Against the targets.** The default bot wins inside 15 to 25%, the bot that never buys a gnome wins 15% instead of 1%, and close calls are 33 to 45% of wins, inside 30 to 50% for the first time. Deaths fall in waves 5 to 8 with wave 8 the biggest for every bot, and waves 1 to 4 stay at or under 1%. A gnome is now worth about 7 points of wins, not 24. The `SWAP=1` bot misses its 35 to 45% target at 29%: its edge over the default bot shrank from 18 points to 7 at every setting tried, and no setting in this pass's files put both bots in range. A real player who swaps back to a refilled spare is still likely to beat the default bot.
- **Tuning log.** On 2026-10-28, 12 tries over the gnome's rate, health, and price, the wave health scales, and the drops; the kept try 12 is the numbers above. Tries 1 to 9 used a `TUNE` file that edited `TRAPS.Turret.price`, which the shop copies into `SHOP_ITEMS` when it loads, so those runs still sold the gnome at $50. A `TUNE` file must edit `SHOP_ITEMS.Turret.price` to change the price. Runs of 200 swing by about 5 points from noise alone.

### Upgrade tiers and endless mode

Added on 2026-10-28, after the first playable. Proposed, not decided. Real players have not tested any of it.

#### Upgrade tiers

Each gun has three tiers beyond its base, sold at Rattles' stall between waves. A tier is a row in `UPGRADE_TIERS` in `src/weapons.ts`: a name, a price, and a boost that adds to damage, the time between shots, the magazine, the reload time, spread, pellets, knockback, and the ammo cap. Tiers stack, and firing reads the held gun's stats at its tier through `statsAt`. Adding a tier is a data change. The bullet carries its damage and knockback, so a shot keeps the tier it was fired with.

- **Where tiers live.** The pistol's tier is on the player. The spare gun's tier is on the carried gun, so buying a different spare gun replaces the slot and its upgrades. The shop says so in its rule line and on the gun's row. A new run resets every tier.
- **In the shop.** A sub-row under each carried gun's card on the GUNS tab, named for the next tier ("Upgrade to Gossip Box"), with the changes spelled out ("Hits for 2 instead of 1"), the price, and the current tier as pips on the card. A row is disabled with a reason when the gun is maxed ("Fully upgraded", price shown as MAX) or the player is short. A gun the player does not carry shows no upgrade.
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
| Chatterbox  | 3    | Blabbermouth 3000  | $350  | Damage 1 to 2                                                            |

The pistol line is expensive on purpose. The campaign is balanced on a knife edge, and the pistol is the gun that never runs dry: in early tuning a $110 tier that doubled pistol damage took the bot from 28% wins to 100%, and even a 10% faster pistol for $100 took it to about 60%. The first pistol tier (a bigger magazine and shove) dropped to $200 with the price ramp, and the bot buys it before wave 7 in most runs. The rate tier stays at $500 and the damage tier at $750, which is for endless.

#### Modes

The run mode is a tagged union, `Campaign` or `Endless`, chosen per run and kept in the Model.

- **Choosing.** The title, Game Over, and Victory screens show CAMPAIGN and ENDLESS buttons, which are ordinary HTML buttons for touch and mouse. On a keyboard, Enter starts a campaign and E starts endless. The canvas prompt names the keys on a keyboard and says PICK A MODE BELOW on touch. A tap or click on the game itself still starts a campaign from the title and Game Over. On Victory it does nothing, so a stray tap cannot throw away Keep going: only the three buttons and their keys act there. Changed on 2026-10-28 by "The home menu" below: the title became the home menu, and a tap on the game itself starts nothing on the home menu or Game Over either, only the buttons and their keys do. Changed again on 2026-10-28 by "Updates wait on the home menu" below: when a newer build is waiting, Game Over and Victory offer only MENU, and Enter goes home there instead of starting a campaign.
- **Keep going.** Victory also offers KEEP GOING (K), which carries the same run into endless wave 9 with its money, guns, tiers, traps, hearts, score, and stats.
- **Endless waves.** Waves 1 to 8 are the hand-made campaign waves. From wave 9, each wave _n_ (depth _d_ = _n_ - 8) is generated from the seeded generator when Preparation begins, so the door preview stays exact and a seed replays the same waves:
  - Health ×(1 + 0.12 _d_): wave 9 is ×1.12, wave 15 ×1.84, wave 20 ×2.44. `Zombie.maxHp` keeps the Big Lug health bar honest.
  - Three sawtooth cycles, built from the campaign's blocks. Each cycle has 18 seconds of squads from a random pair of doors, then a 7 second peak. The first two peaks are pincers and the last is a horde from every door. A fade and a relax of 6 seconds (200 ms shorter a wave, down to 4) follow each of the first two peaks.
  - 90 + 6 _d_ escorts split 30%, 32%, and 38% across the cycles. Squads hold 4 + ⌊_d_ / 3⌋ zombies, up to 7. Pincer packs are one bigger and horde packs two smaller, at least 3. Kaboomer weight is 2 + 0.25 _d_ against 3 Groaners and 2 Hotfoots.
  - 4 + ⌊_d_ / 2⌋ Big Lugs, in pincers just before each peak: a third of them each before the first two peaks and the rest before the horde.
  - Speed ×(1.49 + 0.01 _d_), capped at ×1.6.
- **The alive cap.** At most 20 zombies are in the room at once, in every mode. A spawn that comes due while the room is full waits at its door and walks in when a place frees up. Without the cap the campaign bot peaked at 21 or 22 zombies in a typical run and 29 at worst, so the cap trims the busiest moments of the late campaign waves as well as endless. The balance below was measured with it.
- **What stays the same.** Preparation, the shop, traps, the wave preview, and the music (wave 9 onward plays Stampede) work as in the campaign. Endless waves bring no NEW banner, since every kind has already appeared. A THEY GOT BEEFIER banner with the health bonus shows instead, and the screen-reader preview reads it out. The HUD shows WAVE 12 without "/ 8".
- **Game Over in endless** shows the wave reached and the best wave on this device for the chosen difficulty. Since 2026-10-29 the best is in the on-device save (see "Saved on the device").

#### Pausing, focus, and the end screens

Added on 2026-10-28 before sharing the game more widely. Proposed, not decided. The rules live in `src/main.ts` and `src/update/home.ts`.

- **Leaving the window pauses.** During Preparation or a wave, a hidden tab or a blur of the window itself (clicking into another app on desktop) pauses the game, closes the shop, and lets go of every held key, button, and thumb. Focus moving between elements on the page, such as into the shop dialog, its tabs, or GOT IT, is not a window blur and pauses nothing. The title, Game Over, Victory, and the pause screen ignore it. Coming back does not resume on its own: the pause screen waits for a click, a tap, or Esc.
- **The resume press does only that.** The click, tap, or Esc that resumes is not also a shot or a stick. A movement key held through the pause still moves the player after it.
- **The pause screen teaches the controls.** Added on 2026-10-28 after a playtest ("I have no idea how to use traps on the keyboard."). PAUSED and the wave sit at the top of the canvas, the resume prompt at the bottom, and a HOW TO PLAY panel fills the middle. It lists the controls for the last device used. Keyboard and mouse: WASD moves, the mouse aims, click fires, R reloads, Q swaps guns, T places a trap, G picks the next trap, Enter starts the wave, Esc pauses or resumes, H goes back to the menu (added on 2026-10-28 with the home menu), M mutes, and N turns the music on or off. Each row names one key. Touch: the left thumb moves, the right thumb aims and fires, tapping your ammo reloads, tapping your guns swaps, and the trap, next trap, START WAVE, and pause buttons do what they say, the icons drawn as they look (changed on 2026-10-28 with the mobile HUD). Under them four tips cover the shop, the Plank Pile, the Grumpy Gnome, and goodies. The panel is HTML over the canvas: a labelled region with a heading, two tables of input and action with keys drawn as keycaps, and a list of tips, so a screen reader reads what the eye sees. A click or tap on the panel resumes like one anywhere else and is never a shot or a stick. The panel is placed and sized in arena pixels, so it clears the title, the prompt, and MUTE and MUSIC on 1280x720, 1920x1080, 844x390, and 667x375. The rules live in `src/pauseHelp.ts`, checked with `tools/audit/shots34.ts` and `tools/audit/taps.ts`, which both open the pause screen.
- **One key press, one action.** Space or Enter on a focused HTML button belongs to the button: the game ignores it and the button's own click does the work, once. Other keys on a focused button, and Space and Enter on the game itself, reach the game as usual. A clicked button hands focus back to the game surface, so the next key reaches the game.
- **One key per action.** Changed on 2026-10-28 at the owner's request ("Only one key per action, to avoid multiple keys doing the same thing and being confusing."). Keys are read by `event.code`, so they sit in the same place on any layout.

  | Action                      | Key           |
  | --------------------------- | ------------- |
  | Move                        | WASD          |
  | Fire                        | Click         |
  | Reload                      | R             |
  | Swap guns                   | Q             |
  | Place a trap                | T             |
  | Next trap                   | G             |
  | Start the wave, skip a card | Enter         |
  | Pause and resume            | Esc           |
  | Mute                        | M             |
  | Music on or off             | N             |
  | Campaign (home, end)        | Enter         |
  | Endless (home, end)         | E             |
  | Keep going (Victory)        | K             |
  | Character (home)            | C             |
  | Back to the menu            | H             |
  | Menu, update waiting (end)  | Enter         |
  | Move between menu buttons   | Arrows or Tab |
  | Close a panel or dialog     | Esc           |

  Changed on 2026-10-28 with "Updates wait on the home menu": when a newer build is waiting, Game Over and Victory show only MENU, so Enter, the end screens' main key, means MENU there. H still works, since it means MENU everywhere. E and K do nothing until the player is home.

  Removed: the arrow keys, Space as fire and as start, E as swap, 1 and 2 to pick a gun, P as pause, and Enter as resume. Space now does nothing outside a focused button. Picking a gun by number is gone with no replacement: Q swaps, and with two guns that reaches either one. The shop dialog keeps its own list keys (arrows, Home, End, Enter, and Esc to leave), since those move around a menu, not the game.

- **The PAUSE button.** Superseded on 2026-10-28 by the round pause icon in "Breaks and the mobile HUD". `tools/audit/shots31.ts` checks that no two buttons overlap.
- **Feedback line.** Game Over and Victory show TELL WHOEVER SENT YOU THIS WHAT YOU THINK! centered under the stats panel, and the screen reader status line ends with it. To keep it clear of the mode buttons on 844x390 and 667x375 phones, the panel's rows are 8 px apart instead of 9 and the panel sits 3 px higher. Checked with `tools/audit/taps.ts`, which fails when anything covers a button on Game Over or Victory.

#### Balance with upgrades

Superseded on 2026-10-28 by the measurements under "Balance pass" above, which were taken with upgrades on. Endless after the price ramp (200 runs): median wave 7, best 16, worst 4, where before the ramp no run passed wave 10.

### Breaks and the mobile HUD

Added on 2026-10-28 after a playtest ("the mobile overlay is a bit much", "the new zombie card is too fast to read"). The layout follows the usual mobile action game rules: little chrome, icons instead of words, actions in the right thumb's reach, buttons only while they are useful, and the HUD itself is tappable. The views are `src/touchControls.ts` and `src/menus.ts`, the icons `src/icons.ts`, checked with `tools/audit/shots31.ts`.

- **The corner.** During Preparation and a wave the top right holds one round, see-through pause icon, on every device. Mute and music became round icons that sit there only on the title, the pause screen, Game Over, and Victory. M and N still work everywhere and the toggles keep their labels and pressed states. Desktop moved audio to the pause screen too: one layout to learn, and a keyboard player has M and N. The corner icons and the Home Screen tip step aside while the character picker is open. Changed on 2026-10-28 by "The home menu": the home menu has no corner icons, its SETTINGS panel holds sound, music, screen shake, and full screen.
- **Guns.** Changed on 2026-10-29, owner-approved ("Move the guns to be centered in the bottom of the screen, like CODM. Utility a small button right next or above them."): the two gun slots sit side by side at the bottom middle, on touch and desktop alike, nudged a few pixels left so the icons beside them stop short of the stall. Each shows the gun's icon, its ammo, and its tier pips; the held one is bright with a yellow frame, the other dimmed. They are buttons named after the gun's tier name: a tap or click on the other gun swaps to it, and on the held gun reloads it early. On a keyboard they wear Q and R key badges. The desktop SWAP button is gone. The trap counts and the power-up timers moved to the bottom left, clear of the south doorway. Checked with `tools/audit/shots31.ts`. Changed on 2026-10-29 at the owner's request ("power-up timers should be at the top of the screen"): the power-up timers moved up beside the hearts, right of the last heart and two to a row, so all four stay clear of the wave label, the boss name under it, the score, and the pause icon. The trap counts stay at the bottom left.
- **Beside the guns.** Small round icons sit right of the gun slots, bottom aligned with them: a reload icon on touch while the magazine is below half and not reloading, and during Preparation only, the place icon (the selected trap with its count, red when blocked, its reason read to screen readers) and the next trap icon, with T and G badges on a keyboard. They wrap upward before they reach the stall's outline, so a narrow phone stacks them. The START WAVE pill sits just above the guns during Preparation (a button with an ENTER badge on a keyboard). The bottom band of hints moved up a little to stay clear of it. All of it hides during the new zombie card. This replaced the right thumb column of 2026-10-28.
- **Look.** Round, pixel icons made from the game's own pixel maps, about 0.6 opaque at rest and fully opaque when pressed, at least 44 CSS px, placed inside the safe area insets.
- **Full screen.** A web app manifest (fullscreen, falling back to standalone, landscape) and the iOS Home Screen tags. Where the browser can put the page full screen (Android, desktop) a full screen icon sits with the audio icons on the title and the pause screen, never mid-wave. It asks for full screen and a landscape lock, and a refusal is ignored. On a phone that cannot (iPhone Safari), the first title shows a dismissible ADD TO HOME SCREEN TO PLAY FULL SCREEN tip instead. It goes away for the session once dismissed or once a run starts. Both are decided by feature checks, not the user agent. Changed on 2026-10-29 by "The fixed home layout": on the home menu the full screen icon and the tip sit in the top right corner.
- **The new zombie card.** It stays up 5.5 seconds instead of 2.6 and cannot be skipped in its first 1.5 seconds. Once it can, a prompt shows: TAP TO CONTINUE on touch, CONTINUE with an ENTER keycap on a keyboard. The world stays frozen while it is up.
- **The first break.** The break before wave 2, in the campaign and in endless, has no timer. The HUD says NO TIMER and a hint says PLANKS BLOCK DOORS. GNOMES SHOOT. The first timed break after it, before wave 3, shows BREAKS ARE TIMED FROM NOW ON once. Both heads-ups are saved once seen, so a returning player skips them. Keep going into endless starts a timed break. The balance bot already presses Enter in every break, so its numbers do not change.

### The parlour

Redrawn on 2026-10-29 after the owner said the first room felt disjointed. Proposed, waiting on the owner. The map is `ROOM_MAP` in `src/arena.ts` and the art is `src/room.ts`.

- **A room, not a prop pile.** The fireplace is the centerpiece on the north wall, with a mantel, sconces on both sides, and flames that flicker (a three frame image on the scene canvas; everything else is one baked image on the floor canvas). A big worn rug fills the middle. Two wingback armchairs flank the hearth and a sofa faces it from the south, so the player starts on the rug in front of the fire. An upright piano stands in the north-west corner and a bookshelf in the north-east. The walls are papered and paneled, with a portrait, a boarded window with fingers curled over a board, and cobwebs in the corners.
- **Doors that zombies burst through.** The four spawn doors are splintered frames with the wrecked door hanging or the stumps on the posts, and splinters and blood on the floor. The doors and their ids did not move.
- **Fighting in it.** Each side door is flanked by two pieces (a tea table and the coffin on the west, a tea table and a fern on the east), so a pack funnels through a four-tile lane. The seating group around the rug is a loop to kite around, the sofa is a wall to shoot over a pack from the south door, and the nook between the stock crates and the stall is a corner to back into. Every gap is at least two tiles, so the Big Lug and Uncle Chunk fit everywhere a Groaner does.
- **The shop.** The stall stands on its own green mat, with the shopkeeper's stock crates beside it.
- **The way to the kitchen.** A boarded double door with a fork and knife sign sits on the north wall, at the `K` tiles in the map. It is the parlour's one exit, `Kitchen` in `PARLOUR_SPEC`, closed and solid. It holds no door shut, since no room stands behind it yet, and nothing in the shop opens it. It marks where the first exit the player buys open will be.

### Portrait play

Built on 2026-10-29, owner-approved (moved here from "Future vision", where it was approved on 2026-10-28): "so phone players do not have to turn the phone". One firm rule from the owner: no hints or arrows for zombies out of view, which feels cheap. The rules are in `src/screen.ts` and `src/camera.ts`, checked with `tools/audit/shots34.ts` and `PORTRAIT=1 bun taps.ts`.

- **When.** A touch device whose game surface is taller than it is wide. A keyboard and mouse keep the landscape layout in any window. Turning the phone switches the layout live, mid-wave too: nothing pauses, and the run, the money, and both thumbs carry over. The old TURN YOUR PHONE SIDEWAYS pause is gone. The installed Android app keeps its landscape lock in the manifest for now, and the full screen request still asks for landscape.
- **The screen.** 180 screen pixels wide, so the HUD, the banners, and the cards have the same pixel scale they have when that phone is turned (a landscape phone shows the room's 180 pixel height across its short side). It is as tall as the phone's shape makes it, between 300 and 440 screen pixels: 390 on a 390x844 or 430x932 phone, 400 on a 360x800, 320 on a 375x667. From the top: a HUD band 44 pixels tall, the world window, and the thumb area, the rest.
- **The zoom.** Changed on 2026-10-29 at the owner's request: the first build showed a 180 by 180 window and left the bottom 40 percent of the phone empty. The world window still shows the room's full 180 pixel height, but zooms in, so it is taller on the screen and shows less of the room's width, with bigger sprites. The zoom is picked from the phone's shape: the most that leaves a thumb area at least 76 pixels tall and keeps the window under 63 percent of the screen. The window's widths in the room are 180, 162, 150, 144, 135, or 120 pixels, each one a whole number of screen pixels tall (180 x 180 / width), so the camera stays on whole pixels.

  | Phone   | Screen | Window on screen | Room shown | Zoom | Thumb area |
  | ------- | ------ | ---------------- | ---------- | ---- | ---------- |
  | 390x844 | 390    | 180 x 240        | 135 x 180  | 4/3  | 106 (27%)  |
  | 430x932 | 390    | 180 x 240        | 135 x 180  | 4/3  | 106 (27%)  |
  | 360x800 | 400    | 180 x 240        | 135 x 180  | 4/3  | 116 (29%)  |
  | 375x667 | 320    | 180 x 200        | 162 x 180  | 10/9 | 76 (24%)   |
  | Before  | 390    | 180 x 180        | 180 x 180  | 1    | 166 (43%)  |

  The world canvas is the size of the room it shows and is stretched to the window with crisp pixels, so the zoom costs nothing per frame. The overlay draws world points (door markers, callouts, the trap notice) through the same zoom, rounded to whole screen pixels.

- **The camera.** The window follows the player across the room and stops at the walls, so nothing past the walls shows. The room is as tall as the window, so it only scrolls sideways, 185 pixels from wall to wall at 4/3 zoom. The screen shake moves the world once, inside the window. Touch sticks are screen space and float wherever a thumb lands, so the camera never moves them.
- **Fairness without hints.** The camera leans toward where the player aims, up to 28 room pixels, eased over about a quarter second, and back to the player when the aim lets go. Kept at 28 with the zoom: in a 135 pixel window, aiming sideways shows about 95 pixels ahead of the player and keeps about 40 behind. It lives in the Model (`cameraLean`), stepped each frame from the aim, so the same Messages give the same camera. The door rattles and groans carry the warning for zombies out of view. No stereo panning.
- **HUD band.** Hearts and money at the left, the score at the right beside the pause icon, the boost chips under the score, and the wave label and its line (ZOMBIES, STARTS IN, or the boss bar) centered under them.
- **Thumb area.** Dressed as the manor's wainscot, in the wall's purples: a chair rail along the top, then a row of dark sunken panels, so the room's bottom wall seems to run on down behind the thumbs. It is two small PNG tiles repeated by CSS under the overlay canvas (`src/thumbArea.ts`), drawn once and never per frame. The gun slots at the bottom, nudged a little left of center so two utility icons fit beside them, the START WAVE pill above the guns, the trap counts above the guns at the left, and the new zombie card's continue button. The sticks and the stick ghosts float in it.
- **Banners and cards.** The wave banners, the hints, the new zombie card and band, the pause title, and the Game Over and Victory panels are drawn as in landscape, centered on the world window. Their backdrops dim the whole screen. HTML that lines up with them, such as the pause panel and the home menu's player, reads that frame's top from `--frame-top`. The pause panel turns into one column under the PAUSED title, and TAP TO RESUME drops to the thumb area. The Game Over and Victory buttons stack: MENU on top, the modes in a row under it.
- **The door preview.** Markers for doors in view sit where they do in landscape. A marker for a door out of the window is pinned to the window's edge with a small arrow toward the door. This is the preview between waves, not a warning during one.
- **The home menu.** The same slots, rearranged: status at the top left, the logo, the tagline, and the player in the middle, and the rail as a row of five icons above PLAY and the MODE toggle at the bottom. PLAY stays where it is in either mode. Added on 2026-10-29 at the owner's request: a small pill just above the rail says TURN YOUR PHONE SIDEWAYS TO SEE THE WHOLE ROOM beside a pixel phone that tips on its side, since portrait zooms in and plays harder (see Balance below). It shows only on the home menu in portrait, so never mid-run and never on a keyboard and mouse, and goes the moment the phone turns. It takes no taps and is not dismissible, so nothing is saved. The installed Android app is locked to landscape and never shows it.
- **Dialogs.** The shop, the character picker (the preview above the rows), What's New, the Munchopedia, settings, the difficulty picker, and How to play fit a portrait phone without the page scrolling. Long lists scroll inside their panel.
- **Balance.** `VIEW=portrait` makes the balance bot see only the zombies inside the portrait window. On the wave snapshot pass (100 runs a wave, 2026-10-29) it cleared waves 1 to 5 as often as the landscape bot, and waves 6, 7, and 8 about 5 to 7 points less often (79, 72, and 21 percent against 85, 77, and 28). Within the noise of 100 runs for most waves and not drastic, so nothing was retuned. That pass saw the old 180 pixel wide window.
  - **Measured with the zoom** on 2026-10-29 in the nightly (commit 6b7df975, 200 campaign runs a bot from seed 1), the bot seeing the 390x844 window, 135 by 180 of the room. Portrait is held to the same win targets as landscape, and the nightly lists a pass whose wins sit more than 8 points from landscape's.

    | Bot              | Landscape wins | Portrait wins | Gap   | Win target |
    | ---------------- | -------------- | ------------- | ----- | ---------- |
    | Normal, default  | 16.0%          | 11.0%         | -5.0  | 15 to 25%  |
    | Normal, `SWAP=1` | 37.0%          | 50.0%         | +13.0 | 30 to 45%  |
    | Easy, default    | 66.5%          | 49.0%         | -17.5 | 55 to 70%  |

    Easy is the clear gap: 17.5 points fewer wins, most of the extra deaths on wave 8 (32% of runs die there against 21%). Portrait Normal is inside the noise on wins but dies more on waves 4 and 5 (15% of runs against 6%). The `SWAP=1` bot won more in portrait, for reasons not looked into yet; that pass was a one-off and is not in the nightly, which plays only Normal default and Easy in portrait to stay short. Nothing is retuned yet. The nightly now tracks the gap.

### The home menu, the loading splash, and taps

Added on 2026-10-28 from owner feedback: "Would also love to have a menu page for us to go back to, manage the character, and be the home base for users", "Can add a quick loading page for the game too, especially as we get more and more assets in", and "Tapping on menu items on mobile can not be responsive right away. Can be hard to tap the right spot." Proposed, not decided. The views are `src/homeView.ts` and `src/menu.css`, the rules `src/home.ts`, checked with `tools/audit/shots33.ts`, `tools/audit/taps.ts`, and `tools/audit/splash.ts`.

- **The home menu.** The title grew into it, so it is still `Phase.Ready`. The logo, the ALPHA chip, the tagline, and the parade stay on the canvas, and the player, in their chosen look, backpedals ahead of the bottom lane's Groaners with the pistol up. Under the tagline sit two big buttons, PLAY (the campaign, 8 waves) and ENDLESS, and three smaller ones, CHARACTER, HOW TO PLAY, and SETTINGS. The buttons are HTML placed in arena pixels, at least 48 CSS px tall, with key badges on a keyboard. Changed on 2026-10-29 by "The fixed home layout" below.
- **Keys.** Enter plays, E plays endless, C opens the picker. The arrow keys walk the five buttons in order and wrap, Tab works as usual, and Enter or Space on a focused button presses that button only. Esc closes whichever panel or dialog is open. Changed on 2026-10-29 by "The fixed home layout": E switches the mode instead of starting endless, and the rail has its own keys.
- **The fixed home layout.** Decided on 2026-10-29, owner-approved (moved here from "Future vision", where it was approved on 2026-10-28). The same slots on a phone and a computer, all placed in arena pixels so they scale with the stage like the shop. This is the home layout from now on: a new feature goes into the left rail or the mode toggle, never into a new slot, so PLAY never moves.
  - **Top left, status.** A difficulty badge (DIFFICULTY NORMAL, in the level's color) that opens the difficulty picker, with the current level lit and a Done button, and YOUR BESTS beside it: best endless wave, fastest win, and zombies splatted, or NO BESTS YET. GO GET CHEWED ON.
  - **Center stage.** The logo, the ALPHA chip, the tagline, and the player in their chosen look, twice the room's size, walking on the spot with the pistol up while the parade shuffles past. A tap or click on the player opens CHARACTER (a button over them, left out of the Tab order since the rail's Character button is the one a keyboard reaches). A NEW ENTRY pop sits under the tagline when a run unlocked a Munchopedia entry.
  - **Bottom right, play.** A big PLAY and a MODE toggle beside it (CAMPAIGN or ENDLESS, the chosen one lit). PLAY plays the chosen mode and names it under PLAY. Switching the mode changes only the words, never PLAY's box, which `tools/audit/shots33.ts` checks. The mode lasts for the page session.
  - **Left rail.** Icon buttons, top to bottom: What's New, Munchopedia, Character, How to play, Settings. Small labels under the icons on touch, full labels beside them and a key badge on a keyboard. A red dot marks What's New and the Munchopedia while they hold something unseen.
  - **Top right.** The full screen icon where the browser can do it, the "New version ready" chip, or the iPhone Add to Home Screen tip in its place.
  - **Keys.** One per button, none used anywhere else in the game: Enter PLAY, E switch mode, L What's New, Z Munchopedia, C Character, I How to play, O Settings. W and S were the first idea for What's New and Settings, but they move the player, so they stay movement keys only. The arrow keys walk PLAY, the mode toggle, then the rail top to bottom, and wrap; Tab follows the same order, then the difficulty badge. The home HOW TO PLAY lists these keys under the first table, on a keyboard, when the screen is tall enough.
- **What's New.** Built on 2026-10-29 (approved on 2026-10-28). The rail icon opens a panel with the newest day of `CHANGELOG.md`: its date and title, its intro line if it has one, and its bullets with their emoji. OLDER and NEWER page through the earlier days. `CHANGELOG.md` stays the only source: `src/changelog.ts` imports it as raw text at build time and decodes each day through a Schema, skipping a day that does not decode. The rail dot stays until the newest day has been opened, and the date seen is saved (save version 4).
- **The Munchopedia.** Built on 2026-10-29 (approved on 2026-10-28). A field guide to every zombie, opened from the rail. The rules live in `src/munchopedia.ts`, the panel in `src/guideView.ts`.
  - The header tallies discovery and kills: "6 of 7 discovered, 1,369 zombies splatted".
  - The list shows all seven kinds as tiles. A kind not found yet is a dark silhouette marked ???, with alt text for it. A kind unlocks the first time a run that killed one is counted (on Game Over, Victory, or leaving for the menu). Uncle Chunk unlocks when he is beaten.
  - An entry shows the zombie walking through its wear stages, its name, a one line bio, What it does and How to beat it in the voice of the new zombie cards, the player's total kills of that kind from the saved kills per kind, and badges at 10, 100, and 1,000. Uncle Chunk's entry says how many times he was beaten: his kill count is that number, since he is counted once each time he goes down.
  - A run that unlocks an entry shows NEW ENTRY on Game Over or Victory (In the Munchopedia on the menu) and as a pop on the menu that opens the entry. The pop goes when the entry is opened or the next run starts. The rail dot and a NEW tag on the tile stay until that entry is opened. The opened entries are saved (save version 4).
  - The panel fits 667x375 without scrolling; checked with `tools/audit/shots33.ts`.
- **HOW TO PLAY.** A dialog with the same controls and tips as the pause screen, for the last device used.
- **SETTINGS.** A dialog of toggles: sound (M), music (N), screen shake, and full screen where the browser can do it. Screen shake off keeps the camera still; hit-stop and the rest of the juice stay. Sound, music, and screen shake are saved on the device; full screen is not. RESET TUTORIAL, under the toggles, asks SHOW THE TIPS AND ZOMBIE CARDS AGAIN? with RESET and KEEP, KEEP focused.
- **Your bests.** Renamed from THIS SESSION on 2026-10-29 at the owner's request ("zombies killed this session resets between updates"). A strip under the buttons shows the best endless wave, the fastest campaign win, and the zombies splatted on this device, or NO BESTS YET. GO GET CHEWED ON. A run is counted when it ends: on Game Over, on Victory, or when the player leaves it for the menu, so leaving a run keeps its kills. A win that goes on into endless adds only its new kills when it ends again. The bests are in the on-device save, which since 2026-10-29 is the SQLite player scope, so linked devices share them (see `PLATFORM.md`).
- **MENU.** The pause screen has a MENU pill beside its corner icons, and H does the same. It asks LEAVE THIS RUN? with LEAVE and STAY, STAY focused, and Esc means stay. Game Over and Victory show MENU (H) in place of CHARACTER after the restart grace and go home at once. Going home clears the room and the run, and keeps the look, the settings, the lessons, and the bests.
- **Updates wait on the home menu.** Added on 2026-10-28 from owner feedback: "Wait to say there's an update until you're in the main menu, so you don't lose progress. When you die, make sure you go back to that!" The "New version ready" chip shows only on the home menu. The checks still run on every quiet screen and only record the newer build, so the chip is up the moment the player gets home. Game Over and Victory put MENU first and draw it filled, as the main button. When a newer build is waiting they offer only MENU, focused, with ENTER on its badge and the line A NEW VERSION IS WAITING ON THE MENU., and hide Play again, Endless, and Keep going, after the same restart grace. Checked with `tools/audit/shots26.ts`.
- **No tap to start.** A tap on the game itself starts nothing on the home menu or Game Over and grabs no stick. Before, a tap that missed a button by a few pixels started a campaign.
- **The loading splash.** `index.html` paints a splash before any script runs: a dark purple screen in the app icon's color, a chomping pixel Groaner, the MUNCH MANOR wordmark, WAKING THE DEAD..., and a bar. The game hides it from Commands, never from `update`: `init` starts one Command per load step (the save, the stylesheet, the fonts, the first frame, the sprites), each finished step moves the bar, and the last fades the splash out and removes it. A step that fails still counts, so the game never hangs on it. Future assets, such as images for `Canvas.Image`, join the steps. The built stylesheet is preloaded instead of blocking the first paint, and the stylesheet step waits for it.
  - Measured on 2026-10-28 with `tools/audit/splash.ts` on the production build at 844x390, with the cache off:

    | Network and CPU          | Splash painted | Splash hidden | Before: first paint |
    | ------------------------ | -------------- | ------------- | ------------------- |
    | Unthrottled              | 64 ms          | 398 ms        | 348 ms              |
    | 150 ms, 1.6 Mbps, 4x CPU | 224 ms         | 2.9 s         | 468 ms              |
    | 400 ms, 400 kbps, 6x CPU | 508 ms         | 7.8 s         | 1.2 s               |

- **Taps.** What made phone buttons feel slow or miss, and the fixes:
  - A tap just beside a button reached the game surface and started a campaign. Fixed by "No tap to start".
  - Pressed buttons shrank with `transform: scale()`. A tap near an edge pressed the button, then lifted outside the shrunken button, so the browser sent no click. Pressed buttons now get an inset ring and stay the same size.
  - iOS Safari shows `:active` only when a touchstart listener exists, so a tap showed nothing until the click. The body has an empty `ontouchstart`.
  - `:hover` styles stuck after a tap on iOS. They now sit inside `@media (hover: hover)`.
  - Buttons were 44 px, and the character picker's options 34 px. Every button is now at least 48 px.
  - Menu buttons are not inside the game surface, so no press on them reaches its pointerdown handler, and `tools/audit/taps.ts` checks that every visible button's center and edges hit that button and that each tap sends exactly one Message.

### Saved on the device

Added on 2026-10-28 from owner feedback: "We should also save if they've already done the tutorial so it stops showing every launch." This relaxes "saved progress" under "Not now" for preferences and onboarding only, approved by the owner. The record is `PlayerSave` in `src/save.ts`. It was kept in `localStorage` under `munch-manor:save`. Since 2026-10-29 it lives in SQLite in the browser, on OPFS, as the player sync scope, so linked devices share it; the localStorage copy is imported once and stays as a fallback for one release. See "The on-device save" in `PLATFORM.md`.

- **What is saved.** The lessons that gate the hints (move, aim and fire, start wave, shop, swap, the first pickup, the first break, and BREAKS ARE TIMED), so the wave 1 practice gate stays open for a returning player. The zombie kinds whose new zombie card was seen, and whether a trap hint was seen. The iPhone Home Screen tip once dismissed. Sound, music, and screen shake. The character's look. The difficulty (version 2). Since 2026-10-29 (version 3) the bests: runs played, the zombies splatted in all and per kind (by kind id, read by the Munchopedia), and the best endless wave and fastest win for each difficulty. They are written once a run, when it ends. Since 2026-10-29 (version 4) the home menu: the newest What's New day seen and the Munchopedia entries opened. An older save loads with those empty, so its player sees both dots once. Since 2026-10-29 (version 5) the "Share anonymous play stats" setting, on for older saves.
- **What is not.** The run itself and full screen stay in the page session.
- **Loading.** The splash waits for the save as one of its load steps, so the first frame already knows the player and no hint flashes. A missing, corrupted, or older save reads as no save, and storage the browser blocks reads as no save too. Nothing is written until the save has been read.
- **Writing.** Whenever a saved field changes, never on a plain frame. A failed write is ignored.
- **Reset tutorial.** In SETTINGS, after a confirm. It clears the lessons, the trap hint, and the zombie cards seen, so the hints, the practice gate, and the cards come back. Settings, the look, the difficulty, the Home Screen tip, and the bests and kills are kept.

### Wear and the boss

Added on 2026-10-28 from owner feedback: "Would love for us to have parts of the zombie start to fall off as they lose HP" and "Wave 8 should have a final boss too that spawns near the last third of the zombies." Proposed, not decided. Real players have not tested any of it.

#### Wear

- **The rule.** Each kind's row in `ZOMBIE_KINDS` lists its wear stages. A stage comes off once health falls to its share of the zombie's most health, so wear is read from `hp` and `maxHp` alone, with no randomness and no extra state (`wearOf` in `src/zombies.ts`). Each frame compares every zombie's wear at the start and the end of the frame and records a `PartShed` event for each stage it crossed, so a part comes off exactly once, and one big hit past two thresholds sheds both in order. A killing hit sheds nothing: the death gibs cover it, and the falling body uses the fully worn sprite.
- **What comes off.**

  | Kind        | Comes off at       | What comes off                                                                                                                                                                           |
  | ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Groaner     | 2/3, 1/3           | One reaching arm, leaving a red stump, then the top of its skull, showing pink brain and an empty eye                                                                                    |
  | Hotfoot     | 1/2                | Its hair and scalp, showing pink brain                                                                                                                                                   |
  | Big Lug     | 3/4, 1/2, 1/4      | His junk armor, with a clang: the pot lid off his shoulder, the stop sign chained to his chest, then the bucket on his head, leaving the scrawny zombie underneath. Redone on 2026-10-29 |
  | Kaboomer    | 2/3, 1/3           | His hugging arm comes off and he holds the bomb one-armed, then the bomb casing cracks with a hot glow and his head is scorched. Redone on 2026-10-29 for the bomb                       |
  | Big Leaguer | 2/3, 1/3           | His cap flies off, showing a gash, then his throwing arm hangs limp and his wind-up takes half as long again. Redone on 2026-10-29                                                       |
  | Ankle Biter | 1/2                | The top of its head, showing pink brain                                                                                                                                                  |
  | Uncle Chunk | 4/5, 3/5, 2/5, 1/5 | One arm, his party hat with his scalp, the other arm, then his belly bursts open                                                                                                         |

  With 3 health a Groaner and a Kaboomer lose a part to each of the first two hits. With 4 (wave 7) the first hit takes nothing off and the next two do. A Hotfoot with 2 health loses its scalp to the first hit. A Big Lug of 36 loses parts at 27, 18, and 9.

- **The pop.** A part flies off along the hit as a particle shaped like it and tumbles, with 6 drops of blood and a meat gib, and a short wet pop sound (`LimbPop`). It bounces and lands as a decal that stays like the gibs, and a limb keeps a red stump pixel at one end. The caps are unchanged: 160 particles and 220 decals, newest kept.
- **The clang.** Since 2026-10-29 a Big Lug's pieces are armor (`isArmorPart` in `src/zombies.ts`): each flies off with 8 metal sparks instead of blood and a gib, plays a synthesized `Clang` instead of `LimbPop`, and lands as a pot lid, stop sign, or bucket decal that stays under the same caps.
- **Movement and balance.** Unchanged. A worn Groaner, Hotfoot, or Big Lug only waddles a little more, and that is drawing, not movement.
- **Sprites.** Every stage of every kind is built once at module scope from the base pixel art plus pixel patches (`applyPatches` in `src/sprite.ts`). A Story test checks each kind has one sprite per stage plus its fresh one, each different from the last.

#### Uncle Chunk

Reworked on 2026-10-28 from owner feedback: "Have him spawn with other enemies joining about 5 seconds in. Should feel like a challenge, not something you can just run around." Before this he only stomped up close and burped up a Groaner from far away, and the bot beat him by keeping its distance.

- **Who.** A hulking, pot-bellied zombie with a tiny head, a tiny green party hat, a stained undershirt, red suspenders, blue jeans, and arms that hang to his knees. His sprite is 26 by 26 pixels, about twice a Big Lug in each direction. He walks in a four-frame cycle with a stomp squash and a waddle, flashes faster and faster while a stomp or a charge winds up, and gapes with green drool before a belch or a spit.
- **Numbers.** Health 90 times the wave's health scale (99 on wave 8). Speed 10 to 11 px/s, ×1.6 while the player is more than 70 px away, so he closes in on a player who backs off. A bite costs 2 hearts. His body is 12 px across for bullets, bursts, bites, the crowd, and his charge, but he walks on an 8 px radius and the wide flow field, so he fits through every door and around the crates. Mass 40, knockback ×0.03, chews a trap at 20 a second. Bounty $150, and his kill always drops a goodie. Shown to players as UNCLE CHUNK with the line STAY CLOSE. STEP OUT OF THE RED, and on his new zombie card as HE STOMPS UP CLOSE. RUN FAR AND HE CHARGES AND SPITS.
- **Range decides the attack.** When his cooldown is up he picks by distance: within 44 px he stomps; from 44 to 70 px he only walks in, unless his belch is ready; beyond 70 px he charges and spits in turn, a charge first. He charges only along a lane his body fits down, and spits instead when cover is in the way. Standing near him and stepping out of the stomp is the safe way to fight him, and running far is not.
- **Stomp.** He stops, rises, and flashes for 1 s while a red ring of 34 px fills the floor around him and a yellow sweep grows to its edge. Then he lands: a player whose body touches the ring loses 1 heart and is shoved out, and every zombie in it is shoved away. He recovers for 0.6 s and waits 1.6 s.
- **Charge.** He plants, stamps, snorts, and flashes for 0.8 s while a red lane 24 px wide with an arrowhead fills the floor toward where the player stood when he planted. A yellow fill runs down the lane as the wind-up ends. The target is locked when he plants, so a step sideways clears the lane. The lane stops where a wall or a crate would stop him. Then he rushes at 190 px/s along that line, to 60 px past the locked point. A player he reaches loses 2 hearts and is thrown aside at 1.6 times the usual knockback. Zombies in his way are bowled aside. If a wall, a crate, or a barricade stops him he bonks: the screen shakes at its cap and he is dazed for 1.8 s, swaying with stars around his head, and takes double damage. Otherwise he recovers for 0.5 s. Either way he waits 3 s.
- **Spit.** He puffs up for 0.5 s, then lobs a glob of green goo at where the player stands. The glob arcs through the air for 0.9 s while a green mark of 10 px radius fills on the floor where it will land, with a yellow sweep. A player still on the mark when it lands loses 1 heart. It leaves a puddle of 10 px for 4.5 s that halves the player's speed while they stand in it. He recovers for 0.4 s and waits 4.5 s. At most 5 globs and puddles stay on the floor.
- **Belch.** A timer of 15 s, 6 s for his first, runs 1.5 times as fast while the player is more than 70 px away. When it runs out and his cooldown is up he swells for 0.8 s, gapes, and burps up a Groaner with the wave's health in front of him. He skips it at the alive cap of 20. He recovers for 0.4 s and waits 1.2 s.
- **Enraged.** At a third of his health or less he roars once, his skin flushes red, steam puffs from his head, and his bar reads ENRAGED in place of his name, with the fill blinking orange. He walks 1.5 times as fast, and the waits between attacks drop to 0.55 of their length. His wind-ups stay the same length, so every tell is as readable as before.
- **One tell at a time.** He winds up only one attack at a time, and while a glob is in the air he waits for it to land before he winds up anything else, a stomp included. His first attack comes 2.5 s after he walks in, and every attack has a recovery and a wait after it.
- **The tells.** The stomp ring, the charge lane, the glob mark, and the puddles are drawn on the floor under every actor, so nothing standing in them hides them. The glob in the air, the dazed stars, and the steam are drawn above the actors.
- **Sounds.** A rising growl for the stomp and spit wind-ups, three snorting stamps and a scrape for the charge wind-up, a whoosh for the rush, a cartoon bonk for the wall, a hock for the spit, and a wet splat for the landing glob. The enrage reuses his roar.
- **When he comes.** Wave 8's Preparation draws his door from the seeded generator, and the door preview shows a red-framed BOSS marker with his face at that door (the screen reader says which door). He waits outside until only a third of the wave's planned spawns are left, rounded, so two thirds have come in. Then his door rattles for 2.6 s, he roars, the screen shakes, and a band shows his name and STAY CLOSE. STEP OUT OF THE RED. The band starts below the hearts, the money, and the round text, so it covers none of the HUD. Then he walks in through the door.
- **The rest of the wave joins him.** The wave clock stops while he arrives and for his first 5 s in the room, then the last third of the wave, with its Big Lugs and the horde, comes in while he fights. It was 15 s before this pass.
- **His bar.** While he stands, the HUD shows his name in red and an 80 px health bar at the top of the screen, on the overlay canvas, so it never shakes. The wave line moves up to read WAVE 8 / 8 ZOMBIES 23.
- **His death.** He slumps over 1.6 s with 12 meat gibs, 4 pink chunks, 2 limbs, and 24 drops of blood, the shake hits its cap, and the world runs at quarter speed for 1.4 s. Globs and puddles go with him. Victory waits until his body has finished falling and every other zombie is dead.
- **Endless.** Every eighth wave brings him back, so an endless run meets him on waves 8, 16, 24, and so on, with that wave's health bonus: 176 on wave 16 and 263 on wave 24. One boss per boss wave.
- **The Decided finale still holds.** "The last is a Tank-heavy horde" is unchanged: wave 8 still ends with its four Big Lugs and a horde from every door, and Uncle Chunk comes on top of them. On 2026-10-29 the tighter pacing pass cut that to three Big Lugs (still the most of any wave) and a one-volley horde, because with shorter relaxes the bot died with the boss standing in 87 of 96 wave 8 deaths. The decision still holds: the finale is the Tank-heavy horde with the boss on top. This pass trimmed the horde from 20 to 15 and wave 8's health scale from ×1.21 to ×1.1 (see "Boss far attacks" below), which is a balance number, not a change to that decision.
- **Screenshots.** The audit harness stages each attack with `boss=charge`, `rush`, `spit`, and `dazed`, plus `enraged` and `puddles` (see `tools/audit/README.md`), and `tools/audit/shots17.ts` guards the boss's stages pixel for pixel.
- **Pathing fix.** A wide walker (the Big Lug and Uncle Chunk) now aims at the nearest point its body fits beside the next tile of the flow field, not the tile's middle. Aiming at the middle of a tile beside a crate pinned him on its corner, and one seed had him stuck for 11 minutes.

#### Boss balance

The bot now steps straight out of a stomp ring once a stomp starts winding up and it is within 10 px of the ring, and it keeps 16 px more distance from the boss than from the horde. Hearts lost to a stomp are blamed on the boss, and the report prints each boss wave's fights: how often he arrived and fell, the median fight, the runs that died with him standing, and his stomps and belches. `BOSS_RULES` joins the `TUNE` hook.

Tuning log, 2026-10-28, 17 tries at 200 runs a bot. Health 220 with two belches every 4.2 s took the default bot from 24.5% to 8%. A boss of 1 health with no belch still cost 4.5 points, the cost of the entrance alone, and belches that bring no one gave 22%, so the belched Groaners were most of his cost. Kept: health 80 and one belch every 9 s, at 23% default and 30.5% `SWAP=1`, with 44% of default runs dying on wave 8, the boss felled in 45% of the fights he reached, and a median fight of 33 s. Superseded by "Boss far attacks" below.

- **Caveats.** The bot keeps its distance and shoots the nearest zombie, so it almost never stands in a stomp ring and rarely fights him up close. A person who stands their ground will see far more stomps. The 15 s hold was kept from try 9 on for pacing, not for the bot: it gave the bot only a point or two.

### Character

Added on 2026-10-28 from a playtester: "She wants to be able to select a female/male for the character! Maybe some customizations." Built, not yet playtested.

- **Where.** A CHARACTER button sits beside CAMPAIGN and ENDLESS on the title, Game Over, and Victory screens, and C opens it from the keyboard. Changed on 2026-10-28 by "The home menu": the CHARACTER button lives on the home menu, Game Over and Victory show MENU in its place, and C still opens the picker on all three. It opens a dialog over the canvas, like the shop, with a walking preview of the player, a Randomize button, and Done. It never opens during a run. Changed on 2026-10-29 by "The fixed home layout": on the home menu it is the rail's Character button, and a tap on the player center stage opens it too.
- **The choices.** Each is its own row, and none depends on another, so any hair works with either body.

  | Row        | Options                               |
  | ---------- | ------------------------------------- |
  | Body       | Female, Male                          |
  | Hair       | Crop, Long, Ponytail, Curls           |
  | Hair color | Black, Brown, Ginger, Blonde, Pink    |
  | Skin       | Fair, Light, Medium, Tan, Brown, Deep |
  | Shirt      | Blue, Red, Yellow, Teal, Pink, Purple |

- **The art.** The player stays 8 pixels wide with the same walk cycle, idle breath, gun hold, hit flash, and reload bar. The female body has taller eyes, a mouth, and a scoop neck; the male body has the collar stripe the player always had. A ponytail is tied with a band in the shirt color. Pink hair is the one silly option. There is no green skin: the zombies are green, and the player has to stand out from them at a glance.
- **The default.** Male, Crop, Brown, Light, Blue: the look the player had before.
- **Randomize.** Draws every row from the Model's seeded generator, so it is deterministic, and never hands back the look you already have.
- **How long it lasts.** Saved on the device since 2026-10-28 (see "Saved on the device"), so it survives runs, restarts, and reloads. Since 2026-10-29 it lives in the SQLite player scope, stored whole by a `ChangedAppearance` mutation (see `PLATFORM.md`).
- **Sprites.** A look's frames are composed from parts (a face and torso for each body, a hair overlay for each style) and a palette, built the first time that look is drawn and kept in a small cache, never rebuilt each frame.
- **Later.** Hats stay a later unlockable, on top of this.

#### Boss far attacks

The balance pass for the rework above. 200 runs per row from seed 1, the same seeds as every row, `WORKERS` split. The bot changed with the boss:

- **It dodges every tell.** It steps out of a stomp ring once it winds up and it is within 10 px of the ring, steps sideways off a charge lane (the lane half width plus its body plus 10 px), and steps off a glob mark or out of a puddle, crossing his line of fire toward the side with more room from the nearest zombie. It does not keep its distance on purpose: it holds the middle of the room as before.
- **It shoots him.** While he stands it shoots him unless another zombie it can see is within 60 px, and always while he is dazed (`FOCUS_PX`, `NO_FOCUS=1`).
- **`KITE=1`** never dodges a tell and runs to whichever of eight spots along the walls is farthest from him, shooting as it goes. It is the player who runs around him.
- **`ENGAGE=1`** holds 58 px from him, between his stomp trigger and his charge range. It walks into the horde to get there, so it does worse than the default.
- **The report** prints each fight's charges, how many hit and how many bonked, spits and how many hit, belches, how often he enraged, the hearts lost while he stood by cause (stomp, charge, glob, his bite, the crowd), his health taken a second, and his kill time in runs that cleared his wave. `BOSS_TRACE=1` prints where he and the player stand every 5 s of a fight.

Tuning log, 2026-10-28, 21 tries of 32 to 200 runs. The far attacks were the cost, not the hold: the new boss without them won 26% of 96 runs, and a first cut with them 0%. Holding spawns or slowing the wave clock while he stood did not help. His health was a weak lever, since he soaks the horde's time, not his own. Trimming the horde from 20 to 15 and wave 8's health scale from ×1.21 to ×1.1 brought the bots back. Kept (try 21, health 90), 200 runs a bot: default 24%, `SWAP=1` 28%, `NO_GNOME=1` 15%, `KITE=1` 1%, and `ENGAGE=1` 8.5%. The median kill in winning runs was 40 s (33 to 46), the top of the 25 to 40 s target. While he stood the default bot lost 55% of wave 8's hearts, most of them to the crowd. His health went back up from 80 to 90, not as far as the owner asked: a boss of 100 (121 on wave 8) took 53 s to kill.

- **Kill time.** The bot spends only a third of each fight shooting him: a horde is in the room from 5 s in. While it shoots him it takes 5 to 5.5 health a second with a Chatterbox at tier 1 or 2, so a player who shoots only him needs about 18 to 20 s of fire for his 99 health. Health is a weak lever on the win rate, since most of what he costs is the time the horde has while he stands, and a long fight lets more of it in.
- **Caveats.** The bot still holds the middle of the room, which is far from him while he walks in. A person who stays near him should see more stomps and fewer far attacks. Try 20 lowers wave 8's health scale, which makes wave 8's Groaners and Kaboomers as tough as wave 6's. That is the trade that let the boss stay a real fight inside the win targets: the boss is now the step up on wave 8, not the crowd's health.

### New kinds, frenzy, and the Kaboomer pass

Added on 2026-10-28 from owner feedback, all approved: lighter, more cartoony greens; a Kaboomer that is "a great idea, but not that cool"; a reason to fear big packs; a zombie that throws zombies; and one that crawls out of the floor. Built, not yet playtested. The code is in `src/frenzy.ts`, `src/chucker.ts`, `src/crawler.ts`, `src/actions.ts`, the kind rows in `src/zombies.ts`, and the art in `src/sprite.ts` and `src/zombieView.ts`. `tools/audit/shots17.ts` guards the art pixel for pixel: every kind at every wear stage and a room of Gasbags under fire.

- **Greens.** The Groaner's skin went from `#6fae4f` to `#8ed65e` and its shade from `#4d8a35` to `#5fa83f`, the Hotfoot's from `#c9d660` to `#dcee7a`, and their limb and scalp bits to match. The Groaner's eyes went from red to pale yellow, so red eyes now mean frenzy. Each kind keeps its own look: the Groaner is leaf green in a purple shirt, the Hotfoot yellow-green in orange, the Kaboomer a yellow sack around a lime glow, the Big Lug blue-grey, the Big Leaguer mint teal in a striped vest, and the Ankle Biter pale sage and low to the floor. None is a skin tone the player can pick.
- **Names.** The Thrower is shown as the Big Leaguer. The Crawler is shown as the Ankle Biter, not Gravecrawler, which is already the name of a published trading card.
- **A zombie's action.** Every zombie now carries an action apart from whether it is alive: Roaming, Winded (walks but cannot grab), Hefting (a Big Leaguer winding up), Carried, Flying, Dazed, Burrowed, or Clinging. Only Roaming and Winded zombies steer and bite. A Burrowed, Carried, or Flying zombie is out of reach of bullets, bursts, traps, the crowd, and the bot.

#### The Kaboomer (the Gasbag pass)

Superseded on 2026-10-29 by "The Kaboomer and the Big Leaguer". It was shown as the Gasbag then: a sickly yellow sack with a glowing, pulsing lime belly and a brass valve, whose pulse quickened as he got close or was shot. What stayed: the red floor ring the size of his 28 px burst, and the longer fuses that make it readable, 200 ms after he is shot (was 140) and 340 ms after he touches the player or a trap (was 220).

#### Horde frenzy

- **Who.** Every pack of four or more that walks in through a door together, of any kind: a squad, a pincer pack, or a horde pack. Packs from the floor never frenzy. Wave 2 no longer has a pack of four, so the first frenzy comes in wave 3's first pincer.
- **The look.** Red eyes with a red glow around the head and a puff of steam. The pack's door warning shows a HORDE! callout over the doorway with a howl. Only the newest HORDE! callout stays up, so a horde from every door shows one.
- **The speed.** 15% faster while frenzied (`FRENZY_RULES.paceScale`).
- **Staying together.** A frenzied zombie with no frenzied packmate within 40 px for 0.9 s fades: its glow blinks off and its speed falls back over 1 s, and then it is spent for good. The last of a pack fades the same way.
- **The bonus.** Killing every zombie of a frenzy pack pays $1 a zombie on top of the bounties, with a coin popup and a chime. A Kaboomer of the pack that blows on the player was not killed, so that pack pays nothing. The bot earns about $137 a campaign from it, over about 33 frenzied packs.

#### The Big Leaguer (the Chucker pass)

Look and stats superseded on 2026-10-29 by "The Kaboomer and the Big Leaguer". It was shown as the Chucker then.

- **Who.** A lanky zombie with long arms and big hands, in a red striped vest. Health 8, speed 17 to 21, bite 1 heart, bounty $8, drops a goodie 12% of the time, shows a health bar once hurt.
- **What it does.** It arrives winded for 1.5 s. Then, while a Groaner is in the room, it hangs back once it is within 64 px of the player, and walks to fetch a Groaner it can see within 70 px. When a free Groaner is within 10 px of its body and the player is 28 to 150 px away in its line of sight, it grabs the Groaner, heaves it overhead upside down, and flashes faster and faster for 0.9 s. Then it lobs the Groaner at where the player stands, and is winded for 3.2 s. With no Groaner in the room it walks in and bites like anyone else.
- **The throw.** A red mark of 12 px fills on the floor with a yellow sweep for the 0.9 s flight while the Groaner spins through the air with its shadow under it. A player on the mark when it lands loses a heart. The Groaner lands with a thud and dust and lies dazed with stars for 1 s, open to fire, then gets up. If the Big Leaguer is shot down mid-heave, its Groaner drops dazed.

#### The Ankle Biter

- **Who.** A half-buried crawler that drags itself on its arms. Health 2, speed 26 to 32, no bite, bounty $3.
- **Coming up.** It never uses a door. When it is due, the seeded generator draws a spot on open floor at least 56 px from the player, clear of the doorways, the stall, and the traps (up to 12 draws, then the open spot farthest from the player). For 1.5 s a dust ring spreads, pale cracks split the boards, a hole opens, and a claw pokes through, with a rumble. It stays down while the player stands within 40 px of its cracks, so it never comes up near the player. Then it bursts out with splinters and dust.
- **The grab.** One that reaches the player clings to their ankles for 1.1 s, halving their speed, then lets go and is winded for 2.6 s.
- **The preview.** The door preview counts it in a FLOOR box in the middle of the room, not at a door, and the screen reader says "Up through the floor". Its packs never rattle a door, ring the DINNER BELL, or wait for a camper.

#### The wave plan

- **Wave 2** has packs of 1 to 3 instead of up to 4 (`[2, 3, 1, 3, 3, 3]` and `[3, 2, 3]`), so it stays a Hotfoot lesson.
- **Wave 3** learns frenzy: its first pincer's packs of 4 and 5 frenzy.
- **Wave 6** debuts the Big Leaguer: two from one drawn door, 16 s apart, among Groaner-heavy squads. One straggler fewer.
- **Wave 7** debuts the Ankle Biter: three, 9 s apart, from 7 s in. A Big Leaguer joins the second cycle.
- **Wave 8** adds two Ankle Biters and a Big Leaguer under the boss's last third.
- **Endless** adds 1 Big Leaguer plus one for every 4 waves past 8, and 1 Ankle Biter plus one for every 3.
- **Health.** Waves 5 to 7 scale health by ×1, ×1.03, and ×1.1 instead of ×1.03, ×1.08, and ×1.17. Wave 8 stays ×1.1.

#### Balance

The bot changed with the kinds. It steps off a thrown Groaner's landing mark (the mark's radius, its body, and 6 px) and keeps 8 px more than the hold radius from an Ankle Biter's cracks. It backs off from a frenzied zombie 5 px sooner, in proportion to the extra speed. It never shoots at a zombie under the floor or in the air, never boards a door for Ankle Biters, and blames a landing on the Big Leaguer. The report adds Big Leaguer throws and how many landed, Ankle Biters surfaced and grabs, and frenzied packs and bonuses. `TUNE` files can edit `CHUCKER_RULES`, `CRAWLER_RULES`, and `FRENZY_RULES`. `NO_DODGE=1` ignores every floor tell.

Tuning log, 2026-10-28, five tries at 200 runs. Frenzy was the cost, and the Big Leaguer and the Ankle Biter barely touched the bot. A pack bonus of $3 a zombie paid $412 a run, so it became $1. Kept (frenzy ×1.15, health ×1, ×1.03, and ×1.1 on waves 5 to 7): default 25.5%, `SWAP=1` 29.5%, `NO_GNOME=1` 11%, and `KITE=1` 0.5%, with 49% and 39% of wins close calls and wave 8 the biggest killer. A default run met about 33 frenzied packs (wiping 30 for $137), 1.4 throws, and 3.4 Ankle Biters; Kaboomers cost 30% of lost hearts. Endless reached a median wave 8, best 13.

- **Caveats.** The bot steps off every landing mark at once and shoots each Ankle Biter as it comes up, so the Big Leaguer lands about 1 throw in 15 on it and no Ankle Biter has grabbed it yet. A person who is busy shooting will be hit and grabbed far more, and the new kinds will cost more than these numbers say. Playtest them before trusting this.

#### Performance

`src/perf.scene.test.ts` now stages a Big Leaguer heaving a Groaner, another Groaner in the air over its mark, an Ankle Biter about to come up, a Kaboomer shot twice and pulsing beside the player, and a frenzied pack of seven in its worst case, with one HORDE! callout and a pack bonus among the popups. The room measured 2656 shapes, 1577 steady paint operations, 1564 fill changes, 1659 shapes painted, and 2986 on a full repaint, against 2628, 1554, 1557, 1641, and 2952 before. The steady paint budget rose from 1560 to 1585: the HORDE! callout is 14 operations and the red glow and steam of seven frenzied zombies another 14. The Kaboomer was redrawn so its glowing belly costs no more runs than the old sprite, and the staged sights cost nothing net, since a buried Ankle Biter is cheaper to draw than the zombie it replaced. Every new sprite is built once at module scope, including a red-eyed frame set per kind and stage for frenzy.

### Difficulty levels and planks as bait

Added on 2026-10-28 from owner feedback, all approved: at most two Plank Piles, slow zombies that go after barricades, and four difficulty levels with a locked Nightmare. Built, not yet playtested. The code is in `src/difficulty.ts`, `maybeBaitDoor` in `src/simulation.ts`, the bait fields in `src/pathing.ts`, `BAIT_RULES` and the trap table in `src/traps.ts`, the card and SETTINGS row in `src/homeView.ts` and `src/menu.css`, and the end screen row in `src/screens.ts`. `tools/audit/shots33.ts` and `tools/audit/shots34.ts` check the difficulty picker.

#### The plank cap

- **Two at most.** The Plank Pile's limit went from 4 to 2. The shop refuses a third with "Two plank piles max", counting placed piles and the ones in the pack, and placing a third says the same in the trap notice, over the player and on the PLACE button. The Grumpy Gnome keeps its own limit of 2 and its old wording.
- **Why.** With planks that cheap, boarding up every door was the answer to everything. Two piles still close the two busiest doors.

#### Boarded doors are not spawn points

Added on 2026-10-29 from owner feedback: "zombies are spawning behind the windows that are boarded up. Should block those spawn points."

- **The rule.** A doorway with a standing Plank Pile is no spawn point. A pack or straggler due there comes through the next open door clockwise (North, East, South, West). With two piles at most and four doors, at least two doors are always open. The code is `src/doorRoute.ts`.
- **Pincers.** The two packs of a pincer keep to two different open doors: the earlier pack picks first, the later one avoids its door, and neither takes the door its mate keeps. A horde's pack from a boarded door joins the next open door's pack.
- **Live and honest.** Spawns keep their planned doors and are rerouted wherever they are read: the door preview, the rattle, doorway camping, and the arrival. Placing a plank in Preparation moves that door's counts in the preview at once, and a plank that breaks moves them back. Once a pack has rattled its door, its door is kept (`packDoors` in `Pacing`), so a plank breaking after the warning cannot move it. A plank that breaks mid-wave makes its door a spawn point again for the packs that have not been warned.
- **Not rerouted.** Ankle Biters already come up only on open floor inside the room, clear of the doorways and the traps, so never behind a boarded door. Uncle Chunk keeps his drawn door and smashes through a pile on it.
- **The bot** boards the door with the most spawns after the planks already up, so its second pile goes where the first one sent the zombies.

#### Slow zombies chew planks

- **Who.** Groaners and Big Lugs, the two slow walkers. A Groaner is the shambling baseline, so stopping to gnaw wood fits it. The Big Lug is as slow and as dim, and it is the zombie planks are meant to buy time against: a Big Lug that chews a pile for 2.5 s (12 a second against 30 health) is a Big Lug that is not chasing the player. Hotfoots, Kaboomers, Big Leaguers, and Ankle Biters ignore planks, and so does the boss: the fast ones are hungry for the player, a Kaboomer is a bomb that wants the player, the Big Leaguer is busy throwing, and the Ankle Biter is down in the floor.
- **Frenzy wins.** A frenzied zombie only has eyes for the player, so a frenzied Groaner pack walks past a plank. Once its frenzy fades or is spent, the pull works again.
- **The rule.** A Drawn zombie inside the room goes for the nearest standing Plank Pile when its walk to that pile's inner face is at most `BAIT_RULES.pullPx` (60 px, six tiles) and shorter than its walk to the player. Walking distance, not a straight line, so a plank behind a wall does not pull. It chews the plank from inside like any zombie that touches it (a Groaner 3 a second, a Big Lug 12), and when the plank breaks the doorway is open again. Outside the room nothing changed: a zombie at a boarded door still compares chewing with walking around.
- **Cheap.** Each doorway's field toward its inner face is built once when the module loads, four doorways for two clearances, and never again, since a barricade never moves. A frame costs each slow zombie two array lookups per standing plank. No zombie ever searches for a path.
- **Bait, not a win.** A plank near where Groaners come in buys a few seconds per zombie and costs the plank, and a plank chewed through opens its door again for the packs not yet warned. Before boarded doors stopped spawning, the pull cost the default bot about 4 points of wins (25.5% to 21%). Since then the pull radius barely moves the bot (try 4 below).

#### Difficulty levels

- **Four levels.** Easy, Normal (the default, today's game), Hard, and Nightmare. Each scales every zombie's base health and speed on top of the wave's own scales, the boss and his belched Groaners too, and scales bites. A bite is whole hearts, so it rounds and never drops below one. Endless uses the same multipliers. The wave's kinds, doors, and timing are the same on every level for a seed; only health, speed, and bites change, so the door preview stays exact.

| Level     | Health | Speed | Bite  | Groaner bite | Big Lug and boss bite |
| --------- | ------ | ----- | ----- | ------------ | --------------------- |
| Easy      | ×0.85  | ×0.95 | ×0.5  | 1 heart      | 1 heart               |
| Normal    | ×1     | ×1    | ×1    | 1 heart      | 2 hearts              |
| Hard      | ×1.12  | ×1.04 | ×1    | 1 heart      | 2 hearts              |
| Nightmare | ×1.18  | ×1.06 | ×1.25 | 1 heart      | 3 hearts              |

Normal was ×1.05 health and ×1.02 speed from 2026-10-28: boarding doors made planks stronger (see "Boarded doors are not spawn points"), and those scales brought the bot back to its targets without touching the wave tables. Superseded on 2026-10-29 from owner feedback ("make planks more expensive instead of tweaking Normal"): Normal is ×1 again, and the Plank Pile costs $40 instead of $20, so boarding both busy doors is $80 of a $171 visit before wave 4. Glue and Nails scales with the price, so repairs cost twice as much too. To keep the top SMG tier in reach by wave 8 with the dearer planks, the Blabbermouth 3000 costs $350 instead of $400. Health rounds per zombie, so a Groaner has 3 on Easy, Normal, and Hard and 4 on Nightmare only from wave 6 on, while a Big Lug's 30 becomes 26, 30, 34, and 35.

- **The first-time card.** The first PLAY or ENDLESS of the page session (button, Enter, or E) shows HOW TOUGH ARE YOU? with four choices and a blurb each: Easy "Just here for the vibes", Normal "The way it's meant to be played", Hard "They bite back", and Nightmare "No mercy. Bring snacks". It is the menu panel dialog, so Tab, Esc, and touch work as in SETTINGS, Normal has the first focus, and it fits 667x375 without scrolling (a 2 by 2 grid of 48 px buttons). Picking one starts the mode that was pressed. Closing it starts nothing and the next PLAY asks again. After the first pick the difficulty changes in SETTINGS, where a row of four buttons sits above the toggles, with the chosen one pressed.
- **Nightmare.** Shown from the start with a padlock, dashed and dimmed, with "Beat Hard to unlock". Winning a Hard campaign unlocks it with a small fanfare: the power-up chime, NIGHTMARE UNLOCKED! PICK IT IN SETTINGS blinking under the Victory stats in place of the feedback line, a screen reader line, and a NEW! badge on Nightmare in the card and SETTINGS. The badge goes when the next run starts.
- **Shown.** Game Over and Victory show DIFFICULTY as the first stats row (Hard in red, Nightmare in dark red), and the screen reader line starts with it. The bests are kept per difficulty, and the home strip is titled YOUR BESTS, NORMAL (or the chosen level) and shows that level's bests.
- **Saved.** Since 2026-10-29 the chosen level, whether the card was answered, and the Nightmare unlock are in the on-device save (`PlayerSave` version 2 in `src/save.ts`). A version 1 save loads as Normal with the card still to come. Since the same day the bests per level are saved too (version 3). See `PLATFORM.md`.

#### Balance

`DIFFICULTY=easy|normal|hard|nightmare bun run balance` plays the bot on a level, and `TUNE` files can edit `DIFFICULTIES` and `BAIT_RULES`. Targets: Easy 55 to 70% for the default bot, Normal unchanged (15 to 25% default, 30 to 45% `SWAP=1`), Hard about 5 to 12%, Nightmare about 1 to 4%.

Tuning log, 200 runs per row from seed 1. Scales are health, speed, bite. Wins are the default bot's unless the column says `SWAP=1`.

| Try | Change                                                                                                                    | Easy  | Normal      | `SWAP=1` | Hard     | Nightmare | Note                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | -------- | -------- | --------- | ---------------------------------------------------------------------- |
| 0   | Before this pass, no bait, Normal ×1                                                                                      |       | 25.5%       |          |          |           | The baseline                                                           |
| 1   | Bait 60 px. Easy 0.75/0.9/0.5, Hard 1.2/1.08/1.25, Nightmare 1.4/1.15/1.5                                                 | 82%   | 21%         | 28%      | 0.5%     | 0%        | Bait costs the bot a few points. The levels are far too wide           |
| 2   | Hard 1.1/1.03/1 and 1.05/1.05/1.25, Nightmare 1.2/1.06/1.25 and 1.15/1.08/1.5                                             |       |             |          | 6.5%, 8% | 0%, 0%    | Speed is the sharpest lever: Nightmare dies on wave 3                  |
| 3   | Boarded doors stop spawning (Normal ×1)                                                                                   |       | 32.5%       | 40%      | 13.5%    |           | Fewer doors to watch helps the bot a lot                               |
| 4   | Try 3 with pull 90 or 120 px, plank health 20 or 24                                                                       |       | 33 to 35%   |          |          |           | Plank levers barely move it                                            |
| 5   | Try 3 with plank price $45, or Normal health ×1.06                                                                        |       | 31%, 27.5%  |          |          |           |                                                                        |
| 6   | Normal ×1.05 health, ×1.02 speed (kept)                                                                                   |       | 20.5%       |          |          |           |                                                                        |
| 7   | Easy 0.85/0.95/0.5, Hard 1.12/1.04/1, Nightmare 1.18/1.06/1.25 (kept, `WORKERS=4`)                                        | 61.5% |             | 32%      | 15.5%    | 1.5%      | Baked into `src`                                                       |
| 8   | Tighter pacing, waves 4 to 7 retuned, Normal ×1/×1/×1, planks $40, the bot saves for the top spare tier before the pistol |       | 13.5%       |          |          |           | 2026-10-29                                                             |
| 9   | Try 8, waves 7 and 8 a little slower, a one-volley wave 8 horde, top SMG tier $350 instead of $400                        |       | 11 to 11.5% |          |          |           | Three batches. Most wave 8 deaths come with the boss standing          |
| 10  | Try 9 with wave 8's late Big Lug pair swapped for two stragglers                                                          |       | 23%         |          |          |           | Wave 8 then had two Big Lugs                                           |
| 11  | Try 9 with one late Big Lug and a straggler, three Big Lugs in all (kept)                                                 | 49%   | 16%         | 37%      | 4%       | 0.5%      | Planks off (`NO_PLANKS=1`): 4.5%                                       |
| 12  | Speed: Easy ×0.95 to ×0.9, Hard ×1.04 to ×1.02, Nightmare ×1.06 to ×1.04 (kept)                                           | 67%   | 16%         | 37%      | 7%       | 0%        | Before this try, the same build gave Easy 49%, Hard 4%, Nightmare 0.5% |

- **Before the tighter pacing (try 7, 2026-10-28).** Easy 61.5%, Normal 20.5% (`SWAP=1` 32%), Hard 15.5%, and Nightmare 1.5%, all in range but Hard, 3.5 points over its 5 to 12%. Nightmare lost 23% of its runs on wave 3's first frenzied pincer, where the bot meets fast packs before it has the SMG. Easy's close calls (20%) sat under the 30 to 50% target, which suits a level for the vibes.
- **After the tighter pacing (2026-10-29).** Tries 8 to 12 above, 200 runs per row from seed 1, `WORKERS=4`, measured by the nightly suite (`tools/balance/baseline.json`). Scales now: Easy ×0.85/×0.9/×0.5, Normal ×1/×1/×1, Hard ×1.12/×1.02/×1, Nightmare ×1.18/×1.04/×1.25.

  | Wave | Easy | Normal | `SWAP=1` | Hard | Nightmare |
  | ---- | ---- | ------ | -------- | ---- | --------- |
  | 1    | 0%   | 0%     | 0%       | 0%   | 0%        |
  | 2    | 0%   | 1%     | 1%       | 1%   | 2%        |
  | 3    | 1%   | 1%     | 3%       | 1%   | 23%       |
  | 4    | 0%   | 1%     | 1%       | 6%   | 14%       |
  | 5    | 1%   | 5%     | 4%       | 8%   | 17%       |
  | 6    | 10%  | 19%    | 15%      | 25%  | 25%       |
  | 7    | 3%   | 14%    | 6%       | 28%  | 18%       |
  | 8    | 21%  | 44%    | 33%      | 24%  | 4%        |

  Wins: Easy 67%, Normal 16% (close calls 34%, median win 7.9 min), `SWAP=1` 37%, Hard 7%, Nightmare 0 of 200. In target except Nightmare (0%, target 1 to 4%) and Normal deaths in waves 5 and 6 (23%, target 25 to 35%). Nightmare still loses 23% of runs on wave 3's frenzied pincer; a follow-up should try Nightmare speed ×1.02 or a gentler wave 3 on Nightmare only. Planks earn their keep without carrying the game: the bot that never buys them wins 4.5% on Normal against 16%.

- **Wave lengths and dead air, before and after (2026-10-29).** Normal wave snapshots, 100 runs a wave. Length is the mean in seconds; empty is the mean seconds with no zombie alive; quiet, measured only after, is empty with nothing at a door and spawns still to come.

  | Wave | Length before | Length after (median) | Empty before | Empty after | Quiet after (mean, longest in any run) |
  | ---- | ------------- | --------------------- | ------------ | ----------- | -------------------------------------- |
  | 1    | 17            | 16 (16)               | 6.9          | 5.7         | 1.3, 0.53                              |
  | 2    | 39            | 37 (37)               | 5.3          | 3.0         | 0.7, 0.57                              |
  | 3    | 48            | 46 (45)               | 7.5          | 4.8         | 1.1, 1.03                              |
  | 4    | 66            | 56 (55)               | 6.6          | 2.8         | 0.5, 1.03                              |
  | 5    | 64            | 61 (61)               | 7.7          | 5.4         | 1.3, 1.07                              |
  | 6    | 58            | 65 (58)               | 5.5          | 3.1         | 0.9, 1.07                              |
  | 7    | 78            | 65 (69)               | 10.0         | 4.8         | 1.3, 1.07                              |
  | 8    | 77            | 72 (71)               | 9.8          | 4.7         | 1.4, 0.67                              |

  Empty seconds still count the start of the wave, the frames after the last kill, and the boss fight with no other zombie, which are not dead air.

- **Caveats.** The bot does not change how it plays on a harder level, and it never uses a plank as bait on purpose. A person on Easy will feel the slower zombies more than the bot does, and a person who learns to lure Groaners onto a plank will get more from it.

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

The first four are built, and so is the boss. The Big Leaguer and the Ankle Biter joined them on 2026-10-28. Their numbers are under "Proposed balance" above, and the boss's under "Wear and the boss".

| Type     | Name shown to players | Idea                                                                             |
| -------- | --------------------- | -------------------------------------------------------------------------------- |
| Shambler | Groaner               | The baseline. Slow, average health.                                              |
| Runner   | Hotfoot               | Fast and fragile. Punishes a room with many doors.                               |
| Tank     | Big Lug               | Slow and very tough. Rewards traps and strong guns.                              |
| Spitter  | Not built yet         | Attacks from range, so a closed door alone is not safe.                          |
| Exploder | Kaboomer              | Hugs a bomb that goes off when he dies, damaging nearby traps and players.       |
| Thrower  | Big Leaguer           | Hangs back, lobs Groaners at the player, and shields himself with a held zombie. |
| Crawler  | Ankle Biter           | Comes up through the floor and grabs the ankles.                                 |
| Boss     | Uncle Chunk           | The wave 8 finale. Stomps, charges, spits, burps, sheds.                         |

- **Data, not logic.** A kind is a row in a table: speed, health, bite, radius, mass, knockback, bounty, a behavior tag (`Brawler` bites, `Bomber` fuses and bursts), how it dies, its gibs, its sounds, and its footfalls. Its sprites are a row in a second table keyed by the same kind. Both tables are exhaustive records, so a new kind will not compile until it has both rows.
- **Big zombies path differently.** The Big Lug is wider than one tile, so it follows its own flow field that only steps between tiles sharing an open 2×2 block. It goes around one-tile gaps between cover and walls that a Groaner squeezes through.
- **Bursts hit anything.** Burst damage is applied through one function that takes any list of targets: the player, zombies, and traps.

## Waves

- Casual play runs a set number of waves and ends in `Victory`. The target is 15.
- An endless mode keeps going until the player dies. Built: see "Modes" under the first playable.
- Wave contents come from spawn tables that grow harder with the wave number.

## Technical notes

- The world is drawn with Foldkit's `Canvas` module. Foldkit 0.169.0 ships `Rect`, `Circle`, `Path`, `Text`, and `Group`; the game adds the upstream `Canvas.Image` through a patch (see `patches/README.md`). Every fixed sprite is one image from a PNG data URL, and shapes that change every frame stay rectangles. See [foldkit/foldkit#1831](https://github.com/foldkit/foldkit/issues/1831).
- The canvas repaints the whole scene on every frame. Frame time on a mid-range phone was the main risk. It was measured on 2026-10-28 with a throttled desktop Chrome, not yet on a real phone. See "Performance" under Risks.
- Scene code builds Groups with the `group` helper in `src/sprite.ts`, not `Canvas.Group`. Foldkit's `Canvas.Group` parses every nested shape through Schema on each call, because its `shapes` field is recursive, and that cost more than everything else in the view.
- Frame ticks and pointer moves are kept out of DevTools history so it stays readable.
- Touch input uses a document-level pointer Subscription that tracks each finger by `pointerId`, because the canvas pointer callbacks do not say which pointer fired.
- Game logic is covered by Story tests that replay Messages. Determinism is itself tested.

### The Kaboomer and the Big Leaguer

Added on 2026-10-29 at the owner's request. Built, not yet playtested. The kind ids stay `Exploder` and `Thrower`, so saved intro cards still match. The code is in `src/zombies.ts`, `src/chucker.ts`, `src/combat.ts`, `src/simulation.ts`, the art in `src/sprite.ts` and `src/zombieView.ts`, and the pop in `src/effectsView.ts` and `src/particles.ts`. `tools/audit/shots17.ts` guards the art pixel for pixel: every kind at every wear stage and a room of Gasbags under fire.

#### The Kaboomer

- **Name and card.** The Gasbag is now the Kaboomer. Card: HE WANTS A HUG. POP HIM FROM FAR AWAY. Banner tagline: HE BROUGHT A BOMB TO SHARE.
- **The look.** A hunched lime zombie with big googly eyes and a toothy grin, hugging a big round black cartoon bomb with a white shine, a grey neck, and a lit fuse. It is a round bomb held in his arms, never a vest or anything strapped to him. He waddles.
- **The fuse.** It replaces the belly pulse with the same stepped urgency: nearness within 80 px plus 0.35 per wear stage, in five steps. The fuse runs from 6 px when he is far to 1 px when he is close, and its sparks flicker every 180 ms down to every 50 ms, with 2 sparks, then 3 from halfway. Each fuse length and walk frame is one prebuilt image laid over his sprite, plus a spark core and 2 or 3 spark pixels.
- **The tell.** Unchanged: the red floor ring fills while he blows, 200 ms after he is shot and 340 ms after he touches the player or a trap. The bomb flickers red-hot and he swells, with sparks spraying from the bomb's neck.
- **Chains.** Any burst now lights a Kaboomer's bomb whatever his health, so chains still ripple 150 ms apart even though one burst (6) no longer kills a tougher one.
- **The pop.** A cartoon KABOOM: a white flash with a yellow core, then a fireball shrinking inside a growing shockwave ring and a three-puff smoke cloud that rises and fades, a KABOOM! popup, six puffs of grey smoke, eight drops of blood, ten sparks, three meat gibs, and four black bomb shards. That is 31 particles, down from 33.
- **Sounds.** A bullet on the bomb is a metal clonk and sprays sparks, not goo. Lighting the bomb is a fuse fizz. The boom is longer and lower.
- **Wear.** At 2/3 his hugging arm comes off and he holds the bomb one-armed. At 1/3 the casing cracks with a hot orange glow, his head is scorched, and he loses a tooth.
- **Stats.** Speed 14 to 17 (was 20 to 25, about 30% slower), health 6 (was 3), bounty $4 (was $3), body radius 5.5 (was 4.5) for his bigger sprite. Wave 4 sends 3 lone Kaboomers instead of 5.

#### The Big Leaguer

- **Name and card.** The Chucker is now the Big Leaguer. Card: HE PITCHES ZOMBIES. GET CLOSE AND HE HIDES BEHIND ONE. Banner tagline: HE PITCHES ZOMBIES.
- **The look.** A lanky mint zombie pitcher in a torn pinstripe jersey with a red number and blue sleeves, grey baseball pants, and a backwards red cap. His long arms hang to the floor and drag his knuckles, so he reads as a thrower empty-handed. His wind-up holds the Groaner overhead with a high leg kick. For half a second after a throw he pumps his fist. A thrown Groaner still spins through the air.
- **Wear.** At 2/3 his cap flies off, showing a gash. At 1/3 his throwing arm hangs limp: no fist pump, and his wind-up takes 1.35 s instead of 0.9 s.
- **Stats.** Speed 13 to 16, never faster than the slowest Groaner (was 17 to 21). Health 14 (was 8). Bounty, bite, and drop chance are unchanged. He still hangs back at 64 px, fetches Groaners within 70 px, and throws as before.
- **The shield.** When the player comes within 50 px, or he is hit, he yanks the nearest small zombie within 20 px of his body in front of him: a Groaner first, then a Hotfoot or an Ankle Biter, never a Kaboomer, a Big Lug, or the boss. The yank flashes the held zombie and plays a yank sound. He stands still, cannot throw or bite, and turns toward the player at 1.4 radians a second, so a player who circles him gets a side shot. A bullet that comes at him from within 60 degrees of where he faces hits the held zombie instead, which takes the damage and can die. Shots from the side or behind, piercing shots, and bursts reach him, and bursts never hurt the held zombie. The shield drops after 4 s or when the held zombie dies, the held zombie stumbles off dazed for 0.6 s, and he cools down for 2.6 s before he can shield again.
- **The bot.** It shoots something else while a shield faces it, and the report counts shields per run.

#### Balance

Measured on 2026-10-29 with 200 runs per bot from seed 1, on the code before the save on the device and the difficulty levels. Earlier, the new kinds pass measured 25.5% (default) and 29.5% (`SWAP=1`).

Four tries. A slower, tougher Kaboomer alone, and then with the Big Leaguer, his shield, and 3 lone Kaboomers on wave 4 (try 2, shipped), gave the default bot 15.5% and `SWAP=1` 18.5%. Fewer Kaboomers in mixed packs made it harder (10%), since his chains clear packs for the bot, and a $6 bounty with more drops changed little (14.5%).

In try 2, deaths by wave (default) are 0, 0, 1, 3, 10, 24, 11, and 37%, so wave 8 is still the biggest killer. The Big Leaguer costs about 1% of lost hearts and raises about 1.3 shields a run. The default bot sits at the bottom of its 15 to 25% range and the `SWAP=1` bot is well under its 30 to 45%.

Then measured again on Normal after the difficulty levels, the plank cap, and plank chewing landed, with `bun run balance 200`: the default bot won 23 of 200 (11.5%) with 9 close calls, and the `SWAP=1` bot 50 of 200 (25%) with 11. Deaths by wave (default) are 0, 0, 2, 1, 4, 18, 15, and 50%, so wave 8 is the biggest killer. Kaboomers cost 32% of lost hearts (31% for `SWAP=1`) and the Big Leaguer 1%, with 2.2 throws and 1.4 shields a run. Both bots are under their ranges; the pacing pass that follows rebalances every difficulty.

### Rendering for bigger maps

Set up on 2026-10-28, ahead of the estate. Nothing on screen moved, because today's one room is exactly one view.

- **The level.** `Level` in `src/arena.ts` holds the tile rows and the size they make: columns, rows, width, and height. `VIEW_WIDTH` and `VIEW_HEIGHT` in `src/constants.ts` are only the screen: 320×180 pixels. Changed on 2026-10-29, ahead of the manor: the level is now data the Model carries. The Model's `level` names the level and its open exits (`{ id: 'Parlour', openExits: [] }`), and `levelOf(model)` returns the built `Level`. A level is built once for each set of open exits from its `LevelSpec` (the tile rows and the exits) and kept, with its solid tiles, its doors, door thresholds and door tiles, and its spawn doors (`doorIds`) worked out up front, so a frame only reads them. Every function that reads the map takes the level: collision, rays, the flow field, steering, spawning, the boss, traps, pickups, particles, the camera, the door previews, and the room canvas. `PARLOUR` is the one level today; a fresh run starts there, and the shop stall stands there.
- **Exits.** A `LevelSpec` lists exits: a boarded doorway with its own map symbol and the doors behind it. While an exit is closed its tiles are solid and drawn boarded up, and its doors are shut and left out of the spawn doors. `openExit(level, id)` returns the level with that exit open, where its tiles are floor and its doors join `doorIds`, and `openExitIn(model.level, id)` does the same to the Model's record. The parlour has no exit yet, so nothing in play changed; the kitchen step adds the first exit and what it costs. The wave tables still name the parlour's four doors, so that step also decides how spawns use the doors an exit adds.
- **Caches.** Anything derived from the map is keyed on the `Level`, which is a new record whenever an exit opens. The flow fields store the level's `key` and rebuild when it changes, even if the player has not moved. The pathing tables (open neighbors, the plank bait fields, the outside loop) and the room's shapes are kept per `Level`, and the room and decal canvases' lazy views take the `Level` as an argument, so they repaint only when it changes.
- **The camera.** `src/camera.ts` derives the camera from the player, the level, and the view. It is not stored in the Model. It centers the view on the player in whole pixels and stops at the level's edges. A level no bigger than the view sits centered and still, which is why the camera is the identity today. If the camera ever eases or leads the aim, it has to move into the Model, because it would then depend on the frames before. Changed on 2026-10-29 by "Portrait play": the camera takes a window size, the world window in portrait, and its aim lean is the Model's `cameraLean`. The camera itself is still derived.
- **World and screen.** The scene canvas draws the world inside one Group translated by the screen shake minus the camera. The floor canvases move by the same offset with a CSS transform. The overlay canvas is screen space: the HUD, banners, and cards ignore the camera, and the door markers, callouts, and the trap notice turn their world anchor into a view point. The mouse is stored in view pixels and turned into a world point through the camera each time the aim is worked out, so the aim stays right while the camera moves under a still cursor. The hint band follows the player's place on the screen, not in the world.
- **Depth.** Standing things (the stall, traps, pickups, zombies, and the player) are drawables sorted by the y of their feet, with a rank to break ties. Shadows, dust, ghosts, rattling doors, and bullets stay under them. Muzzle flashes, health bars, blasts, airborne particles, popups, and the reload bar stay over them. Cover is drawn on the cached floor canvas because no free-standing piece rises more than 2 pixels above its tiles. The tall ones (the piano, the fireplace, and the bookshelf) stand against the north wall and rise up its face, where nobody can walk behind them. Tall props out on the floor would need to join the sort.
- **What a bigger map still needs.** The floor canvases are the size of the level. A map a few screens wide still fits one canvas, but a large estate would want the floor cut into tiles that are cached and drawn only near the view, or a canvas image shape (see foldkit/foldkit#1831). The door preview markers sit just inside each door, so on a scrolling map a door off screen needs an arrow at the screen edge instead. The alive cap of 20 is tuned for one room on screen. With zombies out of view it may need to count only the zombies near the player, or rise, and frame cost has to be measured again with zombies drawn off screen culled by the camera.

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
- Content depth: more weapons, hats, Spitter, and the 15-wave campaign. Hats will sit on top of the character looks.
- Character looks. Built on 2026-10-28 and saved on the device: see "Character" under the first playable and "Saved on the device".
- Upgrade tiers. Done on 2026-10-28: see "Upgrade tiers and endless mode" under the first playable.
- An endless mode. Done on 2026-10-28, with Keep going from Victory: see "Upgrade tiers and endless mode".
- Music. Done on 2026-10-28: see "Music" under the first playable.
- Dropped power-ups. Done on 2026-10-28: see "Power-ups" under the first playable.
- Co-op.

### Future vision

Approved ideas that are not built yet. Each moves into the roadmap above when it starts.

- **The Munchopedia, the home menu layout, and What's New.** Built on 2026-10-29: see "The fixed home layout", "What's New", and "The Munchopedia" under "The home menu, the loading splash, and taps".
- **Portrait play.** Built on 2026-10-29: see "Portrait play" under the first playable.
- **Exploring the manor.** Raised on 2026-10-29. The shape, the run length, exploring, and the first room were decided with the owner on 2026-10-29; the rest below is still a sketch.
  - **Decided on 2026-10-29.**
    - **Buy rooms open.** One manor per run. Every run starts in the parlour, whose exits are boarded. The player buys an exit open with money, so every dollar is a choice between a gun and a room. An opened room adds space, loot, and options, and its doors join the spawn doors.
    - **The campaign grows.** The campaign itself becomes the manor run, so a campaign run gets longer than today's 5 to 10 minutes. There is no separate quick mode. The wave count and length are set when the second room lands, with the balance tools.
    - **Explore in breaks.** Rooms are bought and explored between waves. Waves still arrive on the sawtooth, so the pacing rules and the balance tools stay valid.
    - **The kitchen first.** After the groundwork that makes a level data in the Model, the first room built is the kitchen, next to the parlour: ovens to trip and slippery soup.
    - **No off-screen hints.** The owner's earlier rule holds on a bigger map: nothing on screen points at zombies or doors out of view.
      - **Teammates are the exception.** Decided on 2026-10-29 with co-op: an off-screen teammate shows as a small avatar at the screen edge. Zombies and doors still get nothing. See `MULTIPLAYER.md`.
  - **Shape.** The parlour stays a tight killer intro room for the first waves. Its exits are boarded or locked, and the player buys them open with money, so every dollar is a choice between a gun and a room. Opening a room adds space, loot, and options, but also new spawn points.
  - **Rooms with one signature twist each.** Kitchen (ovens to trip, slippery soup), library (bookshelf passages, a rare-gun stash), ballroom (open floor for hordes, a chandelier to shoot down), cellar (dark, lit only near the player), graveyard outside (floor spawns, Uncle Chunk's arena), attic (one entrance, a risky stash).
  - **A goal beyond surviving.** For example restoring the manor's power or finding keys to Uncle Chunk's cellar. Interactive pieces such as a fireplace trap, a mystery box, or a dumbwaiter between floors.
  - **Variety.** The layout stays hand-made (see "Not now"), while secrets, loot spots, and locked doors shift with the seed. Rooms get Munchopedia pages when discovered.
  - **Open questions.** Does every run start in the parlour and expand, or does the player pick a wing? Do waves keep coming while exploring? One big manor or several maps as chapters? How does a full-manor run fit the 5 to 10 minute run length, perhaps as a longer mode with the parlour as the quick mode?

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
- **The Kaboomer lag and sprite images.** Measured on 2026-10-28, same method, with a new `gasbags` scenario that keeps 16 Kaboomers in the room while the bot pops them. At 6x the CPU profile showed update frames of 13 to 17 ms against a mean near 3 ms. The cause was not the Kaboomers: the flow field copied the whole tile grid once per distance ring every time the player crossed a tile, and every frame rebuilt the wave phase with its Schema constructor, which parses the whole spawn list. The flow field now settles tiles from distance buckets (same distances, about six times cheaper) and the phase is copied with `modifyFields`, and the worst update frame at 6x fell to about 6.5 ms. Then every fixed sprite, glyph, and baked text became one `Canvas.Image` from a PNG data URL (Foldkit is patched with the upstream `Canvas.Image`, see `patches/README.md`). The worst room went from 2,656 shapes, 1,577 steady paint operations, and 2,986 on a full repaint to 687, 543, and 1,120. In a 3 second CPU profile of the Kaboomer room at 4x, Foldkit's paint fell from 252 to 128 ms and garbage collection from 47 to 17 ms; update and building the scene are now most of the frame. The host was loaded (load average near 10) during the frame time runs, so FPS and p95 sat at the 60 Hz pacing for both builds and the main thread time per frame fell only a little (Kaboomers at 6x: 13.1 to 11.1 ms). SVG data URLs were tried first and dropped: Chrome builds a document for each SVG image and replays it on every draw, which cost seconds at load and saved nothing per frame. Sprites drawn under a squash, a lean, or a fractional offset are now crisp where the Rects were anti-aliased. All sprite images decode behind the loading splash as its Sprites step.
- **Determinism and juice.** Animation, particles, and shake live in the Model and use the seeded generator, so they stay reproducible. Sound and music play through Commands and never feed back into the game.

## Open questions

- Do traps break, wear out, or get rebuilt each preparation phase? Proposed for step 6, not yet decided: traps stay where they were placed between waves and keep their damage, the shop sells a repair for all of them priced by the missing health, broken traps are gone, and a new run clears them. See "Proposed balance".
- Does a dropped heart exist, and how rare is it? Proposed on 2026-10-28 with the power-ups: yes, the Pickled Heart, weighted so it is about 1.6% of drops (one every four runs for the bot), and only while the player is missing a heart.
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
- Server-side anything. Relaxed on 2026-10-29: run analytics and device sync run on Cloudflare. See `PLATFORM.md`.
- Accounts, leaderboards, or saved progress. Relaxed on 2026-10-28 (owner-approved): preferences and onboarding are saved on the device (see "Saved on the device"). Since 2026-10-29 the bests, the kills per kind, and the Nightmare unlock are saved too, and linked devices share them. The run itself is still not saved, and there are no accounts or leaderboards.

### Junk armor and smaller Kaboomers

Added on 2026-10-29 from owner feedback, approved: "Kaboomer is a bit too big", "Big Lug is a bit too small and should look like an ARMORED zombie whose armor falls off as he is hit". Visual only: no stats, radius, or pathing changed. `tools/audit/shots17.ts` guards every kind at every wear stage pixel for pixel.

- **The Big Lug.** Redrawn from 14 by 14 pixels to 18 by 19, a scrawny blue-grey zombie in junk armor: a bucket helmet with eye holes, a pot lid on his left shoulder, and a stop sign chained to his chest. His collision radius stays 6.5, so the armor sticks out a little past it, the way a shoulder pad would. His wear stages knock off the pot lid at 3/4 health, the stop sign at 1/2, and the bucket at 1/4 (see "Wear"). Frenzy still turns his eyes red, through the bucket's eye holes while he wears it. His debut card reads HE'S WEARING A KITCHEN. KNOCK IT OFF., with the tagline ARMORED IN JUNK.
- **The Kaboomer.** Shrunk from 18 by 17 pixels to 13 by 12 (15 by 12 with his walk sway), bomb and all, so he reads beside a Groaner without towering over the Big Leaguer. The fuse and its sparks keep their size. His collision radius (4.5, body 5.5) is unchanged and now matches the drawing better than before.
- **The Kaboomer's health bar.** With 6 health he now shows a health bar like the Big Lug's once he is hurt, lifted clear of his fuse and sparks.
