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
- **Sound.** Sound effects now, with an audio-unlock on the first input. Music comes later.

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
- Each weapon upgrades in a few tiers, paid for between waves.
- Later: stat-boosting hats and characters with different stats.

## Traps

Traps are placed on tiles or in doorways during Preparation. Each kind is a variant of a tagged union that carries its own state, such as armed or cooling down, and is handled by an exhaustive match.

Ideas to try first:

- Barricade: blocks a door and takes damage until it breaks.
- Spikes: damage zombies that walk over them.
- Turret: fires automatically at zombies in range.
- Fire: a damage zone that lasts a short time.

## Zombie types

Zombie types are a table of speed, health, and damage, plus a behavior tag. Each wave draws from a weighted spawn table using the seeded generator, so waves are reproducible.

Ideas to try first:

| Type     | Idea                                                    |
| -------- | ------------------------------------------------------- |
| Shambler | The baseline. Slow, average health.                     |
| Runner   | Fast and fragile. Punishes a room with many doors.      |
| Tank     | Slow and very tough. Rewards traps and strong guns.     |
| Spitter  | Attacks from range, so a closed door alone is not safe. |
| Exploder | Bursts when killed, damaging nearby traps and players.  |

## Waves

- Casual play runs a set number of waves and ends in `Victory`. The target is 15.
- An endless mode keeps going until the player dies.
- Wave contents come from spawn tables that grow harder with the wave number.

## Technical notes

- The world is drawn with Foldkit's `Canvas` module. It has `Rect`, `Circle`, `Path`, `Text`, and `Group`, and no image shape yet. Sprites and tiles are built from rectangles, merged into runs to keep the shape count down. A tile map makes an image shape much more valuable. See [foldkit/foldkit#1831](https://github.com/foldkit/foldkit/issues/1831).
- The canvas repaints the whole scene on every frame. Frame time on a mid-range phone is the main risk and is not yet measured.
- Frame ticks and pointer moves are kept out of DevTools history so it stays readable.
- Touch input uses a document-level pointer Subscription that tracks each finger by `pointerId`, because the canvas pointer callbacks do not say which pointer fired.
- Game logic is covered by Story tests that replay Messages. Determinism is itself tested.

## Roadmap

The roadmap leads to the first playable. The order puts feel first: juice is built on the arena that exists today, so every later system looks and sounds good the day it lands. Each step ends with something playable.

| Step | Goal                                                                                                                                                                                                                                                                                                                                                                                           | Status                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1    | **Controls and the bare arena.** Twin-stick on desktop and touch, chasing zombies, shooting, score.                                                                                                                                                                                                                                                                                            | Done                                     |
| 2    | **Feel.** Animation frames driven by Model time, walk cycles and idle bob, hit flash, knockback, squash and stretch, death animations and gibs, particles, blood decals that stay, shadows, screen shake, muzzle flash, shell casings, hit-stop, damage numbers. Hearts with knockback and an invulnerable blink. Sound effects with an audio unlock. Measure frame time on a mid-range phone. | Built. Phone frame time not yet measured |     | **The room and the loop.** One screen with cover and three or four doorways, collision, zombies that spawn at doorways and steer around cover. Waves with a preview of which doorways they come from, and a Preparation phase with a 20 second timer that can be skipped. | Planned |
| 4    | **Money and the shop.** Money from kills and a bonus for each wave cleared. A shop stall to walk onto, and an overlay with weapons, ammo, and hearts. Weapons as data: pistol, shotgun, SMG. Carry two and swap. Ammo for everything but the pistol.                                                                                                                                           | Planned                                  |
| 5    | **The horde.** Runner, Tank, and Exploder beside the Shambler, with chain explosions. Spawn tables for each wave from the seeded generator. The 8 wave arc, with a Tank-heavy finale and Victory.                                                                                                                                                                                              | Planned                                  |
| 6    | **Traps.** A barricade for doorways and a turret, placed during Preparation.                                                                                                                                                                                                                                                                                                                   | Planned                                  |
| 7    | **Ready for strangers.** Wave 1 as the tutorial with hints for the current device, a title screen, Game Over and Victory screens with run stats, a balance pass so a run takes 5 to 10 minutes, a phone performance pass, and a public link.                                                                                                                                                   | Planned                                  |

After the first playable, roughly in this order:

- The tile-map estate with rooms, doors, a scrolling camera, and flow-field pathing.
- Content depth: more weapons and upgrade tiers, hats, Spitter, the 15-wave campaign, and an endless mode.
- Music.
- Co-op.

### Risks

- **Phone frame time.** Particles, decals, and animation add shapes on every frame. Step 2 measures this before the rest is built on it. Decals may need to be baked, which is a strong reason for [foldkit/foldkit#1831](https://github.com/foldkit/foldkit/issues/1831).
- **Determinism and juice.** Animation, particles, and shake live in the Model and use the seeded generator, so they stay reproducible. Sound plays through Commands and never feeds back into the game.

## Open questions

- How are the pistol, shotgun, and SMG balanced against each other, and what do they cost?
- How much money comes from a kill compared with a cleared wave?
- Do traps break, wear out, or get rebuilt each preparation phase? Proposed: barricades take damage and can be repaired for money.
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
