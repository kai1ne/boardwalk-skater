// =====================================================================================
// touch-debug.js — the touch debug overlay (?debug=1 in the URL, or T on a keyboard). Loaded only when asked for.
//
// Draws every finger with its role, the D-pad centre, the three zones (hit area, buffer ring, guard ring, the guard
// solid while it is active), the trick split line, and lists the D-pad direction, the named actions, charge and crouch,
// air state, quality tier, frame rate and pixel ratio. TUNE opens live sliders for the GAME.touch values; PRINT shows
// them as text (and copies them where the browser allows) so they can be sent back.
// =====================================================================================
const ROLE_COL = { dpad: '#45c8ff', 'buffer-assist': '#7fe3ff', 'buffer-ignored': '#ff8a8a', jump: '#4cd964', trick: '#ffd84a', title: '#ffffff', ignored: '#888888' };
const SLIDERS = [   // [key, label, min, max, step]; 'size' edits the current D-pad size's share of the screen height
  ['size', 'D-pad size (× height)', 0.12, 0.36, 0.01], ['marginX', 'side gap (× short side)', 0, 0.35, 0.01], ['hitPadding', 'hitPadding (× D)', 0, 0.6, 0.02], ['bufferPadding', 'bufferPadding (× D)', 0, 1, 0.02],
  ['guardPadding', 'guardPadding (× D)', 0, 1, 0.02], ['postReleaseGuard', 'postReleaseGuard ms', 0, 800, 10], ['deadZone', 'dead zone (× radius)', 0, 0.8, 0.01],
  ['repeatDelay', 'repeatDelay ms', 50, 800, 10], ['repeatInterval', 'repeatInterval ms', 50, 600, 10], ['doubleTapWindow', 'doubleTapWindow s', 0.1, 0.6, 0.01],
  ['trickSplitY', 'trickSplitY (× height)', 0.2, 0.8, 0.01],
];
const CHOICES = [['bufferMode', ['assist', 'ignore']], ['airTrickOn', ['down', 'up']], ['repeat', [false, true]], ['diagonalMode', ['nearest', 'horizontal', 'vertical']]];

