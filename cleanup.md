# Cleanup

A temporary plan to make the code base clean and to make the clean way the default: each PR fixes one kind of debt and, where it can, adds a lint, type, or test rule so it cannot come back. Delete this file in the last PR.

The findings come from an audit of `main` at 70d10c95 on 2026-10-30, with patterns from [foldkit-domains](https://github.com/foldkit/foldkit-domains). Line numbers are from then and will drift.

## How to work a slice

- One PR at a time, in the order below. Start from fresh `origin/main`.
- No behavior change: `bun run determinism:diff` shows no difference, and `typecheck`, `lint`, `test`, `test:full`, and `build` pass.
- **Lock it in.** End the slice with a rule that fails on the old pattern: an oxlint rule (`no-restricted-*`, a type-aware rule, an Effect rule), a tsconfig flag, or a small test (such as an exhaustiveness test or a check script in `bun run lint`). If no rule can catch it, add a line to AGENTS.md under "Code shape".
- Check the slice off here in the same PR, with its PR number. Add anything new you find to "Found along the way".
- Heavy jobs go through `bun run heavy`. Conventional Commits with a body, no AI attribution, no em dashes.

## Slices

### In flight

- [x] **0a. Strictness.** (#18) Restore oxlint's default plugins and correctness category, type-aware lint (`oxlint-tsgolint`), the Effect language service rules at error, the Effect oxlint `strict` preset, stricter tsconfig flags on one shared base for app, infra, and packages, and custom rules for the project rules (no `Math.random`/`Date.now`/`crypto.randomUUID`, storage only through the store, no `.guards` in per-frame code, no `Data.taggedEnum`, no `VIEW_WIDTH` in overlays, no em dashes). Files other agents were editing got scoped overrides with a TODO: clear them in slice 9.
- [ ] **0b. Foldkit Block preview.** Move to `foldkit@0.169.0-canary.90746b32d2ca` (what foldkit-domains uses): Blocks, Definitions, and Bindings in place of Submodels, a Dialog Binding in place of `dialogFolds`, `Update.combineSteps`, Effect back to 4.0.x. Lands after 0a.

### Queue

1. [ ] **Exhaustive matches.** (S)
   - `src/storeSqlite.ts:406-439` `runChange` is an if/else chain whose last branch runs `RecordedRun` for any other change; also `:445`, `:462`, `src/coop/update.ts:287-334`, `:676-686`, `src/playerSync.ts:252`. About 196 `._tag ===` checks in all; convert the chains (leave single checks).
   - Use the union's `.match` (`PlayerChange.match(change, {...})`) or `Match.valueTags`; `Match.whenOr` for literal unions (domains `domain/domain.ts:55-60`).
   - Move `Data.taggedEnum` (`store.ts:45`, `storeSqlite.ts:190`, `music.ts:291`) to the Schema tagged union helper.
   - Named variant aliases beside each union (`export type Turret = typeof Trap.Turret.Type`) in place of `Extract<Trap, { _tag: 'Turret' }>` (`traps.ts:400`, `trapView.ts:172,185`, `coop/update.ts:290`).
   - Lock in: type-aware `switch-exhaustiveness-check`, `no-restricted-syntax` against `Extract<…, { _tag: … }>` if expressible, and against an `else` after a `_tag` chain if not too noisy.
2. [ ] **Derived menu state and update helpers.** (S/M)
   - "Is a menu open" lives in three places that disagree: `update/home.ts:94-106` `isPanelAllowed`, `:156-161` `canMoveHomeFocus`, `update/profile.ts:101-104` `canOpenProfile`. `update/home.ts:159` reads `model.coop.screen` instead of `isCoopOpen`. `update/save.ts:244` `isSettingsOpen` duplicates the unused `isProfileOpenOn`.
   - Replace with one derived `menuState(model)` tagged union, computed never stored, read by update and view (domains `searchViewState.ts:36`).
   - `cond ? step(m) : { model: m }` appears 23 times (15 in `update/home.ts`): add `stepWhen(pred, step)` and `modelStep(f)` to `update/step.ts` (or use `Update.combineSteps` after 0b). Drop the `Step` suffix from step names (`keepNameStep`, `leaveShopStep`, `finishLoadStep`).
   - `update/coopRun.ts:146-221`: `isRunOn(model) ? Option.some(…) : Option.none()` in 14 arms. Check once, then one `Match.tags`.
   - `update/shop.ts:118` merges `{ ...model, ...world }`: use `withWorld`.
   - Lock in: `no-restricted-syntax` against spreading a World into a Model if expressible; AGENTS.md rules for `menuState` and the step helpers.
3. [ ] **Commands beside their updates.** (M, mechanical)
   - `src/commands.ts` (642 lines) holds Commands for `update/save.ts` (WriteSave, AwaitRunSettled, ReloadSyncedSave, RequestLinkCode, RedeemLinkCode, ShowLoadProgress, HideSplash, FocusTutorialReset), `update/home.ts` (WaitForUnwrap, ReloadPage, FocusHandCard, FocusEndMenuButton), `update/shop.ts` (FocusShopItem), `update/sound.ts` (PlaySound), `update/rotation.ts` (ApplyRotation), `musicPlan.ts` (CueMusic). Move each beside its update, as FOLDKIT.md asks; keep boot Commands only.
   - Lock in: AGENTS.md rule.
4. [ ] **Shared test helpers.** (S/M)
   - Copied setup: `closeDialog` x4 (analytics.story, difficulty.story, menu.scene, profile.scene), `touchDown` x4, `withKills` x4, `fighting` x8, `preparing` x4, `ticksFor` x3. Move them into `src/testing.ts`.
   - Build multi-step setups with `steps()` from `foldkit/story` (used nowhere today) and a named model fixtures file (domains `src/client/story/test.ts:68,108`, `model.fixture.ts`).
   - Lock in: AGENTS.md rule.
5. [ ] **One rule set for player actions.** (M/L, after the knife lands)
   - Single player and the co-op room each have their own copy of the action rules, and they already disagree. Single player: `main.ts:308-323` swap, `:375-388` reload, `update/shop.ts:110-126` buy (never checks `isShopOpenFor(phase)`). Room: `stepWorld.ts:120-175` `applyToSeat`, whose comment says single player "runs the same rules through its own Messages".
   - Single player calls `withWorld(model, w => applySeatAction(w, leadSlot, action))` and wraps only client cues (debut card, sounds, `dropClip`, chatter) around it.
   - One `syncShopDialog(before)` for both frame pipelines (`main.ts:497-504` by phase, `coopPlay.ts:296-303` by browsing).
   - Lock in: a test that runs each action through both paths and expects the same World.
6. [ ] **Shared drawing and menu helpers.** (S)
   - `rect` x5 (`fridgeView.ts:39`, `kitchenView.ts:33`, `purchaseView.ts:39`, `room.ts:129`, `stall.ts:65`); `pixelArt`, `roll` (`room.ts:139-155`, `kitchenView.ts:41-52`); `isKitchenShown` (`fridgeView.ts:141`, `kitchenView.ts:845`); `percentOf` x3 (`layers.ts:71`, `touchControls.ts:92`, `thumbArea.ts:84`); `iconView`, `keyCapView` x3 (`homeView.ts:84/107`, `profileView.ts:55/69`, `coop/view.ts:81/92`). Move to `drawing.ts` and one shared menu module.
   - Lock in: a duplicate-function check (for example `jscpd` with a low threshold in `bun run lint`), if it is quiet enough.
7. [ ] **Wire and JSON through Schema.** (M)
   - `src/worldCodec.ts:44-74` picks each number's packing by field name (`x`, `y`, `offset`, `*Ms`, `*Scale`), so a new field with one of those names is rounded silently. Mark it on the Schema instead: `Schema.Number.annotate({ wire: 'Position' })`.
   - `worldWire.ts:10-17` should be `Schema.fromJsonString(World)`; raw `JSON.stringify` at `infra/worker/gameRoom.ts:346` (encodeTicket) and `roomCalls.ts:113`.
   - `describeError` x4 (`serviceWorker.ts:32`, `audio.ts:62`, `version.ts:45`, `analyticsBeacon.ts:49`): one helper.
   - Done in PR #17: netcode reconnects go through `packages/netcode/src/Reconnect.ts` on `Schedule`.
   - Lock in: Effect `preferSchemaOverJson` at error; `no-restricted-properties` on `JSON.parse`/`JSON.stringify` outside an allowlist; a codec test that fails on an unannotated number field.
8. [ ] **Slim update and split big files.** (M/L, mechanical)
   - `main.ts:480-570` has fat inline arms (TickedFrame, PressedKey, PressedPointer): one named step each, as `src/update/` does (domains `update.ts:42-190`).
   - `worldSchema.ts` (1583 lines) holds about 30 client-only Schemas under `// HOME MENU` (line 874): move them to a client schema module, which also takes 388 Effect diagnostics out of infra's typecheck.
   - Split on section headers: `sprite.ts` (2186) into `sprites/`, `waves.ts` (1931), `room.ts` (1868), `audio.ts` (1722, recipes to `audioRecipes.ts`), `simulation.ts` (1701), `particles.ts` (1498), `main.ts` (1114).
   - Lock in: turn the `max-lines` ratchet from 0a into an error and shrink its exceptions list as files split.
9. [ ] **Dead code and leftover overrides.** (S)
   - Unused exports: `MOVE_ICON`, `SHOOT_ICON`, `SHOP_ICON` (`icons.ts`), `isInteractKey` (`input.ts`), `nearestTarget` (`party.ts`), `isRoomSlot` (`roomWorld.ts`), `priceLabel` (`shop.ts`), `repairTraps` (`traps.ts`), `WIRE_FIELDS` (`worldCodec.ts`), `isProfileOpenOn`, `GAG_NAMES` (`names.ts`; `fridgeView.ts:101` uses literals instead), `isFridgePrizeWeapon` (`leftovers.ts`), `isOwnLob`, `lobPoint`, `lobDirection` (`fridgeWeapons.ts`).
   - Mode names hard-coded in `coop/view.ts:700` ("Campaign", "Endless", "Keep going"): move to `names.ts`.
   - Clear every scoped override marked `TODO(cleanup slice 9)` that 0a left:
     - `noImplicitReturns` is off in `tsconfig.base.json`: its one hit is `packages/netcode/src/Lobby.ts:530`.
     - `tsconfig.inflight.json` checks `src/store.test.ts` and `packages/sync-engine/test/engine.test.ts` without `noPropertyAccessFromIndexSignature`. Fix their hits, drop the excludes in `tsconfig.json` and `packages/sync-engine/tsconfig.json`, and delete the file and its `typecheck` step.
     - `.oxlintrc.json`: `src/main.ts` and `src/update/shop.ts` (consistent-type-imports); `src/store.test.ts` (Date.now, no-unnecessary-condition); `packages/sync-engine/test/**` (consistent-type-imports, expect-expect, no-base-to-string, no-unsafe-assignment); `packages/netcode/**` (no-control-regex, no-shadow, consistent-type-imports, require-to-throw-message, no-unnecessary-condition, no-useless-spread); `tools/balance/bot.ts` and `simulate.ts` in `ignorePatterns`.
     - `tsconfig.base.json` Effect overrides: `tools/balance/bot.ts` and `simulate.ts` (strictBooleanExpressions); `packages/netcode/src/Socket.ts` (runEffectInsideEffect); `packages/sync-engine/test/**` (preferSchemaOverJson, lazyEffect).
     - `.oxlintrc.effect.json`: `packages/netcode/src/Socket.ts` (run-effect-inside-effect); `packages/sync-engine/test/fixtures.ts` (lazy-effect).
   - Lock in: `knip` (or an unused-exports check) in `bun run lint`.
     9b. [ ] **Tools as strict as the game.** (M) 0a left `tools/` looser.
   - Every tool: Effect's Date, timer, fetch, random, and new-Promise rules are off.
   - `tools/audit`, `tools/mp-spike`, and `tools/sprites`: the unsafe-\*, any, assertion, and strict-boolean rules are off too.
   - Fix what is worth fixing. Scripts on the Effect platform (`Clock`, `HttpClient`, `Schedule`) where that reads simpler. Typed page results in the audits in place of `any` from `page.evaluate`.
   - Keep only overrides with a one-line reason a rule cannot fit (for example, wall-clock timing in a perf audit). Delete `tools/mp-spike` if nothing uses it.
10. [ ] **Finish.** Re-run the audit's checks, list what is left as follow-ups in the right doc, make sure AGENTS.md has every new rule, and delete this file.

## Found along the way

- `storeEarly.ts` uses Promises and try/catch on purpose: it is boot code that runs before the Effect runtime. Leave it, with a comment.
- The co-op audit's "host walks into the stall" and revive steps are flaky (failed once each on production and locally, passed on rerun). Make them wait on state, not time.
