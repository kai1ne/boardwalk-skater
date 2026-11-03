// Leaderboard admin tool. Reads LEADERBOARD_URL and ADMIN_SECRET from server/.env (gitignored; never commit it).
//   node admin.mjs list            every stored entry (id, name, score, date, version)
//   node admin.mjs delete <id>     remove one entry
//   node admin.mjs clear           remove every entry (asks you to type CLEAR)
//   node admin.mjs rejects         rejected submissions by day and reason (no personal data)
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const env = Object.fromEntries(readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!env.LEADERBOARD_URL || !env.ADMIN_SECRET) { console.error('server/.env needs LEADERBOARD_URL and ADMIN_SECRET'); process.exit(1); }
const call = async (method, path, body) => {
  const r = await fetch(env.LEADERBOARD_URL + '/admin' + path, { method, headers: { authorization: `Bearer ${env.ADMIN_SECRET}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({})); if (!r.ok) { console.error(`error ${r.status}: ${data.error || ''} ${data.message || ''}`); process.exit(1); } return data;
};
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'list') { const { entries } = await call('GET', '/entries'); console.table(entries.map((e) => ({ id: e.id, name: e.name, score: e.score, date: new Date(e.created_at).toISOString().slice(0, 16).replace('T', ' '), version: e.game_version }))); console.log(`${entries.length} entries`); }
else if (cmd === 'delete' && /^\d+$/.test(arg || '')) console.log(await call('DELETE', `/entries/${arg}`));
else if (cmd === 'clear') {
  const rl = createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question('Type CLEAR to delete every entry: '); rl.close();
  if (a.trim() !== 'CLEAR') { console.log('Cancelled'); process.exit(0); } console.log(await call('POST', '/clear', { confirm: 'CLEAR' }));
}
else if (cmd === 'rejects') console.table((await call('GET', '/rejects')).rejects);
else { console.log('usage: node admin.mjs list | delete <id> | clear | rejects'); process.exit(1); }
