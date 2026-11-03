// Name rules and a basic profanity / slur blocklist. No filter is perfect: this catches the obvious words and simple
// leetspeak (f4ck, sh1t, fuuuck), not every creative spelling, and it can occasionally block an innocent name.
// The words are stored ROT13-encoded so the repo doesn't spell them out; decode() turns them back at start-up.
import { NAME } from './config.js';

const decode = (w) => w.replace(/[a-z]/g, (c) => String.fromCharCode((c.charCodeAt(0) - 97 + 13) % 26 + 97));
const ANYWHERE = ['snpx', 'sphx', 'sipx', 'shpx', 'fuvg', 'phag', 'avttre', 'avttn', 'avtt', 'snttbg', 'sntbg', 'ovgpu', 'juber', 'fyhg', 'qvpx', 'chffl', 'cravf', 'intvan', 'encvfg', 'ergneq', 'genaal', 'puvax', 'fcvpx', 'xvxr', 'jrgonpx', 'gjng', 'jnax', 'onfgneq', 'anmv', 'uvgyre', 'cbea', 'wvmm', 'xxx', 'qvyqb', 'obbo', 'zbyrfg', 'crqbcuvyr', 'vaprfg', 'tbbx', 'ornare', 'enturnq', 'gbjryurnq', 'wvtnobb', 'cuhpx', 'ovngpu', 'fxnax', 'ubeal', 'betnfz', 'fcrez', 'grfgvpyr', 'fpebghz', 'pyvg', 'oybjwbo', 'unaqwbo', 'evzwbo', 'ohggubyr', 'nffubyr', 'qbhpur', 'wvunq'].map(decode);   // blocked inside a name
const EXACT = new Set(['nff', 'snt', 'phz', 'frk', 'gvg', 'gvgf', 'ubzb', 'wnc', 'jbc', 'ubr', 'xlf', 'pbpx', 'encr', 'encre', 'pbba', 'cnxv', 'arteb', 'qlxr', 'crqb', 'frzra', 'shx', 'fug', 'nany', 'nefr'].map(decode));   // blocked only as the whole name (they also appear inside ordinary names: Hancock, Grape, Montenegro…)

const LEET = { '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g' };
function variants(name) {
  const lower = name.toLowerCase();
  const out = new Set([lower, lower.replace(/[0-9]/g, (d) => LEET[d]), lower.replace(/1/g, 'l').replace(/[02-9]/g, (d) => LEET[d])]);
  for (const v of [...out]) out.add(v.replace(/(.)\1+/g, '$1'));   // fuuuuck -> fuck
  return [...out];
}

// returns { ok: true, name } or { ok: false, code }
export function checkName(raw) {
  const name = String(raw ?? '').trim();
  if (name.length < NAME.min || name.length > NAME.max) return { ok: false, code: 'name_length' };
  if (!/^[A-Za-z0-9]+$/.test(name)) return { ok: false, code: 'name_chars' };
  for (const v of variants(name)) if (EXACT.has(v) || ANYWHERE.some((w) => v.includes(w))) return { ok: false, code: 'name_blocked' };
  return { ok: true, name };
}
