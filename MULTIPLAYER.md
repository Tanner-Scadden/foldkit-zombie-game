# Multiplayer

**Status: dreaming, nothing decided.** This file collects big ideas and the open questions behind them. None of it is on the roadmap yet. Think about it more, play more, and talk it through before choosing a path. When a choice is made, it moves into the "Decided" section of [`GAME_DESIGN.md`](./GAME_DESIGN.md).

## The dream

Munch Manor with friends. You send a link, a friend taps it on their phone, and ten seconds later you are back to back in the parlour, one of you holding the north door with a shotgun while the other runs to the stall for planks. Somebody goes down, the other drags them back up, and you both scream when the Gasbags chain.

Things worth dreaming about:

- **Drop-in co-op for 2 to 4 players.** Each player has their own hearts, gun pair, and money. Zombies split their attention.
- **Revives instead of game over.** A downed player crawls and can be picked up by a teammate holding still beside them. The run ends only when everyone is down.
- **Shared and personal economy.** Personal money for guns, a shared pot for traps, so building the defense is a team decision.
- **Roles that emerge, not classes that are assigned.** The trap builder, the runner who kites the Hotfoots, the one with the shotgun at the door.
- **Room codes and links.** No accounts. A four-letter goofy code ("MOLD", "GOOP") or a link to share.
- **Couch co-op on one screen.** Keyboard plus gamepads on a desktop or TV, with no network at all.
- **Spectate and cheer.** A friend who joins late watches and throws a single heart or a bag of coins once per wave.
- **Emotes, not chat.** A few goofy pings ("HELP!", "SHOP!", "BEHIND YOU!", a dance) keep it social without moderation.
- **Bigger co-op content later.** The estate (the multi-room map) shines with friends splitting up to hold different wings. Co-op-only waves, a boss that needs two people.
- **Versus twists.** One player controls the horde as the Director, spending a budget to send packs. Far future.

## Why the game is well placed for it

`update` is pure and deterministic. The same seed and the same Messages give the same game, and randomness lives in the Model. That is the foundation that lockstep and rollback netcode need, and it is rare to have it from day one. Inputs are tiny, a few bytes per frame per player, so the network cost is small. A frame of game logic costs well under a millisecond, so a server could also run many rooms cheaply.

## Paths to choose between

| Path | What it is | Rough effort | Rough running cost |
| --- | --- | --- | --- |
| Couch co-op | 2 to 4 players on one screen with keyboard and gamepads | 1 to 2 weeks | Nothing |
| Peer-to-peer online | WebRTC between browsers, a tiny signaling server, lockstep or rollback on inputs | 3 to 5 weeks | Near zero, plus a relay (TURN) for the 10 to 20% of players whose networks block direct connections |
| Authoritative server | A Bun server runs the same `update`, clients send inputs and predict locally | 4 to 6 weeks | About 5 to 20 dollars a month to start; one small machine can host hundreds of rooms |

These are guesses to argue about, not estimates to plan with.

## Hard problems to think through first

- **Fixed timestep.** The game steps by the frame's real delta today. Lockstep needs every client to step by the same fixed amount.
- **Float determinism across browsers.** `Math.sin`, `cos`, and `atan2` are not guaranteed to match to the last bit between Chrome and Safari. Either replace them with our own deterministic versions or let a server be the source of truth.
- **Latency feel.** Shooting through 100 ms of input delay feels mushy. Rollback (predict, then rewind and replay when real inputs arrive) fixes the feel but costs CPU on phones, and the frame budget on phones is already the tightest thing we track.
- **Pause and the shop.** A single-player pause and a modal shop do not work with friends. What happens when one player opens the stall mid-wave, or a phone locks?
- **Balance for 1 to 4 players.** Zombie counts, health, money, and the alive cap of 20 all need to scale, and the alive cap is a performance limit, not just a design one.
- **Joining and leaving.** Late joins, disconnects, a host leaving in peer-to-peer.
- **Phones.** Phones cannot share a screen, so mobile co-op means online. Mobile networks add jitter.

## Security and safety

- **IP addresses.** Peer-to-peer reveals each player's IP to the others. Fine among friends, a privacy issue among strangers. Forcing traffic through the relay hides it but costs bandwidth.
- **Cheating.** In lockstep a client cannot fake state without desyncing, but it can automate inputs (an aimbot). That only matters if we add leaderboards. If we do, the server must be authoritative.
- **Untrusted messages.** A server decodes every message with Effect `Schema`, rejects anything malformed, caps message size, and rate limits per player.
- **Room codes.** Unguessable enough that strangers cannot wander in, short enough to read aloud.
- **Relay credentials.** Short-lived and minted by our server, never shipped in the client, so nobody can run up the bill.
- **No free text.** Preset names and emotes avoid moderation entirely. If names ever become free text, they need filtering. Foldkit escapes rendered text, so names cannot inject markup.
- **Data and age.** No accounts and no stored personal data keeps privacy law simple. Collecting anything about players, especially children, changes that.

## Open questions

1. Who is it for first: friends on the same couch, friends far apart, or strangers matched together?
2. Is the first multiplayer step couch co-op on desktop, or online so phones can play together?
3. How many players: 2, or up to 4?
4. Shared lives and revives, or each player's run ends separately?
5. Does the campaign change in co-op, or is it the same 8 waves scaled up?
6. Do we ever want leaderboards? That one answer decides whether a server must be in charge.
7. How much monthly cost and ongoing maintenance are we willing to carry?

## Next steps before deciding

- Play more single player and settle the core feel: reloads, packs, the difficulty curve.
- Prototype the fixed timestep in single player. It helps replays and testing anyway, and it is a prerequisite for every online path.
- Count the trig calls in the simulation and decide how to make them deterministic.
- Try a two-keyboard-player hack on desktop to find out whether co-op is fun in this room before building any netcode.
