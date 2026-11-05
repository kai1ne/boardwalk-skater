// Boardwalk Skater global leaderboard: a Cloudflare Worker with a D1 database.
//   GET  /top5    the all-time top 5 and how many games have been played { top5: [{ name, score, date }], plays }, cached a few seconds
//   POST /start   a signed run token { runId, startedAt, signature }; each one counts as a game played
//   POST /score   { token, name, score, distance, trickCounts, claimedDurationSec, gameVersion } → { ok, qualified, top5 }
//   /admin/...    list / delete / clear, with the admin secret (see README)
// Secrets (Cloudflare secret store, or .dev.vars for local dev): RUN_SECRET (signs run tokens), IP_SALT (hashes client
// IPs for rate limiting; raw IPs are never stored), ADMIN_SECRET (admin endpoints). Rules and limits are in config.js.
import { ALLOWED_ORIGINS, RUN, SCORE, SPEED, LIMITS, ADMIN_PREFIX } from './config.js';
import { checkName } from './names.js';

const te = new TextEncoder();
class Reject extends Error { constructor(status, code, message, log = true) { super(message); this.status = status; this.code = code; this.log = log; } }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// ---- CORS: only the game's own origin (and localhost for development). Requests without an Origin header (scripts,
// curl) can't be stopped by CORS anyway; the token, rate limits and score checks cover those.
const originOK = (o) => !o || ALLOWED_ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
const corsFor = (o) => (o && originOK(o) ? { 'access-control-allow-origin': o, vary: 'Origin' } : { vary: 'Origin' });

// ---- crypto helpers
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, te.encode(text)));
}
async function sha256hex(text) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function safeEqual(a, b) { const A = te.encode(String(a)), B = te.encode(String(b)); return A.length === B.length && crypto.subtle.timingSafeEqual(A, B); }

// ---- global daily write budget: stops writing (gracefully, with a 503) before the D1 free tier's daily limit
async function spendWrites(env, n) {
  const day = utcDay(), row = await env.DB.prepare('SELECT writes FROM daily WHERE day = ?').bind(day).first();
  if ((row?.writes ?? 0) + n > LIMITS.dailyWriteCap) return false;
  await env.DB.prepare('INSERT INTO daily (day, writes) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET writes = writes + excluded.writes').bind(day, n).run();
  return true;
}
const busy = () => new Reject(503, 'daily_limit', 'The leaderboard has reached its daily limit; try again tomorrow', false);

// ---- per-client rate limit: the client IP (Cloudflare's CF-Connecting-IP) is hashed with a secret salt and the day,
// so the stored key can't be turned back into an IP; rows expire after two hours.
async function rateKey(env, request, kind) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return `${(await sha256hex(`${env.IP_SALT}|${ip}|${utcDay()}`)).slice(0, 32)}:${kind}:${Math.floor(Date.now() / 3600000)}`;
}
const isAdmin = (env, request) => !!env.ADMIN_SECRET && safeEqual(request.headers.get('authorization') || '', `Bearer ${env.ADMIN_SECRET}`);
async function rateLimit(env, request, kind, limit) {
  if (isAdmin(env, request)) return null;   // the admin secret skips the per-client limit (for testing); the daily write cap still applies
  const key = await rateKey(env, request, kind), row = await env.DB.prepare('SELECT count FROM rate WHERE key = ?').bind(key).first();
  if ((row?.count ?? 0) >= limit) throw new Reject(429, 'rate_limited', 'Too many requests from this connection; try again later', false);   // over the limit: no writes at all
  return key;
}
const rateBump = (env, key) => key && env.DB.prepare('INSERT INTO rate (key, count, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1').bind(key, Date.now() + 2 * 3600000).run();

// ---- rejected submissions are logged by reason only (no names, scores, IPs): Workers logs, plus a daily count in D1
async function logReject(env, endpoint, code) {
  console.log(JSON.stringify({ rejected: code, endpoint }));
  try { if (await spendWrites(env, 2)) await env.DB.prepare('INSERT INTO rejects (day, endpoint, reason, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, endpoint, reason) DO UPDATE SET count = count + 1').bind(utcDay(), endpoint, code).run(); }
  catch (e) { console.error('reject log failed', e); }
}

// ---- the board
let cache = null;   // { at, rows, plays }: per Worker instance (the Cache API isn't available on workers.dev)
async function readTop(env, n) {
  const { results } = await env.DB.prepare('SELECT id, name, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT ?').bind(n).all();
  return results;
}
async function top5(env) {
  if (cache && Date.now() - cache.at < LIMITS.top5CacheMs) return cache.rows;
  const rows = (await readTop(env, LIMITS.boardSize)).map((r) => ({ name: r.name, score: r.score, date: new Date(r.created_at).toISOString() }));
  cache = { at: Date.now(), rows, plays: await playsTotal(env) }; return rows;
}

