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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + (b - a) * Math.random();
function wpick(obj) { let s = 0; for (const k in obj) s += obj[k]; let r = Math.random() * s; for (const k in obj) { r -= obj[k]; if (r <= 0) return k; } return Object.keys(obj)[0]; }
const TRICK_NAME = { kickflip: 'KICKFLIP', heelflip: 'HEELFLIP', hardflip: 'HARDFLIP', threeSixty: '360 FLIP', impossible: 'IMPOSSIBLE' };

export function createGame(ctx) {
  const { scene, S, chars, IM, cfg: G, getPhaseName } = ctx;
  const L = G.lanes, J = G.jump, H = G.hazards, SP = G.spawn, SC = G.score, TR = G.tricks, EN = G.energy, HP = G.health;
  const LANE_X = Array.from({ length: L.count }, (_, i) => (i - (L.count - 1) / 2) * L.width);
  const $ = (id) => document.getElementById(id);
  const ui = { hud: $('ghud'), score: $('gScore'), combo: $('gCombo'), dist: $('gDist'), pops: $('gPops'),
    health: $('gHealth'), healthBar: $('gHealthBar'), energy: $('gEnergy'), energyCost: $('gEnergyCost'), energyBar: $('gEnergyBar'),
    title: $('gTitle'), over: $('gOver'), pause: $('gPause'), overScore: $('gOverScore'), overBest: $('gOverBest'), titleBest: $('gTitleBest'), newBest: $('gNewBest') };

  let best = 0; try { best = Number(localStorage.getItem('vbSkaterBest')) || 0; } catch (e) { /* storage blocked: best score lasts this session only */ }
  const st = { mode: 'title', paused: false, health: HP.max, energy: EN.max, score: 0, dist: 0, playT: 0, combo: 0, comboT: 0, inv: 0, overT: 0, titleT: 2.5, newBest: false, nextCross: 0 };
  const startLane = Math.min(L.count - 1, Math.floor(L.count / 2));
  const sk = { lane: startLane, x: LANE_X[startLane], vx: 0, toX: 0, chT: -1, queue: [], recT: 0, recDir: 0, held: { '-1': false, '1': false },
    mode: 'ground', t: 0, y: 0, vy: 0, airT: 0, airDur: 1, jumpF: 0, chargeT: 0, jumpHeld: false, flipOnPop: false,
    trick: null, tricks: [], lastGround: 0, stance: 1, popStance: 1, stumbleT: 0, slipSpeed: 0, slipApplied: false,
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
  };
  const pools = {};
  function getMesh(type) { const p = pools[type] || (pools[type] = []); const g = p.pop() || BUILD[type](); g.traverse((m) => { if (m.isMesh) { m.castShadow = !m.material.transparent; m.receiveShadow = true; } }); scene.add(g); return g; }
  function freeMesh(type, g) { scene.remove(g); pools[type].push(g); }

  // -------------------------------------------------------------------------------------
  // Obstacle rows: every row leaves at least one lane completely open; gaps scale with speed
  // so a reaction plus a full lane-to-lane traverse always fits.
  // -------------------------------------------------------------------------------------
  const OBS = [];
  let nextRowZ = 0, agentSeed = 1;
  const PEOPLE = new Set(['ped', 'pedDog', 'bike', 'skater', 'selfie', 'beg', 'smoke', 'drums']), MOVERS = new Set(['ped', 'pedDog', 'bike', 'skater']), SITTERS = new Set(['beg', 'smoke', 'drums']);
  const laneLoad = LANE_X.map(() => 0);   // people placed per lane, so rows spread them evenly
  function spawnObstacle(type, lane, z) {
    const T = G.obstacles[type], o = { type, lane, x: LANE_X[lane], z, az: z, zOff: 0, vz: 0, ...T, done: false, cleared: false, mesh: null, meshType: type, ped: null };
    const seed = 7919 * agentSeed++;
    if (MOVERS.has(type)) {
      let dir = Math.random() < SP.towardChance ? 1 : -1;   // +1 comes toward the skater, -1 goes the same way
      const sp = type === 'bike' ? rand(...SP.bikeSpeed) : type === 'skater' ? rand(...SP.skaterSpeed) : 0;
      if (dir < 0 && sp > sk.speed * 0.7) dir = 1;           // never a same-way rider the player couldn't catch up with
      if (chars) { o.ped = type === 'bike' ? chars.addGameCyclist({ x: o.x, z, dirZ: dir, seed }) : type === 'skater' ? chars.addGameSkater({ x: o.x, z, dirZ: dir, seed })
          : chars.addGameWalker({ x: o.x, z, dir, seed, dog: type === 'pedDog' });
        if (sp) o.ped.speed = sp; }
      o.vz = dir * (o.ped ? o.ped.speed : sp || 1.2);
      if (type === 'pedDog') o.zOff = dir * 0.6;              // the box covers the owner and the dog out in front
      // place them so they reach the row's z when the skater does
      o.az = z - o.vz * (S.z - z) / Math.max(sk.speed, 1); o.z = o.az + o.zOff;
      if (o.ped) o.ped.z = o.az; else { o.mesh = getMesh('ped'); o.meshType = 'ped'; }
    } else if (type === 'selfie' || SITTERS.has(type)) {
      if (!chars) { o.mesh = getMesh('ped'); o.meshType = 'ped'; }
      else if (type === 'drums') {   // three drummers on buckets in a little circle that fills the lane
        o.peds = []; const a0 = rand(0, 6.28);
        for (let k = 0; k < 3; k++) { const ang = a0 + k * Math.PI * 2 / 3, x = o.x + Math.sin(ang) * 0.88, zz = z + Math.cos(ang) * 0.88;
          o.peds.push(chars.addGameStation({ kind: 'drum', x, z: zz, ry: Math.atan2(o.x - x, z - zz), seed: seed + k })); } }
      else { const inward = o.x < 0 ? Math.PI / 2 : -Math.PI / 2;   // sitters face the middle of the boardwalk
        o.ped = chars.addGameStation({ kind: type, x: o.x, z, ry: type === 'selfie' ? (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5) : inward + rand(-0.3, 0.3), seed, sex: type === 'selfie' ? 'F' : undefined }); }
    } else { o.mesh = getMesh(type); o.mesh.rotation.y = (Math.random() - 0.5) * 0.5; }
    if (o.mesh) o.mesh.position.set(o.x, 0, o.az);
    OBS.push(o); return o;
  }
  // a cyclist or skater crossing the boardwalk at a steady speed, timed to be over the lanes when the skater gets there
  function spawnCrossing(z) {
    const type = Math.random() < SP.crossSkateChance ? 'crossSkate' : 'crossBike', T = G.obstacles[type];
    const dirX = Math.random() < 0.5 ? 1 : -1, vx = rand(...(type === 'crossBike' ? SP.crossBikeSpeed : SP.crossSkateSpeed));
    const o = { type, lane: -1, x: 1e3, z, ...T, done: false, cleared: false, mesh: null, ped: null, dirX, vx, xArr: rand(LANE_X[0], LANE_X[L.count - 1]), tArr: clock + (S.z - z) / Math.max(sk.speed, 1), active: false, exited: false };
    OBS.push(o); return o;
  }
  function updateCrossing(o, dt) {
    o.x = o.xArr + o.dirX * o.vx * (clock - o.tArr);
    const inside = Math.abs(o.x) <= SP.crossEdge;
    if (inside && !o.active && !o.exited) { o.active = true;
      if (chars) { o.ped = (o.type === 'crossBike' ? chars.addGameCyclist : chars.addGameSkater)({ x: o.x, z: o.z, dirX: o.dirX, seed: 104729 * agentSeed++ }); o.ped.speed = o.vx; }
      else o.mesh = getMesh('ped'); }
    if (o.active && !inside && Math.sign(o.x) === o.dirX) { o.active = false; o.exited = true; o.done = true; if (o.ped) { chars.removeGameAgent(o.ped); o.ped = null; } if (o.mesh) { freeMesh('ped', o.mesh); o.mesh = null; } }
    if (o.ped) { o.ped.x = o.x; o.ped.z = o.z; } if (o.mesh) o.mesh.position.set(o.x, 0, o.z);
  }
  function removeObstacle(i) { const o = OBS[i]; if (o.ped) chars.removeGameAgent(o.ped); if (o.peds) for (const p of o.peds) chars.removeGameAgent(p); if (o.mesh) freeMesh(o.meshType || 'ped', o.mesh); OBS.splice(i, 1); }
  function clearObstacles() { for (let i = OBS.length - 1; i >= 0; i--) removeObstacle(i); }
  function rowGap() {
    const v = Math.max(sk.speed, targetSpeed());
    // never below the reach-the-open-lane minimum; the random slack on top shrinks as the run goes on
    const d = difficulty(), j = SP.gapJitter;
    return Math.max(SP.minGap, v * (SP.reaction + (L.count - 1) * carveTime(v) + L.recoverTime)) * rand(lerp(j.start[0], j.end[0], d), lerp(j.start[1], j.end[1], d));
  }
  // 0 → 1 over spawn.rampDist metres of the run: more lanes blocked per row and rows packed closer
  const difficulty = () => clamp(st.dist / SP.rampDist, 0, 1);
  // a lane change is a carve whose sideways speed is a fixed share of the forward speed
  const carveTime = (v) => clamp(L.width / (Math.max(v, 0.1) * L.carveRatio), L.carveMin, L.carveMax);
  function spawnRow(z) {
    if (st.playT >= st.nextCross) { st.nextCross = st.playT + rand(...SP.crossEvery); spawnCrossing(z); return; }
    const diff = difficulty();
    let k = 1; if (Math.random() < lerp(SP.twoLane[0], SP.twoLane[1], diff)) k++; if (Math.random() < lerp(SP.threeLane[0], SP.threeLane[1], diff)) k++;
    k = Math.min(k, L.count - 1);   // never block every lane
    // lanes that have had the fewest people so far are picked first (with some shuffle), so people spread evenly
    const lanes = LANE_X.map((_, i) => i).sort((a, b) => laneLoad[a] - laneLoad[b] + (Math.random() - 0.5) * 2.5).slice(0, k);
    let people = 0;
    for (const lane of lanes) { let type = wpick(SP.weights);
      if (SITTERS.has(type) && lane !== 0 && lane !== L.count - 1) type = 'ped';   // people sitting on the ground only in the outer lanes
      if (PEOPLE.has(type)) { if (people >= SP.maxPeoplePerRow) type = Math.random() < 0.5 ? 'cones' : 'can'; else { people++; laneLoad[lane]++; } }
      spawnObstacle(type, lane, z + (Math.random() - 0.5) * SP.rowJitter); }
  }
  function spawnAhead() { if (st.mode !== 'playing') return; while (nextRowZ > S.z - SP.ahead) { spawnRow(nextRowZ); nextRowZ -= rowGap(); } }

  // -------------------------------------------------------------------------------------
  // Speed, scoring, health/energy, state changes
  // -------------------------------------------------------------------------------------
  function targetSpeed() {
    if (st.mode === 'title') return G.speed.title;
    if (st.mode === 'over') return 0;
    return Math.min(G.speed.max, G.speed.start + G.speed.ramp * st.playT);
  }
  function popup(text, cls = '') { const d = document.createElement('div'); d.className = 'pop ' + cls; d.textContent = text; ui.pops.appendChild(d); setTimeout(() => d.remove(), 1300); }
  function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function breakCombo() { if (st.combo > 1 && st.mode === 'playing') popup('combo lost', 'bad'); st.combo = 0; st.comboT = 0; }
  function damage(n, label) {
    if (st.mode !== 'playing') return;
    st.health = Math.max(0, st.health - n); flash(ui.healthBar); popup(`${label}  −${n}`, 'bad');
    if (st.health <= 0) gameOver();
  }
  function startGame() {
    clearObstacles(); Object.assign(st, { mode: 'playing', paused: false, health: HP.max, energy: EN.max, score: 0, dist: 0, playT: 0, combo: 0, comboT: 0, inv: 0, overT: 0, newBest: false, nextCross: rand(...SP.crossFirst) });
    Object.assign(sk, { mode: 'ground', t: 0, y: 0, vy: 0, trick: null, tricks: [], jumpHeld: false, stumbleT: 0, queue: [], demoHold: undefined, stance: 1 });
    sk.speed = Math.max(sk.speed, G.speed.start * 0.8); nextRowZ = S.z - SP.startDelay;
    ui.pops.textContent = ''; showScreens();
  }
  function gameOver() {
    st.mode = 'over'; st.overT = 0; setMode('crash'); sk.queue.length = 0; sk.trick = null;
    st.score = Math.floor(st.score); if (st.score > best) { best = st.score; st.newBest = true; try { localStorage.setItem('vbSkaterBest', String(best)); } catch (e) { /* storage blocked */ } }
    ui.overScore.textContent = st.score.toLocaleString(); ui.overBest.textContent = best.toLocaleString(); ui.newBest.style.display = st.newBest ? '' : 'none';
  }
  function showScreens() {
    ui.title.classList.toggle('show', st.mode === 'title'); ui.over.classList.toggle('show', st.mode === 'over' && st.overT > G.overDelay);
    ui.pause.classList.toggle('show', st.paused); ui.hud.classList.toggle('show', st.mode !== 'title');
    ui.titleBest.textContent = best ? `Best ${best.toLocaleString()}` : '';
  }
  function setPaused(p) { if (st.mode !== 'playing') p = false; st.paused = p; showScreens(); }

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
  function chargeFrac() { return smooth(0, J.chargeTime, sk.chargeT); }
  // the jump's height picks the trick: a quick tap is a plain ollie, then kickflip → heelflip → hardflip → 360 flip → impossible
  function trickFor(f) { if (f < TR.ollieBelow) return null; const o = TR.order; return o[Math.min(o.length - 1, Math.floor((f - TR.ollieBelow) / (1 - TR.ollieBelow) * o.length))]; }
  function pop() {
    let f = chargeFrac();
    if (st.mode === 'playing') { f = Math.min(f, clamp((st.energy - EN.ollieMin) / (EN.ollieMax - EN.ollieMin), 0, 1)); st.energy -= ollieCost(f); }
    const h = lerp(J.minHeight, J.maxHeight, f);
    setMode('air'); sk.vy = Math.sqrt(2 * J.gravity * h); sk.y = 0; sk.airT = 0; sk.airDur = 2 * sk.vy / J.gravity; sk.jumpF = f; sk.jumpH = h;
    sk.tricks = []; sk.clearedThisJump = 0; sk.popStance = sk.stance;
    const type = trickFor(f); sk.trick = type ? { type, t: -TR.delay, dur: TR.durShare * sk.airDur - TR.delay } : null;   // always lands in time
  }
  // ↑/↓ in the air: swap which foot leads (regular ↔ switch); you land and keep riding that way
  function switchStance() { if (sk.mode === 'air') sk.stance = -sk.stance; }
  function pressJump() { if (sk.mode !== 'air' && sk.mode !== 'crash' && sk.mode !== 'charge') startCharge(); }
  function releaseJump() { sk.jumpHeld = false; }
  function pressLane(d) { if (st.mode !== 'over') sk.queue.push(d); }   // applied to the target lane next frame
  function slip() {
    if (sk.mode === 'slip' || sk.mode === 'crash') return;
    sk.slipSpeed = sk.speed; sk.slipApplied = false; setMode('slip');
  }
  function hit() {
    if (st.mode !== 'playing') return false;   // every obstacle you run into costs health (each one can only hit once)
    sk.speed *= G.speed.hitFactor; sk.stumbleT = H.stumbleTime; S.shake = H.shake; breakCombo(); damage(HP.hit, 'OUCH'); return true;
  }
  function land() {
    sk.y = 0; sk.vy = 0;
    if (sk.trick) {   // still flipping when the wheels touch down: wipe out
      sk.trick = null; setMode('bail'); sk.speed *= G.speed.bailFactor; breakCombo(); damage(HP.fall, 'WIPEOUT'); return;
    }
    setMode('land');
    if (st.mode !== 'playing') return;
    const over = sk.clearedThisJump > 0;
    let pts = Math.round(lerp(SC.ollieMin, SC.ollieMax, sk.jumpF) / 5) * 5; const names = [];
    for (const t of sk.tricks) { pts += TR[t].pts; names.push(TRICK_NAME[t]); }
    if (sk.stance !== sk.popStance) { pts += SC.switchBonus; names.push('SWITCH'); }   // changed feet in the air
    if (over) pts *= SC.overObstacle;
    const mult = Math.min(SC.comboMax, 1 + st.combo); pts *= mult; st.score += pts; st.combo++; st.comboT = SC.comboWindow;
    const label = names.length ? names.join(' + ') : (sk.jumpF > 0.7 ? 'BIG OLLIE' : 'OLLIE');
    popup(`${label}${over ? ' OVER' : ''} +${pts}${mult > 1 ? `  ×${mult}` : ''}`, names.length ? 'flip' : '');
  }

  function updateSkater(dt) {
    sk.t += dt; if (sk.stumbleT > 0) sk.stumbleT -= dt;
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
        if ((!sk.jumpHeld && sk.chargeT >= J.minCrouch) || sk.chargeT >= J.maxHold) pop(); break;
      case 'air':
        sk.airT += dt; sk.vy -= J.gravity * dt; sk.y += sk.vy * dt;
        if (sk.trick) { sk.trick.t += dt; if (sk.trick.t >= sk.trick.dur) { sk.tricks.push(sk.trick.type); sk.trick = null; } }
        if (sk.y <= 0) land();
        break;
      case 'land': if (sk.t >= J.landTime) setMode('ground'); break;
      case 'slip':
        if (!sk.slipApplied && sk.t >= J.coyote) { sk.slipApplied = true; sk.speed = sk.slipSpeed * G.speed.slipFactor; breakCombo(); S.shake = H.shake * 0.5; damage(HP.slip, 'SLIP'); }
        if (sk.t >= H.slipTime) setMode('ground'); break;
      case 'bail': if (sk.t >= H.bailTime) setMode('ground'); break;
    }
    // combo chain expires after a while on the ground without a trick
    if (st.combo > 0 && grounded()) { st.comboT -= dt; if (st.comboT <= 0) st.combo = 0; }
    return sk.lean;
  }

  function writePose(lean) {
    const P = S.pose; for (const k in P) P[k] = 0; P.flipping = false; P.lean = lean; P.stance = sk.stance;
    switch (sk.mode) {
      case 'charge': P.crouch = 0.25 + 0.5 * chargeFrac() * smooth(0, J.minCrouch, sk.chargeT) + 0.1 * smooth(0, J.minCrouch, sk.chargeT); break;
      case 'air': { const u = clamp(sk.airT / sk.airDur, 0, 1); P.air = sk.y; P.airN = clamp(sk.y / J.maxHeight, 0, 1);
        P.pitch = u < 0.35 ? Math.sin(u / 0.35 * Math.PI) * 0.42 : 0;
        P.crouch = lerp(-0.15, 0.3 + 0.25 * sk.jumpF, smooth(0.12, 0.55, u)) - 0.25 * smooth(0.8, 1, u);   // pop extends, legs tuck (more on big jumps), then reach for the ground
        const tr = sk.trick;
        if (tr && tr.t > 0) { const f = clamp(tr.t / tr.dur, 0, 1), e = smooth(0, 1, f), y = tr.type;
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
  function collide() {
    const sx0 = sk.x - SKB.w / 2, sx1 = sk.x + SKB.w / 2, sz0 = S.z - SKB.d / 2, sz1 = S.z + SKB.d / 2;
    for (const o of OBS) {
      if (o.done || (o.lane < 0 && !o.active)) continue;
      const ox0 = o.x - o.w / 2, ox1 = o.x + o.w / 2, oz0 = o.z - o.d / 2, oz1 = o.z + o.d / 2;
      if (oz0 > sz1) { o.done = true; if (o.cleared && st.mode === 'playing') { st.score += SC.clear; popup(`CLEAR +${SC.clear}`); } continue; }   // passed behind the skater
      if (ox1 < sx0 || ox0 > sx1 || oz1 < sz0 || oz0 > sz1) continue;
      if (o.clear !== null && sk.y > o.clear) { if (!o.cleared) sk.clearedThisJump++; o.cleared = true; continue; }
      o.done = true; o.cleared = false;
      if (o.kind === 'slip') slip(); else hit();
    }
  }

  // -------------------------------------------------------------------------------------
  // Hitbox debug (H)
  // -------------------------------------------------------------------------------------
  let debug = false; const helpers = [];
  const COLORS = { solid: 0xff3030, jump: 0xffa020, slip: 0xffe040, skater: 0x30e0ff };
  function helper(i) { let h = helpers[i]; if (!h) { h = new THREE.Box3Helper(new THREE.Box3(), 0xffffff); h.material.depthTest = false; h.renderOrder = 10; scene.add(h); helpers[i] = h; } h.visible = true; return h; }
  function drawHitboxes() {
    let n = 0;
    if (debug) {
      const h = helper(n++); h.box.min.set(sk.x - SKB.w / 2, sk.y, S.z - SKB.d / 2); h.box.max.set(sk.x + SKB.w / 2, sk.y + SKB.h, S.z + SKB.d / 2); h.material.color.setHex(COLORS.skater);
      for (const o of OBS) { if (o.lane < 0 && !o.active) continue; const b = helper(n++); b.box.min.set(o.x - o.w / 2, 0, o.z - o.d / 2); b.box.max.set(o.x + o.w / 2, o.h, o.z + o.d / 2);
        b.material.color.setHex(o.kind === 'slip' ? COLORS.slip : o.clear !== null ? COLORS.jump : COLORS.solid); }
    }
    for (let i = n; i < helpers.length; i++) helpers[i].visible = false;
  }

  // -------------------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------------------
  let hudT = 0;
  function update(dt) {
    if (st.paused) { writePose(sk.lean || 0); drawHitboxes(); return; }
    clock += dt;
    if (st.mode === 'playing') st.playT += dt;
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
    S.speed = sk.speed; S.moving = sk.speed > 0.05; S.z -= sk.speed * dt;
    if (st.mode === 'playing') { st.dist += sk.speed * dt; st.score += sk.speed * dt * SC.perMetre; st.energy = Math.min(EN.max, st.energy + EN.regen * dt); }

    const lean = updateSkater(dt);
    S.x = sk.x; S.camRoll = lean * L.camRoll;
    writePose(lean);

    // obstacles: spawn ahead, move pedestrians and crossing traffic, collide, recycle behind
    spawnAhead();
    for (const o of OBS) {
      if (o.lane < 0) updateCrossing(o, dt);
      else if (o.vz) { o.az += o.vz * dt; o.z = o.az + o.zOff; if (o.ped) o.ped.z = o.az; else o.mesh.position.z = o.az; }
    }
    if (st.mode === 'playing') collide();
    for (let i = OBS.length - 1; i >= 0; i--) if (OBS[i].z > S.z + SP.despawn) removeObstacle(i);

    S.shake = Math.max(0, (S.shake || 0) - dt);
    drawHitboxes();

    hudT -= dt;
    if (hudT <= 0) { hudT = 0.05;
      ui.score.textContent = Math.floor(st.score).toLocaleString();
      const mult = Math.min(SC.comboMax, 1 + st.combo); ui.combo.textContent = st.combo > 0 ? `×${mult} combo` : '';
      const hp = st.health / HP.max; ui.health.style.width = `${hp * 100}%`; ui.health.style.background = hp > 0.6 ? '#4cd964' : hp > 0.3 ? '#ffcc33' : '#ff4a4a';
      ui.energy.style.width = `${st.energy / EN.max * 100}%`;
      // while charging, the darker end of the bar shows what this jump will cost
      const cost = sk.mode === 'charge' && st.mode === 'playing' ? Math.min(st.energy, ollieCost(chargeFrac())) : 0;
      ui.energyCost.style.width = `${cost / EN.max * 100}%`; ui.energyCost.style.left = `${(st.energy - cost) / EN.max * 100}%`;
      ui.dist.textContent = `${Math.floor(st.dist * 3.28084).toLocaleString()} ft`; }
  }

  // -------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------
  const LEFT = ['ArrowLeft', 'a', 'A'], RIGHT = ['ArrowRight', 'd', 'D'], JUMP = ['ArrowUp', ' ', 'w', 'W'];
  function keydown(e) {
    const k = e.key;
    if (k === 'h' || k === 'H') { debug = !debug; return true; }
    if (st.paused) { if (k === 'Enter' || k === ' ' || k === 'Escape') { if (!e.repeat) setPaused(false); return true; } return LEFT.includes(k) || RIGHT.includes(k) || k === 'ArrowUp'; }
    if (st.mode === 'title') { if ((k === 'Enter' || k === ' ') && !e.repeat) { startGame(); return true; } return k === ' ' || k.startsWith('Arrow'); }
    if (st.mode === 'over') { if ((k === 'Enter' || k === ' ') && !e.repeat && st.overT > G.overDelay) startGame(); return k === ' ' || k.startsWith('Arrow') || k === 'Enter'; }
    if (k === 'Escape') { setPaused(true); return true; }
    if (LEFT.includes(k)) { if (!e.repeat) { sk.held[-1] = true; pressLane(-1); } return true; }
    if (RIGHT.includes(k)) { if (!e.repeat) { sk.held[1] = true; pressLane(1); } return true; }
    if ((k === 'ArrowUp' || k === 'ArrowDown') && sk.mode === 'air') { if (!e.repeat) switchStance(); return true; }
    if (k === 'ArrowDown') return true;
    if (JUMP.includes(k)) { if (!e.repeat) pressJump(); return true; }
    return false;
  }
  function keyup(e) { const k = e.key; if (LEFT.includes(k)) sk.held[-1] = false; if (RIGHT.includes(k)) sk.held[1] = false; if (JUMP.includes(k)) releaseJump(); }
  window.addEventListener('blur', () => { sk.held[-1] = sk.held[1] = false; sk.jumpHeld = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { sk.held[-1] = sk.held[1] = false; sk.jumpHeld = false; setPaused(true); } });

  showScreens();
  return {
    update, keydown, keyup,
    get paused() { return st.paused; }, get mode() { return st.mode; }, get debug() { return debug; },
    // test hooks
    st, sk, OBS, LANE_X, start: startGame, setPaused, kill() { st.health = 1; hit(); }, spawnObstacle, spawnCrossing, clearObstacles,
  };
}
