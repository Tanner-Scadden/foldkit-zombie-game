# Balance tools

Three layers of balance checks, cheapest first. Run the heavy ones through the guard (see `tools/heavy/README.md`), never `simulate.ts` or `nightly.ts` directly.

| Command                                        | Layer           | Time                       |
| ---------------------------------------------- | --------------- | -------------------------- |
| `bun run balance:model`                        | Analytical      | Under a second             |
| `bun run test`                                 | Model and smoke | Part of the test suite     |
| `bun run balance -- --wave 4 --runs 200`       | Wave snapshots  | Seconds                    |
| `bun run balance -- --wave all --runs 100`     | Wave snapshots  | About a minute             |
| `bun run balance [runs]`                       | Campaign bot    | Minutes                    |
| `bun run balance:nightly`                      | Everything      | About 15 minutes           |
| `bun run balance:nightly -- --update-baseline` | Everything      | Also rewrites the baseline |

## The analytical model

`model.ts` reads the real tables: wave plans rolled for six seeds, the level's health scale, bounties and the clear bonus, shop prices and upgrade tiers. It buys the bot's loadout wave by wave, works out its sustained damage a second (magazine and reload included), and plays each wave as a flow of health through the holds, rests, quiet hurries, the alive cap, and the boss's entrance. `ASSUMPTIONS` holds the guesses: how much of each gun's fire lands, the upkeep a visit, and when hearts start costing money. They are calibration knobs, not measurements.

`model.test.ts` tests the math on hand-made tables and holds the guardrails from `GAME_DESIGN.md`. A guardrail not met yet is a `test.todo` that prints today's value.

## Wave snapshots

`simulate.ts --wave n|all` plays single waves. A snapshot is the model on the first frame of a wave's Preparation in a campaign run the bot played. Slot k of `--slots` (10) uses the first of the seeds k, k + 10, k + 20, and so on whose run reached the wave. Run i of a wave starts from slot i mod 10, rolls the wave again from its own seed, and plays it to the next Preparation or the end.

Snapshots are derived by playing, not saved as fixtures. A fixture would be a whole Model, which changes shape whenever the game does, so it would go stale with every new field or zombie kind. Playing to the wave start costs one partial run per slot, a few seconds, and is cached for the life of the process, so `--wave all` derives each slot's run once. Workers split a pass by slot, so no two derive the same run.

## The nightly suite

`nightly.ts` runs these jobs one after another, each through `simulate.ts --json` with the guard's `WORKERS`: Normal default, Normal `SWAP=1`, Easy, Hard, Nightmare, endless on Normal (200 runs each), and the snapshot pass for every wave on Normal (100 runs a wave). It decodes each summary with the Schemas in `summary.ts`, adds the model's numbers, judges the targets in `targets.ts`, compares everything with `baseline.json`, and writes `reports/<YYYY-MM-DD>.md` (gitignored). The summary at the top lists what is in target, what drifted past its noise tolerance, and what is out of target. It exits 0 and prints the report's path. `--runs n` and `--wave-runs n` shrink the jobs for a quick try.

The baseline is written when it is missing or with `--update-baseline`. The tolerances in `suite.ts` sit at the noise of the batch sizes: about 5 points for a share over 200 runs and 8 over 100.

## Files

| File            | What it holds                                                                      |
| --------------- | ---------------------------------------------------------------------------------- |
| `bot.ts`        | The bot, a campaign run, and wave snapshots                                        |
| `simulate.ts`   | The command line: campaign and snapshot passes, workers, the text report, `--json` |
| `summary.ts`    | Run summaries and their Schemas                                                    |
| `model.ts`      | The analytical model                                                               |
| `targets.ts`    | The targets from `GAME_DESIGN.md`, as data                                         |
| `suite.ts`      | The nightly's jobs, metrics, target verdicts, baseline drift, and report           |
| `nightly.ts`    | The nightly's shell: runs the jobs and writes the files                            |
| `baseline.json` | The stored numbers the nightly compares against                                    |
| `*.test.ts`     | The model, suite, and snapshot tests, run by `bun run test`                        |