// ---- games played: one counter row per UTC day (no personal data), summed for the public total
async function playsTotal(env) {
  try { return (await env.DB.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM plays').first())?.n ?? null; }
  catch (e) { console.error('plays read failed', e); return null; }   // e.g. the plays table hasn't been created yet
}
async function countPlay(env) {
  try { await env.DB.prepare('INSERT INTO plays (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1').bind(utcDay()).run(); }
  catch (e) { console.error('plays count failed', e); }   // never costs the player their run token
}

// the furthest a clean run can get in t seconds: start speed ramping to top speed (config.js SPEED), in feet
function maxDistanceFt(t) {
  const tr = (SPEED.max - SPEED.start) / SPEED.ramp, m = t <= tr ? SPEED.start * t + 0.5 * SPEED.ramp * t * t : SPEED.start * tr + 0.5 * SPEED.ramp * tr * tr + SPEED.max * (t - tr);
  return m * 3.28084 * SPEED.slack + 50;
}

async function start(env, request) {
  const key = await rateLimit(env, request, 'start', LIMITS.startsPerHour);
  if (!(await spendWrites(env, key ? 3 : 2))) throw busy();
  await rateBump(env, key);
  if (key) await countPlay(env);   // admin-keyed test runs don't count as games played
  const runId = crypto.randomUUID(), startedAt = Date.now();
  return { runId, startedAt, signature: await hmac(env.RUN_SECRET, `${runId}.${startedAt}`) };
}

async function score(env, request) {
  const key = await rateLimit(env, request, 'score', LIMITS.scoresPerHour);
  if (!(await spendWrites(env, 8))) throw busy();
  await rateBump(env, key);   // every submission counts toward the hourly limit, accepted or not
  let b; try { b = await request.json(); } catch { throw new Reject(400, 'bad_json', 'The request body must be JSON'); }
  const t = b && b.token;
  if (!t || typeof t.runId !== 'string' || t.runId.length > 64 || !Number.isInteger(t.startedAt) || typeof t.signature !== 'string') throw new Reject(400, 'bad_token', 'Missing or malformed run token');
  if (!safeEqual(await hmac(env.RUN_SECRET, `${t.runId}.${t.startedAt}`), t.signature)) throw new Reject(403, 'bad_signature', 'The run token signature is invalid');
  const now = Date.now(), elapsed = (now - t.startedAt) / 1000;
  if (elapsed < 0 || elapsed > RUN.maxAgeSec) throw new Reject(403, 'token_expired', 'The run token has expired');

  const s = b.score;
  if (typeof s !== 'number' || !Number.isInteger(s)) throw new Reject(400, 'score_not_integer', 'The score must be a whole number');
  if (s < 0) throw new Reject(400, 'score_negative', 'The score cannot be negative');
  if (s > SCORE.hardMax) throw new Reject(400, 'score_absurd', 'The score is impossibly large');
  const claimed = b.claimedDurationSec;
  if (typeof claimed !== 'number' || !Number.isFinite(claimed) || claimed < 0) throw new Reject(400, 'bad_duration', 'claimedDurationSec must be a non-negative number');
  if (elapsed < claimed - RUN.durationToleranceSec) throw new Reject(400, 'too_fast', 'The run claims more play time than has passed');
  const tt = Math.min(elapsed, claimed + RUN.durationToleranceSec);
  if (s > SCORE.bonusBound + SCORE.maxPerSec * tt) throw new Reject(400, 'score_too_high', 'The score is higher than this run could have scored');
  const d = b.distance;
  if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) throw new Reject(400, 'bad_distance', 'distance must be a non-negative number');
  if (d > maxDistanceFt(tt)) throw new Reject(400, 'distance_too_far', 'The distance is further than this run could have gone');
  const tc = b.trickCounts;
  if (!tc || typeof tc !== 'object' || Array.isArray(tc) || Object.keys(tc).length > 8 || Object.values(tc).some((n) => !Number.isInteger(n) || n < 0)) throw new Reject(400, 'bad_tricks', 'trickCounts must map trick names to whole numbers');
  if (Object.values(tc).reduce((a, n) => a + n, 0) > (100 + 6 * tt) / 8 + 1) throw new Reject(400, 'too_many_tricks', 'More tricks than this run had energy for');
  const ver = b.gameVersion;
  if (typeof ver !== 'string' || !/^[\w.-]{1,16}$/.test(ver)) throw new Reject(400, 'bad_version', 'gameVersion is missing or malformed');
  const nm = checkName(b.name); if (!nm.ok) throw new Reject(400, nm.code, nm.code === 'name_blocked' ? 'Please choose a different name' : 'Names are 3 to 10 letters or numbers');

  // each run token posts once (only an accepted submission uses it up, so a rejected name can be fixed and resent)
  const used = await env.DB.prepare('INSERT OR IGNORE INTO used_runs (run_id, used_at) VALUES (?, ?)').bind(t.runId, now).run();
  if (!used.meta.changes) throw new Reject(409, 'token_used', 'This run has already been submitted');

  const board = await readTop(env, LIMITS.boardSize), qualified = board.length < LIMITS.boardSize || s > board[board.length - 1].score;
  let id = null;
  if (qualified) {
    const ins = await env.DB.prepare('INSERT INTO scores (name, score, created_at, game_version) VALUES (?, ?, ?, ?)').bind(nm.name, s, now, ver).run();
    id = ins.meta.last_row_id ?? null;
    await env.DB.prepare('DELETE FROM scores WHERE id NOT IN (SELECT id FROM scores ORDER BY score DESC, created_at ASC LIMIT ?)').bind(LIMITS.keepRows).run();
    cache = null;
  }
  const rows = await top5(env);
  return { ok: true, qualified, top5: rows, rank: qualified ? rows.findIndex((r) => r.name === nm.name && r.score === s) + 1 || null : null };
}

// ---- admin (Authorization: Bearer <ADMIN_SECRET>); the secret only lives in Cloudflare and your local server/.env
async function admin(env, request, path) {
  if (!isAdmin(env, request)) throw new Reject(401, 'unauthorized', 'Admin secret required');
  const m = request.method;
  if (m === 'GET' && path === '/entries') return { entries: (await env.DB.prepare('SELECT id, name, score, created_at, game_version FROM scores ORDER BY score DESC, created_at ASC').all()).results };
  if (m === 'GET' && path === '/health') return { clientIpHeader: !!request.headers.get('CF-Connecting-IP'), today: utcDay(), writesToday: (await env.DB.prepare('SELECT writes FROM daily WHERE day = ?').bind(utcDay()).first())?.writes ?? 0, cap: LIMITS.dailyWriteCap };
  if (m === 'GET' && path === '/plays') return { total: await playsTotal(env), days: (await env.DB.prepare('SELECT day, count FROM plays ORDER BY day DESC LIMIT 400').all()).results };
  if (m === 'GET' && path === '/rejects') return { rejects: (await env.DB.prepare('SELECT day, endpoint, reason, count FROM rejects ORDER BY day DESC, count DESC LIMIT 200').all()).results };
  const del = path.match(/^\/entries\/(\d+)$/);
  if (m === 'DELETE' && del) { const r = await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(Number(del[1])).run(); cache = null; return { deleted: r.meta.changes }; }
  if (m === 'POST' && path === '/clear') {
    let b = {}; try { b = await request.json(); } catch { /* no body */ }
    if (b.confirm !== 'CLEAR') throw new Reject(400, 'confirm_required', 'Send {"confirm":"CLEAR"} to clear the board', false);
    const r = await env.DB.prepare('DELETE FROM scores').run(); cache = null; return { deleted: r.meta.changes };
  }
  throw new Reject(404, 'not_found', 'No such admin endpoint', false);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = request.headers.get('Origin'), cors = corsFor(origin);
    if (request.method === 'OPTIONS') {
      if (!originOK(origin)) return new Response(null, { status: 403, headers: { vary: 'Origin' } });
      return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
    }
    try {
      if (!originOK(origin)) throw new Reject(403, 'origin_not_allowed', 'This site may not use the leaderboard', false);
      if (url.pathname.startsWith(ADMIN_PREFIX + '/')) return json(await admin(env, request, url.pathname.slice(ADMIN_PREFIX.length)));
      if (request.method === 'GET' && url.pathname === '/top5') { const rows = await top5(env); return json({ top5: rows, plays: cache?.plays ?? null }, 200, { ...cors, 'cache-control': 'public, max-age=5' }); }
      if (request.method === 'POST' && url.pathname === '/start') return json(await start(env, request), 200, cors);
      if (request.method === 'POST' && url.pathname === '/score') return json(await score(env, request), 200, cors);
      throw new Reject(404, 'not_found', 'No such endpoint', false);
    } catch (e) {
      if (e instanceof Reject) { if (e.log) ctx.waitUntil(logReject(env, url.pathname, e.code)); else console.log(JSON.stringify({ rejected: e.code, endpoint: url.pathname })); return json({ error: e.code, message: e.message }, e.status, cors); }
      console.error(e);
      return json({ error: 'server_error', message: 'The leaderboard is unavailable right now' }, 503, cors);
    }
  },
  // daily tidy-up: used run tokens, expired rate-limit rows, old counters
  async scheduled(event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM used_runs WHERE used_at < ?').bind(now - 2 * 3600000),
      env.DB.prepare('DELETE FROM rate WHERE expires < ?').bind(now),
      env.DB.prepare('DELETE FROM daily WHERE day < ?').bind(utcDay(now - 8 * 86400000)),
      env.DB.prepare('DELETE FROM rejects WHERE day < ?').bind(utcDay(now - 31 * 86400000)),
    ]);
  },
};
