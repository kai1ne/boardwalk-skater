// =====================================================================================
// touch.js — touch controls: another source for game.js's named actions (press / release)
//
// Pointer Events with pointer capture, any number of fingers at once. Every finger gets one role when it touches down
// and keeps it until it lifts, wherever it slides:
//   dpad           started on the D-pad's hit area (zone 1): its direction presses laneLeft/laneRight/flipUp/flipDown
//                  exactly like the arrow keys (press on entering a direction, release on leaving it)
//   buffer-assist  started in the buffer ring (zone 2) or the re-landing guard ring, bufferMode "assist": a D-pad finger
//   buffer-ignored the same in bufferMode "ignore", or inside the dead zone: does nothing
//   jump           started on the game surface (zone 3) on the ground: holding Space (crouch), lifting = release
//   trick          started on the game surface in the air: one flipUp (upper part) or flipDown (lower part) tap; it is
//                  consumed, so still holding it after landing never crouches
//   title          a tap on the title screen starts a run (on lift)
//   ignored        everything else (a second D-pad or jump finger, a finger down while paused, ...)
// A finger in the buffer or guard rings can never jump or fire a trick tap. Every number is in GAME.touch.
// =====================================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DIRS = { left: 'laneLeft', right: 'laneRight', up: 'flipUp', down: 'flipDown' };
const AXIS = { right: 0, down: 90, left: 180, up: -90 };   // screen angles (y grows downward)
const angDiff = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return Math.abs(d); };

