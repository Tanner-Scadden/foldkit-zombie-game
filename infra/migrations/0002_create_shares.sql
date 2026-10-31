-- One row per tap on SHARE to X at the end of a run, when the player shares
-- anonymous play stats. See ShareEvent in src/analytics.ts. Nothing here
-- identifies a person: visit_id is random per page visit, and the post's
-- text is never sent.
CREATE TABLE shares (
  id INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL,
  received_day TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  visit_id TEXT NOT NULL,
  build TEXT NOT NULL,
  screen TEXT NOT NULL,
  mode TEXT NOT NULL,
  difficulty TEXT NOT NULL
);

CREATE INDEX shares_by_day ON shares (received_day);

CREATE INDEX shares_by_screen ON shares (screen, mode, difficulty);