export function createTouchDebug({ game, touch, cfg: T }) {
  const cv = document.createElement('canvas'); cv.id = 'tDbgCanvas'; document.body.appendChild(cv);
  const g = cv.getContext('2d');
  const info = document.createElement('pre'); info.id = 'tDbgInfo'; document.body.appendChild(info);
  const tuneBtn = document.createElement('button'); tuneBtn.id = 'tDbgTune'; tuneBtn.type = 'button'; tuneBtn.textContent = 'Tune'; document.body.appendChild(tuneBtn);
  const panel = document.createElement('div'); panel.id = 'tDbgPanel'; document.body.appendChild(panel);
  const style = document.createElement('style');
  style.textContent = `#tDbgCanvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 30; }
    #tDbgInfo { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top) + 6px); margin: 0; padding: 6px 9px; z-index: 31; pointer-events: none;
      background: rgba(0,0,0,.6); color: #fff; border-radius: 6px; font: bold 11px/1.4 ui-monospace, Menlo, monospace; white-space: pre; }
    #tDbgTune { position: fixed; z-index: 32; right: calc(env(safe-area-inset-right) + 8px); top: 50%; transform: translateY(-50%); min-height: 40px; padding: 6px 16px;
      border-radius: 6px; border: 2px solid #ffd84a; background: rgba(0,0,0,.6); color: #ffd84a; font: bold 13px "Trebuchet MS", sans-serif; letter-spacing: 2px; text-transform: uppercase; touch-action: manipulation; }
    #tDbgPanel { display: none; position: fixed; z-index: 32; right: calc(env(safe-area-inset-right) + 90px); top: 50%; transform: translateY(-50%); width: min(520px, 70vw);
      max-height: 86vh; overflow-y: auto; touch-action: pan-y; background: rgba(8,10,14,.9); color: #fff; border-radius: 10px; padding: 10px 12px; font: 12px/1.3 ui-monospace, Menlo, monospace; text-transform: none; }
    #tDbgPanel.show { display: block; } #tDbgPanel label { display: grid; grid-template-columns: 11em 1fr 4em; gap: 8px; align-items: center; margin: 4px 0; }
    #tDbgPanel input[type=range] { width: 100%; touch-action: none; height: 28px; } #tDbgPanel .row { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
    #tDbgPanel button { min-height: 36px; padding: 4px 10px; border-radius: 6px; border: 1px solid #ffd84a; background: #111; color: #ffd84a; font: bold 12px ui-monospace, Menlo, monospace; touch-action: manipulation; }
    #tDbgPanel button.on { background: #ffd84a; color: #111; } #tDbgPanel textarea { width: 100%; height: 9em; box-sizing: border-box; font: 11px ui-monospace, Menlo, monospace; -webkit-user-select: text; user-select: text; }`;
  document.head.appendChild(style);

  // ---- the tuning panel
  const get = (k) => (k === 'size' ? T.sizes[touch.prefs.size] : k === 'bufferMode' ? touch.prefs.bufferMode : T[k]);
  function set(k, v) {
    if (k === 'size') T.sizes[touch.prefs.size] = v;
    else if (k === 'bufferMode') touch.setPref('bufferMode', v);
    else T[k] = v;
    touch.relayout();
  }
  const out = document.createElement('textarea'); out.readOnly = true; out.style.display = 'none';
  for (const [k, label, min, max, step] of SLIDERS) {
    const row = document.createElement('label'), val = document.createElement('span'), r = document.createElement('input');
    row.append(label); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = get(k); val.textContent = get(k);
    r.addEventListener('input', () => { set(k, +r.value); val.textContent = r.value; });
    row.append(r, val); panel.appendChild(row);
  }
  for (const [k, opts] of CHOICES) {
    const row = document.createElement('div'); row.className = 'row'; row.append(k + ':');
    const btns = opts.map((o) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = String(o); b.addEventListener('click', () => { set(k, o); paint(); }); row.appendChild(b); return [o, b]; });
    const paint = () => { for (const [o, b] of btns) b.classList.toggle('on', get(k) === o); }; paint(); panel.appendChild(row);
  }
  const tools = document.createElement('div'); tools.className = 'row';
  const printBtn = document.createElement('button'); printBtn.type = 'button'; printBtn.textContent = 'Print values';
  printBtn.addEventListener('click', () => {
    const v = { size: touch.prefs.size, sizes: { ...T.sizes }, leftHanded: touch.prefs.leftHanded };
    for (const [k] of SLIDERS) if (k !== 'size') v[k] = T[k];
    for (const [k] of CHOICES) v[k] = get(k);
    const text = 'GAME.touch tuning: ' + JSON.stringify(v);
    console.log(text); out.value = text; out.style.display = 'block'; out.focus(); out.select();
    try { navigator.clipboard.writeText(text).then(() => { printBtn.textContent = 'Copied'; setTimeout(() => (printBtn.textContent = 'Print values'), 1500); }, () => {}); } catch (e) { /* select and copy by hand */ }
  });
  tools.appendChild(printBtn); panel.append(tools, out);
  tuneBtn.addEventListener('click', () => panel.classList.toggle('show'));

  // ---- drawing
  function circle(x, y, r, col, dash, width = 2) { g.beginPath(); g.setLineDash(dash || []); g.strokeStyle = col; g.lineWidth = width; g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
  let fpsT = 0, fpsN = 0, fpsShown = 0, last = performance.now();
  function frame(on) {
    for (const el of [cv, info, tuneBtn]) el.style.display = on ? '' : 'none';
    if (!on) { panel.classList.remove('show'); return; }
    const now = performance.now(); fpsT += now - last; fpsN++; last = now; if (fpsT > 500) { fpsShown = fpsN * 1000 / fpsT; fpsT = 0; fpsN = 0; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = innerWidth, h = innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const L = touch.layout;
    // zones: hit area, buffer ring, guard ring (solid while the post-release guard is active), dead zone; D-pad centre
    circle(L.cx, L.cy, L.r, 'rgba(255,255,255,.5)', [2, 4], 1);
    circle(L.cx, L.cy, L.hitR, '#45c8ff');
    circle(L.cx, L.cy, L.bufR, touch.prefs.bufferMode === 'assist' ? '#7fe3ff' : '#ff8a8a', [8, 5]);
    circle(L.cx, L.cy, L.guardR, touch.guardActive ? '#ff5050' : 'rgba(255,80,80,.55)', touch.guardActive ? [] : [3, 6], touch.guardActive ? 3 : 2);
    circle(L.cx, L.cy, L.deadR, 'rgba(255,255,255,.6)', [2, 3], 1);
    g.setLineDash([]); g.fillStyle = '#fff'; g.beginPath(); g.arc(L.cx, L.cy, 3, 0, 7); g.fill();
    // trick split line
    const sy = T.trickSplitY * L.vh; g.setLineDash([10, 8]); g.strokeStyle = 'rgba(255,216,74,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, sy); g.lineTo(w, sy); g.stroke(); g.setLineDash([]);
    g.font = 'bold 11px ui-monospace, Menlo, monospace'; g.fillStyle = 'rgba(255,216,74,.95)'; g.fillText('↑ flipUp', w - 90, sy - 6); g.fillText('↓ flipDown', w - 90, sy + 14);
    // fingers
    for (const p of touch.pointers.values()) {
      const col = ROLE_COL[p.role] || '#fff';
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x0, p.y0); g.lineTo(p.x, p.y); g.stroke();
      g.fillStyle = col + '55'; g.beginPath(); g.arc(p.x, p.y, 26, 0, 7); g.fill(); circle(p.x, p.y, 26, col, null, 3);
      const label = `${p.id} ${p.role}${p.dir ? ' ' + p.dir : ''}${p.consumed ? ' (used)' : ''}`;
      g.font = 'bold 12px ui-monospace, Menlo, monospace'; const tw = g.measureText(label).width;
      g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(p.x - tw / 2 - 4, p.y - 50, tw + 8, 17); g.fillStyle = col; g.fillText(label, p.x - tw / 2, p.y - 37);
      g.fillStyle = '#fff'; g.fillText(`${Math.round(p.x)},${Math.round(p.y)}`, p.x - 22, p.y + 44);
    }
    // text
    const sk = game.sk, vb = window.__vb || {}, held = [];
    if (sk.held[-1]) held.push('laneLeft'); if (sk.held[1]) held.push('laneRight'); if (sk.jumpHeld) held.push('crouchJump');
    const rec = game.recent.filter((r) => now - r.t < 1500).map((r) => `${r.a}${r.src === 'touch' ? '·t' : '·k'}`).join(' ');
    const charge = game.charge;
    info.textContent = `D-pad ${touch.dpadDir || '-'}  guard ${touch.guardActive ? 'ON' : 'off'}  fingers ${touch.pointers.size}\n` +
      `held ${held.join(' ') || '-'}\nrecent ${rec || '-'}\n` +
      `state ${sk.mode}${game.airborne ? ' (air)' : ''}  charge ${charge.toFixed(2)}  crouch ${((game.pose && game.pose.crouch) || 0).toFixed(2)}\n` +
      `tier ${vb.tier || '?'}  ${fpsShown.toFixed(0)} fps  pr ${(vb.dbg ? vb.dbg.renderer.getPixelRatio() : 0).toFixed(2)}  ${w}×${h}`;
  }
  return { frame };
}
