/**
 * The D1 schema. The Worker applies it on the first request of each isolate
 * (src/worker/db.ts).
 *
 * There is no migration step: evolve it only with CREATE TABLE / CREATE INDEX IF NOT
 * EXISTS, and keep semicolons out of statement bodies and comments, because
 * schemaStatements() splits on every one. This file imports nothing so Node scripts
 * can load it.
 */

export const SCHEMA = `
-- One row per contribution: a place, a brand, a menu, a review excerpt, a photo or an
-- illustration, and proposals to update a place, a brand or a menu. Field values live in
-- data_json, provenance in its own columns. The kind's config (kinds/) says what data holds.
--   parent_id  the place or brand a menu, review, photo or illustration belongs to
--   root_id    the place whose page shows the record (a place points at itself)
--   ref_id     a place's brand, so a brand's change reaches its branches
--   target_id  for a proposal, the live record it would update in place
CREATE TABLE IF NOT EXISTS records (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  parent_id    TEXT,
  root_id      TEXT,
  ref_id       TEXT,
  target_id    TEXT,
  identity_key TEXT NOT NULL,
  status       TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  evidence     TEXT NOT NULL,
  observed_at  TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  merged_into  TEXT,
  flagged      INTEGER NOT NULL DEFAULT 0,
  verified_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Two live records of a kind never share an identity. Rejected, merged, withdrawn and applied
-- ones can, and so can proposals, which carry their target's identity on purpose.
CREATE UNIQUE INDEX IF NOT EXISTS records_identity ON records (kind, identity_key)
  WHERE status IN ('pending', 'verified', 'stale') AND target_id IS NULL;
-- One proposal waits per target at a time.
CREATE UNIQUE INDEX IF NOT EXISTS records_proposal ON records (target_id)
  WHERE status = 'pending' AND target_id IS NOT NULL;
-- What changed since the read models last looked: one range through this index.
CREATE INDEX IF NOT EXISTS records_changed ON records (updated_at);
-- A parent's children: unblocking, withdrawing or re-pointing them when the parent changes.
CREATE INDEX IF NOT EXISTS records_children ON records (parent_id, status) WHERE parent_id IS NOT NULL;
-- Everything one place's page shows, for its document.
CREATE INDEX IF NOT EXISTS records_root ON records (root_id, status) WHERE root_id IS NOT NULL;
-- A brand's branches.
CREATE INDEX IF NOT EXISTS records_ref ON records (ref_id) WHERE ref_id IS NOT NULL;
-- A token's records by kind and status: its standing, its cap, its waiting records.
CREATE INDEX IF NOT EXISTS records_submitter ON records (submitted_by, kind, status);
-- Verified records of a kind by when they were last checked: rechecks.
CREATE INDEX IF NOT EXISTS records_due ON records (kind, status, verified_at);
-- Records of a kind by status and age: the media purge, the admin's lists.
CREATE INDEX IF NOT EXISTS records_age ON records (kind, status, updated_at);

-- Every change to a record. Reverting a token replays its rows. A change the server made
-- because another record changed (a place rejected withdraws its reviews) names that record
-- in caused_by, so undoing the cause undoes its effects too.
CREATE TABLE IF NOT EXISTS revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT NOT NULL,
  reason      TEXT,
  source_url  TEXT,
  evidence    TEXT,
  caused_by   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS revisions_record ON revisions (record_id, id);
CREATE INDEX IF NOT EXISTS revisions_actor ON revisions (actor, id);
-- A maintainer's verdicts today, on every lease and skill fetch: a range, not a scan.
CREATE INDEX IF NOT EXISTS revisions_actor_time ON revisions (actor, created_at);
CREATE INDEX IF NOT EXISTS revisions_actor_kind_time ON revisions (actor, kind, created_at);
CREATE INDEX IF NOT EXISTS revisions_cause ON revisions (caused_by) WHERE caused_by IS NOT NULL;

-- Agent credentials. Only a hash of each secret is stored. kinds_json lists the kinds a
-- maintainer token reviews, or ["*"].
CREATE TABLE IF NOT EXISTS tokens (
  id               TEXT PRIMARY KEY,
  secret_hash      TEXT NOT NULL UNIQUE,
  role             TEXT NOT NULL,
  label            TEXT NOT NULL,
  kinds_json       TEXT NOT NULL,
  status           TEXT NOT NULL,
  pending_cap      INTEGER,
  daily_task_limit INTEGER,
  expires_at       TEXT,
  last_used_at     TEXT,
  created_at       TEXT NOT NULL
);

-- A token's reviewed records of one kind, by status: one row instead of a count over
-- everything it ever sent. Every status change moves these counts in the same batch
-- (moveStanding, src/worker/tokens.ts), and a row a day old is counted again. Pending records
-- are counted live, and withdrawn ones not at all: a place rejected is not its reviews' fault.
CREATE TABLE IF NOT EXISTS standings (
  token_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  verified   INTEGER NOT NULL,
  rejected   INTEGER NOT NULL,
  merged     INTEGER NOT NULL,
  stale      INTEGER NOT NULL,
  counted_at TEXT NOT NULL,
  PRIMARY KEY (token_id, kind)
);

-- Maintainer work. type is verify (a new record), update (a proposal) or recheck. A task
-- whose record waits on a parent that is not verified yet is blocked, and no lease sees it.
-- A lease reserves a task for one token. note carries the submit-time check of the quote,
-- or a collector's flag.
CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  record_id        TEXT NOT NULL,
  record_kind      TEXT NOT NULL,
  type             TEXT NOT NULL,
  status           TEXT NOT NULL,
  note             TEXT,
  leased_to        TEXT,
  lease_expires_at TEXT,
  created_at       TEXT NOT NULL,
  done_at          TEXT
);
-- What a lease takes from, oldest first: open and leased tasks only. Done and blocked ones are
-- never walked. The first serves tokens for every kind, the second tokens for some.
-- A lease's status test must stay word for word these WHERE clauses, or SQLite cannot use them.
CREATE INDEX IF NOT EXISTS tasks_open ON tasks (created_at, id) WHERE status IN ('open', 'leased');
CREATE INDEX IF NOT EXISTS tasks_open_kind ON tasks (record_kind, created_at, id) WHERE status IN ('open', 'leased');
CREATE INDEX IF NOT EXISTS tasks_leased ON tasks (lease_expires_at) WHERE status = 'leased';
CREATE INDEX IF NOT EXISTS tasks_record ON tasks (record_id, status);
CREATE INDEX IF NOT EXISTS tasks_review ON tasks (record_kind) WHERE status = 'review';

-- Each place's public page, built from its records (src/worker/docs.ts): the document the page
-- reads in one row, the slim entry the index is assembled from, and hashes of what it
-- contributes to the dish and source tables, so those are rewritten only when they change.
CREATE TABLE IF NOT EXISTS place_docs (
  place_id     TEXT PRIMARY KEY,
  doc_json     TEXT NOT NULL,
  entry_json   TEXT,
  etag         TEXT NOT NULL,
  dishes_hash  TEXT,
  sources_hash TEXT,
  built_at     TEXT NOT NULL
);
-- Places whose document is out of date, oldest first. The cron rebuilds a bounded number a run.
CREATE TABLE IF NOT EXISTS dirty_places (
  place_id TEXT PRIMARY KEY,
  since    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dirty_places_since ON dirty_places (since);

-- Whole datasets readers load at once (index, dishes, illustrations). The JSON is cut into
-- parts under D1's 2 MB row limit. The head records what it was built from.
CREATE TABLE IF NOT EXISTS dataset_heads (
  name      TEXT PRIMARY KEY,
  watermark TEXT,
  count     INTEGER NOT NULL DEFAULT 0,
  built_at  TEXT NOT NULL,
  full_at   TEXT
);
CREATE TABLE IF NOT EXISTS dataset_parts (
  name TEXT NOT NULL,
  part INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (name, part)
);

-- Where each dish can be eaten: one row per dish, place and how we know (a menu or a review).
CREATE TABLE IF NOT EXISTS dish_places (
  dish_key   TEXT NOT NULL,
  place_id   TEXT NOT NULL,
  via        TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  PRIMARY KEY (dish_key, place_id, via)
);
CREATE INDEX IF NOT EXISTS dish_places_place ON dish_places (place_id);

-- Every dish by its standard Chinese name, how many places serve it, and its illustration.
CREATE TABLE IF NOT EXISTS dishes (
  dish_key        TEXT PRIMARY KEY,
  name_zh         TEXT,
  name_en         TEXT,
  places          INTEGER NOT NULL DEFAULT 0,
  illustration_id TEXT,
  updated_at      TEXT NOT NULL
);
-- Dishes still waiting for an illustration, most served first.
CREATE INDEX IF NOT EXISTS dishes_unillustrated ON dishes (places DESC) WHERE illustration_id IS NULL AND places > 0;

-- Every public review excerpt by its source and author, for the pages that list one source's
-- or one critic's history.
CREATE TABLE IF NOT EXISTS source_entries (
  review_id    TEXT PRIMARY KEY,
  place_id     TEXT NOT NULL,
  source_key   TEXT NOT NULL,
  author_key   TEXT,
  published_on TEXT NOT NULL,
  entry_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS source_entries_source ON source_entries (source_key, published_on);
CREATE INDEX IF NOT EXISTS source_entries_author ON source_entries (author_key, published_on) WHERE author_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_entries_place ON source_entries (place_id);

-- Collectors' work feed (src/worker/work.ts): leads to research, places missing a menu or
-- reviews, menu photos to transcribe, dishes to illustrate. One item per type and subject.
-- An item is handed to one token for a while, so two agents do not do the same work.
CREATE TABLE IF NOT EXISTS work_items (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  status       TEXT NOT NULL,
  handed_to    TEXT,
  handed_until TEXT,
  record_id    TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS work_items_subject ON work_items (type, subject);
-- Open items of a type, most wanted first, then oldest. A handed item stays open until it is
-- submitted: its handout simply runs out if the agent never comes back.
CREATE INDEX IF NOT EXISTS work_items_open ON work_items (type, priority DESC, created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS work_items_handed ON work_items (handed_to) WHERE handed_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_items_record ON work_items (record_id) WHERE record_id IS NOT NULL;

-- Postcodes looked up at postcodes.io, so each is asked once.
CREATE TABLE IF NOT EXISTS postcodes (
  postcode      TEXT PRIMARY KEY,
  outcode       TEXT NOT NULL,
  lat           REAL,
  lng           REAL,
  district      TEXT,
  district_code TEXT,
  london        INTEGER NOT NULL,
  checked_at    TEXT NOT NULL
);

-- Replies to submits that carried an Idempotency-Key, kept for 24 hours.
CREATE TABLE IF NOT EXISTS idempotency (
  token_id      TEXT NOT NULL,
  key           TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (token_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_age ON idempotency (created_at);

-- Readers' reports on public records: something wrong, or a rights holder asking us to take
-- an excerpt or a photo down.
CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id  TEXT NOT NULL,
  type       TEXT NOT NULL,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_open ON reports (status, record_id);

-- Settings made in /settings, and the schema fingerprint, under scope '*'.
CREATE TABLE IF NOT EXISTS settings (
  scope      TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

-- The admin's weekly accuracy check: one mark per sampled record per ISO week.
CREATE TABLE IF NOT EXISTS spot_checks (
  week       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  note       TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (week, record_id)
);

-- Fixed-window counters for rate limits.
CREATE TABLE IF NOT EXISTS rate_counters (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_counters_window ON rate_counters (window_start);
`;

/**
 * Split SQL into statements: drop `--` comment lines first, then split on ';'.
 * Comments go first because they may contain punctuation that would otherwise split a
 * statement in half. Statement bodies may not.
 */
export function schemaStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
