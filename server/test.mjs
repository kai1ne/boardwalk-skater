// Checks the leaderboard rules against a running server (local `wrangler dev` or the deployed Worker).
//   node test.mjs http://localhost:8787 .dev.vars      (local)
//   node test.mjs https://<worker>.workers.dev .env    (deployed)
// The secrets file supplies ADMIN_SECRET (most checks use it so they skip the per-client rate limit, plus the admin
// tools) and RUN_SECRET (to forge an already-expired token). It never prints either value. It clears the board when done.
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
const [base, secretsFile] = process.argv.slice(2);
if (!base || !secretsFile) { console.error('usage: node test.mjs <baseUrl> <secretsFile>'); process.exit(1); }
const env = Object.fromEntries(readFileSync(secretsFile, 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const ADMIN = { authorization: `Bearer ${env.ADMIN_SECRET}` }, GAME = { origin: 'https://kai1ne.github.io' };
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };
async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data, acao: r.headers.get('access-control-allow-origin') };
}
const start = async (h = { ...GAME, ...ADMIN }) => (await call('POST', '/start', null, h)).data;
const submit = (token, o = {}, h = { ...GAME, ...ADMIN }) => call('POST', '/score', { token, name: 'Tester', score: 1000, distance: 50, trickCounts: { kickflip: 1 }, claimedDurationSec: 1, gameVersion: 'test', ...o }, h);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await call('POST', '/admin/clear', { confirm: 'CLEAR' }, ADMIN);
const t0 = await call('GET', '/top5', null, GAME);
ok(t0.status === 200 && Array.isArray(t0.data.top5), 'GET /top5 answers', `(${t0.data && t0.data.top5.length} entries)`);
ok(t0.acao === 'https://kai1ne.github.io', 'CORS allows the game origin');

// a normal run
const tok = await start(); ok(tok && tok.runId && tok.signature, 'POST /start returns a signed token');
await sleep(2100);
const good = await submit(tok, { name: 'Calvin', score: 4321, claimedDurationSec: 2 });
ok(good.status === 200 && good.data.qualified && good.data.top5.some((r) => r.name === 'Calvin' && r.score === 4321), 'a normal run is accepted and on the board', JSON.stringify(good.data && good.data.top5));
ok((await submit(tok, { name: 'Calvin', score: 4321 })).data.error === 'token_used', 'replayed token rejected (token_used)');
ok((await submit({ ...tok, signature: tok.signature.slice(0, -2) + (tok.signature.endsWith('AA') ? 'BB' : 'AA') })).data.error === 'bad_signature', 'tampered signature rejected (bad_signature)');
const old = Date.now() - 31 * 60 * 1000, oldId = 'expired-test-' + old;
const expired = { runId: oldId, startedAt: old, signature: createHmac('sha256', env.RUN_SECRET).update(`${oldId}.${old}`).digest('base64url') };
ok((await submit(expired, { claimedDurationSec: 60 })).data.error === 'token_expired', 'expired token rejected (token_expired)');

// rule checks on one fresh token (rejected submissions don't use it up)
const t2 = await start();
const expect = async (o, code, label) => { const r = await submit(t2, o); ok(r.data && r.data.error === code, label, `→ ${r.status} ${r.data && r.data.error}`); };
await expect({ score: 60000, claimedDurationSec: 0 }, 'score_too_high', 'too-high score rejected');
await expect({ score: 500, claimedDurationSec: 120 }, 'too_fast', 'more play time than has passed rejected');
await expect({ score: 12.5 }, 'score_not_integer', 'non-integer score rejected');
await expect({ score: -5 }, 'score_negative', 'negative score rejected');
await expect({ score: 9e9 }, 'score_absurd', 'absurd score rejected');
await expect({ distance: 999999 }, 'distance_too_far', 'impossible distance rejected');
await expect({ name: 'ab' }, 'name_length', 'too-short name rejected');
await expect({ name: 'bad name!' }, 'name_chars', 'name with symbols rejected');
await expect({ name: 'Sh1tHead' }, 'name_blocked', 'blocked name rejected');

// the board never shows more than 5, sorted, and the 6th-best isn't on it
await call('POST', '/admin/clear', { confirm: 'CLEAR' }, ADMIN);
const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'], pts = [600, 900, 300, 1200, 750, 450];
for (let i = 0; i < 6; i++) { const t = await start(); await submit(t, { name: names[i], score: pts[i] }); }
const b = (await call('GET', '/top5', null, GAME)).data.top5;   // may be up to 5 s stale in another instance
await sleep(5200); const b2 = (await call('GET', '/top5', null, GAME)).data.top5;
ok(b2.length === 5 && b2.every((r, i) => i === 0 || b2[i - 1].score >= r.score), 'board has 5 entries, sorted by score', b2.map((r) => `${r.name}:${r.score}`).join(' '));
ok(b2.map((r) => r.score).join() === '1200,900,750,600,450' && !b2.some((r) => r.score === 300), 'the 6th-best (300) is not shown');

// CORS from another origin
const evil = await call('GET', '/top5', null, { origin: 'https://evil.example' });
ok(evil.status === 403 && !evil.acao, 'another origin is refused (403, no CORS header)');
const pre = await fetch(base + '/score', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
ok(pre.status === 403 && !pre.headers.get('access-control-allow-origin'), 'CORS preflight from another origin refused');

// admin tools
const list = await call('GET', '/admin/entries', null, ADMIN); ok(list.status === 200 && list.data.entries.length >= 5, 'admin: list entries', `(${list.data.entries.length})`);
const victim = list.data.entries[0]; const del = await call('DELETE', `/admin/entries/${victim.id}`, null, ADMIN); ok(del.data && del.data.deleted === 1, 'admin: delete one entry');
ok((await call('GET', '/admin/entries', null, { authorization: 'Bearer wrong' })).status === 401, 'admin: wrong secret refused');
const clr = await call('POST', '/admin/clear', { confirm: 'CLEAR' }, ADMIN); ok(clr.status === 200, 'admin: clear the board', `(${clr.data.deleted} deleted)`);
const rej = await call('GET', '/admin/rejects', null, ADMIN); ok(rej.status === 200, 'admin: rejection log readable', JSON.stringify(rej.data.rejects.slice(0, 4)));

// rate limit, without the admin secret: 10 starts an hour, the 11th is refused
let codes = []; for (let i = 0; i < 12; i++) codes.push((await call('POST', '/start', null, GAME)).status);
ok(codes.includes(429) && codes.indexOf(429) <= 10, 'rate limit: the 11th start in an hour is refused (429)', codes.join(','));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
