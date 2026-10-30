# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

- [ ] **Watch the devlog clips and pick which to post.** They are in `tools/video/out/` (`rattles-mine`, `portrait-aim`, `coop-looks`, `fridge-pull`, each an `.mp4` and a looping `.gif`). Say which to post and any caption to change (captions live in `tools/video/shots/devlog.json`).
- [ ] **Play with Mystery Leftovers and say if the prices and odds feel right.** Open the kitchen, then hold Enter at the fridge on its back wall ($75 a pull). The proposed numbers are in "Mystery Leftovers" in `GAME_DESIGN.md`: Cooker 36, Pan 36, Brain Freeze 8 (rising 3 a slam, up to 20), Sandwich 11, Dud 9 out of 100; a slam after 3 or 4 pulls for 30 s; Rattles' upgrades $70, $160, $300 for the Cooker, $60, $150, $300 for the Pan, and $30 Lid Stacks. Reply with any you want changed.
- [ ] **Turn on device emulation so agents can test on an Android emulator (and iOS Simulator).** This lets an agent check the installed app's ROTATE toggle (the item below) and test touch, portrait, and the PWA on real mobile browsers, without your phone.
  1. In T3 Code, turn on device access for this environment (the setting that lets agents use the Device panel; today agents get "Agent device access is turned off for this environment").
  2. Reply "OK to install the Android SDK" (about 6 to 8 GB). An agent then runs `brew install --cask android-commandlinetools` and installs a Pixel system image with Google Play Chrome and an emulator through `sdkmanager`, and creates the device. Nothing else on the Mac changes.
  3. Optional, for iOS: install Xcode from the App Store (about 10+ GB) and open it once to accept the license, so the iOS Simulator is available too.
- [ ] **Check the rotation setting on a real Android phone (installed app).** The app now starts in landscape, and Settings' ROTATE tile (LOCKED or AUTO) lets it turn. Install it, flip ROTATE, turn the phone, and say if it follows.
- [ ] **Set up the Stripe tip link.** The "Buy the shopkeeper a coffee" button is built and hidden until the link exists.
  1. Sign up at stripe.com as an individual (sole proprietor). No LLC needed. Use https://munch-manor.tanner-scadden.workers.dev as the website.
  2. Payment Links, then New. Product: "Buy the shopkeeper a coffee". Turn on "Customers choose what to pay", suggested amount $3.
  3. Optional: after payment, redirect to https://munch-manor.tanner-scadden.workers.dev.
  4. Send the `https://buy.stripe.com/...` link to an agent. It goes in `SUPPORT_URL`, and the TIP JAR card appears in the home menu's MORE hand and a coffee pill on the Victory screen.
  5. Call it support or a coffee, never a donation.

## Later

- [ ] **Release video, once co-op lands.** See `RELEASE_VIDEO.md`. You will need: the X account to post from and a decision on a custom domain. The players-together shots are mocked in pixel art.
