# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

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
