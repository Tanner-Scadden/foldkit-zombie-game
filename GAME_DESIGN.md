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
- **Onboarding.** Wave 1 is the tutorial. Control hints for the current device fade in, and the first zombies are a few slow Shamblers. No walls of text.
- **Working title.** Munch Manor. It lives in `GAME_TITLE` in `src/constants.ts`, which builds the title screen logo, the document title, and the page heading. `index.html` repeats it for the first paint, and a Scene test checks the two agree.
- **Sound.** Sound effects with an audio-unlock on the first input, and synthesized chiptune music that follows the run. See "Music" below.

#### Music

Added on 2026-10-28, after the first playable. The music is original and synthesized with Web Audio: no audio files. It is a goofy, swung haunted-house groove in E minor: a bouncy filtered-square bass, a square-and-sine organ with a shared vibrato, offbeat stabs, a wobbly sine "theremin", and a noise kit. The patterns are data in `src/music.ts`, written one token per eighth note.

- **Moods.** The title and Preparation share Creep, a sneaky 100 BPM shuffle. A wave plays Romp, a driving 138 BPM loop. Wave 8 plays Stampede, a heavier 152 BPM variation with a four-on-the-floor kick and a tritone bass. Victory and Game Over silence the loop.
- **Stingers.** A cleared wave plays a short rising fanfare before Creep returns. Victory plays a major-key fanfare. Game Over plays a descending "wah wah" phrase.
- **Transitions.** Loops change on the next bar line so they stay in time. Stingers start on the next beat so they land with the moment. Pause ducks the music to under a third of its volume, and resuming brings it back at once.
- **Mixing.** Music runs through its own bus into the shared compressor, below the sound effects. Mute (M) silences everything. Music has its own toggle: N, or the MUSIC button under MUTE.
- **Who owns what.** `update` decides only the mood, its level, and any stinger, from the phase and the two settings. It sends a `CueMusic` Command when that cue changes. Music plays only once audio is Ready, music is on, and sound is not muted. The scheduler lives with the audio engine: a fiber forked into the audio resource's scope, so releasing the resource stops it. Every 40 ms it schedules notes up to 0.2 s ahead on the `AudioContext` clock. Music never feeds back into the Model, so the game stays deterministic.

#### Proposed balance

Proposed on 2026-10-28 for step 4. These are starting numbers to play against, not decisions. They live in `src/constants.ts`, `src/weapons.ts`, and `src/shop.ts`.

- **Money.** Each kill pays the bounty of its kind (see the horde below). Clearing wave _n_ pays $20 + $5 × _n_, so wave 1 pays $25 and wave 8 pays $60. A full run earns about $1,850 (see "Balance pass" below).
- **The shop.** It opens from the wave 2 preparation onward. Wave 1 is the tutorial, the player has no money yet, and its preparation is only 6 seconds, so the stall sleeps behind a CLOSED sign until wave 1 is cleared.
- **Slots.** The pistol always stays in the first slot. A bought gun goes in the second slot and replaces whatever is there, along with its ammo. A new gun comes out in the player's hands.

| Item                  | Price | What it does                                                                                                      |
| --------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Pop Pistol            | Start | 1 damage, 250 ms between shots, an 8 round magazine, 1.1 s reload, never runs out                                 |
| Barn Buster (shotgun) | $75   | 5 pellets in a 0.75 radian spray, 1 damage each, short range, 620 ms between shots, 6 shells a load, 1.3 s reload |
| Shell Sack            | $15   | 16 more shells, up to 48. The shotgun comes with 16                                                               |
| Chatterbox (SMG)      | $120  | 1 damage, 70 ms between shots, a slight random spread, a 30 round magazine, 1.4 s reload                          |
| Chatter Drum          | $20   | 120 more rounds, up to 360. The SMG comes with 120                                                                |
| Pickled Heart         | $25   | One heart, never past the maximum of 5                                                                            |

Proposed on 2026-10-28 after the first playtest ("the pistol should have to reload, and a lower rate of fire"). Every gun fires from a magazine. The magazine size and reload time are columns in the weapon table in `src/weapons.ts`, and the upgrade tiers can change them.

- **The pistol** keeps its infinite reserve: a reload always fills its magazine. It fires about 4 shots a second instead of 7.
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

