-- Boardwalk Skater leaderboard (Cloudflare D1). Apply with: npx wrangler d1 execute boardwalk-leaderboard --remote --file=schema.sql
-- Only name, score, time and game version are stored for a score. The other tables hold no personal data:
-- used run ids, games played per day, hashed (salted, day-scoped) rate-limit keys, daily write counts and rejection counts by reason.
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at INTEGER NOT NULL,          -- ms since 1970 (UTC)
  game_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_rank ON scores (score DESC, created_at ASC);
CREATE TABLE IF NOT EXISTS used_runs (run_id TEXT PRIMARY KEY, used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, writes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rejects (day TEXT NOT NULL, endpoint TEXT NOT NULL, reason TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, endpoint, reason));
CREATE TABLE IF NOT EXISTS plays (day TEXT PRIMARY KEY, count INTEGER NOT NULL);   -- games started per UTC day (kept; the public total is the sum)
