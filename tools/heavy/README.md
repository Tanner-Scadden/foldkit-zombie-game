# Heavy guard

A small Effect program that every CPU-heavy job goes through, so several agents on one laptop take turns instead of piling up. Run it from the repo root.

| Command                                      | What it does                                              |
| -------------------------------------------- | --------------------------------------------------------- |
| `bun run balance [runs]`                     | The balance bot through the guard                         |
| `bun run perf:check`                         | The frame time gate through the guard                     |
| `bun run heavy -- <command...>`              | Any other heavy command, such as an audit or shots script |
| `bun run heavy -- --allow-more <command...>` | Run past the balance budget                               |
| `bun run heavy -- --exclusive <command...>`  | Run alone, whatever the command's class                   |
| `bun run heavy -- --shared <command...>`     | Run in a Shared slot, whatever the command's class        |
| `bun run heavy -- --reset-budget`            | Reset this worktree and branch's balance batch count      |

Env vars on the command line, such as `MODE=endless bun run balance 100`, pass through to the child.

## Why, and the rules

The game is developed on one laptop (12 cores), often with several agents at once. Two agents running 8-process balance batches together pushed the load average to 30 and made every step about three times slower. Running every job alone went too far the other way: agents queued for half an hour behind a throttled splash audit that used 1% of a core, on a machine at load 4.

- **Everything heavy goes through the guard:** the balance bot, `perf:check`, headless Chrome audits such as `tools/audit/perf.ts`, `sqlite.ts`, and `sync.ts`, and the shots scripts. Never call `tools/balance/simulate.ts` or a heavy audit directly. The lock only protects jobs that take it.
- **Timing runs and the balance bot run alone.** Load skews frame times, so `perf:check` and the timing audits never share the machine. The guard enforces this when every job goes through it.
- **Screenshot and functional audits share.** They mostly wait on a browser, so a few run at once.
- **Cap tuning at about three batches per change.** Use 100 runs to sort ideas and 200 runs only to confirm the final numbers. Results within a few points of a target are fine: list misses as follow-ups instead of running more batches. The budget below backs this up.

## Job classes

`jobClassOf` in `decision.ts` reads the class from the command's words, so a script inside `sh -c "..."` counts too. A script counts by its bare name (`taps.ts`, `./taps.ts`) or under an `audit/` folder, so `src/save.ts` is not the save audit.

| Class     | Commands                                                                                                                                             | Runs                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Exclusive | `balance/simulate.ts` (`bun run balance`, wave snapshots), `balance/nightly.ts`, `perf.ts`, `perf-check.ts`, `profile.ts`, `measure.ts`, `splash.ts` | Alone, with nothing else heavy, while the load is at or under the core count |
| Exclusive | `determinism/crossEngine.ts` and `beforeAfter.ts`                                                                                                    | The same                                                                     |
| Exclusive | Any command the guard does not know                                                                                                                  | The same                                                                     |
| Shared    | `shots<N>.ts`, `taps.ts`, `offline.ts`, `sqlite.ts`, `sync.ts`, `save.ts`, `live-check.ts`, `icons.ts`, `og.ts`, `beacon-check.ts`                   | Up to `HEAVY_SHARED_SLOTS` (3) at once, while the load is under 0.75 x cores |

- **Determinism is Exclusive.** It is not timed, but it plays whole runs in four engines and builds first, which keeps several cores busy for minutes. Shared jobs beside it would crawl, and the load would close their gate anyway.
- **Unknown is Exclusive,** so a new heavy script is safe until it is listed. A command that names both an Exclusive and a Shared script is Exclusive.
- **Overrides.** `--exclusive` or `--shared` before the command sets the class. Passing both is an error.

## What it does

1. **Locks.** Every file holds `{pid, command, cwd, startedAt}`, is written to a draft, and is hard linked into place, so taking it is atomic. A file whose pid is gone, or that does not decode, is stale: the guard says so and takes it over. A lock is released when the child exits, when it fails, and on `SIGINT` or `SIGTERM`, which also stops the child.
   - An **Exclusive** job holds `munch-manor-heavy.lock` in the temp directory, the same file every older guard used.
   - A **Shared** job holds one slot file, `munch-manor-heavy.d/shared-<n>.lock`, the lowest free slot from 1 to `HEAVY_SHARED_SLOTS`.
   - After taking its file, each guard looks again: an Exclusive job that finds a live Shared slot, or a Shared job that finds a live Exclusive lock, lets go and waits. Two guards racing can both back off, but never both run.
