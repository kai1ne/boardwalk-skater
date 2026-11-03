// Server-side rules for the Boardwalk Skater leaderboard. Everything here is public (it ships in the repo); secrets
// (the run-token HMAC key, the IP-hash salt, the admin secret) live only in Cloudflare's secret store / .dev.vars.

export const ALLOWED_ORIGINS = ['https://kai1ne.github.io'];   // plus any http://localhost:<port> / http://127.0.0.1:<port> for development

export const RUN = {
  maxAgeSec: 30 * 60,          // a run token expires 30 min after /start (longer runs can't post)
  durationToleranceSec: 5,     // the server's elapsed time may trail the client's claimed play time by this much (clock / network slack)
};

// ---- score ceiling: score <= BONUS_BOUND + MAX_SCORE_PER_SEC * t, where t = min(server elapsed, claimed duration + tolerance)
// Derived from the game's config (venice-boardwalk.html GAME.score / tricks / energy) and checked against the autopilot:
//   * tricks are limited by energy: 100 to start, +6 per second. The best points per energy is an impossible from a full
//     jump: (400 trick + 100 ollie) / 35 energy ≈ 14, ×2 over an obstacle, ×8 combo ≈ 224 points per energy point.
//     → 224 × 100 ≈ 22,400 up front, and 224 × 6 ≈ 1,344 per second.
//   * close calls (60 × 8 combo = 480) and clears (75) are limited by how fast obstacles come: at most ~0.8 a second
//     (the autopilot met 46–48 a minute) → ~450 per second.
//   * distance only pays the seven milestone bonuses: 30,000 in total.
//   → per second ≈ 1,344 + 450 ≈ 1,800; up front ≈ 22,400 + 30,000 + margin ≈ 55,000.
// Measured: a 10-minute autopilot run that never lost (health held full) scored 285,415 (≈ 480/s average, 926/s at its
// best 30 s), about a quarter of this ceiling, so honest runs never come near it; it only stops absurd scores.
export const SCORE = {
  maxPerSec: 1800,
  bonusBound: 55000,
  hardMax: 5_000_000,          // absolute cap whatever the time
};

// ---- distance ceiling: a clean run from the start speed ramping to the top speed (GAME.speed: start 7.5, ramp 0.22, max 64 m/s)
export const SPEED = { start: 7.5, ramp: 0.22, max: 64, slack: 1.1 };   // slack: 10% for frame-timing differences

export const NAME = { min: 3, max: 10 };

// ---- rate limits (per hashed client IP, per hour) and the global daily write budget
export const LIMITS = {
  startsPerHour: 10,
  scoresPerHour: 10,
  dailyWriteCap: 30000,        // write operations per UTC day before the service stops writing (D1 free tier: 100,000 rows written/day;
                               // an operation can write more than one row, e.g. an index entry, so this keeps a wide margin)
  top5CacheMs: 5000,           // GET /top5 is cached this long in each Worker instance
  keepRows: 100,               // only the top 100 scores are kept
  boardSize: 5,
};

export const ADMIN_PREFIX = '/admin';
