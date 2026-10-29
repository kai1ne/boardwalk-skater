// =====================================================================================
// director.js — places obstacles by pattern, and refuses any pattern without a way through.
//
// A pattern is a list of placements { type, lane, dz, opt } (dz = metres beyond the row line).
// validate() turns placements into per-lane cells (solid / jump / slip) using the GAME config's
// hitbox sizes, and accepts the pattern only if at least one lane can be ridden straight through
// at the current speed: no solids, and every jump in that lane physically clearable with a full
// ollie, with enough room between jumps to land and charge again. Lane-changing or drifting
// movers block both lanes they use. Row spacing (in game.js) separately guarantees that any lane
// can be reached from any other before the next row.
// =====================================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + (b - a) * Math.random();
function wpick(obj) { let s = 0; for (const k in obj) s += obj[k]; let r = Math.random() * s; for (const k in obj) { r -= obj[k]; if (r <= 0) return k; } return Object.keys(obj)[0]; }
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const PEOPLE_BLOCKERS = ['ped', 'bike', 'skater', 'selfie', 'smokers'];
const OBJECT_BLOCKERS = ['can', 'cones', 'pizza', 'poop'];

export function createDirector(G, LANE_X) {
  const D = G.director, O = G.obstacles, J = G.jump, N = LANE_X.length;
  const stats = { patterns: {}, rejected: 0, violations: [] };

  const stageFor = (dist) => { let s = 0; for (let i = 0; i < D.stages.length; i++) if (dist >= D.stages[i].from) s = i; return s; };

  // a blocker for one lane, from the stage's allowed types (people share = director.peopleShare)
  function blocker(st) {
    const people = PEOPLE_BLOCKERS.filter((t) => st.types.includes(t)), objs = OBJECT_BLOCKERS.filter((t) => st.types.includes(t));
    const usePeople = people.length && (!objs.length || Math.random() < D.peopleShare);
    const list = usePeople ? people : objs; return list[Math.floor(Math.random() * list.length)];
  }
  const hasType = (st, t) => st.types.includes(t);

  // ---------------- patterns ----------------
  const PATTERNS = {
    single(st) { return [{ type: blocker(st), lane: Math.floor(Math.random() * N), dz: 0 }]; },
    pair(st) { const [a, b] = shuffle([...Array(N).keys()]); return [{ type: blocker(st), lane: a, dz: 0 }, { type: blocker(st), lane: b, dz: rand(-0.6, 0.6) }]; },
    triple(st) { const lanes = shuffle([...Array(N).keys()]).slice(0, N - 1); return lanes.map((lane) => ({ type: blocker(st), lane, dz: rand(-0.6, 0.6), opt: { still: true } })); },
    // a line of slip hazards with one gap, and a jumpable a few metres on in that gap: jump the line, or take the gap and jump the can
    hazardLine(st) { const gap = Math.floor(Math.random() * N), out = [];
      for (let l = 0; l < N; l++) if (l !== gap) out.push({ type: Math.random() < 0.5 ? 'pizza' : 'poop', lane: l, dz: rand(-0.4, 0.4) });
      out.push({ type: Math.random() < 0.5 ? 'can' : 'cones', lane: gap, dz: rand(D.hazardLineGap[0], D.hazardLineGap[1]) }); return out; },
    // a busker on one outer lane, pedestrians across on the other side
    performerSide(st) { const left = Math.random() < 0.5, pl = left ? 0 : N - 1, far = left ? N - 1 : 0, out = [{ type: 'performer', lane: pl, dz: 0 }];
      out.push({ type: 'ped', lane: far, dz: rand(-1, 1), opt: { behave: 'walk' } }); if (Math.random() < 0.5) out.push({ type: 'ped', lane: left ? far - 1 : far + 1, dz: rand(1, 3), opt: { behave: 'walk' } }); return out; },
    // dog and owner a lane apart with the lead between them; at higher stages another blocker elsewhere
    leash(st) { const owner = Math.floor(Math.random() * N); let dog = owner + (Math.random() < 0.5 ? -1 : 1); if (dog < 0 || dog >= N) dog = owner + (owner === 0 ? 1 : -1);
      const out = [{ type: 'leash', lane: owner, dz: 0, opt: { dogLane: dog } }];
      if (st.leashPlus && Math.random() < st.leashPlus) { const free = [...Array(N).keys()].filter((l) => l !== owner && l !== dog); out.push({ type: blocker(st), lane: free[Math.floor(Math.random() * free.length)], dz: rand(2, 4), opt: { still: true } }); }
      return out; },
    cross() { return [{ type: 'cross', lane: -1, dz: 0, opt: { xArr: rand(LANE_X[0], LANE_X[N - 1]) } }]; },
  };

  // ---------------- validator ----------------
  // per-lane cells a placement creates: { lane, dz, kind: 'solid' | 'jump', clear, depth }
  function cells(p) {
    const out = [], solid = (lane, depth = 1, dz = p.dz) => out.push({ lane, dz, kind: 'solid', depth });
    const jump = (lane, T, dz = p.dz) => out.push({ lane, dz, kind: 'jump', clear: T.clear, depth: T.d });
    switch (p.type) {
      case 'can': case 'cones': case 'pizza': case 'poop': jump(p.lane, O[p.type]); break;
      case 'ped': solid(p.lane); if (p.opt && p.opt.drift !== undefined) solid(p.opt.drift); break;
      case 'skater': solid(p.lane); if (p.opt && p.opt.change !== undefined) solid(p.opt.change); break;
      case 'bike': case 'selfie': case 'smokers': solid(p.lane); break;
      case 'performer': solid(p.lane, O.performer.d); break;
      case 'leash': solid(p.lane); jump(p.opt.dogLane, O.dog, p.dz + 0.35); break;
      case 'cross': { const T = O.crossBike; for (let l = 0; l < N; l++) if (Math.abs(LANE_X[l] - p.opt.xArr) < T.w / 2 + 0.25 + 0.6) solid(l); break; }
    }
    return out;
  }
  // can a full ollie at speed v carry the skater box over an obstacle of this height and depth?
  function jumpable(clear, depth, v) {
    const h = J.maxHeight - D.jumpMargin; if (clear >= h) return false;
    const T = 2 * Math.sqrt(2 * J.maxHeight / J.gravity), above = T * Math.sqrt(1 - clear / J.maxHeight);
    return v * above >= depth + G.skaterBox.d + D.jumpSlack;
  }
  function validate(placements, v) {
    const all = placements.flatMap(cells), reasons = [];
    const minJumpSpacing = v * (2 * Math.sqrt(2 * J.maxHeight / J.gravity) + J.landTime + J.chargeTime);
    for (let l = 0; l < N; l++) {
      const c = all.filter((x) => x.lane === l).sort((a, b) => a.dz - b.dz);
      if (c.some((x) => x.kind === 'solid')) { reasons.push(`lane ${l}: solid`); continue; }
      const jumps = c.filter((x) => x.kind === 'jump');
      if (jumps.some((x) => !jumpable(x.clear, x.depth, v))) { reasons.push(`lane ${l}: jump too big at ${v.toFixed(1)} m/s`); continue; }
      let ok = true; for (let i = 1; i < jumps.length; i++) if (jumps[i].dz - jumps[i - 1].dz < minJumpSpacing && jumps[i].dz - jumps[i - 1].dz > Math.max(jumps[i].depth, jumps[i - 1].depth)) ok = false;
      if (!ok) { reasons.push(`lane ${l}: jumps too close`); continue; }
      return { ok: true, lane: l };
    }
    return { ok: false, reasons };
  }

  // pick a pattern for this stage, fill in movers' behaviours, validate; on failure log it and fall back
  function plan(dist, v) {
    const si = stageFor(dist), st = D.stages[si];
    for (let tries = 0; tries < 6; tries++) {
      let name = wpick(st.patterns);
      if ((name === 'performerSide' && !hasType(st, 'performer')) || (name === 'leash' && !hasType(st, 'leash')) || (name === 'cross' && !hasType(st, 'cross'))) name = 'single';
      const ps = PATTERNS[name](st);
      // movers decide now (so the validator sees both lanes of anyone drifting or changing lane)
      for (const p of ps) {
        p.opt = p.opt || {}; const still = p.opt.still;
        if (p.type === 'ped' && !p.opt.behave) { const r = Math.random(); p.opt.behave = r < st.pedStop ? 'stop' : r < st.pedStop + (still ? 0 : st.pedDrift) ? 'drift' : 'walk'; }
        if (p.type === 'ped' && p.opt.behave === 'drift') { const to = p.lane + (Math.random() < 0.5 ? -1 : 1); if (to >= 0 && to < N) p.opt.drift = to; else p.opt.behave = 'walk'; }
        if (p.type === 'skater' && !still && Math.random() < st.skaterChange) { const to = p.lane + (Math.random() < 0.5 ? -1 : 1); if (to >= 0 && to < N) p.opt.change = to; }
        if (p.type === 'selfie') p.opt.walkBack = Math.random() < st.selfieWalk;
        p.opt.moverScale = st.moverScale;
      }
      const res = validate(ps, v);
      if (res.ok) { stats.patterns[name] = (stats.patterns[name] || 0) + 1; return { name, stage: si, placements: ps, length: Math.max(0, ...ps.map((p) => p.dz + (p.type === 'performer' ? O.performer.d / 2 : 0))) }; }
      stats.rejected++; const msg = `[director] rejected ${name} (stage ${si}, ${v.toFixed(1)} m/s): ${res.reasons.join('; ')}`;
      if (stats.violations.length < 50) stats.violations.push(msg); console.warn(msg);
    }
    const ps = [{ type: 'cones', lane: Math.floor(Math.random() * N), dz: 0, opt: {} }]; stats.patterns.fallback = (stats.patterns.fallback || 0) + 1;
    return { name: 'fallback', stage: si, placements: ps, length: 0 };
  }

  return { plan, validate, cells, jumpable, stageFor, stats, PATTERNS };
}
