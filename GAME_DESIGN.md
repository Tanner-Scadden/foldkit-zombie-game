# Game Design

The vision for the game in one place. "Decided" is settled; everything after it describes what is built and how it is tuned, and the last sections hold ideas, open questions, and what is out of scope. Implementation detail lives in the code and the tools READMEs, not here.

## Inspiration

[Zombie Estate 2](https://www.mobygames.com/game/74771/zombie-estate-ii/) is the reason this exists: a top-down zombie shooter a group of brothers played through the night. Its four pillars are what this game keeps:

- The weapons.
- The upgrades and traps between waves.
- Working out which room to survive the next round in.
- The different zombie types.

Everything else serves them. The art, names, and characters here are original. Only the shape of the fun is borrowed.

## Decided

- **The game.** A goofy-gory pixel-art wave shooter. Chunky, bright, bouncy sprites, cartoon splatter, and zombies that are funny more than scary. Every sprite moves: walk cycles, hit flashes, knockback, gibs, decals that stay, shake, and hit-stop.
- **Platform.** One game for desktop and phones, in landscape and in portrait. Every input works with a keyboard and mouse and with touch.
- **View.** Top-down pixel art on a 320×180 canvas, scaled with crisp pixels. Portrait phones see a zoomed window that follows the player (see "Portrait play").
- **Controls.** Twin-stick on every device.
  - Keyboard: WASD moves, Left and Right turn the aim, and Space fires. Each action has exactly one key, read by its physical position (see "One key per action"). Since 2026-10-28 the arrow keys no longer move.
  - Mouse: aim at the pointer, hold the button to fire.
  - Touch: the left thumb moves, the right thumb aims and fires while held. Two thumbs at once must work.
- **The loop.** Preparation, then a wave, then Preparation again, until the player dies or wins.
- **How the code is organized.** One Foldkit Model. A pure, deterministic `update`: no `Math.random`, no clock. Randomness comes from a seeded generator in the Model, so the same seed and the same Messages give the same game. Effect is used fully, through its own APIs, with no workarounds around it (recorded from the owner on 2026-10-29). The frame stays cheap (see "Risks").
- **Show, don't explain.** Decided with the owner on 2026-10-29. It is a fun game, so it should read at a glance and teach by doing. Prefer pictures, icons, motion, and sound to text. Keep every label and line short, cut explanations a player can learn by playing, and say a thing once: once the player has seen something (a power-up, a zombie, a control), stop repeating what it does. Older text-heavy screens are listed for the owner in `TANNER_TODO.md`.
- **Making money.** Decided with the owner on 2026-10-29. The game stays free to play.
  - **Cosmetics and a supporter pack.** One-time purchases of looks, hats, gun skins, and a founder's hat. Nothing bought changes how the game plays. Bought on the web through Stripe Checkout confirmed by a Worker, and kept in the player's synced scope so it follows linked devices. Not built yet.
  - **A tip jar.** A small "buy the shopkeeper a coffee" link. Built on 2026-10-29: a pill with a pixel mug under the difficulty badge on the home menu and in the top left corner of Victory, never in a run, on pause, or on Game Over. It opens a Stripe Payment Link in a new tab and stays hidden until `SUPPORT_URL` in `src/support.ts` holds that link.
  - **Never.** No ads of any kind, no pay-to-win, and no real-money loot boxes. The mystery box uses in-game money only.
- **Online is Cloudflare only.** Hosting, analytics, and player sync run on Cloudflare Workers, D1, and Durable Objects, with our own sync engine. See `PLATFORM.md`.
- **Co-op.** Decided with the owner on 2026-10-29: online co-op for up to 4 players, server-authoritative in a Durable Object. The rules (money, revives, READY, scaling) are in "Decided" in `MULTIPLAYER.md`. Not built yet.
- **Original art and names.** Nothing is copied from Zombie Estate 2: no art, names, or item lists.
- **Working title.** Munch Manor, in `GAME_TITLE` in `src/constants.ts`. `index.html` repeats it for the first paint, and a Scene test checks the two agree.

### Exploring the manor

Decided with the owner on 2026-10-29. This replaces the first playable's one-room arena and its "5 to 10 minute run" as the shape of the campaign.

- **Buy rooms open.** One manor per run. Every run starts in the parlour, whose exits are boarded. The player buys an exit open with money, so every dollar is a choice between a gun and a room. An opened room adds space, loot, and options, and its doors join the spawn doors.
- **The campaign grows.** The campaign itself becomes the manor run, so a run gets longer than the first playable's 5 to 10 minutes. There is no separate quick mode. The wave count and run length are set as rooms land, with the balance tools.
- **Explore in breaks.** Rooms are bought and explored between waves. Waves still arrive on the sawtooth, so the pacing rules and the balance tools stay valid.
- **The kitchen first.** The first room after the parlour is the kitchen: ovens to trip and slippery soup. The level is already data in the Model, so a room is an exit in a `LevelSpec` (see "Technical notes").
- **No off-screen hints.** Nothing on screen points at zombies or doors out of view. The door rattles and groans carry the warning.
  - **Teammates are the exception.** Decided on 2026-10-29 with co-op: an off-screen teammate shows as a small avatar at the screen edge. Zombies and doors still get nothing.
- **Still a sketch.** Rooms with one signature twist each: library (bookshelf passages, a rare-gun stash), ballroom (open floor for hordes, a chandelier to shoot down), cellar (dark, lit only near the player), a graveyard outside (floor spawns, Uncle Chunk's arena), attic (one entrance, a risky stash). A goal beyond surviving, such as restoring the power or finding the keys to Uncle Chunk's cellar. Interactive pieces such as a fireplace trap, a mystery box, or a dumbwaiter. The layout stays hand-made, while secrets and loot spots shift with the seed.

### The first playable

Decided on 2026-10-27: a fun one-room arena a stranger can open from a link. It is built and live. Where a line below was later changed, the change is dated.

- **Audience.** Strangers on the web. The first 30 seconds have to hook someone who knows nothing about the game.
- **Run length.** Superseded on 2026-10-29 by "Exploring the manor": the campaign grows with the manor. Today's eight-wave campaign takes about 8 minutes for the bot.
- **The arena.** The parlour: one 320×180 room with cover and four doorways. Since 2026-10-29 portrait phones see it through a window that follows the player.
- **Waves.** Today 8 waves, the last a Tank-heavy horde with Uncle Chunk on top, then Victory. The count grows with the manor (see "Exploring the manor"). Endless keeps going past the campaign.
- **Preparation.** About 20 seconds, timed and skippable. Since 2026-10-28 the first break, before wave 2, has no timer and waits for START WAVE (Enter).
- **Shop.** A stall in the room, opened by walking into it.
- **Weapons.** A pistol that never runs out, plus one bought gun with limited ammo. Two carried, swapped with one key.
- **Zombies.** Six kinds and a boss (see "Zombie types"). The Ankle Biter comes up through the floor, which bends "doors are the chokepoints" on purpose: it stays rare, telegraphs for 1.5 s, never comes up near the player, and the preview counts it as FLOOR.
- **Traps.** The Plank Pile and the Grumpy Gnome. At most two Plank Piles, placed or carried (2026-10-28). Groaners and Big Lugs chew a nearby pile instead of chasing the player (2026-10-28). A boarded doorway is no spawn point (2026-10-29).
- **Difficulty levels.** Decided on 2026-10-28: Easy, Normal (the default), Hard, and Nightmare, locked until a Hard campaign win. See "Difficulty levels and planks as bait".
- **Health.** A few hearts, at most 5. A hit knocks the player back and gives a short invulnerable blink. Hearts are bought and rarely dropped.
- **Onboarding.** Wave 1 is the tutorial: a few slow Groaners and control hints for the current device. No walls of text.
- **Sound.** Sound effects unlocked on the first input, and synthesized chiptune music that follows the run.

#### Onboarding

Built on 2026-10-28 after a first-time phone player said the right stick was never taught and new zombies came in unexplained. The logic is in `src/onboarding.ts`.

- **Hints clear on practice.** The move hint clears after 24 px of the player's own movement, the aim and fire hint after 3 aimed shots, neither before 2.5 s of play. Other input leaves them alone.
- **Touch teaches both thumbs.** During wave 1, pulsing ghost sticks sit on each half of the screen until that thumb's lesson is learned.
- **The practice gate.** Wave 1's countdown waits until the player has moved and aimed and fired. START WAVE (Enter) skips it. A returning player never sees it.
- **The new zombie card.** The moment a wave starts, the first kind in it not yet introduced gets a band across the screen: its walk cycle large, its name, and a one-line pitch. The world holds still for 5.5 s; after 1.5 s a tap, a click, or Enter skips it. Each kind is introduced once, saved on the device. During Preparation the door preview already tags the door with NEW, so the card is never the first warning.

| Kind        | Card pitch                                             |
| ----------- | ------------------------------------------------------ |
| Groaner     | HE'S SLOW. BACK UP AND KEEP SHOOTING.                  |
| Hotfoot     | ZOOMS RIGHT AT YOU. ONE SHOT DROPS IT.                 |
| Kaboomer    | HE WANTS A HUG. POP HIM FROM FAR AWAY.                 |
| Big Lug     | HE'S WEARING A KITCHEN. KNOCK IT OFF.                  |
| Big Leaguer | HE PITCHES ZOMBIES. GET CLOSE AND HE HIDES BEHIND ONE. |
| Ankle Biter | IT CLAWS UP THROUGH THE FLOOR AND GRABS YOUR ANKLES.   |

- **The door preview.** On the overlay canvas, which never shakes. Each door's box lists the kinds coming through it with an icon and a count; only its frame pulses.

#### Screen shake

Retuned on 2026-10-28 after a playtest said shooting shook too much. Trauma moves the screen up to 3 px per unit and decays 2.5 units a second. Shots can raise it only to 0.3, so held fire shakes about 1 px at most; hurts, blasts, big kills, and the boss add on top, up to 1. The numbers per source are in `src/juice.ts` and `src/constants.ts`. Screen shake can be turned off in SETTINGS.

#### Music

Original, synthesized with Web Audio, no audio files: a goofy, swung haunted-house groove in E minor. The patterns are data in `src/music.ts`.

- **Moods.** Creep (100 BPM) on the title and in Preparation, Romp (138 BPM) in a wave, Stampede (152 BPM) on the finale and endless. Stingers for a cleared wave, Victory, and Game Over.
- **Who owns what.** `update` decides only the mood and any stinger and sends `CueMusic` when it changes. The scheduler lives with the audio resource. Music never feeds back into the Model. M mutes everything, N toggles music.

#### Proposed balance

Starting numbers to play against, not decisions. They live in `src/constants.ts`, `src/weapons.ts`, `src/zombies.ts`, `src/waves.ts`, and `src/shop.ts`.

- **Money.** Each kill pays its kind's bounty. Clearing wave _n_ pays $20 + $5 × _n_. Wave 1 pays about $37, so the first visit buys a gun.
- **The shop** opens from the wave 2 Preparation. Mid-wave and before wave 1 the stall sleeps behind a CLOSED sign.
- **Slots.** The pistol always stays in the first slot. A bought gun replaces whatever is in the second, with its ammo.

| Item                  | Price | What it does                                                                                                      |
| --------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Pop Pistol            | Start | 1 damage, 150 ms between shots, a 14 round magazine, 0.8 s reload, never runs out                                 |
| Barn Buster (shotgun) | $35   | 5 pellets in a 0.75 radian spray, 1 damage each, short range, 620 ms between shots, 6 shells a load, 1.3 s reload |
| Shell Sack            | $10   | 16 more shells, up to 48. The shotgun comes with 16                                                               |
| Chatterbox (SMG)      | $100  | 1 damage, 70 ms between shots, a slight spread, a 30 round magazine, 1.2 s reload                                 |
| Chatter Drum          | $15   | 120 more rounds, up to 360. The SMG comes with 150                                                                |
| Pickled Heart         | $25   | One heart, never past 5                                                                                           |

- **Reloading.** Every gun fires from a magazine. An empty one reloads on its own; R, or a tap on the held gun's slot, reloads early. Swapping cancels a reload, and each gun keeps its own magazine. The pistol fires 6.7 shots a second while a magazine lasts and 4.75 sustained.
- **Out of ammo.** The next pull clicks, pops EMPTY, and swaps to the pistol.

| Kind     | Name        | Speed (px/s) | Health | Bite     | Radius | Bounty | Notes                                                                       |
| -------- | ----------- | ------------ | ------ | -------- | ------ | ------ | --------------------------------------------------------------------------- |
| Shambler | Groaner     | 16 to 28     | 3      | 1 heart  | 4      | $2     | The baseline                                                                |
| Runner   | Hotfoot     | 44 to 52     | 2      | 1 heart  | 3.5    | $3     | Light, so it is shoved and knocked back further                             |
| Tank     | Big Lug     | 11 to 14     | 30     | 2 hearts | 6.5    | $20    | Takes 12% of knockback, shoves the crowd aside, health bar once hurt        |
| Exploder | Kaboomer    | 14 to 17     | 6      | none     | 4.5    | $4     | Bursts 200 ms after it dies, or 340 ms after it touches the player (no pay) |
| Thrower  | Big Leaguer | 13 to 16     | 14     | 1 heart  | 4.5    | $8     | Hangs back, lobs Groaners, and hides behind a held zombie                   |
| Crawler  | Ankle Biter | 26 to 32     | 2      | none     | 3.5    | $3     | Comes up through the floor and grabs the ankles, halving speed for 1.1 s    |

- **The burst.** Radius 28 px. It costs the player 1 heart unless blinking, deals 6 to every zombie and 15 to every trap it reaches, and lights any Kaboomer it touches, so chains ripple 150 ms apart. At most 2 bursts a frame.
- **Speed.** Each wave scales spawn speed from ×1 on wave 1 to ×1.45 on wave 8. By wave 8 the fastest Hotfoots outrun the player (72 px/s).
- **Health.** Waves 5 to 8 scale health by ×1, ×1.03, ×1.1, and ×1.1, rounded per zombie. The boss is the step up on wave 8, not the crowd's health.

Each wave is learn, test, combine, or twist, built from packs on the sawtooth (see "Packs and pacing"). Health is before the wave's scale.

| Wave | Zombies | Health | Cycles | What is new or special                                                                                                    |
| ---- | ------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1    | 6       | 18     | 1      | The tutorial. Four slow Groaners from the north door, 3 s apart, then a pair                                              |
| 2    | 31      | 83     | 2      | Groaner packs of 1 to 3 from two drawn doors. NEW: Hotfoot, in ones and twos. No pack of four, so no frenzy yet           |
| 3    | 49      | 130    | 2      | Stragglers and mixed squads, then the first frenzied pincer (packs of 4 and 5). A Hotfoot rush after the relax            |
| 4    | 66      | 220    | 2      | NEW: Kaboomer, three alone from one drawn door, while Groaner packs come from two others. Pincer peaks at 15.5 s and 38 s |
| 5    | 62      | 221    | 2      | NEW: Big Lug, alone from the north with escorts behind. Mixed squads, then a second Big Lug leads a pincer                |
| 6    | 63      | 235    | 2      | NEW: Big Leaguer, two 16 s apart. A Big Lug and a frenzied pincer, then a third Big Lug and a horde from every door       |
| 7    | 71      | 282    | 3      | NEW: Ankle Biter, three 9 s apart. Big Lugs with pincers, a Big Leaguer, a stream of stragglers, a mixed rush             |
| 8    | 53      | 262    | 3      | The finale. Squads and pincers, two Ankle Biters and a Big Leaguer, three Big Lugs, a one-volley horde, and Uncle Chunk   |

A wave is a list of groups and holds. When Preparation begins the seeded generator shuffles each group's pack sizes, draws its doors, and rolls every spawn's kind and timing, so the door preview shows exactly what will come and the same seed rolls the same wave. A kind's debut group is only that kind, from one door, so the NEW card never promises a zombie the roll left out. Most groups draw their doors per run, and stragglers (packs of one with up to 1.5 s of jitter) wander in between packs from wave 3.

#### Packs and pacing

Proposed, not decided. The packs are in `src/waves.ts`, the beats, telegraphs, and intensity in `src/pacing.ts`.

- **Packs.** Zombies come in packs, not a drizzle: a Squad from one door, a Pincer from opposite doors 1.5 to 3 s apart, a Horde from every door, a Trickle of one.
- **Sawtooth.** A wave runs two or three cycles of Build, Peak (5 to 8 s), Fade, and Relax. At a hold the wave clock stops until fewer than 6 zombies are alive and nothing waits at a door, then rests 2 to 3 s. A fade gives up after 20 s. The last peak is the biggest.
- **Tighter waves.** From owner feedback on 2026-10-29 ("Waves shouldn't be super long or have periods where no zombies are on screen"). After 0.5 s of quiet (no zombie alive, nothing at a door) the clock skips to the next pack's warning. A relax that goes quiet lets in up to two stragglers, then ends. The restless extension is at most 2 s. Endless relaxes are 3 s, falling 0.1 s a wave to 2 s.
- **Telegraphs.** Every pack warns about 1 s before it enters: its door rattles with red eyes, dust puffs, and a groan plays. A horde rings the DINNER BELL instead.
- **Doorway camping.** A pack due while the player stands within 16 px of its doorway waits until the player steps away. Only timing changes, never a door or a kind, so the preview stays exact.
- **The alive cap.** At most 20 zombies in the room in every mode; the rest wait at their doors. It is the phone's frame budget.

#### Mercy rules

Proposed, not decided. Invisible and deterministic; neither draws from the seeded generator.

- **Last-heart grace.** A hit that leaves 1 heart blinks for 1.5 s instead of 1 s.
- **Pacing intensity.** `intensity` rises with hearts lost and zombies close by and decays about 11% a second. While it is at least 0.4 when a relax ends, the relax runs up to 2 s longer. It never adds or removes a zombie.

#### Difficulty principles

These guide tuning. The code does not enforce them.

- **Stay in the flow channel.** Challenge rises about as fast as skill and gear. Each wave teaches, tests, combines, or twists.
- **Sawtooth intensity.** During a peak, incoming zombie health a second briefly reaches 1.5 to 2.5 times the player's damage a second; during a relax it is near zero.
- **Telegraph every threat.** Surprise comes from what a warning means, never from a zombie with no warning.
- **Invisible mercy.** Small hidden help at the edge of death makes close calls more common than deaths.
- **No rubber banding.** What comes, and from where, is fixed by the seed when Preparation begins.
- **Measure with the bot, then playtest.** The targets are for the bot, not for people.

#### How balance is checked

Added on 2026-10-29. Three layers, cheapest first. The commands are in `AGENTS.md` and `tools/balance/README.md`.

- **The analytical model** (`tools/balance/model.ts`, instant, part of `bun run test`). From the real tables, for every wave and level: the spawns for six seeds, the money the waves pay, the loadout the bot's shopping list buys, that loadout's sustained damage a second, and the wave played as a flow of health through the holds, rests, quiet hurries, trickles, and the alive cap. Its tests hold the guardrails: waves 5 to 8 peak at 1.5 to 2.5 times the player's damage, early waves are gentler, health never falls from one wave to the next on any level, the peak never drops more than 0.05 from one wave to the next, no wave runs past its length ceiling, and Easy < Normal < Hard < Nightmare. A guardrail not met yet is a `test.todo` with today's value; since 2026-10-29 every one is met. The model ranks changes and spots gross mistakes; the bot has the last word.
- **Wave snapshots** (`bun run balance -- --wave 4 --runs 200`, seconds). The bot plays one wave many times from typical run states taken from ten campaign runs that reached it. It reports cleared, hearts lost, lengths, empty and quiet seconds, the longest quiet stretch, and deaths by kind. A three-run smoke pass of wave 2 runs in `bun run test`.
- **The nightly suite** (`bun run balance:nightly`, minutes). Every campaign bot on every level, endless, portrait passes (Normal and Easy with `VIEW=portrait`), and every wave's snapshots, held to `tools/balance/targets.ts` and to `tools/balance/baseline.json`. Its report lists what is in target, what drifted past its noise, and what is out of target. A portrait pass more than 8 points from its landscape twin is called out.

**The targets** (in `tools/balance/targets.ts`):

- **Wins.** Normal: the default bot 15 to 25%, `SWAP=1` 30 to 45%. Easy 55 to 70%, Hard about 5 to 12%, Nightmare about 1 to 4%. Portrait is held to the same targets.
- **Where runs die.** Under 3% in waves 1 and 2, under 10% in 3 and 4, about 25 to 35% in 5 and 6, and the most in 7 and 8, with the finale the biggest single wall.
- **Feel.** A median win of 7 to 9 minutes for today's campaign. 30 to 50% of wins are close calls (down to 1 heart).
- **Wave length.** The median wave in the snapshot pass: wave 1 at most 40 s, waves 2 to 4 at most 75 s, waves 5 to 7 at most 90 s, wave 8 with the boss at most 120 s.
- **Dead air.** At most 3 quiet seconds a wave on the mean run and no stretch over 1.2 s in any run. A Story test holds a perfect killer's longest quiet stretch to 1 s.

**Where it stands** (nightly, 2026-10-29, 200 runs a row): Easy 67%, Normal 16% (`SWAP=1` 37%, close calls 34%, median win 7.9 min), Hard 7%, Nightmare 0%. Out of target: Nightmare (it loses 23% of runs on wave 3's frenzied pincer; try Nightmare speed ×1.02 or a gentler wave 3 on Nightmare only) and Normal deaths in waves 5 and 6 (23%). The bot that never buys planks wins 4.5% on Normal, so planks earn their keep without carrying the game. The latest numbers are in `tools/balance/baseline.json` and each nightly report.

**The bot** (`tools/balance/simulate.ts`, always through `bun run balance`). It keeps away from the nearest zombie within 36 px, re-aims every 5 frames with some hand shake, shops from a fixed list, boards the busiest doors, sets gnomes near the middle, and starts each wave at once. It dodges every floor tell and focuses the boss unless a zombie is close. Switches such as `SWAP=1`, `NO_GNOME=1`, `NO_PLANKS=1`, `KITE=1`, `DIFFICULTY=`, `VIEW=portrait`, `TIMELINE=1`, and `TUNE=file.ts` are in `tools/balance/README.md`.

- **Caveats.** The bot never stands in a doorway, plays Preparation in seconds, steps off every landing mark at once, and backs off anything within 36 px. A person feels the peaks, the Big Leaguer's throws, and the Ankle Biter's grabs far more. Playtest before trusting any of it.

#### Traps

Proposed numbers. The table is in `src/traps.ts`, the chewing rates in `src/zombies.ts`.

| Trap      | Name           | Price  | Health | Most at once | What it does                                                                                           |
| --------- | -------------- | ------ | ------ | ------------ | ------------------------------------------------------------------------------------------------------ |
| Barricade | Plank Pile     | $40    | 30     | 2            | Boards up one doorway. Blocks zombies and the player; shots and peas fly through the gaps              |
| Turret    | Grumpy Gnome   | $75    | 10     | 2            | Shoots a pea (1 damage, 1200 ms apart) at the nearest walking zombie it can see within 84 px           |
| Repair    | Glue and Nails | Varies | -      | -            | Restores every damaged trap for half of each trap's price, scaled by the share of health it is missing |

- **Placing.** Traps are bought into a pack shown in the HUD. In Preparation, T (or the place icon) puts the selected one down and G (or the next icon) switches kinds. A Plank Pile goes in the doorway the player stands in or beside; a gnome on the free tile in front of the player. A green or red ghost shows where it would go.
- **Chewing.** A walking zombie that touches a trap chews it: a Groaner 3 health a second, a Hotfoot 2, a Big Lug 12. A Kaboomer that touches one fuses. A Plank Pile cracks at two thirds and one third and breaks with a crash.
- **Pathing.** A boarded doorway stays in the flow field at a toll of 25 tiles, and a zombie outside compares walking round to another door with chewing through.
- **Between waves.** Traps stay and keep their damage. Broken traps are gone. A new run clears them all.
- **Still ideas.** Spikes that hurt what walks over them, and a short-lived fire zone.

#### The stall entrance and the coin

From a playtest on 2026-10-28 ("I tried going to the side of it and got lost"). The rule is in `src/shop.ts`, the art in `src/stall.ts`, the coin in `src/font.ts`.

- **Walking in.** The shop opens when the player comes within 12 px of any open side of the stall, only in Preparation from wave 2. After LEAVE SHOP it stays shut until the player is 22 px away.
- **Signposts.** While the shop is open, a gold outline pulses around the stall, a coin and an arrow bob over the awning, and Rattles waves.
- **The coin.** Money is a chunky gold coin drawn wherever `$` appears in canvas text and before every price in the shop. Screen readers still hear dollars.

#### Shop categories and the price ramp

From a playtest on 2026-10-28 ("Shop should have categories, and be more of a ramp up"). Proposed, not decided. The rules are in `src/shop.ts`, the dialog in `src/shopView.ts`.

- **Categories.** Three tabs: GUNS (each gun with its ammo and upgrades), HEALTH (the Pickled Heart), and TRAPS. Arrows, Home, End, and Enter work as a menu; tabs are at least 48 px tall. The shop opens on the last tab used; a new run starts on GUNS.
- **Affordable at a glance.** Each tab has a badge counting what the player can buy now. Prices are green when affordable and grey with the shortfall when not.
- **Phones.** Under 500 px tall the panel widens and the rows sit side by side, so every tab fits an 844x390 or 667x375 phone without scrolling (`tools/audit/shots34.ts`).
- **The ramp.** Cheap first steps and dear top tiers, so the first visit buys a gun and the top tiers are goals for the late waves. The pistol line stays expensive on purpose: it never runs dry, and a cheap pistol damage tier once took the bot from 28% wins to 100%.
- **The bot's shopping.** A heart at 3 or fewer, the Chatterbox when affordable (else the Barn Buster), ammo below half, two Plank Piles, Glue and Nails at $25 or less, spare gun tiers, one gnome, pistol tiers only once the spare gun is maxed, then a second gnome. It keeps $30 back after an upgrade or a gnome.

#### Ammo and upgrades under the gun

From a playtest on 2026-10-28. Proposed, not decided. The layout is `gunShelves` in `src/shop.ts`.

- **One card per gun.** GUNS lists the Barn Buster, the Chatterbox, and the Pop Pistol in a fixed order. A gun the player does not carry is one buy row. A carried gun is a card with its tier name, its rounds, and tier pips, and its ammo refill and next upgrade as rows under it.
- **A gun goes by the name on its card.** Everything the shop says about a carried gun uses its tier name.
- **Focus.** Buying a gun moves focus to its ammo row; buying ammo or an upgrade keeps it in place.

#### Power-ups

From a playtest on 2026-10-28 ("Temporary power ups that get dropped would be sick"). Proposed, not decided. The tables are in `src/powerups.ts`, the drawing in `src/powerupView.ts`.

Zombies sometimes drop a goodie. Walking over it grabs it. Four are timed boosts and two act at once.

| Kind      | Name            | What it does                                                                                    | Lasts | Weight |
| --------- | --------------- | ----------------------------------------------------------------------------------------------- | ----- | ------ |
| RapidFire | Hot Sauce       | 0.55 times the time between shots, tops off the magazine, spends no rounds, never reloads       | 8 s   | 24     |
| Damage    | Mean Beans      | Twice the damage and 1.5 times the knockback                                                    | 8 s   | 22     |
| Speed     | Zoomy Socks     | Runs 1.4 times as fast                                                                          | 10 s  | 16     |
| Pierce    | Shish Kebullets | Each shot goes through 3 zombies                                                                | 9 s   | 20     |
| Burp      | Big Burp        | At once: 5 damage and a hard shove to every walking zombie within 110 px, paying their bounties | -     | 10     |
| Heart     | Pickled Heart   | At once: one heart. Only drops while the player is missing one                                  | -     | 8      |

- **Stacking.** Different boosts run side by side. Grabbing a running boost adds its time, up to 1.5 times one pickup. `firingStats` and `playerSpeed` in `src/powerups.ts` are the one place boosts turn into stats.
- **Time.** Boosts and pickups stand still with the world: paused, in the shop, in hit-stop, or under the new zombie card.
- **Feel.** A pickup bobs in a glow for 10 s and blinks out over its last 3. A grab plays its own sound, throws sparks, and shows its name. Only the first grab of each kind, ever, adds its one-line blurb; later grabs pop just its icon and name (2026-10-29, owner request, "Show, don't explain"). While a boost runs the player wears an aura of its color, shots take its glaze, and a chip beside the hearts drains.

##### Drops

Drops use their own seeded generator, `loot.rngState`, so they never change which zombies come.

- **Wave 1** drops one Hot Sauce on its third kill, to teach the grab, and nothing else.
- **Each kill** from wave 2 rolls its kind's chance: Groaner and Hotfoot 3%, Kaboomer 4%, Big Lug 40%, Big Leaguer 12%, with 8 s between drops.
- **Peaks.** When a peak's fade begins, the next kill rolls 50% for a prize.
- **Pity.** After 25 s of wave time with no drop, the next kill drops for sure.
- **The cap.** At most 2 pickups on the floor.

A run sees about 20 drops with a boost running about a quarter of wave time. Power-ups add highlight moments but do not replace traps.

### Upgrade tiers and endless mode

Added on 2026-10-28. Proposed, not decided.

#### Upgrade tiers

Each gun has three tiers, rows in `UPGRADE_TIERS` in `src/weapons.ts`. Tiers stack, and adding one is a data change. The pistol's tier is on the player; the spare gun's tier goes with that gun, so buying a different spare replaces it. Each tier changes the gun's highlight color and muzzle sparks, and the HUD slot shows pips.

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

#### Modes

The run mode is `Campaign` or `Endless`, chosen on the home menu and kept in the Model.

- **Keep going.** Victory offers KEEP GOING (K), which carries the same run into endless with its money, guns, tiers, traps, hearts, and stats.
- **Endless waves.** After the campaign's waves, each wave _n_ (depth _d_ past the campaign) is generated when Preparation begins, so the preview stays exact: health ×(1 + 0.12 _d_), three sawtooth cycles of squads and pincers ending in a horde, 90 + 6 _d_ escorts, 4 + ⌊_d_ / 2⌋ Big Lugs before the peaks, more Big Leaguers and Ankle Biters as it goes, and speed rising 0.01 a wave from the finale's, up to ×1.6. Uncle Chunk comes back every eighth wave.
- **What stays the same.** Preparation, the shop, traps, the preview, and the music. A THEY GOT BEEFIER banner replaces NEW. Game Over shows the wave reached and the best for the difficulty.

#### Pausing, focus, and the end screens

Proposed, not decided. The rules are in `src/main.ts` and `src/update/home.ts`.

- **Leaving the window pauses.** A hidden tab or a window blur during Preparation or a wave pauses, closes the shop, and lets go of every held input. Coming back waits for a click, a tap, or Esc.
- **The resume press does only that.** It is never also a shot or a stick.
- **The pause screen** shows the controls for the last device used as keycaps and icons, and four short tips (`src/pauseHelp.ts`), with the MENU pill to leave the run.
- **One key press, one action.** Space or Enter on a focused HTML button belongs to the button. A clicked button hands focus back to the game.
- **One key per action.** Decided on 2026-10-28 at the owner's request ("Only one key per action"). Keys are read by `event.code`.

  | Action                            | Key           |
  | --------------------------------- | ------------- |
  | Move                              | WASD          |
  | Fire                              | Click         |
  | Turn the aim without a mouse      | Left, Right   |
  | Fire without a mouse              | Space         |
  | Reload                            | R             |
  | Swap guns                         | Q             |
  | Place a trap                      | T             |
  | Next trap                         | G             |
  | Start the wave, skip a card       | Enter         |
  | Pause and resume                  | Esc           |
  | Mute                              | M             |
  | Music on or off                   | N             |
  | Play (home, end)                  | Enter         |
  | Switch mode (home), endless (end) | E             |
  | Keep going (Victory)              | K             |
  | Back to the menu                  | H             |
  | The home rail                     | L, Z, C, I, O |
  | Move between menu buttons         | Arrows or Tab |
  | Close a panel or dialog           | Esc           |

  Removed for good: the arrow keys for movement, Space as fire or start, E as swap, 1 and 2 to pick a gun, and P as pause. The shop dialog keeps its own list keys.

  Proposed on 2026-10-29, not yet owner-approved: the whole game plays on a keyboard alone. Left and Right turn the aim heading at half a turn a second, the heading stays where it was left, and Space fires along it. The keyboard heading outranks the mouse only while Left, Right, or Space is held, and the right thumb outranks both. On the home and end screens the arrows still move between buttons. This brings Space back as fire, which the list above removed, so the owner decides.

- **End screens.** Game Over and Victory put MENU first. When a newer build is waiting they offer only MENU (see "The home menu, the loading splash, and taps"). `tools/audit/taps.ts` fails when anything covers a button there.

### Breaks and the mobile HUD

From a playtest on 2026-10-28 ("the mobile overlay is a bit much"). Little chrome, icons instead of words, actions in the right thumb's reach, buttons only while useful, and a tappable HUD. The views are `src/touchControls.ts`, `src/menus.ts`, and `src/hud.ts`, checked with `tools/audit/shots31.ts`.

- **The corner.** During play the top right holds one round pause icon. Mute and music icons show only on the pause, Game Over, and Victory screens; on the home menu they live in SETTINGS. M and N work everywhere.
- **Guns.** Since 2026-10-29, owner-approved ("like CODM"): the two gun slots sit side by side at the bottom middle on every device, each with its icon, ammo, and pips. Tapping the other gun swaps; tapping the held one reloads. Keyboards see Q and R badges.
- **Beside the guns.** Small round icons: reload on touch while the magazine is under half, and in Preparation the place and next trap icons. START WAVE sits above the guns in Preparation. Trap counts sit at the bottom left, power-up timers beside the hearts.
- **Look.** Round pixel icons from the game's own pixel maps, about 0.6 opaque at rest, at least 44 CSS px, inside the safe area.
- **Full screen.** A web app manifest and the iOS Home Screen tags. Where the browser can go full screen, an icon offers it; on iPhone Safari a dismissible tip suggests Add to Home Screen. Both by feature checks, never the user agent.
- **The first break** has no timer, and the first timed break after it says so once. Both heads-ups are saved once seen.

### The parlour

Redrawn on 2026-10-29 after the owner said the first room felt disjointed. Waiting on the owner's review. The map is `ROOM_MAP` in `src/arena.ts`, the art `src/room.ts`.

- **A room, not a prop pile.** A fireplace with flickering flames on the north wall, a big worn rug, wingback armchairs and a sofa facing the hearth, a piano and a bookshelf in the corners, papered walls, a portrait, a boarded window, and cobwebs.
- **Doors that zombies burst through.** The four spawn doors are splintered frames with blood and splinters on the floor.
- **Fighting in it.** Furniture funnels each side door into a four-tile lane, the seating group is a loop to kite around, and every gap is at least two tiles so the Big Lug and Uncle Chunk fit.
- **The shop.** The stall stands on its own green mat beside the stock crates.
- **The way to the kitchen.** A boarded double door with a fork and knife sign on the north wall, the `K` tiles: `Kitchen` in `PARLOUR_SPEC`, the parlour's one exit. Buying it open comes with the kitchen.

### Portrait play

Built on 2026-10-29, owner-approved: "so phone players do not have to turn the phone". The owner's firm rule holds: no hints or arrows for zombies out of view. The rules are in `src/screen.ts` and `src/camera.ts`, checked with `tools/audit/shots34.ts` and `PORTRAIT=1 bun taps.ts`.

- **When.** A touch device whose game surface is taller than wide. A keyboard and mouse keep landscape in any window. Turning the phone switches layout live, mid-wave too. The installed Android app still locks to landscape in its manifest (an open question for the owner in `TANNER_TODO.md`).
- **The screen.** 180 screen pixels wide, so the HUD keeps the scale of a landscape phone, and 300 to 440 tall. From the top: a 44 pixel HUD band, the world window, and the thumb area.
- **The zoom.** Changed on 2026-10-29 at the owner's request. The window shows the room's full height and zooms in, showing 120 to 180 pixels of its width, picked from the phone's shape so the thumb area is at least 76 pixels and the window under 63% of the screen. A 390x844 phone shows 135 by 180 of the room at 4/3. The world canvas is stretched with crisp pixels, so the zoom costs nothing per frame.
- **The camera.** It follows the player and stops at the walls, and leans up to 28 room pixels toward the aim, eased, kept in the Model as `cameraLean` so it stays deterministic. The door rattles and groans carry the warning for zombies out of view.
- **Thumb area.** Dressed as the manor's wainscot (`src/thumbArea.ts`), holding the gun slots, START WAVE, the trap counts, and the floating sticks.
- **Banners and cards** are drawn as in landscape, centered on the world window. HTML that lines up with them reads `--frame-top`.
- **The door preview.** A marker for a door out of the window is pinned to the window's edge with a small arrow, between waves only. Whether this fits "No off-screen hints" is an open question in `TANNER_TODO.md`.
- **The home menu** keeps the same slots, rearranged. A pill with a tipping pixel phone suggests turning sideways to see the whole room, since portrait plays harder.
- **Dialogs** fit a portrait phone without the page scrolling.
- **Balance.** The bot with `VIEW=portrait` sees only the window. Nightly, 2026-10-29, 390x844: Normal default 11% against 16% in landscape, Easy 49% against 66.5% (most of the gap on wave 8). The nightly tracks the gap; nothing is retuned yet.

### The home menu, the loading splash, and taps

From owner feedback on 2026-10-28: a home base, a loading page, and taps that land. The views are `src/homeView.ts` and `src/menu.css`, the rules `src/home.ts`, checked with `tools/audit/shots33.ts`, `tools/audit/taps.ts`, and `tools/audit/splash.ts`.

- **The fixed home layout.** Decided on 2026-10-29, owner-approved. The same slots on a phone and a computer, placed in arena pixels. A new feature goes into the left rail or the mode toggle, never a new slot, so PLAY never moves.
  - **Top left, status.** The difficulty badge (opens the difficulty picker) and YOUR BESTS: best endless wave, fastest win, and zombies splatted.
  - **Center stage.** The logo, the tagline, and the player in their look, walking on the spot while the parade shuffles past. Tapping the player opens CHARACTER. A NEW ENTRY pop appears when a run unlocked a Munchopedia entry.
  - **Bottom right, play.** A big PLAY and a MODE toggle (CAMPAIGN or ENDLESS). Switching changes only the words, never PLAY's box.
  - **Left rail.** Icon buttons: What's New, Munchopedia, Character, How to play, Settings. A red dot marks anything unseen.
  - **Top right.** Full screen, the "New version ready" chip, or the iPhone Home Screen tip.
  - **Keys.** One per button, used nowhere else: Enter PLAY, E mode, L What's New, Z Munchopedia, C Character, I How to play, O Settings.
- **What's New.** The newest day of `CHANGELOG.md`, paged with OLDER and NEWER. `src/changelog.ts` decodes the file at build time; it is the only source.
- **The Munchopedia.** A field guide to every zombie (`src/munchopedia.ts`, `src/guideView.ts`). Unfound kinds are silhouettes. An entry shows the zombie walking through its wear, a one-line bio, how it plays and how to beat it, the player's kills of it, and badges at 10, 100, and 1,000.
- **SETTINGS.** Sound, music, screen shake, full screen, the difficulty, linking devices, sharing anonymous play stats, and RESET TUTORIAL behind a confirm.
- **MENU.** From pause (or H) it asks LEAVE THIS RUN? with STAY focused. Going home keeps the look, settings, lessons, and bests.
- **Updates wait on the home menu.** From owner feedback on 2026-10-28: the "New version ready" chip shows only on the home menu, so a reload never costs a run. When a newer build waits, Game Over and Victory offer only MENU. See "How updates reach installed apps" in `PLATFORM.md`.
- **No tap to start.** A tap on the game itself starts nothing on the home menu or Game Over.
- **The loading splash.** `index.html` paints a splash before any script runs: the app icon's chomping zombie, the wordmark, and a bar. Commands, never `update`, move the bar per load step (the save, the stylesheet, the fonts, the first frame, the sprites) and fade it out; a failed step still counts.
- **Taps.** Every button is at least 48 px, pressed buttons keep their size, hover styles sit inside `@media (hover: hover)`, and `tools/audit/taps.ts` checks that every button's center and edges hit it and send one Message.

### Saved on the device

From owner feedback on 2026-10-28 ("save if they've already done the tutorial"). The record is `PlayerSave` in `src/save.ts`, kept in SQLite on OPFS as the player sync scope, so linked devices share it. See "The on-device save" in `PLATFORM.md`.

- **What is saved.** The lessons, the zombie cards seen, the Home Screen tip, sound, music, screen shake, the look, the difficulty and the Nightmare unlock, the bests and kills per kind, the What's New day seen, the Munchopedia entries opened, the play stats setting, and the power-up kinds grabbed (version 6, merged across linked devices as a union).
- **What is not.** The run itself and full screen.
- **Loading and writing.** The splash waits for the save, so no hint flashes. A missing, corrupt, or unreadable save reads as no save. It is written only when a saved field changes.
- **Reset tutorial** clears the lessons, the cards, and the power-ups seen, and keeps everything else.

### Wear and the boss

From owner feedback on 2026-10-28: parts falling off as zombies lose health, and a final boss. Proposed, not decided.

#### Wear

Each kind lists its wear stages in `ZOMBIE_KINDS`. A stage comes off when health falls to its share, read from `hp` and `maxHp` alone (`wearOf` in `src/zombies.ts`), so a part comes off exactly once with no extra state. A killing hit sheds nothing.

| Kind        | Comes off at       | What comes off                                                                          |
| ----------- | ------------------ | --------------------------------------------------------------------------------------- |
| Groaner     | 2/3, 1/3           | A reaching arm, then the top of its skull                                               |
| Hotfoot     | 1/2                | Its hair and scalp                                                                      |
| Big Lug     | 3/4, 1/2, 1/4      | His junk armor with a clang: the pot lid, the stop sign, then the bucket helmet         |
| Kaboomer    | 2/3, 1/3           | His hugging arm, then the bomb casing cracks with a hot glow                            |
| Big Leaguer | 2/3, 1/3           | His cap, then his throwing arm hangs limp and his wind-up takes 1.35 s instead of 0.9 s |
| Ankle Biter | 1/2                | The top of its head                                                                     |
| Uncle Chunk | 4/5, 3/5, 2/5, 1/5 | One arm, his party hat and scalp, the other arm, then his belly bursts                  |

A part flies off as a tumbling particle with blood and a pop sound and lands as a decal; armor throws sparks and clangs instead. Every stage's sprite is built once at module scope.

#### Uncle Chunk

Reworked on 2026-10-28 from owner feedback: "Should feel like a challenge, not something you can just run around." The rules are `BOSS_RULES` in `src/boss.ts`.

- **Who.** A hulking pot-bellied zombie with a tiny head and a tiny green party hat, about twice a Big Lug each way.
- **Numbers.** Health 90 times the wave's health scale (99 on wave 8). Slow, but 1.6 times as fast while the player is more than 70 px away. A bite costs 2 hearts. Bounty $150, and his kill always drops a goodie.
- **Range decides the attack.** Within 44 px he stomps; beyond 70 px he charges and spits in turn; between, he walks in and belches. Standing near him and stepping out of the stomp is the safe way to fight him.
- **Stomp.** A 34 px red ring fills around him for 1 s, then costs 1 heart and shoves.
- **Charge.** A red lane fills toward where the player stood, then he rushes along it for 2 hearts. A wall, a crate, or a barricade stops him with a bonk, and he is dazed and takes double damage for 1.8 s.
- **Spit.** A glob arcs to a marked spot for 1 heart and leaves a slowing puddle.
- **Belch.** Every 15 s or so he burps up a Groaner, never past the alive cap.
- **Enraged.** At a third of his health he roars, flushes red, moves 1.5 times as fast, and waits less between attacks. His tells stay the same length.
- **One tell at a time.** Every attack winds up on the floor under the actors, so nothing hides it.
- **When he comes.** The finale's preview shows a BOSS marker at his door. He walks in once two thirds of the wave has come, the clock holds for 5 s, and then the rest of the wave joins him. His bar sits at the top of the screen. Victory waits until he has fallen and every other zombie is dead.
- **The Tank-heavy finale holds.** Wave 8 still ends with the most Big Lugs of any wave and a horde, with the boss on top. On 2026-10-29 the tighter pacing trimmed that to three Big Lugs and a one-volley horde, a balance number, not a change to the decision.

#### Boss balance

The bot dodges every tell and shoots him unless another zombie is within 60 px. Kept on 2026-10-28 after 21 tries: health 90, with a median kill of 40 s in winning runs; most of what he costs is the time the horde has while he stands. The finale's health scale went from ×1.21 to ×1.1 so the boss is the step up. `KITE=1` (running away) wins about 1%, as intended.

### Character

From a playtester on 2026-10-28: "She wants to be able to select a female/male for the character!" Built, not yet playtested.

- **Where.** The rail's Character button, a tap on the player on the home menu, or C. A dialog with a walking preview, Randomize, and Done. Never during a run.
- **The choices.** Body (Female, Male), Hair (Crop, Long, Ponytail, Curls), Hair color (Black, Brown, Ginger, Blonde, Pink), Skin (Fair, Light, Medium, Tan, Brown, Deep), Shirt (Blue, Red, Yellow, Teal, Pink, Purple). No green skin: the player must stand out from the zombies.
- **Randomize** draws from the Model's seeded generator and never returns the current look.
- **Sprites.** A look is composed from parts and a palette the first time it is drawn and cached.
- **Later.** Hats, as cosmetics (see "Making money").

### The newer kinds and frenzy

Added on 2026-10-28 and reworked on 2026-10-29 from owner feedback, all approved. Built, not yet playtested. The code is in `src/frenzy.ts`, `src/chucker.ts`, `src/crawler.ts`, `src/actions.ts`, and `src/zombies.ts`; `tools/audit/shots17.ts` guards the art pixel for pixel.

- **Greens.** Lighter, cartoony greens. Groaner eyes are pale yellow, so red eyes mean frenzy. No kind wears a skin tone the player can pick.
- **A zombie's action.** Every zombie carries an action apart from being alive: Roaming, Winded, Hefting, Carried, Flying, Dazed, Burrowed, or Clinging. Only Roaming and Winded zombies steer and bite.

#### The Kaboomer

The kind id stays `Exploder`. A hunched lime zombie with googly eyes hugging a round black cartoon bomb with a lit fuse, never a vest. Shrunk on 2026-10-29 to 13 by 12 pixels so he does not tower over the others. The fuse shortens and sparks faster as he nears the player or wears. A red floor ring fills before he blows. Bullets on the bomb clonk. The pop is a cartoon KABOOM with a fireball, a shockwave ring, and smoke. Since 2026-10-29 he is slower and tougher (speed 14 to 17, health 6) and shows a health bar once hurt.

#### The Big Lug's junk armor

Redrawn on 2026-10-29 at the owner's request ("should look like an ARMORED zombie whose armor falls off as he is hit"): 18 by 19 pixels, a scrawny blue-grey zombie in a bucket helmet, a pot lid on his shoulder, and a stop sign chained to his chest, each knocked off by his wear. Visual only; his stats and radius did not change.

#### Horde frenzy

- **Who.** Every pack of four or more that walks in through a door together. Floor packs never frenzy.
- **The look.** Red eyes, a red glow, steam, and a HORDE! callout with a howl at the door.
- **The speed.** 15% faster while frenzied. A frenzied zombie with no packmate within 40 px for 0.9 s fades back to normal for good.
- **The bonus.** Killing a whole frenzy pack pays $1 a zombie on top, with a chime.

#### The Big Leaguer

The kind id stays `Thrower`. A lanky mint pitcher in a torn pinstripe jersey and a backwards cap, knuckles dragging.

- **What it does.** It arrives winded, hangs back about 64 px from the player, fetches a Groaner within 70 px, heaves it overhead with a leg kick for 0.9 s, and lobs it at where the player stands, then is winded. With no Groaner around it walks in and bites.
- **The throw.** A red mark fills where it will land. A player on it loses a heart. The Groaner lands dazed for 1 s.
- **The shield.** When the player comes within 50 px or it is hit, it yanks the nearest small zombie in front of it and turns slowly toward the player. Shots from the front hit the held zombie; side and back shots, piercing shots, and bursts reach it. The shield drops after 4 s or when the held zombie dies.

#### The Ankle Biter

- **Coming up.** It never uses a door. A seeded spot on open floor at least 56 px from the player, clear of doorways, the stall, and traps, cracks and opens for 1.5 s, and it stays down while the player stands within 40 px.
- **The grab.** It clings to the player's ankles for 1.1 s, halving their speed, then lets go winded.
- **The preview.** It counts in a FLOOR box in the middle of the room. Its packs never rattle a door.

### Difficulty levels and planks as bait

From owner feedback on 2026-10-28, all approved. Built, not yet playtested. The code is in `src/difficulty.ts`, `src/doorRoute.ts`, `maybeBaitDoor` in `src/simulation.ts`, and `BAIT_RULES` in `src/traps.ts`.

#### The plank cap

At most two Plank Piles, counting placed and carried. A third is refused with a short reason. With planks cheap, boarding every door was the answer to everything; two still close the two busiest doors.

#### Boarded doors are not spawn points

From owner feedback on 2026-10-29 ("zombies are spawning behind the windows that are boarded up").

- **The rule.** A doorway with a standing Plank Pile is no spawn point. Its packs come through the next open door clockwise. A pincer's two packs keep to two different open doors.
- **Live and honest.** The preview, the rattle, camping, and the arrival all read the rerouted door, so placing a plank moves the preview at once. Once a pack has rattled, its door is kept.
- **Not rerouted.** Ankle Biters already avoid doorways. Uncle Chunk keeps his door and smashes through.

#### Slow zombies chew planks

- **Who.** Groaners and Big Lugs, the slow walkers. Everything else, frenzied packs, and the boss ignore planks.
- **The rule.** A slow zombie in the room goes for the nearest standing pile when its walk there is at most 60 px and shorter than its walk to the player, and chews it from inside. Each doorway's field is built once at load, so a frame costs two array lookups per slow zombie per plank.
- **Bait, not a win.** A plank buys a few seconds per zombie and costs the plank.

#### Difficulty levels

Four levels scale zombie health, speed, and bites on top of the wave's scales, the boss and endless too. Kinds, doors, and timing are the same on every level, so the preview stays exact.

| Level     | Health | Speed | Bite  | Groaner bite | Big Lug and boss bite |
| --------- | ------ | ----- | ----- | ------------ | --------------------- |
| Easy      | ×0.85  | ×0.9  | ×0.5  | 1 heart      | 1 heart               |
| Normal    | ×1     | ×1    | ×1    | 1 heart      | 2 hearts              |
| Hard      | ×1.12  | ×1.02 | ×1    | 1 heart      | 2 hearts              |
| Nightmare | ×1.18  | ×1.04 | ×1.25 | 1 heart      | 3 hearts              |

From owner feedback on 2026-10-29 ("make planks more expensive instead of tweaking Normal"): Normal stays ×1, and the Plank Pile costs $40.

- **The first pick.** The first PLAY of a session asks HOW TOUGH ARE YOU? with the four levels as big buttons. After that the badge and SETTINGS change it.
- **Nightmare.** Shown locked until a Hard campaign win, which unlocks it with a fanfare and a NEW! badge.
- **Shown.** Game Over and Victory show the difficulty first, and the bests are kept per level.

## Core loop

| Phase         | What the player does                                                                      |
| ------------- | ----------------------------------------------------------------------------------------- |
| `Ready`       | The home menu.                                                                            |
| `Preparation` | Walks the manor, spends money on guns, traps, and rooms, and picks where to make a stand. |
| `Wave`        | Survives. Zombies come through the doors and up through the floor.                        |
| `GameOver`    | Sees the run's stats and goes again. `Victory` follows the campaign's last wave.          |

The phase is a tagged union, never a set of booleans.

- **The map.** A grid of tiles: floors, walls, doors, and boarded exits. Zombies find the player through a flow field toward them. A small room is easy to defend and easy to get cornered in; a big one has more space and more entrances.
- **The preview.** Before each wave the game shows which zombies are coming and through which doors. Without it the choice of room would be a guess.
- **Weapons are data.** Fire rate, damage, spread, ammo, reload, and tiers are table rows, so a new gun is a data change.
- **Shop dialogs** are ordinary Foldkit views over the canvas: large touch targets, keyboard, and screen readers.

## Zombie types

A kind is a row in an exhaustive table (stats, a behavior tag, how it dies, its sounds) with its sprites in a second table keyed the same way, so a new kind will not compile until it has both. Bursts go through one function that takes any targets. Wide walkers (the Big Lug and Uncle Chunk) follow their own flow field that only steps where a 2×2 block is open.

| Type     | Name shown to players | Idea                                                                             |
| -------- | --------------------- | -------------------------------------------------------------------------------- |
| Shambler | Groaner               | The baseline. Slow, average health.                                              |
| Runner   | Hotfoot               | Fast and fragile. Punishes a room with many doors.                               |
| Tank     | Big Lug               | Slow and very tough. Rewards traps and strong guns.                              |
| Exploder | Kaboomer              | Hugs a bomb that goes off when he dies, hurting nearby traps and players.        |
| Thrower  | Big Leaguer           | Hangs back, lobs Groaners at the player, and shields himself with a held zombie. |
| Crawler  | Ankle Biter           | Comes up through the floor and grabs the ankles.                                 |
| Boss     | Uncle Chunk           | The campaign finale. Stomps, charges, spits, burps, sheds.                       |
| Spitter  | Not built yet         | Attacks from range, so a closed door alone is not safe.                          |

## Technical notes

- **Drawing.** The world is drawn with Foldkit's `Canvas`, plus the upstream `Canvas.Image` through a patch (see `patches/README.md`). Every fixed sprite, glyph, and baked text is one image from a PNG data URL; shapes that change every frame stay rectangles. Scene code builds Groups with the `group` helper in `src/sprite.ts`, since `Canvas.Group` parses every nested shape through Schema on each call.
- **The level is data.** The Model's `level` names the level and its open exits, and `levelOf(model)` returns the built `Level` with its tiles, doors, and spawn doors. Every function that reads the map takes that `Level`, and caches key on it, since it is a new record whenever an exit opens. `openExit` opens one. The wave tables still name the parlour's four doors; the kitchen decides how spawns use the doors an exit adds.
- **The camera** is derived from the player, the level, and the window in `src/camera.ts`; only its aim lean lives in the Model. The scene canvas draws the world in one Group offset by the shake minus the camera; the overlay is screen space.
- **Depth.** Standing things are sorted by the y of their feet (`src/depth.ts`). Shadows and bullets sit under them; flashes, bars, and popups over them.
- **Bigger maps.** A large manor may want the floor cut into cached tiles drawn only near the view, and the alive cap may need to count only zombies near the player. Measure frame cost again when zombies are drawn off screen.
- **Input.** Touch uses a document-level pointer Subscription that tracks each finger by `pointerId`. Frame ticks and pointer moves stay out of DevTools history.
- **Tests.** Game logic is covered by Story tests that replay Messages, and determinism is itself tested.

## Roadmap

The first playable (controls, feel, the room and the loop, the shop, the horde, traps, onboarding, and a public link) is built and live, with upgrade tiers, endless, music, power-ups, the boss, character looks, difficulty levels, the home menu, portrait play, the on-device save, sync, analytics, and the tip jar on top. Next, roughly in order:

1. **The kitchen.** The first room bought open, and the campaign's new wave count. In progress.
2. **More rooms** from the sketch in "Exploring the manor", each with one twist and its own Munchopedia page.
3. **Co-op.** The phases in `MULTIPLAYER.md`, after its remaining defaults are confirmed.
4. **Cosmetics and the supporter pack**, hats first (see "Making money").
5. **Content depth.** More guns, the Spitter, and more traps.

### Risks

- **Phone frame time.** Frame time is measured only in headless Chrome with CPU throttling, which slows JavaScript but not the GPU. A real mid-range phone has not been checked (waiting on the owner). `src/perf.scene.test.ts` budgets the shapes and paint operations of a worst-case room, and `bun run perf:check` gates frame time against `tools/audit/frame-baseline.json`. The method is in `tools/audit/README.md`.
- **What keeps it cheap.** Sprite images instead of rectangles (the worst room went from 2,656 shapes to 687 on 2026-10-28), the alive cap of 20 (at 4× throttling a room at the cap stays near 10 ms p95; 30 dropped frames at 6×), `isAnyOf` instead of `guards` in per-frame code, and a flow field rebuilt only when the player changes tile or the level changes.
- **Determinism and juice.** Animation, particles, and shake live in the Model and use the seeded generator. Sound and music play through Commands and never feed back into the game.

## Open questions

- Is there a second, permanent currency for unlocks, apart from the money spent within a run? Cosmetics are bought with real money (see "Making money"), so this is only about unlocks earned by playing.
- Do zombies ever spawn inside rooms or corners of the manor, beyond the Ankle Biter?
- What is the mystery box called? (In `TANNER_TODO.md`.)
- Do we store full runs (seed plus inputs) for replays? (In `PLATFORM.md`.)

## Reference notes: Zombie Estate 2

From the fan-written [Zombie Estate Wiki](https://zombie-estate.fandom.com/wiki/Zombie_Estate_2), unchecked against the game. A record of what the original did, not a specification, and nothing here is decided. The names, items, and numbers are the original's; this game uses its own.

- **The game.** By Sad Spaghetti Entertainment, on Steam in 2017 after Xbox: online co-op waves, 35 characters, over 100 weapons, 30 stat-boosting hats, and 6 levels.
- **Levels.** Six maps (an estate, a high school, a mall, a skyscraper, a desert town, an office). The wiki's strategies agree: fight in open areas, small rooms are where a horde overwhelms you, and some maps spawn zombies inside rooms or corners.
- **The shop** is a character behind a sign somewhere on the map, locked during a wave, so its place is part of the level's design.
- **Modes.** Casual and Hard, up to 15 waves with up to 3 continues, and Unlimited with zombie health rising each wave.
- **Currencies.** Money that resets each game, and points earned at the end of a game that unlock characters and hats for good.
- **Ammo** comes in four kinds, each for certain weapons, bought in the shop and sometimes dropped.
- **Hats** each give a buff and some a debuff. **Traps** are not documented; the closest are deployables such as totems and a turret launcher.
- **What it suggests.** Walking to the shop ties it to the room choice (built). Small rooms should be risky. Maps of different shapes make the same guns play differently.

## Not now

- **Procedurally generated manors.** The layout is hand-made; only secrets and loot spots may shift with the seed.
- **Accounts and leaderboards.** Progress is saved on the device and shared between linked devices without accounts (see `PLATFORM.md`). A leaderboard comes only with the daily challenge, which `PLATFORM.md` plans after the player scope.
- **Saving a run in progress.** A run lives in the page session.
- **Versus play.** Co-op only (see `MULTIPLAYER.md`).
