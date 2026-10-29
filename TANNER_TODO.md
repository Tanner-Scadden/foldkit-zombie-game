# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

- [ ] **Turn the tutorial's word hints into pictures?** They break "Show, don't explain": wave 1 and the first breaks show sentences such as DRAG YOUR LEFT THUMB TO MOVE, TRY THE CONTROLS FIRST, PLANKS BLOCK DOORS. GNOMES SHOOT., BREAKS ARE TIMED FROM NOW ON, and WALK UP TO THE $ STALL TO SHOP (`HINT_TEXT` in `src/onboarding.ts`, the stall prompt in `src/stall.ts`). Recommended: yes. Keep the ghost sticks and add a pulsing arrow at the stall, a keycap or thumb icon per lesson, and at most two or three words each. Say yes or no and an agent builds it.
- [ ] **Stop repeating words the player has seen?** Three screens say the same thing every time: the pause screen's four tips (shop, Plank Pile, Gnome, goodies) under the controls, the end screens' TELL WHOEVER SENT YOU THIS WHAT YOU THINK!, and the portrait home menu's TURN YOUR PHONE SIDEWAYS TO SEE THE WHOLE ROOM pill. Recommended: drop the pause tips (the controls table stays), show the feedback line only on a player's first few runs, and keep the tipping phone picture but drop its words. The shop's long row text and the power-up callouts are being reworked by other agents already.
- [ ] **Do the portrait door arrows break "No off-screen hints"?** Between waves, a door preview marker for a door outside the portrait window is pinned to the window's edge with an arrow. The manor rule says nothing points at doors out of view. Recommended: keep them, and word the rule as "nothing points at zombies, and nothing points at doors during a wave", because the between-wave preview is what makes choosing a room a real decision.
- [ ] **Let the installed Android app play in portrait?** Portrait play is decided, but `public/manifest.webmanifest` still locks the installed Android app to landscape, and the full screen request asks for landscape. Recommended: yes. Set the manifest orientation to `any` and drop the landscape lock, after a check on one Android phone.
- [ ] **Set up the Stripe tip link.** The "Buy the shopkeeper a coffee" button is built and hidden until the link exists.
  1. Sign up at stripe.com as an individual (sole proprietor). No LLC needed. Use https://munch-manor.tanner-scadden.workers.dev as the website.
  2. Payment Links, then New. Product: "Buy the shopkeeper a coffee". Turn on "Customers choose what to pay", suggested amount $3.
  3. Optional: after payment, redirect to https://munch-manor.tanner-scadden.workers.dev.
  4. Send the `https://buy.stripe.com/...` link to an agent. It goes in `SUPPORT_URL` and the button appears on the home menu and the Victory screen.
  5. Call it support or a coffee, never a donation.
- [ ] **Name the mystery box.** Ideas so far: the Lunchbox (Uncle Chunk's rattling lunchbox), the Mystery Meat Crate (moves rooms on a dumbwaiter), the Haunted Hamper (sometimes bites back).
- [ ] **Confirm the remaining co-op defaults** in `MULTIPLAYER.md` (the rows marked "default, not yet confirmed"), before co-op Phase 1 starts.
- [ ] **Play on a real mid-range phone** and say if anything stutters. Frame time is only measured with CPU throttling in headless Chrome.

## Coming up for review

- [ ] **The kitchen.** Being built now. Screenshots, the door price, and the new campaign wave count come to you before it ships.