| Wave | Zombies | What is new or special                                                                     |
| ---- | ------- | ------------------------------------------------------------------------------------------ |
| 1    | 6       | The tutorial. Six slow Groaners from the north door, 3 seconds apart                       |
| 2    | 30      | NEW: Hotfoot. Twenty Groaners from the north and west, then ten Hotfoots from the east     |
| 3    | 48      | Groaners and Hotfoots from the sides, then a Hotfoot rush from the south                   |
| 4    | 75      | NEW: Gasbag. Ten Gasbags from the west among a mix from the north, east, and south         |
| 5    | 80      | NEW: Big Lug. Two Big Lugs from the north with Groaners, Hotfoots, and Gasbags around them |
| 6    | 86      | Two Big Lugs from the south and two from the east while every door opens                   |
| 7    | 90      | Three Big Lugs, west and east, with a fast mixed crowd                                     |
| 8    | 94      | The finale. Four Big Lugs in two pairs, with 90 escorts from every door, then Victory      |

Each wave is a list of groups. A group has a count, the doors it uses, a start time and an interval, and weights for each kind. The kind, door, timing jitter, and offset of every spawn are drawn from the seeded generator when Preparation begins, so the door preview shows exactly what will come. A kind's first wave uses a group of only that kind, so the "NEW" banner never promises a zombie the roll left out.

Proposed on 2026-10-28 for step 6, traps. These are starting numbers to play against, not decisions. The trap table lives in `src/traps.ts`, the chewing rates in `src/zombies.ts`, and the reach and range numbers in `src/constants.ts`.

| Trap      | Name           | Price  | Health | Most at once | What it does                                                                                                         |
| --------- | -------------- | ------ | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Barricade | Plank Pile     | $30    | 30     | 4            | Boards up one doorway. Blocks zombies and the player. The player's shots and the gnome's peas fly through the gaps   |
| Turret    | Grumpy Gnome   | $70    | 16     | 2            | Sits on a floor tile and shoots a pea (1 damage, 520 ms apart) at the nearest walking zombie it can see within 84 px |
| Repair    | Glue and Nails | Varies | -      | -            | Restores every damaged trap. Costs half of each trap's price, scaled by the share of health it is missing            |

- **Buying and placing.** Traps are bought at the stall and go into a trap pack shown in the HUD. The shop refuses a kind once the player owns its most at once, placed or not. During Preparation, T or the PLACE button puts the selected trap down, and G or the NEXT button switches kinds when both are owned. A Plank Pile goes in the doorway the player stands in or next to (within 16 px). A Grumpy Gnome goes on the tile in front of the player, never on a wall, cover, the stall or the tile in front of it, a doorway, another trap, the player, or a zombie. A ghost shows where it would go, green or red, and a refused placement says why on the button and above the player. The first trap bought turns on a hint, PRESS T / TAP PLACE IN A DOORWAY, until the first one is placed.
- **Chewing.** A walking zombie that touches a trap chews it: a Groaner 3 health a second, a Hotfoot 2, a Big Lug 12. A Gasbag that touches a trap fuses as if it had touched the player. A Plank Pile cracks at two thirds and one third of its health, shedding planks, and breaks with a crash. A Grumpy Gnome breaks with a pop.
- **Bursts.** A Gasbag burst deals 15 damage to every trap it reaches.
- **Pathing.** A barricaded doorway stays in the flow field at a toll of 25 extra tiles, and a gnome's tile at 6. A zombie outside a boarded door compares walking around the outside of the room to another door against chewing through, and takes the cheaper. The flow fields are recomputed when the player changes tile or a trap is placed or breaks.
- **Between waves.** Traps stay where they were placed and keep their damage. Broken traps are gone. A new run clears every trap and the trap pack. The wave preview stays exact: spawns are rolled when Preparation begins, and traps change only a zombie's path, never its door.

#### Balance pass

Proposed on 2026-10-28 for step 7. Still proposed, not decided. A headless bot played the game's own `update` many times to find numbers where a decent player usually falls in the second half and a full win takes about 8 minutes. Real players have not tested them yet.