2. **Who waits for whom.**
   - An Exclusive job waits while the Exclusive lock is held and while any Shared slot is held.
   - A Shared job waits while the Exclusive lock is held and while every slot is held. It counts live slots past its own `HEAVY_SHARED_SLOTS` too.
   - **No starvation.** A waiting Exclusive job writes `munch-manor-heavy.d/exclusive-waiting-<pid>.json` with when it arrived, and removes it once it holds the lock, gives up, or is stopped. A Shared or Exclusive job that arrived after a live waiter waits behind it, so a stream of Shared jobs cannot starve it. A Shared job that was already queued before the waiter keeps its turn. A marker whose pid is gone is removed when read.
3. **Load gate.** An Exclusive job waits while the 1 minute load average is above the core count. A Shared job starts only while it is under 0.75 x cores (9 on 12 cores). The guard checks every `HEAVY_POLL_SECONDS` (10) for up to `HEAVY_WAIT_MINUTES` (30), and prints why at most every 30 seconds, such as `Waiting: load 24.1 over 12 cores (lock held by pid 4212: bun tools/balance/simulate.ts 100)` or `Waiting: an exclusive job is waiting first (pid 6001: bun tools/audit/splash.ts)`. When it gives up it exits with 1.
4. **Worker cap.** The child gets `WORKERS` set to the caller's `WORKERS` (4 by default) clamped to 1 through 4. When the load is above half the cores it drops to `floor((cores - load) / 2)`, at least 1. A balance run says when its workers were lowered.
5. **Balance budget.** Balance runs are counted per worktree and branch in `munch-manor-heavy-budget.json` in the temp directory. The third batch warns, and the sixth is refused unless `--allow-more` is passed. A corrupt ledger reads as empty.
6. **Run.** The child gets the terminal's stdin, stdout, and stderr. The guard says whether it runs alone or in which slot, exits with the child's code, and prints one line with the wall time and the load before and after.

`HEAVY_STATE_DIR` moves the locks, the slot directory, and the ledger, which is how to try the guard without touching the real ones.

## Worktrees on an older guard

A worktree that has not rebased onto the guard with classes still runs the old guard, which knows only `munch-manor-heavy.lock` and treats every job as Exclusive.

- Its jobs hold `munch-manor-heavy.lock`, so new guards see them as Exclusive: new Shared and Exclusive jobs wait for them.
- New Exclusive jobs hold that same file, so the old guard waits for them.
- The old guard does not read the slot directory, so it can start a job while new Shared jobs run. Until every worktree rebases, an old-guard job may overlap up to `HEAVY_SHARED_SLOTS` Shared jobs. Rebase a long-lived worktree before running timing audits in it.

## Files

| File               | What it holds                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decision.ts`      | The pure part: the snapshot, job classes, the `Decision`, the slot pick, the worker cap, the budget, the lock and ledger Schemas, argument parsing |
| `decision.test.ts` | Tests for every decision over fixed snapshots, run by `bun run test`                                                                               |
| `lock.ts`          | Reading, taking, and releasing the lock and slot files, the waiter markers, and checking a pid                                                     |
| `ledger.ts`        | Reading and writing the budget ledger                                                                                                              |
| `guard.ts`         | The shell: gathers a snapshot, acts on the decision, and runs the child                                                                            |
| `main.ts`          | The entry point                                                                                                                                    |

Every choice is made by `decide(snapshot)`, which returns `Run` (with the file to hold, the workers, whether to take over a stale file, and notes), `Wait` (with the reason), or `Refuse` (with the reason). The shell only reads the load, the lock, the slots, the waiters, and the ledger into a snapshot and carries out what comes back. `maybeConflictAfterTaking` is the pure check each guard makes after taking its file.
