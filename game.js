// =====================================================================================
// game.js — the playable core loop (title → playing → game over)
//
// Owns the skater's lane, the jump/trick state machine, speed, health and energy; spawns obstacle
// rows and crossing traffic ahead of the skater; resolves collisions with lane-aware AABBs; keeps
// score and the HUD. All tuning lives in the GAME object near the top of venice-boardwalk.html
// (passed in as ctx.cfg). The skater's look is driven through S.pose, which characters.js turns
// into bone overrides.
// =====================================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createDirector } from './director.js';
import { makeVehicle } from './vehicles.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + (b - a) * Math.random();
function wpick(obj) { let s = 0; for (const k in obj) s += obj[k]; let r = Math.random() * s; for (const k in obj) { r -= obj[k]; if (r <= 0) return k; } return Object.keys(obj)[0]; }
const TRICK_NAME = { kickflip: 'KICKFLIP', heelflip: 'HEELFLIP', hardflip: 'HARDFLIP', threeSixty: '360 FLIP', impossible: 'IMPOSSIBLE' };

export function createGame(ctx) {
  const { scene, S, chars, IM, cfg: G, getPhaseName } = ctx;   // also ctx.phase (lighting phase state), ctx.shopsBetween, ctx.drawLeaf, ctx.onStart
  const L = G.lanes, J = G.jump, H = G.hazards, SP = G.spawn, SC = G.score, TR = G.tricks, EN = G.energy, HP = G.health;
  const LANE_X = Array.from({ length: L.count }, (_, i) => (i - (L.count - 1) / 2) * L.width);
  const $ = (id) => document.getElementById(id);
  const ui = { hud: $('ghud'), score: $('gScore'), add: $('gAdd'), combo: $('gCombo'), dist: $('gDist'), pops: $('gPops'),
    health: $('gHealth'), healthBar: $('gHealthBar'), energy: $('gEnergy'), energyCost: $('gEnergyCost'), energyBar: $('gEnergyBar'),
    title: $('gTitle'), over: $('gOver'), pause: $('gPause'), overScore: $('gOverScore'), overBest: $('gOverBest'), scores: [$('gScores'), $('gOverScores')], newBest: $('gNewBest'), count: $('gCount'), disc: $('gDisc'), storeNote: $('gStoreNote'), dbg: $('gDbg'), phase: $('gPhase'), credits: $('gCredits'), roll: $('gCreditsRoll'), entry: $('gEntry'), name: $('gName'), overGo: $('gOverGo') };

  // saved game: top scores, tricks discovered and hints shown, in localStorage under a versioned key. Bad or missing data
  // starts fresh; if storage is blocked everything lives in memory for the session and the game-over screen says so.
  const SV = G.save, cleanName = (v) => String(v).replace(/[^A-Za-z0-9]/g, '').slice(0, SV.nameMax);
  const save = { scores: [], tricks: {}, hints: {} }; let storageOK = true;
  const cleanScores = (raw) => (Array.isArray(raw) ? raw : []).map((r) => ({ name: cleanName(r && r.name) || 'PLAYER', score: Math.floor(Number(r && r.score)) || 0 })).filter((r) => r.score > 0);
  function writeSave() { try { localStorage.setItem(SV.key, JSON.stringify(save)); storageOK = true; } catch (e) { storageOK = false; } }
  (function readSave() {
    let raw = null;
    try { raw = localStorage.getItem(SV.key); } catch (e) { storageOK = false; return; }
    if (raw !== null) { let d = null; try { d = JSON.parse(raw); } catch (e) { /* corrupted: start fresh */ }
      if (d && typeof d === 'object') { save.scores = cleanScores(d.scores);
        for (const t of [...TR.discover, TR.bonus]) if (d.tricks && d.tricks[t] === true) save.tricks[t] = true;
        for (const h of ['hold', 'air']) if (d.hints && d.hints[h] === true) save.hints[h] = true; }
    } else {   // first run on this version: carry over the scores saved by the older keys
      let old = []; try { old = cleanScores(JSON.parse(localStorage.getItem(SV.oldScores) || '[]')); } catch (e) { /* unreadable: nothing to carry over */ }
      const b = Number(localStorage.getItem(SV.oldBest)) || 0; if (b && !old.length) old.push({ name: 'PLAYER', score: b });
      save.scores = old; if (old.length) writeSave(); }
    if (storageOK) try { localStorage.setItem(SV.key + '.test', '1'); localStorage.removeItem(SV.key + '.test'); } catch (e) { storageOK = false; }
    save.scores.sort((a, b) => b.score - a.score); save.scores.length = Math.min(save.scores.length, SV.topN);
  })();
  const scores = save.scores, HS_MAX = SV.topN;
  let best = scores.length ? scores[0].score : 0, entering = false, lastEntry = null;
  const qualifies = (n) => n > 0 && (scores.length < HS_MAX || n > scores[scores.length - 1].score);
  function renderScores() {
    for (const ol of ui.scores) { ol.textContent = ''; for (let i = 0; i < HS_MAX; i++) {
      const r = scores[i], li = document.createElement('li');
      if (!r) li.className = 'empty'; else if (r === lastEntry) li.className = 'me';
      for (const [c, t] of [['r', i + 1], ['n', r ? r.name : '—'], ['s', r ? r.score.toLocaleString() : '']]) { const sp = document.createElement('span'); sp.className = c; sp.textContent = t; li.appendChild(sp); }
      ol.appendChild(li);
    } }
  }
  ui.name.addEventListener('input', () => { const v = cleanName(ui.name.value); if (v !== ui.name.value) ui.name.value = v; });
  ui.name.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.repeat) {
      lastEntry = { name: cleanName(ui.name.value) || 'PLAYER', score: st.score };
      scores.push(lastEntry); scores.sort((a, b) => b.score - a.score); scores.length = Math.min(scores.length, HS_MAX); writeSave();
      entering = false; ui.name.blur(); showScreens(); renderScores();
    }
  });
  const st = { mode: 'title', paused: false, countT: 0, health: HP.max, energy: EN.max, score: 0, dist: 0, playT: 0, combo: 0, comboT: 0, inv: 0, overT: 0, titleT: 2.5, newBest: false, spawned: 0 };
  const startLane = Math.min(L.count - 1, Math.floor(L.count / 2));
  const sk = { lane: startLane, x: LANE_X[startLane], vx: 0, toX: 0, chT: -1, queue: [], recT: 0, recDir: 0, held: { '-1': false, '1': false },
    mode: 'ground', t: 0, y: 0, vy: 0, airT: 0, airDur: 1, jumpF: 0, chargeT: 0, jumpHeld: false, flipOnPop: false,
    trick: null, tricks: [], lastGround: 0, stance: 1, invT: 0, flip: null, attempted: false, stumbleT: 0, slipSpeed: 0, slipApplied: false,
    speed: G.speed.title, clearedThisJump: 0 };
  let clock = 0;
  S.x = sk.x; S.speed = sk.speed; S.pose = {};
  if (chars) chars.walkerScale = G.crowd.sideWalkers;   // thins the ambient side crowd to match the people in the lanes

  // -------------------------------------------------------------------------------------
  // Obstacle meshes (pooled per type). Cans and cones reuse the scenery geometry/materials.
  // -------------------------------------------------------------------------------------
  const lumpy = (r, seed) => { const g = new THREE.IcosahedronGeometry(r, 2), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + 0.18 * Math.sin(v.x * 31 + seed) * Math.sin(v.z * 27 + v.y * 19 + seed); v.multiplyScalar(n); if (v.y < -r * 0.35) v.y = -r * 0.35; p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g; };
  const smearMat = (c, o) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const smearGeo = new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);
  const M = {
    cheese: new THREE.MeshStandardMaterial({ color: 0xf1bf45, roughness: 0.45 }), crust: new THREE.MeshStandardMaterial({ color: 0xc4843a, roughness: 0.8 }),
    pep: new THREE.MeshStandardMaterial({ color: 0xa8281f, roughness: 0.4 }),
    box: new THREE.MeshStandardMaterial({ color: 0xe6d6b4, roughness: 0.9 }), boxLid: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.85 }),
    grease: smearMat(0xb86a22, 0.32), poop: new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.32 }), poopSmear: smearMat(0x3a2412, 0.4),
    litter: [0xf4f1e6, 0xe8322b, 0xffd93b, 0x2a7de1].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide })),
    ped: new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.8 }),
    hat: new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.9, side: THREE.DoubleSide }),
    rug: new THREE.MeshStandardMaterial({ roughness: 0.95, map: (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
      x.fillStyle = '#7a1f2b'; x.fillRect(0, 0, 128, 256); x.strokeStyle = '#e7c46a'; x.lineWidth = 6; x.strokeRect(8, 8, 112, 240); x.strokeStyle = '#1f3d6b'; x.lineWidth = 4; x.strokeRect(18, 18, 92, 220);
      x.fillStyle = '#e7c46a'; for (let i = 0; i < 6; i++) { x.save(); x.translate(64, 40 + i * 36); x.rotate(Math.PI / 4); x.fillRect(-9, -9, 18, 18); x.restore(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() }),
  };
  const sliceGeo = (() => { const s = new THREE.Shape(); s.moveTo(0, 0.17); s.lineTo(-0.13, -0.15); s.quadraticCurveTo(0, -0.19, 0.13, -0.15); s.lineTo(0, 0.17);
    return new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false }).rotateX(-Math.PI / 2); })();
  const crustGeo = new THREE.TorusGeometry(0.16, 0.018, 6, 12, 1.25).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2 - 0.62).translate(0, 0.012, 0.0);
  const pepGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.006, 10);
  const boxBaseGeo = (() => { const w = 0.44, h = 0.04, t = 0.006, parts = [new THREE.BoxGeometry(w, t, w).translate(0, t / 2, 0)];   // open tray
    for (const s of [-1, 1]) { parts.push(new THREE.BoxGeometry(w, h, t).translate(0, h / 2, s * w / 2), new THREE.BoxGeometry(t, h, w).translate(s * w / 2, h / 2, 0)); }
    return mergeGeometries(parts); })();
  const boxLidGeo = new THREE.BoxGeometry(0.44, 0.006, 0.44).translate(0, 0, 0.22);
  const litterGeo = new THREE.PlaneGeometry(0.13, 0.09).rotateX(-Math.PI / 2);
  const BUILD = {
    can() { const g = new THREE.Group(), c = new THREE.Mesh(IM.can.geometry, IM.can.material); c.rotation.z = Math.PI / 2; c.position.set(0.46, 0.33, 0); g.add(c);
      for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(litterGeo, M.litter[i % 4]); l.position.set(-0.3 - Math.random() * 0.5, 0.012, (Math.random() - 0.5) * 0.7); l.rotation.y = Math.random() * 6; g.add(l); }
      return g; },
    cones() { const g = new THREE.Group(); for (const [x, z, tip] of [[-0.45, 0.05, 0], [0.42, 0.12, 0], [0.0, -0.32, 0]]) { const c = new THREE.Mesh(IM.cone.geometry, IM.cone.material); c.position.set(x, 0, z); c.rotation.set(0, Math.random() * 6, tip); g.add(c); } return g; },
    pizza() {   // a dropped open box (reads from far away) plus slices sliding out of it over a grease streak
      const g = new THREE.Group(), slice = () => { const s = new THREE.Group(); s.add(new THREE.Mesh(sliceGeo, M.cheese), new THREE.Mesh(crustGeo, M.crust));
        for (const [x, z] of [[0.0, 0.07], [-0.05, -0.06], [0.06, -0.08], [0.0, -0.01]]) { const p = new THREE.Mesh(pepGeo, M.pep); p.position.set(x, 0.017, z); s.add(p); } return s; };
      const sm = new THREE.Mesh(smearGeo, M.grease); sm.scale.set(0.8, 1, 2.0); sm.position.set(0.05, 0.004, 0.1); g.add(sm);
      const bx = new THREE.Group(); bx.add(new THREE.Mesh(boxBaseGeo, M.box)); const lid = new THREE.Mesh(boxLidGeo, M.boxLid); lid.position.set(0, 0.04, -0.22); lid.rotation.x = -1.95; bx.add(lid);
      const inBox = slice(); inBox.scale.setScalar(1.15); inBox.position.set(0.06, 0.03, 0.02); inBox.rotation.y = 2.2; bx.add(inBox);
      bx.position.set(-0.12, 0, -0.15); bx.rotation.y = 0.5; g.add(bx);
      for (const [x, z, r] of [[0.2, 0.32, 0.4], [-0.08, 0.6, 2.9]]) { const s = slice(); s.scale.setScalar(1.25); s.position.set(x, 0.004, z); s.rotation.y = r; g.add(s); }
      return g; },
    poop() { const g = new THREE.Group(), sm = new THREE.Mesh(smearGeo, M.poopSmear); sm.scale.set(0.7, 1, 1.1); sm.position.set(0, 0.004, 0.08); g.add(sm);
      for (const [r, y, x, z] of [[0.11, 0.05, 0, 0], [0.08, 0.13, 0.01, 0], [0.05, 0.19, -0.005, 0], [0.07, 0.04, 0.16, 0.12], [0.05, 0.03, -0.14, 0.2]]) {
        const b = new THREE.Mesh(lumpy(r, r * 40), M.poop); b.scale.y = 0.75; b.position.set(x, y, z); g.add(b); }
      g.scale.setScalar(1.45); return g; },
    ped() { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.7, 10).translate(0, 0.85, 0), M.ped); g.add(m); return g; },   // only if the rigged crowd failed to load
    rug() {   // a busker's patterned rug marking the performance footprint, with a tip hat
      const g = new THREE.Group(), T = G.obstacles.performer, r = new THREE.Mesh(new THREE.PlaneGeometry(T.w - 0.1, T.d - 0.1).rotateX(-Math.PI / 2), M.rug); r.position.y = 0.006; r.receiveShadow = true; g.add(r);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.08, 14, 1, true).translate(0, 0.04, 0), M.hat); hat.position.set(0.55, 0.006, T.d / 2 - 0.5); g.add(hat); return g; },
  };
  // shops' stand-up signs: A-frame boards, one painted face per shop kind
  const SIGN_KINDS = ['pizza', 'coffee', 'sunglasses', 'tattoo', 'weed'];
  const signTex = (() => { const c = document.createElement('canvas'); c.width = 256 * SIGN_KINDS.length; c.height = 384; const x = c.getContext('2d');
    const board = (i, bg) => { x.fillStyle = '#2a2622'; x.fillRect(i * 256, 0, 256, 384); x.fillStyle = bg; x.fillRect(i * 256 + 12, 12, 232, 360); };
    const lettering = (i, fg, lines, font) => { x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; const h = 330 / lines.length;
      lines.forEach((t, k) => { let sz = Math.min(h * 0.8, 120); x.font = `bold ${sz}px ${font}`; while (x.measureText(t).width > 212 && sz > 12) { sz -= 2; x.font = `bold ${sz}px ${font}`; } x.fillText(t, i * 256 + 128, 27 + h * (k + 0.5)); }); };
    board(0, '#c8102e'); lettering(0, '#fff4d6', ['PIZZA', 'HERE'], '"Arial Black", Impact, sans-serif');
    board(1, '#1d2b22'); lettering(1, '#f4f1e6', ['BEST', 'COFFEE', 'IN THE', 'WORLD'], '"Chalkduster", "Marker Felt", sans-serif');
    board(2, '#ffd93b'); lettering(2, '#111111', ['2 FOR', '$30', 'SUNGLASSES'], 'Impact, "Arial Black", sans-serif');
    board(3, '#111111'); lettering(3, '#e8322b', ['$5', 'TATTOOS'], 'Rockwell, "Cooper Black", Georgia, serif');
    board(4, '#f4f1e6'); if (ctx.drawLeaf) ctx.drawLeaf(x, 4 * 256 + 128, 192, 250, '#2e9a3e');
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
  const signFrameMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.8 }), signFaceMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.75 });
  const SIGN_H = 0.95, SIGN_W = 0.62, SIGN_LEAN = 0.2, signBoardGeo = new THREE.BoxGeometry(SIGN_W + 0.06, SIGN_H, 0.025);
  function buildSign(kind) {   // two boards hinged at the top, faces toward ±z (the oncoming skater sees one)
    const g = new THREE.Group(), i = SIGN_KINDS.indexOf(kind), face = new THREE.PlaneGeometry(SIGN_W, SIGN_H), uv = face.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / SIGN_KINDS.length);
    for (const sd of [1, -1]) { const panel = new THREE.Group(), f = new THREE.Mesh(face, signFaceMat); f.position.z = 0.014;
      panel.add(new THREE.Mesh(signBoardGeo, signFrameMat), f); panel.position.set(0, SIGN_H * Math.cos(SIGN_LEAN) / 2, sd * SIGN_H * Math.sin(SIGN_LEAN) / 2); panel.rotation.set(-sd * SIGN_LEAN, sd > 0 ? 0 : Math.PI, 0); g.add(panel); }
    return g; }
  for (const k of SIGN_KINDS) BUILD['sign:' + k] = () => buildSign(k);
  for (const k of ['policeSUV', 'lifeguard']) BUILD['veh:' + k] = () => makeVehicle(k);
  BUILD.stage = () => { const g = chars && chars.makeBreakStage ? chars.makeBreakStage() : new THREE.Group(); g.visible = true; return g; };   // breakdancers' cardboard + boombox
  const pools = {};
  function getMesh(type) { const p = pools[type] || (pools[type] = []); const g = p.pop() || BUILD[type](); g.traverse((m) => { if (m.isMesh) { m.castShadow = !m.material.transparent; m.receiveShadow = true; } }); scene.add(g); return g; }
  function freeMesh(type, g) { scene.remove(g); pools[type].push(g); }

  // -------------------------------------------------------------------------------------
  // Obstacles. Each has one or more hitbox parts { dx, dz, w, d, h, clear, kind } relative to (o.x, o.z),
  // a behaviour (walk / stop / drift / ride / change lane / walk backward / stand), and the agents or
  // meshes that show it. Placement comes from the spawn director (director.js).
  // -------------------------------------------------------------------------------------
  const OBS = [];
  let nextRowZ = 0, agentSeed = 1;
  const director = createDirector(G, LANE_X);
  const timeTo = (z) => (S.z - z) / Math.max(sk.speed, 1);   // s until the skater reaches z at the current speed
  const part = (T, dx = 0, dz = 0, w = T.w) => ({ dx, dz, w, d: T.d, h: T.h, clear: T.clear, kind: T.kind, dmg: T.dmg ?? HP.hit });
  const placeholder = (o) => { o.mesh = getMesh('ped'); o.meshType = 'ped'; };
  function spawnObstacle(type, lane, z, opt = {}) {
    const T = G.obstacles[type], seed = 7919 * agentSeed++;
    const o = { type, lane, x: LANE_X[lane], z, vz: 0, t: 0, parts: T ? [part(T)] : [], done: false, cleared: false, hit: false, minGap: 9, minV: 9, mesh: null, meshType: type, ped: null, peds: null, lanes: [lane] };
    const sc = opt.moverScale || 1, e = timeTo(z);
    // movers are placed so that they reach the row line exactly when the skater does
    const meet = (moveT) => { o.z = z - o.vz * moveT; };
    switch (type) {
      case 'ped': {
        let dir = Math.random() < SP.towardChance ? 1 : -1; if (dir < 0 && vehicleIn([lane, opt.drift ?? lane])) dir = 1;
        if (chars) o.ped = chars.addGameWalker({ x: o.x, z, dir, seed }); else placeholder(o);
        o.vz = dir * (o.ped ? o.ped.speed : 1.2); o.walkTs = o.ped ? o.ped.ts : 1;
        if (opt.behave === 'stop' && e > 3) { o.idle = rand(1.5, Math.min(3, e * 0.5)); o.tStop = rand(0.15, 0.4) * e; }
        if (opt.behave === 'drift') { o.drift = { to: opt.drift, t0: e * rand(0.15, 0.3), dur: Math.min(3.2, e * 0.45) }; o.lanes.push(opt.drift); }
        meet(e - (o.idle || 0)); break; }
      case 'bike': case 'skater': {
        let dir = Math.random() < SP.towardChance ? 1 : -1;
        const sp = rand(...(type === 'bike' ? SP.bikeSpeed : SP.skaterSpeed)) * sc;
        if (dir < 0 && sp > sk.speed * 0.7) dir = 1;   // never a same-way rider the player couldn't catch up with
        if (dir < 0 && vehicleIn([lane, opt.change ?? lane])) dir = 1;   // nor one riding head-on into a car coming up the lane
        if (chars) { o.ped = (type === 'bike' ? chars.addGameCyclist : chars.addGameSkater)({ x: o.x, z, dirZ: dir, seed }); o.ped.speed = sp; } else placeholder(o);
        o.vz = dir * sp;
        if (type === 'skater' && opt.change !== undefined) { o.change = { to: opt.change, t0: e * rand(0.3, 0.5), dur: SP.skaterChangeTime }; o.lanes.push(opt.change); }
        meet(e); break; }
      case 'selfie': {   // influencer, phone up: standing, or walking slowly backward
        const face = Math.random() < 0.5 ? 0 : Math.PI;
        if (chars) o.ped = chars.addGameStation({ kind: 'selfie', x: o.x, z, ry: face + (opt.walkBack ? 0 : rand(-0.5, 0.5)), seed, sex: 'F' }); else placeholder(o);
        if (opt.walkBack) { o.vz = -Math.cos(face) * SP.selfieWalkSpeed; if (o.ped) chars.setClip(o.ped, 'walk', -SP.selfieWalkSpeed / 0.95); }
        meet(e); break; }
      case 'leash': {   // owner in this lane, dog in the next, the lead stretched between them
        let dir = Math.random() < SP.towardChance ? 1 : -1; if (dir < 0 && vehicleIn([lane, opt.dogLane])) dir = 1; const side = (opt.dogLane - lane) * L.width, sg = Math.sign(side);
        if (chars) { o.ped = chars.addGameWalker({ x: o.x, z, dir, seed, dog: true }); o.ped.dogSide = side; o.ped.ts *= 0.9; o.ped.speed *= 0.9; } else placeholder(o);
        o.vz = dir * (o.ped ? o.ped.speed : 1.1); const dz = dir * 0.35, Od = G.obstacles.dog, Oc = G.obstacles.leashCord;
        o.parts = [part(G.obstacles.ped), part(Od, side, dz), part(Oc, sg * (0.3 + (Math.abs(side) - 0.3 - Od.w / 2) / 2), dz / 2, Math.abs(side) - 0.3 - Od.w / 2)];
        o.lanes.push(opt.dogLane); meet(e); break; }
      case 'performer': {   // busker on a rug, or breakdancers on cardboard, in an outer lane facing the oncoming skater, with a few people watching
        const act = ['guitar', 'drum', 'piano', 'breakdance', 'breakdance'][Math.floor(Math.random() * 5)], back = z - G.obstacles.performer.d / 2 + 0.6;
        if (act === 'breakdance') {   // one dancer on a power move in the middle of the cardboard, a partner toprocking behind, the crowd in front
          o.mesh = getMesh('stage'); o.meshType = 'stage'; o.mesh.rotation.y = o.x > 0 ? 0 : Math.PI;   // the boombox sits on the boardwalk-edge side
          if (chars) { const move = ['headspin', 'windmill', 'footwork'][Math.floor(Math.random() * 3)], c = z - 0.2;
            o.peds = [chars.addGameStation({ kind: 'bboy', move, look: 'bboy', x: o.x, z: c, ry: 0, seed }), chars.addGameStation({ kind: 'bboy', move: 'toprock', look: 'bboy2', x: o.x + (o.x > 0 ? -0.55 : 0.55), z: c - 1.25, ry: 0, seed: seed + 9 })];
            const n = 2 + Math.floor(Math.random() * 2);
            for (let k = 0; k < n; k++) { const wx = o.x + (k - (n - 1) / 2) * 0.6 + rand(-0.1, 0.1), wz = c + rand(1.3, 1.9);
              o.peds.push(chars.addGameStation({ kind: 'watch', x: wx, z: wz, ry: Math.atan2(o.x - wx, c - wz), seed: seed + k + 1 })); } }
          break; }
        o.mesh = getMesh('rug'); o.meshType = 'rug'; o.mesh.rotation.y = 0;
        if (chars) { o.peds = [chars.addGameStation({ kind: act, x: o.x, z: back, ry: 0, seed })];
          const n = 2 + Math.floor(Math.random() * 2);
          for (let k = 0; k < n; k++) { const wx = o.x + (k - (n - 1) / 2) * 0.6 + rand(-0.1, 0.1), wz = back + rand(1.9, 2.8);
            o.peds.push(chars.addGameStation({ kind: 'watch', x: wx, z: wz, ry: Math.atan2(o.x - wx, back - wz), seed: seed + k + 1 })); } }
        break; }
      case 'smokers': {   // one to three people standing together in the lane, smoking and facing each other
        const n = 1 + Math.floor(Math.random() * 3), a0 = Math.random() * 6.28;
        if (chars) { o.peds = []; for (let k = 0; k < n; k++) { const ang = a0 + k / n * Math.PI * 2, r = n === 1 ? 0 : 0.42, x = o.x + Math.sin(ang) * r, pz = z + Math.cos(ang) * r * 0.8;
            o.peds.push(chars.addGameStation({ kind: 'smokeStand', x, z: pz, ry: n === 1 ? rand(-0.6, 0.6) + (Math.random() < 0.5 ? 0 : Math.PI) : Math.atan2(o.x - x, z - pz), seed: seed + k })); } }
        else placeholder(o);
        break; }
      case 'sign': o.meshType = 'sign:' + (opt.sign || 'pizza'); o.mesh = getMesh(o.meshType); o.mesh.rotation.y = (Math.random() - 0.5) * 0.35; break;
      case 'vehicle': {   // a police SUV or lifeguard pickup rolling slowly up the boardwalk toward the skater, straddling two lanes
        o.x = (LANE_X[lane] + LANE_X[lane + 1]) / 2; o.lanes.push(lane + 1); o.vz = rand(1.8, 2.8); meet(e);
        o.meshType = 'veh:' + (opt.kind || 'policeSUV'); o.mesh = getMesh(o.meshType); o.mesh.rotation.y = 0; break; }
      default: o.mesh = getMesh(type); o.mesh.rotation.y = (Math.random() - 0.5) * 0.5;
    }
    if (o.ped && type !== 'leash') o.ped.z = o.z; if (o.ped && type === 'leash') o.ped.z = o.z;
    if (o.mesh) o.mesh.position.set(o.x, 0, o.z);
    OBS.push(o); return o;
  }
  // a cyclist or skater crossing the boardwalk at a steady speed, timed to be over the lanes when the skater gets there
  function spawnCrossing(z, xArr = rand(LANE_X[0], LANE_X[L.count - 1])) {
    const type = Math.random() < SP.crossSkateChance ? 'crossSkate' : 'crossBike', T = G.obstacles[type];
    const dirX = Math.random() < 0.5 ? 1 : -1, vx = rand(...(type === 'crossBike' ? SP.crossBikeSpeed : SP.crossSkateSpeed));
    const o = { type, lane: -1, x: 1e3, z, vz: 0, t: 0, parts: [part(T)], done: false, cleared: false, hit: false, minGap: 9, minV: 9, mesh: null, meshType: 'ped', ped: null, dirX, vx, xArr, tArr: clock + timeTo(z), active: false, exited: false };
    OBS.push(o); return o;
  }
  function updateCrossing(o) {
    o.x = o.xArr + o.dirX * o.vx * (clock - o.tArr);
    const inside = Math.abs(o.x) <= SP.crossEdge;
    if (inside && !o.active && !o.exited) { o.active = true;
      if (chars) { o.ped = (o.type === 'crossBike' ? chars.addGameCyclist : chars.addGameSkater)({ x: o.x, z: o.z, dirX: o.dirX, seed: 104729 * agentSeed++ }); o.ped.speed = o.vx; }
      else o.mesh = getMesh('ped'); }
    if (o.active && !inside && Math.sign(o.x) === o.dirX) { o.active = false; o.exited = true; o.done = true; if (o.ped) { chars.removeGameAgent(o.ped); o.ped = null; } if (o.mesh) { freeMesh('ped', o.mesh); o.mesh = null; } }
    if (o.ped) { o.ped.x = o.x; o.ped.z = o.z; } if (o.mesh) o.mesh.position.set(o.x, 0, o.z);
  }
  // per-frame behaviour of the moving obstacles
  function updateObstacle(o, dt) {
    o.t += dt;
    let vz = o.vz;
    if (o.idle) {   // a pedestrian who stops for a moment, then walks on
      const stopped = o.t > o.tStop && o.t < o.tStop + o.idle;
      if (stopped !== !!o.halted) { o.halted = stopped; if (o.ped) { o.ped.halt = stopped; chars.setClip(o.ped, stopped ? 'idle' : 'walk', stopped ? 1 : o.walkTs); } }
      if (stopped) vz = 0;
    }
    o.z += vz * dt;
    if (o.drift && o.t > o.drift.t0) o.x = lerp(LANE_X[o.lane], LANE_X[o.drift.to], smooth(0, 1, (o.t - o.drift.t0) / o.drift.dur));
    if (o.change) {   // other skater: lean for the telegraph time, then carve into the next lane
      const c = o.change, side = Math.sign(c.to - o.lane), tel = SP.skaterTelegraph;
      const lean = smooth(c.t0 - tel, c.t0, o.t) * (1 - smooth(c.t0 + c.dur * 0.6, c.t0 + c.dur, o.t));
      if (o.ped) o.ped.lean = -side * 0.28 * lean;
      if (o.t > c.t0) o.x = lerp(LANE_X[o.lane], LANE_X[c.to], smooth(0, 1, (o.t - c.t0) / c.dur));
    }
    if (o.ped) { o.ped.x = o.x; o.ped.z = o.z; } if (o.mesh && o.type === 'ped') o.mesh.position.set(o.x, 0, o.z);
    if (o.type === 'vehicle' && o.mesh) { o.mesh.position.set(o.x, 0, o.z); const v = o.mesh.userData.veh; for (const w of v.wheels) w.rotation.x += o.vz * dt / v.r; }
    // an influencer's flash fires as you pass close
    const dz = S.z - o.z;
    if (o.type === 'selfie' && !o.flashed && o.ped && Math.abs(dz) < SP.flashDist && Math.abs(o.x - sk.x) < 2.6) { o.flashed = true; chars.cue(o.ped, 'flash'); }
  }
  function removeObstacle(i) { const o = OBS[i]; if (o.ped) chars.removeGameAgent(o.ped); if (o.peds) for (const p of o.peds) chars.removeGameAgent(p); if (o.mesh) freeMesh(o.meshType || 'ped', o.mesh); OBS.splice(i, 1); }
  function clearObstacles() { for (let i = OBS.length - 1; i >= 0; i--) removeObstacle(i); }
  // a lane change is a carve whose sideways speed is a fixed share of the forward speed
  const carveTime = (v) => clamp(L.width / (Math.max(v, 0.1) * L.carveRatio), L.carveMin, L.carveMax);
  // stage by distance (st.stageLock, a debug hook, pins it for testing)
  const stageDist = () => (st.stageLock !== undefined ? G.director.stages[st.stageLock].from : st.dist);
  const stage = () => director.stageFor(stageDist());
  // rows never closer than reaction + a full lane-to-lane carve + recovery at the current speed; each stage adds its own slack
  function rowGap() {
    const v = Math.max(sk.speed, targetSpeed()), g = G.director.stages[stage()].gap;
    return Math.max(SP.minGap, v * (SP.reaction + (L.count - 1) * carveTime(v) + L.recoverTime)) * rand(g[0], g[1]);
  }
  // Shops' stand-up signs go out in the right-hand lane while the shops are open (ctx.phase.open): not every shop puts one
  // out, and never two within SIGN_GAP. Signs near a row are validated with it (they're jumpable, so they count as jumps
  // in that lane); signs between rows stand on their own, far enough from either row to carve around.
  const SIGN_LANE = L.count - 1, SIGN_GAP = 30; let signZ = 0, lastSignZ = 1e9;
  function pickSigns(zFar) {
    const out = []; if (zFar >= signZ) return out;
    if (ctx.shopsBetween && ctx.phase && ctx.phase.open >= 0.5) for (const sh of ctx.shopsBetween(signZ, zFar)) {
      if (lastSignZ - sh.z < SIGN_GAP || Math.random() > 0.65) continue; lastSignZ = sh.z; out.push(sh); }
    signZ = zFar; return out;
  }
  // a vehicle never takes a lane that a faster rider (coming toward the skater) is already using: it would catch the car up from behind
  const fastLanes = () => { const set = new Set(); for (const o of OBS) if (!o.done && (o.type === 'bike' || o.type === 'skater') && o.vz > 1.7) for (const l of o.lanes) set.add(l); return set; };
  function vehicleIn(lanes) { return OBS.some((v) => v.type === 'vehicle' && !v.done && v.lanes.some((l) => lanes.includes(l))); }
  const crowdShare = () => (ctx.phase ? clamp(ctx.phase.crowd / 0.7, 0.35, 1) : 1);   // fewer people in the lanes on the quiet morning and at blue hour
  function spawnRow(z) {
    const v = Math.max(sk.speed, targetSpeed()), m = Math.max(10, v * 1.5);   // m: the stretch before/after a row whose signs are checked with it
    for (const sg of pickSigns(z + m)) spawnObstacle('sign', SIGN_LANE, sg.z, { sign: sg.kind });
    const near = pickSigns(z - 10 - m);
    const plan = director.plan(stageDist(), v, { busy: crowdShare(), avoidLanes: fastLanes(), extra: near.map((sg) => ({ type: 'sign', lane: SIGN_LANE, dz: z - sg.z, opt: {} })) });
    let len = plan.length, carInSignLane = false;
    for (const p of plan.placements) {
      if (p.type === 'cross') spawnCrossing(z - p.dz, p.opt.xArr);
      else { const o = spawnObstacle(p.type, p.lane, z - p.dz - (p.type === 'performer' ? G.obstacles.performer.d / 2 : 0), p.opt);
        if (o.type === 'vehicle') { len = Math.max(len, z - o.z + G.obstacles.vehicle.d / 2); carInSignLane = o.lanes.includes(SIGN_LANE); } }   // the next row starts past the car
      st.spawned++; if (bot.on) bot.spawned++;
    }
    if (carInSignLane) signZ = Math.min(signZ, z - len);   // no signs in the path of a car driving up the sign lane
    else for (const sg of near) spawnObstacle('sign', SIGN_LANE, sg.z, { sign: sg.kind });
    return len;
  }
  function spawnAhead() { if (st.mode !== 'playing') return; while (nextRowZ > S.z - Math.max(SP.ahead, sk.speed * SP.aheadTime)) { const len = spawnRow(nextRowZ); nextRowZ -= rowGap() + len; } }

  // -------------------------------------------------------------------------------------
  // Speed, scoring, health/energy, state changes
  // -------------------------------------------------------------------------------------
  function targetSpeed() {
    if (st.mode === 'title') return G.speed.title;
    if (st.mode === 'over') return 0;
    return Math.min(G.speed.max, G.speed.start + G.speed.ramp * st.rampT);   // rampT: clean riding time (damage takes some back)
  }
  function popup(text, cls = '') { const d = document.createElement('div'); d.className = 'pop ' + cls; d.textContent = text; ui.pops.appendChild(d); setTimeout(() => d.remove(), 1300); }
  // bonus points: a "+points" tag pops up beside the score counter while the counter counts up to include them
  let shown = 0, addSum = 0, addTimer = 0;
  function addBonus(pts) {
    st.score += pts; if (st.mode !== 'playing') return;
    addSum += pts; ui.add.textContent = `+${addSum.toLocaleString()}`; flash(ui.add); flash(ui.score);
    clearTimeout(addTimer); addTimer = setTimeout(() => { addSum = 0; }, 1300);   // quick back-to-back bonuses add up in one tag
  }
  function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function breakCombo() { if (st.combo > 1 && st.mode === 'playing') popup('combo lost', 'bad'); st.combo = 0; st.comboT = 0; }
  function damage(n, label) {
    if (st.mode !== 'playing') return;
    st.health = Math.max(0, st.health - n); st.sinceHit = 0; st.rampT *= n >= HP.hit ? G.speed.hitRampKeep : G.speed.slipRampKeep;   // damage costs built-up speed
    if (bot.on) bot.hits++; flash(ui.healthBar); popup(`${label}  −${n}`, 'bad');
    if (st.health <= 0) gameOver();
  }
  function startGame() {
    clearObstacles(); Object.assign(st, { mode: 'playing', paused: false, countT: 0, health: HP.max, energy: EN.max, sinceHit: 0, score: 0, dist: 0, playT: 0, combo: 0, comboT: 0, inv: 0, overT: 0, newBest: false, spawned: 0, nearMisses: 0, rampT: 0, noJumpT: 0, plainJumps: 0, jumped: false });
    Object.assign(sk, { mode: 'ground', t: 0, y: 0, vy: 0, trick: null, tricks: [], flip: null, attempted: false, invT: 0, jumpHeld: false, stumbleT: 0, queue: [], demoHold: undefined, stance: 1 }); S.hidden = false;
    sk.speed = Math.max(sk.speed, G.speed.start * 0.8); nextRowZ = S.z - SP.startDelay; signZ = nextRowZ; lastSignZ = 1e9;
    if (ctx.onStart) { ctx.onStart(); if (ctx.phase && ctx.phaseNow) ctx.phaseNow(); }
    ui.pops.textContent = ''; shown = 0; addSum = 0; showScreens();
  }
  function gameOver() {
    st.mode = 'over'; st.overT = 0; setMode('crash'); sk.queue.length = 0; sk.trick = null; sk.flip = null; sk.invT = 0; S.hidden = false;
    renderDiscoveries(); st.score = Math.floor(st.score); if (st.score > best) { best = st.score; st.newBest = true; }
    entering = !bot.on && qualifies(st.score); ui.name.value = '';   // autopilot runs don't go on the list
    ui.overScore.textContent = st.score.toLocaleString(); ui.overBest.textContent = best.toLocaleString(); ui.newBest.style.display = st.newBest ? '' : 'none';
  }
  function showScreens() {
    ui.title.classList.toggle('show', st.mode === 'title'); ui.over.classList.toggle('show', st.mode === 'over' && st.overT > G.overDelay);
    ui.pause.classList.toggle('show', st.paused); ui.hud.classList.toggle('show', st.mode !== 'title');
    const asking = entering && st.mode === 'over' && st.overT > G.overDelay;
    ui.entry.style.display = asking ? 'block' : 'none'; ui.overGo.style.display = entering ? 'none' : '';
    if (asking && document.activeElement !== ui.name) ui.name.focus();
  }
  // pausing lets go of held keys and any charge; resuming runs a 3-2-1 with input ignored, then play picks up where it stopped
  function setPaused(p) {
    if (st.mode !== 'playing') { st.paused = false; st.countT = 0; }
    else if (p) { st.paused = true; st.countT = 0; sk.held[-1] = sk.held[1] = false; sk.jumpHeld = false; if (sk.mode === 'charge') setMode('ground'); }
    else if (st.paused) { st.paused = false; st.countT = G.pause.countdown; }
    showScreens(); drawCount();
  }
  const isFrozen = () => st.paused || st.countT > 0;
  function drawCount() { ui.count.style.display = st.countT > 0 ? 'flex' : 'none'; if (st.countT > 0) ui.count.textContent = Math.ceil(st.countT); document.body.classList.toggle('frozen', isFrozen()); }
  function realTick(raw) { if (st.countT > 0) { st.countT = Math.max(0, st.countT - raw); drawCount(); } }   // the countdown runs on real time; the world is stopped
  function autoPause() { if (st.mode === 'playing' && !bot.on) setPaused(true); }

  // -------------------------------------------------------------------------------------
  // Skater state machine: ground → charge (hold to jump higher) → air → land → ground,
  // plus slip / bail / crash. Taps in the air start and upgrade flip tricks.
  // -------------------------------------------------------------------------------------
  function setMode(m) { sk.mode = m; sk.t = 0; }
  const grounded = () => sk.mode === 'ground' || sk.mode === 'land';
  const canSteer = () => sk.mode !== 'bail' && sk.mode !== 'crash';
  function canJump() {
    if (grounded()) return true;
    // coyote time: a jump pressed just after touching a slip hazard still gets away clean
    return sk.mode === 'slip' && sk.t < J.coyote;
  }
  const ollieCost = (f) => lerp(EN.ollieMin, EN.ollieMax, f);
  function startCharge() {
    if (!canJump()) return false;
    if (st.mode === 'playing' && st.energy < EN.ollieMin) { flash(ui.energyBar); popup('no energy', 'bad'); return false; }
    if (sk.mode === 'slip') sk.speed = sk.slipSpeed;   // got away clean
    setMode('charge'); sk.chargeT = 0; sk.jumpHeld = true; return true;
  }
  function chargeFrac() { return clamp(sk.chargeT / J.chargeTime, 0, 1); }
  function pop() {
    let f = chargeFrac();
    if (st.mode === 'playing') { f = Math.min(f, clamp((st.energy - EN.ollieMin) / (EN.ollieMax - EN.ollieMin), 0, 1)); st.energy -= ollieCost(f); }
    const h = lerp(J.minHeight, J.maxHeight, f);
    setMode('air'); sk.vy = Math.sqrt(2 * J.gravity * h); sk.y = 0; sk.airT = 0; sk.airDur = 2 * sk.vy / J.gravity; sk.jumpF = f; sk.jumpH = h;
    sk.tricks = []; sk.clearedThisJump = 0; st.jumped = true;
    sk.trick = null; sk.flip = null; sk.attempted = false;
  }
  // ↑/↓ in the air start a trick (one per jump): after the first press, wait up to flipWindow for a second press, then flip.
  // On the ground, ↓ swaps which foot leads.
  function pressFlip(dir) {
    if (sk.mode === 'air') { if (sk.trick || sk.attempted) return; const c = dir > 0 ? 'U' : 'D';
      if (!sk.flip) sk.flip = { keys: c, t: 0 }; else { sk.flip.keys += c; startFlip(); } }
    else if (dir < 0 && (grounded() || sk.mode === 'charge')) sk.stance = -sk.stance;
  }
  // a trick lands only from a high enough jump with enough air left; otherwise the board starts to go and he bails on landing
  function startFlip() {
    const type = TR.inputs[sk.flip.keys], T = TR[type], ok = sk.jumpH >= T.minApex && sk.airDur - sk.airT >= T.dur + TR.airMargin;
    sk.flip = null; sk.attempted = true; sk.trick = { type, t: 0, dur: T.dur, fail: !ok };
  }
  // the inputs that would land right now (the debug overlay and the autopilot read this)
  function availableFlips() { const left = sk.airDur - sk.airT; return Object.keys(TR.inputs).filter((k) => { const T = TR[TR.inputs[k]]; return sk.jumpH >= T.minApex && left - (k.length === 1 ? TR.flipWindow : 0) >= T.dur + TR.airMargin; }); }
  // tricks discovered (saved); the bonus trick stays off the list until it's been landed
  function renderDiscoveries() {
    const n = TR.discover.filter((t) => save.tricks[t]).length;
    ui.disc.innerHTML = `<b>Tricks discovered: ${n} / ${TR.discover.length}</b><br>${TR.discover.map((t) => (save.tricks[t] ? TRICK_NAME[t] : '<span class="q">???</span>')).join(' · ')}${save.tricks[TR.bonus] ? `<br><b>Bonus:</b> ${TRICK_NAME[TR.bonus]}` : ''}`;
    ui.storeNote.style.display = storageOK ? 'none' : 'block';
  }
  // one-time hints, gone for good once any trick has been landed
  function hint(key, text) {
    if (bot.on || save.hints[key] || Object.keys(save.tricks).length) return;
    save.hints[key] = true; writeSave(); const d = document.createElement('div'); d.className = 'pop hint'; d.textContent = text; ui.pops.appendChild(d); setTimeout(() => d.remove(), 4000);
  }
  function bail() {
    sk.trick = null; sk.flip = null; setMode('bail'); sk.speed *= G.speed.bailFactor; breakCombo(); sk.invT = TR.bail.invuln; damage(G.obstacles.cones.dmg, 'BAIL');
  }
  function pressJump() { if (sk.mode !== 'air' && sk.mode !== 'crash' && sk.mode !== 'charge') startCharge(); }
  function releaseJump() { sk.jumpHeld = false; }
  function pressLane(d) { if (st.mode !== 'over') sk.queue.push(d); }   // applied to the target lane next frame
  function slip() {
    if (sk.mode === 'slip' || sk.mode === 'crash') return;
    sk.slipSpeed = sk.speed; sk.slipApplied = false; setMode('slip');
  }
  function hit(dmg = HP.hit) {
    if (st.mode !== 'playing') return false;   // every obstacle you run into costs its own damage (each one can only hit once)
    sk.speed *= G.speed.hitFactor; sk.stumbleT = H.stumbleTime; S.shake = H.shake; S.hitStop = H.hitStop; breakCombo(); damage(dmg, 'OUCH'); return true;
  }
  function land() {
    sk.y = 0; sk.vy = 0;
    if (sk.trick || sk.flip) { bail(); return; }   // a failed attempt, or a press too late to flip at all
    setMode('land');
    if (st.mode !== 'playing') return;
    const over = sk.clearedThisJump > 0;
    let pts = Math.round(lerp(SC.ollieMin, SC.ollieMax, sk.jumpF) / 5) * 5; const names = [];
    let trickPts = 0; for (const t of sk.tricks) { pts += TR[t].pts; trickPts += TR[t].pts; names.push(TRICK_NAME[t]); if (!bot.on && !save.tricks[t]) { save.tricks[t] = true; writeSave(); } }
    if (!sk.attempted && ++st.plainJumps >= G.hints.airAfter) hint('air', 'Try ↑ or ↓ in the air');
    const k = over ? SC.overObstacle : 1, mult = Math.min(SC.comboMax, 1 + st.combo); pts *= k * mult; addBonus(pts); st.combo++;
    const label = names.length ? names.join(' + ') : (sk.jumpF > 0.7 ? 'BIG OLLIE' : 'OLLIE');   // a trick's popup shows its own points; the score tag shows the jump's total
    popup(`${label}${over ? ' OVER' : ''} +${names.length ? trickPts * k * mult : pts}${mult > 1 ? `  ×${mult}` : ''}`, names.length ? 'flip' : '');
  }

  function updateSkater(dt) {
    sk.t += dt; if (sk.stumbleT > 0) sk.stumbleT -= dt;
    if (sk.invT > 0) { sk.invT -= dt; S.hidden = sk.invT > 0 && Math.floor(sk.invT * TR.bail.flickerHz * 2) % 2 === 0; } else S.hidden = false;   // flicker after a bail
    if (grounded()) sk.lastGround = clock;
    // lanes: the board carves toward a target lane at a sideways speed tied to the forward speed.
    // Each press moves the target one lane; holding a direction keeps pushing the target on before
    // the skater arrives, so they slide continuously across lanes and settle into one on release.
    const vmax = Math.max(sk.speed * L.carveRatio, L.width / L.carveMax), acc = 4 * L.width / Math.pow(carveTime(sk.speed), 2);
    if (canSteer() && st.mode !== 'over') {
      while (sk.queue.length) { const d = sk.queue.shift(), nl = clamp(sk.lane + d, 0, L.count - 1);
        if (nl !== sk.lane) sk.lane = nl; else { sk.recT = L.recoverTime; sk.recDir = -d; } }   // at the edge: a little wobble instead of a move
      for (const d of [-1, 1]) { const nl = sk.lane + d;
        if (sk.held[d] && nl >= 0 && nl < L.count && (LANE_X[sk.lane] - sk.x) * d < L.width * 0.5) sk.lane = nl; }
    }
    sk.toX = LANE_X[sk.lane]; const dist = sk.toX - sk.x;
    const want = Math.sign(dist) * Math.min(vmax, Math.sqrt(2 * acc * Math.abs(dist)));   // cruise, then ease into the lane
    sk.vx += clamp(want - sk.vx, -acc * dt, acc * dt); sk.x += sk.vx * dt;
    // arrive without overshooting: crossing the lane centre (or getting close and slow) snaps into it, so there's no swing back
    if ((sk.toX - sk.x) * dist <= 0 || (Math.abs(dist) < 0.005 && Math.abs(sk.vx) < 0.05)) { sk.x = sk.toX; sk.vx = 0; }
    sk.chT = Math.abs(dist) > 0.01 ? 1 : -1;
    let lean = -clamp(sk.vx / vmax, -1, 1) * L.lean;   // lean into the slide
    if (sk.recT > 0) { sk.recT -= dt; lean += sk.recDir * L.lean * 0.25 * Math.sin(Math.PI * clamp(sk.recT / L.recoverTime, 0, 1)); }   // small wobble at the edge
    sk.lean = lerp(sk.lean || 0, lean, 1 - Math.exp(-dt * 5));   // eases in and out, no snap

    switch (sk.mode) {
      case 'charge': sk.chargeT += dt;
        if (sk.demoHold !== undefined && sk.chargeT >= sk.demoHold) { sk.jumpHeld = false; sk.demoHold = undefined; }
        if (!sk.jumpHeld && sk.chargeT >= J.minCrouch) pop(); break;   // held: stays crouched until released
      case 'air':
        sk.airT += dt; sk.vy -= J.gravity * dt; sk.y += sk.vy * dt;
        if (sk.flip) { sk.flip.t += dt; if (sk.flip.t >= TR.flipWindow) startFlip(); }
        if (sk.trick) { sk.trick.t += dt; if (!sk.trick.fail && sk.trick.t >= sk.trick.dur) { sk.tricks.push(sk.trick.type); sk.trick = null; } }
        if (st.mode === 'title' && !sk.attempted && !sk.flip && sk.airT > 0.02) { const a = availableFlips(); sk.attempted = !a.length; if (a.length) for (const c of a[Math.floor(Math.random() * a.length)]) pressFlip(c === 'U' ? 1 : -1); }   // show off on the title screen
        if (sk.y <= 0) land();
        break;
      case 'land': if (sk.t >= J.landTime) setMode('ground'); break;
      case 'slip':
        if (!sk.slipApplied && sk.t >= J.coyote) { sk.slipApplied = true; sk.speed = sk.slipSpeed * G.speed.slipFactor; S.shake = H.shake * 0.5; damage(HP.slip, 'SLIP'); }
        if (sk.t >= H.slipTime) setMode('ground'); break;
      case 'bail': if (sk.t >= H.bailTime) setMode('ground'); break;
    }
    return sk.lean;
  }

  function writePose(lean) {
    const P = S.pose; for (const k in P) P[k] = 0; P.flipping = false; P.lean = lean; P.stance = sk.stance;
    switch (sk.mode) {
      case 'charge': P.charge = chargeFrac(); P.crouch = lerp(J.crouchStart, J.crouchFull, P.charge) * smooth(0, J.minCrouch, sk.chargeT); break;
      case 'air': { const u = clamp(sk.airT / sk.airDur, 0, 1); P.air = sk.y; P.airN = clamp(sk.y / J.maxHeight, 0, 1);
        P.pitch = u < 0.35 ? Math.sin(u / 0.35 * Math.PI) * 0.42 : 0;
        P.crouch = lerp(-0.15, 0.3 + 0.25 * sk.jumpF, smooth(0.12, 0.55, u)) - 0.25 * smooth(0.8, 1, u);   // pop extends, legs tuck (more on big jumps), then reach for the ground
        const tr = sk.trick;
        if (tr && tr.t > 0) { const f = clamp(tr.t / tr.dur, 0, 1) * (tr.fail ? 0.45 : 1), e = smooth(0, 1, f), y = tr.type;   // a failed flip stalls part-way and he loses balance
          if (tr.fail) { const w = smooth(0, 1, tr.t / tr.dur); P.flail = w; P.bodyPitch = -0.32 * w; }
          P.flipping = true; P.lift = Math.sin(f * Math.PI) * (y === 'kickflip' || y === 'heelflip' ? 0.11 : 0.15);
          if (y === 'impossible') P.spin = e * Math.PI * 2;                                  // board wraps end over end around the back foot
          else { P.roll = (y === 'heelflip' ? -1 : 1) * e * Math.PI * 2; P.flick = Math.sin(clamp(f / 0.3, 0, 1) * Math.PI); P.flickDir = y === 'heelflip' ? -1 : 1; }
          if (y === 'hardflip') { P.boardYaw = e * Math.PI; P.pitch += Math.sin(f * Math.PI) * 0.7; }   // flips up between the legs
          else if (y === 'threeSixty') P.boardYaw = e * Math.PI * 2; }                        // kickflip + 360 shove-it
        break; }
      case 'land': P.crouch = lerp(0.45 + 0.25 * sk.jumpF, 0, smooth(0, 1, sk.t / J.landTime)); break;
      case 'slip': { const u = clamp(sk.t / H.slipTime, 0, 1), e = Math.sin(u * Math.PI);
        P.boardZ = -0.85 * Math.sin(Math.min(1, u * 1.3) * Math.PI); P.boardYaw = 0.8 * e; P.bodyPitch = 0.42 * e; P.crouch = 0.35 * e; P.flail = e;
        P.offBoard = smooth(0, 0.12, u) * (1 - smooth(0.7, 0.95, u)); break; }
      case 'bail': { const u = clamp(sk.t / H.bailTime, 0, 1), e = Math.sin(u * Math.PI);
        P.bodyPitch = -0.55 * e; P.boardYaw = -1.1 * e; P.boardZ = -0.5 * e; P.roll = 0.8 * e; P.crouch = 0.5 * e; P.flail = e; P.offBoard = smooth(0, 0.1, u) * (1 - smooth(0.7, 0.95, u)); break; }
      case 'crash': { const u = smooth(0, 0.55, sk.t);
        P.bodyPitch = -1.2 * u; P.crouch = 0.55 * u; P.boardZ = -2.2 * u; P.boardYaw = 2.4 * u; P.roll = 0.5 * u; P.flail = 1 - u; P.offBoard = 1; break; }
    }
    if (sk.stumbleT > 0) { const s = clamp(sk.stumbleT / H.stumbleTime, 0, 1); P.bodyPitch += -0.28 * Math.sin(s * Math.PI); P.flail = Math.max(P.flail, s); }
  }

  // -------------------------------------------------------------------------------------
  // Collisions: lane-aware AABBs (not the meshes)
  // -------------------------------------------------------------------------------------
  const SKB = G.skaterBox;
  function nearMiss(o) {
    st.nearMisses++; const mult = Math.min(SC.comboMax, 1 + st.combo), pts = SC.nearMiss * mult; addBonus(pts); st.combo++;
    popup(`CLOSE CALL +${pts}${mult > 1 ? `  ×${mult}` : ''}`, 'near');
  }
  function collide() {
    const sx0 = sk.x - SKB.w / 2, sx1 = sk.x + SKB.w / 2, sz0 = S.z - SKB.d / 2, sz1 = S.z + SKB.d / 2;
    for (const o of OBS) {
      if (o.done || (o.lane < 0 && !o.active)) continue;
      let ahead = false;
      for (const p of o.parts) {
        const cx = o.x + p.dx, cz = o.z + p.dz, x0 = cx - p.w / 2, x1 = cx + p.w / 2, z0 = cz - p.d / 2, z1 = cz + p.d / 2;
        if (z0 <= sz1) ahead = true;
        if (z1 < sz0 || z0 > sz1) continue;   // not alongside yet / already passed
        const gap = Math.max(x0 - sx1, sx0 - x1);
        if (gap > 0) { o.minGap = Math.min(o.minGap, gap); continue; }   // passing beside it: track how close
        if (p.clear !== null && sk.y > p.clear) { if (!o.cleared) sk.clearedThisJump++; o.cleared = true; o.minV = Math.min(o.minV, sk.y - p.clear); continue; }
        if (sk.invT > 0) continue;   // brief invincibility after a bail
        o.done = true; o.hit = true; if (p.kind === 'slip') slip(); else hit(p.dmg); break;
      }
      if (!o.done && !ahead) {   // fully behind the skater
        o.done = true; if (st.mode !== 'playing') continue;
        if (o.cleared) { addBonus(SC.clear); popup(`CLEAR +${SC.clear}`); }
        if (o.minGap < SC.nearDist || (o.cleared && o.minV < SC.nearJump)) nearMiss(o);
      }
    }
  }

  // -------------------------------------------------------------------------------------
  // Hitbox debug (H)
  // -------------------------------------------------------------------------------------
  let debug = false, dbgOn = false; const helpers = [];
  const COLORS = { solid: 0xff3030, jump: 0xffa020, slip: 0xffe040, skater: 0x30e0ff };
  function helper(i) { let h = helpers[i]; if (!h) { h = new THREE.Box3Helper(new THREE.Box3(), 0xffffff); h.material.depthTest = false; h.renderOrder = 10; scene.add(h); helpers[i] = h; } h.visible = true; return h; }
  function drawHitboxes() {
    let n = 0;
    if (debug) {
      const h = helper(n++); h.box.min.set(sk.x - SKB.w / 2, sk.y, S.z - SKB.d / 2); h.box.max.set(sk.x + SKB.w / 2, sk.y + SKB.h, S.z + SKB.d / 2); h.material.color.setHex(COLORS.skater);
      for (const o of OBS) { if (o.lane < 0 && !o.active) continue;
        for (const p of o.parts) { const b = helper(n++), cx = o.x + p.dx, cz = o.z + p.dz; b.box.min.set(cx - p.w / 2, 0, cz - p.d / 2); b.box.max.set(cx + p.w / 2, p.h, cz + p.d / 2);
          b.material.color.setHex(p.kind === 'slip' ? COLORS.slip : p.clear !== null ? COLORS.jump : COLORS.solid); } }
    }
    for (let i = n; i < helpers.length; i++) helpers[i].visible = false;
  }

  // -------------------------------------------------------------------------------------
  // Autopilot (P): a simple bot that plays by the same rules. It only reads the hitboxes, steers with
  // the normal carve and jumps with the normal charge. It counts a "trap" whenever no lane it can
  // reach has a way through, which would mean an unfair row.
  // -------------------------------------------------------------------------------------
  const bot = { on: false, runs: 0, hits: 0, trapped: 0, trapLog: [], time: 0, spawned: 0, lastTrapZ: 1e9, label: null };
  const fullAir = 2 * Math.sqrt(2 * J.maxHeight / J.gravity), tapAir = 2 * Math.sqrt(2 * J.minHeight / J.gravity);
  function botCells(v, look) {
    const lanes = LANE_X.map(() => []);
    for (const o of OBS) { if (o.done) continue;
      for (const p of o.parts) {
        const cz = o.z + p.dz, d = S.z - (cz + p.d / 2) - SKB.d / 2; if (d < -p.d - SKB.d || d > look) continue;
        let cx = o.x + p.dx; if (o.lane < 0) cx = o.xArr + o.dirX * o.vx * (clock + Math.max(0, d) / v - o.tArr) + p.dx;
        const span = [cx];
        if (o.drift) span.push(LANE_X[o.drift.to] + p.dx); if (o.change) span.push(LANE_X[o.change.to] + p.dx);
        for (let l = 0; l < LANE_X.length; l++) if (span.some((x) => Math.abs(LANE_X[l] - x) < p.w / 2 + SKB.w / 2 + 0.12))
          lanes[l].push({ d, kind: p.kind === 'slip' ? 'slip' : p.clear !== null && director.jumpable(p.clear, p.d, v) ? 'jump' : 'solid', depth: p.d });
      } }
    return lanes;
  }
  // lane planner: dynamic programming over (time step, lane). Each obstacle part occupies its lane(s) for the time the
  // skater box overlaps it; carving to the next lane takes carveTime and occupies both lanes meanwhile. Returns the
  // first move of the cheapest path and its cost (≥ 1e6 = every path runs into something solid: a trap).
  function botPlan(v, lanes) {
    const dtp = 0.05, H = 4, steps = Math.round(H / dtp), m = Math.max(1, Math.ceil(carveTime(v) / dtp)), N = LANE_X.length;
    const canFull = st.energy >= EN.ollieMax || st.mode !== 'playing';
    const occ = lanes.map((cells) => { const a = new Float64Array(steps + 1);
      for (const c of cells) { const s0 = Math.max(0, Math.floor((c.d - 0.1) / v / dtp)), s1 = Math.min(steps, Math.ceil((c.d + c.depth + SKB.d + 0.1) / v / dtp));
        // a collision costs ≥ 1e6, more the sooner it comes, so the plan always deals with the nearest row first
        const solid = c.kind === 'solid' || (c.kind === 'jump' && !canFull);
        for (let s = s0; s <= s1; s++) a[s] = Math.max(a[s], solid ? 1e6 * (2 - s / steps) : c.kind === 'jump' ? 30 : 8); }
      return a; });
    // start in the lane the skater is heading for; if mid-carve, the lane being left still counts until the
    // skater box is clear of it (0.55 m from its centre), which is much sooner than arriving in the new lane
    const vlat = Math.max(sk.speed * L.carveRatio, L.width / L.carveMax);
    const physical = clamp(Math.round((sk.x - LANE_X[0]) / L.width), 0, N - 1), tClear = physical === sk.lane ? 0 : Math.max(0, 0.55 - Math.abs(sk.x - LANE_X[physical])) / vlat;
    const dp = Array.from({ length: steps + 1 }, () => new Float64Array(N).fill(Infinity)), first = Array.from({ length: steps + 1 }, () => new Int8Array(N));
    let c0 = occ[sk.lane][0]; const nClear = Math.ceil(tClear / dtp);
    const extra = (s) => (s <= nClear ? occ[physical][s] : 0);   // the lane still being left
    const s0 = 0; dp[0][sk.lane] = Math.max(c0, extra(0)); first[0][sk.lane] = 0;
    for (let s = s0; s < steps; s++) for (let l = 0; l < N; l++) { const c = dp[s][l]; if (c === Infinity) continue;
      const stay = c + Math.max(occ[l][s + 1], extra(s + 1)); if (stay < dp[s + 1][l]) { dp[s + 1][l] = stay; first[s + 1][l] = s === s0 ? 0 : first[s][l]; }
      // a carve: the box is in the old lane for the first ~60% of it and in the new one for the last ~60%
      for (const d of [-1, 1]) { const n = l + d; if (n < 0 || n >= N) continue; const e = Math.min(steps, s + m), leave = s + Math.ceil(m * 0.6), enter = s + Math.floor(m * 0.4); let mc = c;
        for (let k = s + 1; k <= e; k++) mc += Math.max(k <= leave ? occ[l][k] : 0, k >= enter ? occ[n][k] : 0, extra(k)); mc += 2;   // small cost per move: don't weave for nothing
        if (mc < dp[e][n]) { dp[e][n] = mc; first[e][n] = s === s0 ? d : first[s][l]; } } }
    let best = Infinity, move = 0; for (let l = 0; l < N; l++) if (dp[steps][l] < best) { best = dp[steps][l]; move = first[steps][l]; }
    // trapped = even the best path can't avoid a collision within the time it takes to carve across every lane
    const tTrap = Math.min(steps, Math.ceil(((N - 1) * carveTime(v) + 0.4) / dtp)); let trapC = Infinity; for (let l = 0; l < N; l++) trapC = Math.min(trapC, dp[tTrap][l]);
    return { cost: best, move, trapped: trapC >= 1e6 };
  }
  function autopilot() {
    if (st.mode === 'title') { startGame(); bot.runs++; return; }
    if (st.mode === 'over') { if (st.overT > G.overDelay + 0.5) { startGame(); bot.runs++; } return; }
    const v = Math.max(sk.speed, 1), lanes = botCells(v, v * 4 + 4), plan = botPlan(v, lanes);
    if (plan.trapped && Math.abs(S.z - bot.lastTrapZ) > 15) { bot.trapped++; bot.lastTrapZ = S.z;
      if (bot.trapLog.length < 20) bot.trapLog.push({ dist: Math.round(st.dist), stage: stage(), lane: sk.lane, x: +sk.x.toFixed(2), energy: Math.round(st.energy), lanes: lanes.map((c) => c.map((x) => `${x.kind}@${x.d.toFixed(1)}`).join(' ')) }); }
    if (plan.move && !sk.queue.length && sk.chT < 0) pressLane(plan.move);
    // jumps: a full ollie timed so the apex is over a jumpable, a quick hop over a slip hazard
    const cur = clamp(Math.round((sk.x - LANE_X[0]) / L.width), 0, LANE_X.length - 1);
    if (grounded() && Math.abs(sk.x - LANE_X[cur]) < 0.4) {
      const ahead = lanes[cur].filter((x) => x.d > 0 && x.kind !== 'solid').sort((a, b) => a.d - b.d)[0];
      if (ahead) {
        if (ahead.kind === 'jump' && ahead.d <= v * (J.chargeTime + 0.5 * fullAir) - ahead.depth / 2) { if (startCharge()) sk.demoHold = J.chargeTime; }
        else if (ahead.kind === 'slip' && ahead.d <= v * (J.minCrouch + 0.5 * tapAir)) { if (startCharge()) sk.demoHold = 0; }
      }
    }
  }
  function setAutopilot(on) {
    bot.on = on; if (!bot.label) { bot.label = document.createElement('div'); bot.label.id = 'gBot'; bot.label.textContent = 'AUTOPILOT'; document.body.appendChild(bot.label); }
    bot.label.style.display = on ? '' : 'none';
  }
  function botReport() {
    const min = bot.time / 60;
    return { minutes: +min.toFixed(2), runs: bot.runs, obstaclesPerMin: +(bot.spawned / Math.max(min, 1e-3)).toFixed(1), hits: bot.hits, trapped: bot.trapped, trapLog: bot.trapLog,
      stage: stage(), dist: Math.round(st.dist), nearMisses: st.nearMisses, patterns: { ...director.stats.patterns }, rejected: director.stats.rejected, violations: director.stats.violations.slice(-5) };
  }

  // -------------------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------------------
  let hudT = 0;
  function apexIfReleased() { let f = chargeFrac(); if (st.mode === 'playing') f = Math.min(f, clamp((st.energy - EN.ollieMin) / (EN.ollieMax - EN.ollieMin), 0, 1)); return lerp(J.minHeight, J.maxHeight, f); }
  function drawDebugOverlay() {
    ui.dbg.style.display = dbgOn ? 'block' : 'none'; if (!dbgOn) return;
    const air = sk.mode === 'air', apex = sk.mode === 'charge' ? apexIfReleased() : air ? sk.jumpH : 0, left = air ? sk.airDur - sk.airT : 0;
    const fits = [...TR.discover, TR.bonus].filter((t) => apex >= TR[t].minApex).map((t) => TRICK_NAME[t]);
    const win = sk.flip ? `waiting ${sk.flip.keys} ${(TR.flipWindow - sk.flip.t).toFixed(2)} s` : sk.trick ? `${sk.trick.fail ? 'failing' : 'flipping'} ${TRICK_NAME[sk.trick.type]}` : sk.attempted ? 'used' : 'open';
    ui.dbg.textContent = `state ${sk.mode}\ncharge ${(sk.mode === 'charge' ? chargeFrac() : 0).toFixed(2)}\ncrouch ${(S.pose.crouch || 0).toFixed(2)}\napex ${apex.toFixed(2)} m\ntricks ${fits.join(', ') || 'none'}\nflip window ${win}\nair left ${left.toFixed(2)} s`;
  }
  function update(dt) {
    drawDebugOverlay();
    if (isFrozen()) { writePose(sk.lean || 0); drawHitboxes(); return; }
    clock += dt;
    if (st.mode === 'playing') { st.playT += dt; st.rampT = (st.rampT || 0) + dt; if (!st.jumped && (st.noJumpT += dt) >= G.hints.holdAfter) hint('hold', 'Try holding Space'); }
    if (bot.on) { autopilot(); if (st.mode === 'playing') bot.time += dt; }
    if (st.mode === 'over') { st.overT += dt; if (st.overT > G.overDelay && !ui.over.classList.contains('show')) showScreens(); }
    // title screen: cruise and throw the odd trick for show
    if (st.mode === 'title') { st.titleT -= dt; if (st.titleT <= 0 && grounded()) { st.titleT = 2.5 + Math.random() * 2.5;
      if (startCharge()) sk.demoHold = rand(0, J.chargeTime);
      if (Math.random() < 0.5) pressLane(sk.lane <= 1 ? 1 : -1); } }
    // speed eases back toward the ramped target after a hit or slip
    const tgt = targetSpeed();
    if (sk.mode === 'slip' || sk.mode === 'bail') { /* hold the reduced speed until back on the board */ }
    else if (sk.speed < tgt) sk.speed = Math.min(tgt, sk.speed + G.speed.recoverRate * dt);
    else sk.speed = Math.max(tgt, sk.speed - (st.mode === 'over' ? G.speed.crashDecel : G.speed.recoverRate * 2) * dt);
    S.speed = sk.speed; S.moving = sk.speed > 0.05; const zPrev = S.z; S.z -= sk.speed * dt;
    if (st.mode === 'playing') { st.dist += sk.speed * dt; st.score += sk.speed * dt * SC.perMetre; st.energy = Math.min(EN.max, st.energy + EN.regen * dt);
      // health slowly refills once you've gone a while without taking damage
      st.sinceHit += dt; if (st.sinceHit > HP.regenDelay) st.health = Math.min(HP.max, st.health + HP.regen * dt); }

    const lean = updateSkater(dt);
    S.x = sk.x; S.camRoll = lean * L.camRoll;
    writePose(lean);

    // obstacles: spawn ahead, move pedestrians and crossing traffic, collide, recycle behind
    spawnAhead();
    for (const o of OBS) { if (o.lane < 0) updateCrossing(o); else updateObstacle(o, dt); }
    // collisions in sub-steps of ≤ 0.3 m so a fast frame can't skip over an obstacle
    if (st.mode === 'playing') { const zNow = S.z, n = Math.max(1, Math.ceil((zPrev - zNow) / 0.3));
      for (let i = 1; i <= n; i++) { S.z = zPrev + (zNow - zPrev) * i / n; collide(); } S.z = zNow; }
    for (let i = OBS.length - 1; i >= 0; i--) if (OBS[i].z > S.z + SP.despawn) removeObstacle(i);

    S.shake = Math.max(0, (S.shake || 0) - dt);
    drawHitboxes();

    hudT -= dt;
    if (hudT <= 0) { hudT = 0.05;
      // the counter eases toward the score, so a bonus visibly counts up
      const goal = st.score; shown = st.mode === 'playing' && goal >= shown ? shown + (goal - shown) * (goal - shown > 30 ? 0.25 : 1) : goal;
      ui.score.textContent = Math.floor(shown).toLocaleString();
      const mult = Math.min(SC.comboMax, 1 + st.combo); ui.combo.textContent = st.combo > 0 ? `×${mult} combo` : '';
      const hp = st.health / HP.max; ui.health.style.width = `${hp * 100}%`; ui.health.style.background = hp > 0.6 ? '#4cd964' : hp > 0.3 ? '#ffcc33' : '#ff4a4a';
      ui.energy.style.width = `${st.energy / EN.max * 100}%`;
      // while charging, the darker end of the bar shows what this jump will cost
      const cost = sk.mode === 'charge' && st.mode === 'playing' ? Math.min(st.energy, ollieCost(chargeFrac())) : 0;
      ui.energyCost.style.width = `${cost / EN.max * 100}%`; ui.energyCost.style.left = `${(st.energy - cost) / EN.max * 100}%`;
      ui.dist.textContent = `${Math.floor(st.dist * 3.28084).toLocaleString()} ft`; ui.phase.textContent = getPhaseName(); }
  }

  // -------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------
  // every key goes through a named action (GAME.input); press / release are what touch controls can call later
  const ACTIONS = {}; for (const a in G.input) for (const k of G.input[a]) (ACTIONS[k] ||= []).push(a);
  let creditsOpen = false;
  function showCredits(on) { creditsOpen = on; ui.credits.classList.toggle('show', on); ui.title.classList.toggle('show', !on && st.mode === 'title'); if (on) ui.roll.scrollTop = 0; }
  $('gCreditsBtn').addEventListener('click', () => { if (st.mode === 'title') showCredits(true); });
  $('gCreditsClose').addEventListener('click', () => showCredits(false));
  for (const b of ['gCreditsBtn', 'gCreditsClose']) $(b).addEventListener('mousedown', (e) => e.preventDefault());   // a click never leaves keyboard focus on the button
  function press(a) {   // returns true if the action did something on this screen
    if (creditsOpen) { if (a === 'pause') showCredits(false); else if (a === 'flipUp' || a === 'flipDown') ui.roll.scrollTop += a === 'flipUp' ? -60 : 60; return true; }
    if (st.countT > 0) return false;   // ignored during the 3-2-1
    if (st.paused) { if (a === 'pause' || a === 'confirm') { setPaused(false); return true; } return false; }
    if (st.mode === 'title') { if (a === 'confirm') { startGame(); return true; } if (a === 'credits') { showCredits(true); return true; } return false; }
    if (st.mode === 'over') { if (a === 'confirm' && st.overT > G.overDelay && !entering) { startGame(); return true; } return false; }
    switch (a) {
      case 'pause': setPaused(true); return true;
      case 'laneLeft': sk.held[-1] = true; pressLane(-1); return true;
      case 'laneRight': sk.held[1] = true; pressLane(1); return true;
      case 'crouchJump': pressJump(); return true;
      case 'flipUp': pressFlip(1); return true;
      case 'flipDown': pressFlip(-1); return true;
    }
    return false;
  }
  function release(a) { if (a === 'laneLeft') sk.held[-1] = false; else if (a === 'laneRight') sk.held[1] = false; else if (a === 'crouchJump') releaseJump(); }
  function keydown(e) {
    const k = e.key;
    if (k === 'h' || k === 'H') { debug = !debug; return true; }
    if (k === 'p' || k === 'P') { if (!e.repeat) setAutopilot(!bot.on); return true; }
    if (k === 't' || k === 'T') { if (!e.repeat) dbgOn = !dbgOn; return true; }
    const acts = ACTIONS[k]; if (!acts) return false;
    if (acts[0] === 'credits') return !e.repeat && press('credits');   // C stays the debug camera unless a screen uses it
    if (!e.repeat) for (const a of acts) if (press(a)) break;
    return true;   // preventDefault on every game key, so arrows and Space never scroll the page
  }
  function keyup(e) { for (const a of ACTIONS[e.key] || []) release(a); }
  // auto-pause when the window loses focus or the tab is hidden; it never resumes by itself
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });

  renderScores(); renderDiscoveries(); showScreens();
  return {
    update, realTick, keydown, keyup, press, release,
    get paused() { return isFrozen(); }, get mode() { return st.mode; }, get debug() { return debug; },
    // test hooks
    st, sk, OBS, LANE_X, save, writeSave, director, bot, botReport, setAutopilot, start: startGame, setPaused, kill() { st.health = 1; hit(); }, spawnObstacle, spawnCrossing, clearObstacles,
  };
}