- **The bot.** `bun tools/balance/simulate.ts [runs] [firstSeed]` runs it at 30 frames a second. It keeps away from the nearest zombie once one is within 36 px, otherwise drifts to the middle of the room. It re-aims every 5 frames at the nearest zombie it can see, with up to 0.22 radians of hand shake, and holds the trigger while it has a target. From wave 2 it walks to the stall and buys a heart when it has 3 or fewer, the SMG when it can afford it (else the shotgun), ammo below half, and up to two Plank Piles, which it nails into the door with the most spawns. Then it starts the wave at once, so Preparation costs only the walking. Every run is deterministic for its seed.
- **Before.** With the step 5 numbers, 40 runs: every run won, the median win took 3.6 minutes, the bot lost 1 heart in all 40 runs, and it earned about $1,570 a run. A careful player could not lose and the run was too short.
- **What changed.** Waves are longer and denser (6, 30, 48, 75, 80, 86, 90, 94 zombies instead of 4 to 40), Groaners and Gasbags have 3 health, Hotfoots 2, and Big Lugs 30. Speed climbs ×0.07 a wave instead of ×0.03. Bounties fell (Groaner $2, Hotfoot $3, Gasbag $3, Big Lug $20) so money still means choices, and the guns cost more (shotgun $75, SMG $120).
- **After.** 40 runs with the final numbers, measured after the fix that checks bullet hits along the whole path of a frame. The earlier 100-run figures were taken while bullets could skip over zombies on slow frames, which made the bot weaker than it is.

  | Wave | Reached | Cleared | Money earned by its end (median) |
  | ---- | ------- | ------- | -------------------------------- |
  | 1    | 100%    | 100%    | $37                              |
  | 2    | 100%    | 100%    | $137                             |
  | 3    | 100%    | 100%    | $290                             |
  | 4    | 100%    | 100%    | $507                             |
  | 5    | 100%    | 98%     | $783                             |
  | 6    | 98%     | 75%     | $1,131                           |
  | 7    | 75%     | 60%     | $1,475                           |
  | 8    | 60%     | 28%     | $1,848                           |

  The bot wins 11 of 40 runs. The median run lasts 7.9 minutes and the median win 8.5 minutes. The bot most often dies on wave 7. Gasbags cost it 55% of its lost hearts, Big Lugs 22%, Hotfoots 19%, and Groaners 5%. At most 27 zombies are in the room at once.

- **Caveats.** The bot never uses the Grumpy Gnome, never swaps by hand, and plays Preparation in a few seconds, so a human run adds up to 20 seconds a wave. The bot does not dodge Gasbags, which may be why they cost it so much. Playtest it before trusting any of this.

### Upgrade tiers and endless mode

Added on 2026-10-28, after the first playable. Proposed, not decided. Real players have not tested any of it.

#### Upgrade tiers

Each gun has three tiers beyond its base, sold at Rattles' stall between waves. A tier is a row in `UPGRADE_TIERS` in `src/weapons.ts`: a name, a price, and a boost that adds to damage, the time between shots, the magazine, the reload time, spread, pellets, knockback, and the ammo cap. Tiers stack, and firing reads the held gun's stats at its tier through `statsAt`. Adding a tier is a data change. The bullet carries its damage and knockback, so a shot keeps the tier it was fired with.

- **Where tiers live.** The pistol's tier is on the player. The spare gun's tier is on the carried gun, so buying a different spare gun replaces the slot and its upgrades. The shop says so in its rule line and on the gun's row. A new run resets every tier.
- **In the shop.** One row per gun, named for the next tier ("Upgrade to Gossip Box"), with the changes spelled out ("Hits for 2 instead of 1"), the price, and the current tier. A row is disabled with a reason when the gun is not carried, the gun is maxed ("Fully upgraded", price shown as MAX), or the player is short.
- **Feedback.** The gun's highlight changes color per tier (blue, pink, then gold), the muzzle flash throws more sparks per tier, and each HUD slot shows three tier pips. Buying a tier plays the cha-ching and a rising PowerUp arpeggio.

| Gun         | Tier | Name               | Price | What changes                                                             |
| ----------- | ---- | ------------------ | ----- | ------------------------------------------------------------------------ |
| Pop Pistol  | 1    | Shovey Popper      | $300  | Knockback +25, magazine 8 to 10                                          |
| Pop Pistol  | 2    | Golden Grandpopper | $500  | 250 to 220 ms between shots, reload 1.1 to 0.9 s                         |
| Pop Pistol  | 3    | Double-Dip Popper  | $750  | Damage 1 to 2, knockback +15                                             |
| Barn Buster | 1    | Barn Buster Plus   | $110  | 5 to 7 pellets, spray +0.1 radian                                        |
| Barn Buster | 2    | Silo Splitter      | $220  | 620 to 500 ms between shots, reload 1.3 to 1.0 s, knockback +40, cap +16 |
| Barn Buster | 3    | Hayloft Howitzer   | $380  | Damage 1 to 2 per pellet, cap +16                                        |
| Chatterbox  | 1    | Gossip Box         | $150  | Spread 0.22 to 0.14, knockback +10                                       |
| Chatterbox  | 2    | Rumor Mill         | $280  | 70 to 58 ms between shots, magazine 30 to 40, cap 360 to 480             |
| Chatterbox  | 3    | Blabbermouth 3000  | $450  | Damage 1 to 2                                                            |

The pistol line is expensive on purpose. The campaign is balanced on a knife edge, and the pistol is the gun that never runs dry: in early tuning a $110 tier that doubled pistol damage took the bot from 28% wins to 100%, and even a 10% faster pistol for $100 took it to about 60%. At these prices a campaign player can afford the first pistol tier late, and the damage tier is for endless.

