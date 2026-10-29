# Heavy guard

A small Effect program that every CPU-heavy job goes through, so several agents on one laptop take turns instead of piling up. Run it from the repo root.

| Command                                      | What it does                                              |
| -------------------------------------------- | --------------------------------------------------------- |
| `bun run balance [runs]`                     | The balance bot through the guard                         |
| `bun run perf:check`                         | The frame time gate through the guard                     |
| `bun run heavy -- <command...>`              | Any other heavy command, such as an audit or shots script |
| `bun run heavy -- --allow-more <command...>` | Run past the balance budget                               |
| `bun run heavy -- --reset-budget`            | Reset this worktree and branch's balance batch count      |

Env vars on the command line, such as `MODE=endless bun run balance 100`, pass through to the child.

## What it does

1. **Lock.** One lock file for the whole machine, `munch-manor-heavy.lock` in the temp directory, holding `{pid, command, cwd, startedAt}`. It is written to a draft and hard linked into place, so taking it is atomic. While a live process holds it, the guard waits. A lock whose pid is gone, or a file that does not decode, is stale: the guard says so and takes it over. The lock is released when the child exits, when it fails, and on `SIGINT` or `SIGTERM`, which also stops the child.
2. **Load gate.** It waits while the 1 minute load average is above the core count, checking every `HEAVY_POLL_SECONDS` (10) for up to `HEAVY_WAIT_MINUTES` (30), and prints why at most every 30 seconds, such as `Waiting: load 24.1 over 12 cores (lock held by pid 4212: bun tools/balance/simulate.ts 100)`. When it gives up it exits with 1.
3. **Worker cap.** The child gets `WORKERS` set to the caller's `WORKERS` (4 by default) clamped to 1 through 4. When the load is above half the cores it drops to `floor((cores - load) / 2)`, at least 1. A balance run says when its workers were lowered.
4. **Balance budget.** Balance runs are counted per worktree and branch in `munch-manor-heavy-budget.json` in the temp directory. The third batch warns, and the sixth is refused unless `--allow-more` is passed. A corrupt ledger reads as empty.
5. **Run.** The child gets the terminal's stdin, stdout, and stderr. The guard exits with the child's code and prints one line with the wall time and the load before and after.

`HEAVY_STATE_DIR` moves the lock and the ledger, which is how to try the guard without touching the real lock.

## Files

| File               | What it holds                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `decision.ts`      | The pure part: the snapshot, the `Decision`, the worker cap, the budget, the lock and ledger Schemas, and argument parsing |
| `decision.test.ts` | Tests for every decision over fixed snapshots, run by `bun run test`                                                       |
| `lock.ts`          | Reading, taking, and releasing the lock file, and checking a pid                                                           |
| `ledger.ts`        | Reading and writing the budget ledger                                                                                      |
| `guard.ts`         | The shell: gathers a snapshot, acts on the decision, and runs the child                                                    |
| `main.ts`          | The entry point                                                                                                            |

Every choice is made by `decide(snapshot)`, which returns `Run` (with the workers, whether to take over a stale lock, and notes), `Wait` (with the reason), or `Refuse` (with the reason). The shell only reads the load, the lock, and the ledger into a snapshot and carries out what comes back.
