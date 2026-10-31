# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

- [ ] **Say yes or no to two end screen extras.** Play a run to its end and look at the new MUNCHED! card.
  1. Retry keys. Enter retries and H goes home, as "One key per action" decides. Reply "add R and Esc" if you also want R to retry and Esc to go home there (that bends the decision).
  2. NEW BEST on a campaign death. It bursts today only for the deepest endless wave and the fastest win, the two records the save keeps. Reply "save the best campaign wave" and an agent adds it to the save and its sync (a save version bump and a scope migration).
  3. Share counts in analytics were skipped: the run summary is sent the moment a run ends, before any tap on SHARE. Reply if you want a separate share event.

- [ ] **Watch the devlog clips and pick which to post.** They are in `tools/video/out/` (`rattles-mine`, `portrait-aim`, `coop-looks`, `fridge-pull`, each an `.mp4` and a looping `.gif`). Say which to post and any caption to change (captions live in `tools/video/shots/devlog.json`).
- [ ] **Play with Mystery Leftovers and say if the prices and odds feel right.** Open the kitchen, then hold Enter at the fridge on its back wall ($75 a pull). The proposed numbers are in "Mystery Leftovers" in `GAME_DESIGN.md`: Cooker 36, Pan 36, Brain Freeze 8 (rising 3 a slam, up to 20), Sandwich 11, Dud 9 out of 100; a slam after 3 or 4 pulls for 30 s; Rattles' upgrades $70, $160, $300 for the Cooker, $60, $150, $300 for the Pan, and $30 Lid Stacks. Reply with any you want changed.
- [ ] **Turn on device emulation so agents can test on an Android emulator (and iOS Simulator).** This lets an agent check the installed app's ROTATE toggle (the item below) and test touch, portrait, and the PWA on real mobile browsers, without your phone.
  1. In T3 Code, turn on device access for this environment (the setting that lets agents use the Device panel; today agents get "Agent device access is turned off for this environment").
  2. Reply "OK to install the Android SDK" (about 6 to 8 GB). An agent then runs `brew install --cask android-commandlinetools` and installs a Pixel system image with Google Play Chrome and an emulator through `sdkmanager`, and creates the device. Nothing else on the Mac changes.
  3. Optional, for iOS: install Xcode from the App Store (about 10+ GB) and open it once to accept the license, so the iOS Simulator is available too.
- [ ] **Check the rotation setting on a real Android phone (installed app).** The app now starts in landscape, and Settings' ROTATE tile (LOCKED or AUTO) lets it turn. Install it, flip ROTATE, turn the phone, and say if it follows.
## Later

- [ ] **Release video, once co-op lands.** See `RELEASE_VIDEO.md`. You will need: the X account to post from and a decision on a custom domain. The players-together shots are mocked in pixel art.