#### Modes

The run mode is a tagged union, `Campaign` or `Endless`, chosen per run and kept in the Model.

- **Choosing.** The title, Game Over, and Victory screens show CAMPAIGN and ENDLESS buttons, which are ordinary HTML buttons for touch and mouse. On a keyboard, Enter or Space starts a campaign and E starts endless. The canvas prompt names the keys on a keyboard and says PICK A MODE BELOW on touch. A tap or click on the game itself still starts a campaign from the title and Game Over. On Victory it does nothing, so a stray tap cannot throw away Keep going: only the three buttons and their keys act there.
- **Keep going.** Victory also offers KEEP GOING (K), which carries the same run into endless wave 9 with its money, guns, tiers, traps, hearts, score, and stats.
- **Endless waves.** Waves 1 to 8 are the hand-made campaign waves. From wave 9, each wave _n_ (depth _d_ = _n_ - 8) is generated from the seeded generator when Preparation begins, so the door preview stays exact and a seed replays the same waves:
  - Health ×(1 + 0.12 _d_): wave 9 is ×1.12, wave 15 ×1.84, wave 20 ×2.44. `Zombie.maxHp` keeps the Big Lug health bar honest.
  - 4 + ⌊_d_ / 2⌋ Big Lugs from a random pair of doors, spread over the first 30 seconds.
  - 90 + 6 _d_ escorts in two groups: a main group from every door and a later rush from a random pair. Gasbag weight is 2 + 0.25 _d_ against 3 Groaners and 2 Hotfoots, and spawn intervals shrink 30 ms a wave down to a floor.
  - Speed ×(1.49 + 0.01 _d_), capped at ×1.6.
- **The alive cap.** At most 20 zombies are in the room at once, in every mode. A spawn that comes due while the room is full waits at its door and walks in when a place frees up. Without the cap the campaign bot peaked at 21 or 22 zombies in a typical run and 29 at worst, so the cap trims the busiest moments of the late campaign waves as well as endless. The balance below was measured with it.
- **What stays the same.** Preparation, the shop, traps, the wave preview, and the music (wave 9 onward plays Stampede) work as in the campaign. Endless waves bring no NEW banner, since every kind has already appeared. A THEY GOT BEEFIER banner with the health bonus shows instead, and the screen-reader preview reads it out. The HUD shows WAVE 12 without "/ 8".
- **Game Over in endless** shows the wave reached and the best wave this session. The best lives in the Model and is not saved anywhere.

#### Balance with upgrades

Measured with `bun tools/balance/simulate.ts` after the tiers landed. The bot now buys a refill, the SMG, planks, and hearts first, then spare gun tiers, then pistol tiers once its spare gun is at tier 2. It keeps $45 back after any upgrade. Two seed batches of 40 runs each (first seed 1 and first seed 500001), because one batch of 40 swings by several wins.

| Bot                             | Wins           | Median run       | Median win       | Where it falls                            |
| ------------------------------- | -------------- | ---------------- | ---------------- | ----------------------------------------- |
| No upgrades (the step 7 bot)    | 24 of 80 (30%) | 7.9 min (seed 1) | 8.5 min (seed 1) | Wave 6 (27 runs), wave 8 (21), wave 7 (8) |
| With upgrades, alive cap 20     | 26 of 80 (33%) | 7.9 to 8.4 min   | 8.6 to 8.7 min   | Wave 8 (25 runs), wave 6 (23), wave 7 (6) |
| `SWAP=1`, no upgrades, seed 1   | 16 of 40 (40%) | 8.1 min          | 8.4 min          | Wave 6                                    |
| `SWAP=1`, with upgrades, seed 1 | 26 of 40 (65%) | 8.5 min          | 8.6 min          | Wave 8                                    |

- **Campaign.** With upgrades the bot wins about a third of its runs, a median win takes 8.6 minutes, and it buys spare gun tier 2 and pistol tier 1 by the end (about $730). Wave 6 is still the first wall and wave 8 the second.
- **Swapping.** The default bot never swaps by hand, so once its spare gun first runs dry it fights on with the pistol and never feels its spare gun's tiers. `SWAP=1` re-arms the spare gun before each wave. For that bot the tiers are worth 25 points of win rate, so a player who swaps will find the campaign easier with upgrades than the default numbers suggest.
- **Endless.** `MODE=endless`, same two batches: the median run reaches wave 8, the best wave 11. Of the 26 runs that reach wave 9, 13 die there, 10 on wave 10, and 3 on wave 11. Endless is a wall after the campaign, which suits a mode that only ends one way. Playtest before trusting it.

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
