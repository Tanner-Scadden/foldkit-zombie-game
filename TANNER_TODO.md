# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

- [ ] **Stop repeating words the player has seen?** Two screens still say the same thing every time: the pause screen's four tips (shop, Plank Pile, Gnome, goodies) under the controls, and the portrait home menu's TURN YOUR PHONE SIDEWAYS TO SEE THE WHOLE ROOM pill. Recommended: drop the pause tips (the controls table stays), and keep the tipping phone picture but drop its words. The end screens' feedback line now shows only on a player's first three runs. The shop's long row text and the power-up callouts are being reworked by other agents already.
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

## Later

- [ ] **Release video, once co-op lands.** See `RELEASE_VIDEO.md`. You will need: the X account to post from and a decision on a custom domain. The players-together shots are mocked in pixel art.

## Coming up for review

- [ ] **The kitchen.** Being built now. Screenshots, the door price, and the new campaign wave count come to you before it ships.