export function createTouch({ game, cfg: T }) {
  // ---- settings saved in this browser (pause menu → Controls); storage may be blocked, then they last for this visit
  const prefs = { leftHanded: !!T.leftHanded, size: T.size, bufferMode: T.bufferMode };
  try { const d = JSON.parse(localStorage.getItem(T.saveKey) || '{}');
    if (typeof d.leftHanded === 'boolean') prefs.leftHanded = d.leftHanded;
    if (T.sizes[d.size]) prefs.size = d.size;
    if (d.bufferMode === 'assist' || d.bufferMode === 'ignore') prefs.bufferMode = d.bufferMode; } catch (e) { /* defaults */ }
  const savePrefs = () => { try { localStorage.setItem(T.saveKey, JSON.stringify(prefs)); } catch (e) { /* in memory only */ } };

  // ---- DOM: a full-screen layer under every screen and button (it gets only touches that hit nothing else), the drawn
  // D-pad (it never takes events itself: the zones are hit-tested from its centre) and the pause button
  const layer = document.createElement('div'); layer.id = 'touchLayer'; document.body.prepend(layer);
  const pad = document.createElement('div'); pad.id = 'tDpad';
  pad.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="47"/>${
    ['up', 'right', 'down', 'left'].map((d, i) => `<g class="arr" data-dir="${d}" transform="rotate(${i * 90} 50 50)"><path d="M50 9 L66 28 L57 28 L57 36 L43 36 L43 28 L34 28 Z"/></g>`).join('')
  }<circle class="hub" cx="50" cy="50" r="7"/></svg>`;
  document.body.appendChild(pad);
  const arrows = {}; for (const g of pad.querySelectorAll('.arr')) arrows[g.dataset.dir] = g;
  const pauseBtn = document.createElement('button'); pauseBtn.id = 'tPause'; pauseBtn.type = 'button'; pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';
  pauseBtn.addEventListener('click', () => { if (game.mode === 'playing' && !game.paused) { releaseAll(); game.press('pause'); } });
  document.body.appendChild(pauseBtn);
  // the safe-area insets, read from a probe that is padded by env(safe-area-inset-*)
  const probe = document.createElement('div'); probe.id = 'tSafe'; document.body.appendChild(probe);

  // ---- layout (px), recomputed on every resize / orientation change / toolbar change
  const L = { vw: 0, vh: 0, D: 0, cx: 0, cy: 0, r: 0, hitR: 0, bufR: 0, guardR: 0, deadR: 0, inset: { l: 0, r: 0, t: 0, b: 0 } };
  function layout() {
    const vv = window.visualViewport, vw = vv ? vv.width : innerWidth, vh = vv ? vv.height : innerHeight, vmin = Math.min(vw, vh);
    const cs = getComputedStyle(probe); L.inset = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
    const D = Math.max(T.minSize, T.sizes[prefs.size] * vh), m = T.margin * vmin;
    Object.assign(L, { vw, vh, D, r: D / 2,
      cx: prefs.leftHanded ? vw - L.inset.r - m - D / 2 : L.inset.l + m + D / 2, cy: vh - L.inset.b - m - D / 2 });
    L.hitR = L.r + T.hitPadding * D; L.bufR = L.hitR + T.bufferPadding * D; L.guardR = L.bufR + T.guardPadding * D; L.deadR = T.deadZone * L.r;
    Object.assign(pad.style, { width: D + 'px', height: D + 'px', left: L.cx - D / 2 + 'px', top: L.cy - D / 2 + 'px', opacity: T.opacity });
    const pb = Math.max(T.pauseMin, T.pauseSize * vmin), pm = T.pauseMargin * vmin;
    Object.assign(pauseBtn.style, { width: pb + 'px', height: pb + 'px', top: L.inset.t + pm + 'px', left: prefs.leftHanded ? L.inset.l + pm + 'px' : '', right: prefs.leftHanded ? '' : L.inset.r + pm + 'px' });
    document.body.classList.toggle('lefty', !!prefs.leftHanded);
    document.documentElement.style.setProperty('--tPause', pb + pm + 'px');
  }
  window.addEventListener('resize', layout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => { releaseAll(); setTimeout(layout, 250); });

  // ---- touch UI appears with the first touch and stays
  let touchOn = false;
  function enableTouchUI() { if (touchOn) return; touchOn = true; document.body.classList.add('touch'); layout(); if (api.onEnable) api.onEnable(); }

  // ---- pointers
  const ptrs = new Map();   // pointerId → { id, role, x, y, x0, y0, t0, dir, half, consumed }
  let dpadLiftAt = -1e9, now = () => performance.now();
  const live = () => game.mode === 'playing' && !game.paused && !game.credits;
  const holder = (role) => { for (const p of ptrs.values()) if (p.role === role) return p; return null; };
  const isPad = (p) => p.role === 'dpad' || p.role === 'buffer-assist';
  // the zone a point is in: 'hit' (zone 1), 'buffer' (zone 2, or the guard ring just after a D-pad finger lifted), 'surface' (zone 3)
  function zoneAt(x, y) {
    const d = Math.hypot(x - L.cx, y - L.cy);
    if (d <= L.hitR) return 'hit';
    if (d <= L.bufR || (now() - dpadLiftAt < T.postReleaseGuard && d <= L.guardR)) return 'buffer';
    return 'surface';
  }
  function trickAt(p) { return p.y < T.trickSplitY * L.vh ? 'flipUp' : 'flipDown'; }   // the top counts as up
  function fireTrick(p) { p.consumed = true; game.press(trickAt(p), { win: T.doubleTapWindow }); }

  function down(e) {
    if (e.pointerType === 'mouse') return;   // the mouse never drives touch controls (desktop stays as it is)
    e.preventDefault(); enableTouchUI();
    try { layer.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already gone: the window listeners still follow it */ }
    const p = { id: e.pointerId, role: 'ignored', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now(), dir: null, consumed: false, repT: 0 };
    ptrs.set(p.id, p);
    if (game.mode === 'title' && !game.credits) { p.role = 'title'; return; }
    if (!live()) return;
    const z = zoneAt(p.x, p.y);
    if (z !== 'surface') {
      if (holder('dpad') || holder('buffer-assist')) return;   // one D-pad finger at a time
      if (z === 'hit') p.role = 'dpad';
      else p.role = prefs.bufferMode === 'assist' && Math.hypot(p.x - L.cx, p.y - L.cy) > L.deadR ? 'buffer-assist' : 'buffer-ignored';
      if (isPad(p)) steer(p);
      return;
    }
    // zone 3, the game surface
    if (game.airborne) { p.role = 'trick'; if (T.airTrickOn === 'down') fireTrick(p); return; }
    const la = game.landAt;   // a finger that came down in the last moments of the air, but got here after the landing frame
    if (la && e.timeStamp < la && e.timeStamp >= la - T.landingBuffer) { p.role = 'trick'; p.consumed = true; return; }
    if (holder('jump')) return;   // one jump finger at a time
    p.role = 'jump'; game.press('crouchJump');
  }
  function move(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (isPad(p)) steer(p);
  }
  function up(e) { const p = ptrs.get(e.pointerId); if (p) end(p, e.type === 'pointercancel'); }
  function end(p, cancelled) {
    if (isPad(p)) { setDir(p, null); dpadLiftAt = now(); }
    else if (p.role === 'buffer-ignored') dpadLiftAt = now();
    else if (p.role === 'jump') { if (cancelled) game.cancelCharge(); else game.release('crouchJump'); }
    else if (p.role === 'trick' && !p.consumed && !cancelled && T.airTrickOn === 'up' && game.airborne) fireTrick(p);
    else if (p.role === 'title' && !cancelled && game.mode === 'title' && !game.credits && now() - p.t0 < T.tapMaxMs && Math.hypot(p.x - p.x0, p.y - p.y0) < T.tapSlop * Math.min(L.vw, L.vh)) game.press('confirm');
    ptrs.delete(p.id);
  }
  // let go of everything (pause, rotation, a lost window, a cancelled touch): no crouch or direction is ever left held
  function neutralize(p) {
    if (isPad(p)) setDir(p, null); else if (p.role === 'jump') game.cancelCharge();
    if (p.role !== 'title') p.role = 'ignored';
  }
  function releaseAll() { for (const p of ptrs.values()) neutralize(p); }
  function endAll(cancelled = true) { for (const p of [...ptrs.values()]) end(p, cancelled); }

  // ---- D-pad direction: the angle from the D-pad centre, with a dead zone in the middle and hysteresis at the edges of
  // each direction, so a thumb sliding round the pad changes direction cleanly (release the old action, press the new)
  function steer(p) {
    const dx = p.x - L.cx, dy = p.y - L.cy, r = Math.hypot(dx, dy);
    if (r < (p.dir ? L.deadR * (1 - T.deadZoneHysteresis) : L.deadR)) return setDir(p, null);
    const a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (p.dir && angDiff(a, AXIS[p.dir]) <= 45 + T.hysteresis) return;   // still inside the held direction (plus hysteresis)
    let best = null, bd = 1e9; for (const d in AXIS) { const v = angDiff(a, AXIS[d]); if (v < bd) { bd = v; best = d; } }
    if (T.diagonalMode !== 'nearest' && bd > 45 - T.diagonalBand) {   // near a diagonal: prefer one axis
      const horiz = Math.abs(dx) > 0 ? (dx > 0 ? 'right' : 'left') : best, vert = dy > 0 ? 'down' : 'up';
      best = T.diagonalMode === 'horizontal' ? horiz : vert; }
    setDir(p, best);
  }
  function setDir(p, d) {
    if (p.dir === d) return;
    if (p.dir) { game.release(DIRS[p.dir]); arrows[p.dir].classList.remove('on'); }
    p.dir = d;
    if (d) { arrows[d].classList.add('on'); pressDir(d); p.repT = now() + T.repeatDelay; }
  }
  const pressDir = (d) => (d === 'up' || d === 'down' ? game.press(DIRS[d], { win: T.doubleTapWindow }) : game.press(DIRS[d]));

  layer.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  layer.addEventListener('lostpointercapture', (e) => { const p = ptrs.get(e.pointerId); if (p) end(p, true); });
  // browser gestures off on the game surface: no double-tap zoom, long-press callout or menu, pinch, pull-to-refresh
  layer.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });   // Safari pinch
  window.addEventListener('touchcancel', (e) => { if (!e.touches.length) endAll(); }, { passive: true });
  window.addEventListener('touchend', (e) => { if (!e.touches.length && ptrs.size) endAll(false); }, { passive: true });   // safety net: no finger left on the glass
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // ---- per frame: let go when the game stops taking input, repeat a held lane direction if configured, show/hide the UI
  let shown = null;
  function tick() { requestAnimationFrame(tick); frame(); }
  function frame() {
    const on = live();
    if (!on) releaseAll();
    else if (T.repeat) for (const p of ptrs.values()) if (isPad(p) && (p.dir === 'left' || p.dir === 'right') && now() >= p.repT) { pressDir(p.dir); p.repT = now() + T.repeatInterval; }
    const vis = touchOn && on;
    if (vis !== shown) { shown = vis; document.body.classList.toggle('tplay', vis); }
    if (api.onFrame) api.onFrame();
  }
  // ---- pause menu (touch only): Resume, and Controls: which side the D-pad is on, its size, what edge touches do
  const $ = (id) => document.getElementById(id), SIZES = Object.keys(T.sizes);
  function menuLabels() {
    if ($('tSide')) $('tSide').textContent = `D-pad: ${prefs.leftHanded ? 'right' : 'left'}`;
    if ($('tSize')) $('tSize').textContent = `Size: ${prefs.size}`;
    if ($('tBuf')) $('tBuf').textContent = `Edges: ${prefs.bufferMode}`;
  }
  const onBtn = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', () => { fn(); menuLabels(); }); };
  onBtn('tResume', () => { if (game.paused) game.press('pause'); });
  onBtn('tSide', () => api.setPref('leftHanded', !prefs.leftHanded));
  onBtn('tSize', () => api.setPref('size', SIZES[(SIZES.indexOf(prefs.size) + 1) % SIZES.length]));
  onBtn('tBuf', () => api.setPref('bufferMode', prefs.bufferMode === 'assist' ? 'ignore' : 'assist'));
  menuLabels();

  layout(); requestAnimationFrame(tick);

  const api = {
    prefs, layout: L, pointers: ptrs, relayout: layout, releaseAll, frame, get on() { return touchOn; }, enableTouchUI,
    get dpadDir() { for (const p of ptrs.values()) if (isPad(p) && p.dir) return p.dir; return null; },
    get guardActive() { return now() - dpadLiftAt < T.postReleaseGuard; },
    setPref(k, v) { prefs[k] = v; savePrefs(); layout(); menuLabels(); },
    onEnable: null, onFrame: null,
  };
  return api;
}
