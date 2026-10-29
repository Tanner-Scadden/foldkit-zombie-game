-- One row per run summary posted by the game. See src/analytics.ts for the
-- shape and PLATFORM.md for what is collected and why. Nothing here
-- identifies a person: visit_id is random per page visit, and no IP address
-- or hash of one is ever stored.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL,
  received_day TEXT NOT NULL,
  summary_version INTEGER NOT NULL,
  visit_id TEXT NOT NULL,
  build TEXT NOT NULL,
  mode TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  wave INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  killed_by TEXT,
  run_ms INTEGER NOT NULL,
  hearts_lost INTEGER NOT NULL,
  purchases INTEGER NOT NULL,
  power_ups_grabbed INTEGER NOT NULL,
  traps_placed INTEGER NOT NULL,
  device TEXT NOT NULL,
  screen_fit TEXT NOT NULL,
  frame_time TEXT NOT NULL,
  kills TEXT NOT NULL CHECK (json_valid(kills))
);

CREATE INDEX runs_by_day ON runs (received_day);

CREATE INDEX runs_by_difficulty ON runs (mode, difficulty, outcome);
