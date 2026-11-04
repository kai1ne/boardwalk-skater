// =====================================================================================
// sfx.js — sound effects made in code (Web Audio synthesis, no files) and the ambience bed (small CC0 recordings)
//
// Created by audio.js on the first key press, on the same AudioContext as the music. Everything here plays into
// two inputs audio.js provides: `out` (effects) and `amb` (ambience), which share the SFX volume, the pause fade,
// the M mute and the master limiter with the music.
//
// One-shots are built from a few short-lived nodes (a noise burst or an oscillator → filter → envelope gain); they
// are only made when something happens, never per frame. The continuous sounds (wheels, charge tone) are built once
// and only have their parameters steered. Voices are capped in two pools (effects, performers): when a pool is
// full a new sound is skipped rather than cutting one off, so there are no clicks from stolen voices.
// Positional sounds (bells, dogs, flash, performers) use a PannerNode each; the listener stays at the origin facing
// −z (the defaults), and the game passes positions relative to the skater: x to the right, z ahead negative.
// =====================================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + (b - a) * Math.random();
const semis = (n) => Math.pow(2, n / 12);

export function createSfx({ ctx, out, amb, cfg: X, duck }) {
  const sr = ctx.sampleRate;
  // one shared 2 s white-noise buffer: every noise layer starts at a random offset in it
  const noiseBuf = ctx.createBuffer(1, sr * 2, sr); { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  // ---------------------------------------------------------------- voices
  const pools = { fx: { n: 0, max: X.maxVoices }, perf: { n: 0, max: X.performers.maxVoices } };
  let dropped = 0;
  const take = (pool, k) => { const p = pools[pool]; if (p.n + k > p.max) { dropped++; return false; } p.n += k; return true; };
  // an envelope on a fresh gain: silence → peak in `a` s, held `hold` s, then an exponential tail (time constant d/4).
  // The source is stopped at 1.6·d into the tail (< 0.2% of the peak left), so nothing ends with a step.
  function env(dest, t, a, peak, d, hold = 0) {
    // value = 0 as well: before its first event a new gain is 1, which leaks one sample of a source that starts between samples
    const g = ctx.createGain(), p = g.gain; p.value = 0; p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
    if (hold) p.setValueAtTime(peak, t + a + hold); p.setTargetAtTime(0, t + a + hold, d / 4); g.connect(dest); return g;
  }
  const endOf = (t, o) => t + o.a + (o.hold || 0) + o.d * 1.6;
  function finish(src, pool, g, end) { src.stop(end); src.onended = () => { pools[pool].n--; g.disconnect(); }; }
  // a filtered noise layer: o = { f, f2 (sweep target), sweep (s), type, q, a, d, peak, hold }
  function noise(dest, t, o, pool = 'fx') {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1; f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.sweep || o.a + o.d));
    const g = env(dest, t, o.a, o.peak, o.d, o.hold); s.connect(f).connect(g);
    s.start(t, Math.random() * 1.4); finish(s, pool, g, endOf(t, o));
  }
  // an oscillator layer: o = { wave, f, f2, sweep, a, d, peak, hold, lp (optional low-pass), lp2, vib (Hz depth), vibRate }
  function tone(dest, t, o, pool = 'fx') {
    const s = ctx.createOscillator(); s.type = o.wave || 'sine'; s.frequency.setValueAtTime(o.f, t);
    if (o.f2) s.frequency.exponentialRampToValueAtTime(o.f2, t + (o.sweep || o.a + o.d));
    const g = env(dest, t, o.a, o.peak, o.d, o.hold); let n = s;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5; f.frequency.setValueAtTime(o.lp, t); if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + (o.lpT || o.d)); n = n.connect(f); }
    n.connect(g); const end = endOf(t, o);
    if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vibRate || 28; lg.gain.value = o.vib; l.connect(lg).connect(s.frequency); l.start(t); l.stop(end); }
    s.start(t); finish(s, pool, g, end);
  }
  // a short-lived output for one positioned sound; it disconnects itself when the sound is over
  function spot(x, z, life, y = 1) {
    const p = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: X.positional.refDistance, rolloffFactor: X.positional.rolloff, maxDistance: 200, positionX: x, positionY: y, positionZ: z });
    p.connect(out); setTimeout(() => p.disconnect(), life * 1000 + 200); if (log) log.push({ at: +ctx.currentTime.toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2) }); return p;
  }
  function side(pan, life) { const p = new StereoPannerNode(ctx, { pan: clamp(pan, -1, 1) }); p.connect(out); setTimeout(() => p.disconnect(), life * 1000 + 200); return p; }
  let log = null;   // test hook: positions of the positioned one-shots

  // ---------------------------------------------------------------- continuous: wheels and the charge tone
  // wheels: the recorded skateboard-on-pavement loop (assets/sfx/roll-pavement.mp3), louder and a touch faster with
  // speed; a low noise rumble stands in until the file has loaded. Cut the moment the board leaves the ground, back on landing
  const R = X.roll, roll = { src: ctx.createBufferSource(), lp: ctx.createBiquadFilter(), rg: ctx.createGain(), rec: null, recG: null, on: false };
  roll.src.buffer = noiseBuf; roll.src.loop = true; roll.lp.type = 'lowpass'; roll.lp.frequency.value = R.rumbleHz; roll.lp.Q.value = 0.7;
  roll.rg.gain.value = 0; roll.src.connect(roll.lp).connect(roll.rg).connect(out); roll.src.start();
  function startRollLoop(b) { roll.rec = ctx.createBufferSource(); roll.rec.buffer = makeLoop(b, R.loopFade); roll.rec.loop = true;
    roll.recG = ctx.createGain(); roll.recG.gain.value = 0; roll.rec.connect(roll.recG).connect(out); roll.rec.start(ctx.currentTime, Math.random() * roll.rec.buffer.duration);
    roll.rg.gain.cancelScheduledValues(ctx.currentTime); roll.rg.gain.setTargetAtTime(0, ctx.currentTime, 0.05); }
  // charge: a soft triangle whose pitch rises continuously with the crouch while Space is held
  const C = X.charge, charge = { osc: ctx.createOscillator(), lp: ctx.createBiquadFilter(), g: ctx.createGain(), on: false };
  charge.osc.type = 'triangle'; charge.osc.frequency.value = C.from; charge.lp.type = 'lowpass'; charge.lp.frequency.value = 1400; charge.g.gain.value = 0;
  charge.osc.connect(charge.lp).connect(charge.g).connect(out); charge.osc.start();
  const glide = (param, v, tau) => param.setTargetAtTime(v, ctx.currentTime, tau);

  // ---------------------------------------------------------------- performers (positioned loops, scheduled ahead)
  const P = X.performers, act = [];
  // each instrument hit takes its voices from the performers' pool first; a full pool skips the hit
  const kick = (d, t, l) => { if (take('perf', 1)) tone(d, t, { f: 125, f2: 42, sweep: 0.11, a: 0.002, d: 0.22, peak: l }, 'perf'); };
  const snare = (d, t, l) => { if (!take('perf', 2)) return; noise(d, t, { f: 1900, q: 0.7, a: 0.001, d: 0.13, peak: l * 0.7 }, 'perf'); tone(d, t, { wave: 'triangle', f: 200, f2: 160, a: 0.001, d: 0.06, peak: l * 0.35 }, 'perf'); };
  const hat = (d, t, l) => { if (take('perf', 1)) noise(d, t, { type: 'highpass', f: 7000, q: 0.7, a: 0.001, d: 0.03, peak: l * 0.28 }, 'perf'); };
  const pluck = (d, t, f, l) => { if (take('perf', 1)) tone(d, t, { wave: 'sawtooth', f, a: 0.003, d: 0.75, peak: l, lp: 3200, lp2: 450, lpT: 0.45 }, 'perf'); };
  const key = (d, t, f, l, len = 0.9) => { if (take('perf', 1)) tone(d, t, { wave: 'triangle', f, a: 0.004, d: len, peak: l }, 'perf'); };
  const bass = (d, t, f, l) => { if (take('perf', 1)) tone(d, t, { wave: 'triangle', f, a: 0.005, d: 0.3, peak: l }, 'perf'); };
  // djembe strokes: B = bass (open low thump), T = tone (ringing mid), S = slap (bright crack); `size` sets each drum's pitch
  const djembe = (d, t, kind, v, size = 1) => { if (!take('perf', 2)) return;
    if (kind === 'B') { tone(d, t, { f: 88 * size, f2: 62 * size, sweep: 0.09, a: 0.002, d: 0.26, peak: v }, 'perf'); noise(d, t, { type: 'lowpass', f: 320, a: 0.001, d: 0.05, peak: v * 0.35 }, 'perf'); }
    else if (kind === 'T') { tone(d, t, { f: 340 * size, f2: 305 * size, sweep: 0.05, a: 0.001, d: 0.13, peak: v * 0.55 }, 'perf'); noise(d, t, { f: 650 * size, q: 2.2, a: 0.001, d: 0.06, peak: v * 0.45 }, 'perf'); }
    else { noise(d, t, { f: 2300 * size, q: 1.1, a: 0.001, d: 0.05, peak: v * 0.75 }, 'perf'); tone(d, t, { wave: 'triangle', f: 540 * size, a: 0.001, d: 0.045, peak: v * 0.3 }, 'perf'); } };
  // a drum circle: one interlocking part per player (4 to 6), each on its own drum, a little loose in time and touch
  const CIRCLE = [
    { p: 'B..TT.B.B..TT...', size: 1, v: 1 }, { p: '..S..S....S..S.S', size: 0.94, v: 0.85 }, { p: 'T.TT.T.TT.TT.T.T', size: 1.1, v: 0.45 },
    { p: 'B.......B..B....', size: 0.84, v: 0.9 }, { p: '....S.......S.S.', size: 1.04, v: 0.7 }, { p: 'T..T..T..T..T.T.', size: 0.98, v: 0.5 } ];
  const CH = { G: [98, 196, 247, 294], C: [131, 196, 262, 330], D: [147, 220, 294, 370], Em: [82, 165, 196, 247], Am: [110, 220, 262, 330], F: [87, 175, 220, 262] };
  const ACTS = {
    // a bucket drummer: low bucket hits, rim cracks, a busy off-beat
    drum: { bpm: 104, steps: 16, play(d, s, t) { const L = P.level; if ([0, 3, 6, 8, 11, 14].includes(s)) kick(d, t, L * (s % 8 === 0 ? 1 : 0.7)); if (s === 4 || s === 12) snare(d, t, L); if (s % 2 === 1) hat(d, t, L * (s % 4 === 3 ? 1 : 0.6)); } },
    // an acoustic-ish strum: G C D Em, a down/up pattern in eighths
    guitar: { bpm: 100, steps: 32, play(d, s, t) { const ch = CH[['G', 'C', 'D', 'Em'][s >> 3]], k = s & 7; if (![0, 3, 4, 6].includes(k)) return;
      const up = k === 3 || k === 6, notes = up ? ch.slice(1).reverse() : ch; notes.forEach((f, i) => pluck(d, t + i * 0.013, f * 2, P.level * (up ? 0.25 : 0.33))); } },
    // a keyboard on a stand: C Am F G, bass note then a broken chord
    piano: { bpm: 84, steps: 32, play(d, s, t) { const ch = CH[['C', 'Am', 'F', 'G'][s >> 3]], k = s & 7;
      if (k === 0) key(d, t, ch[0], P.level * 0.5, 1.4); else key(d, t, ch[[1, 2, 3, 2, 1, 2, 3][k - 1]] * 2, P.level * 0.3, 0.7); } },
    // hand drums in a circle by the boardwalk (h.n players)
    drumCircle: { bpm: 112, steps: 16, play(d, s, t, h) { const L = P.circleLevel;
      for (let k = 0; k < Math.min(h.n, CIRCLE.length); k++) { const c = CIRCLE[k]; let st = c.p[s];
        if (st === '.' && k === 1 && Math.random() < 0.06) st = 'S';   // now and then an extra slap
        if (st !== '.' && Math.random() > 0.04) djembe(d, t + Math.random() * 0.012, st, L * c.v * rand(0.8, 1.05), c.size); } } },
    // breakdancers' boombox: boom-bap with a bass line, through a small speaker
    breakdance: { bpm: 92, steps: 16, speaker: true, play(d, s, t) { const L = P.level;
      if (s === 0 || s === 7 || s === 10) { kick(d, t, L); bass(d, t, s === 10 ? 49 : 55, L * 0.6); }
      if (s === 4 || s === 12) snare(d, t, L); if (s % 2 === 0) hat(d, t, L * 0.8); } },
  };
  function performer(kind, n = 4) {
    const A = ACTS[kind]; if (!A || act.length >= P.max) return null;
    const p = new PannerNode(ctx, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: X.positional.refDistance, rolloffFactor: X.positional.rolloff, maxDistance: 200, positionZ: -60 });
    const g = ctx.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    let input = g; if (A.speaker) { const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85; lp.type = 'lowpass'; lp.frequency.value = 3500; hp.connect(lp).connect(g); input = hp; }
    g.connect(p).connect(out);
    const h = { kind, A, p, g, input, n, step: 0, next: ctx.currentTime + 0.1, dt: 60 / A.bpm / 4 * (A.steps === 32 ? 2 : 1) };
    act.push(h); return h;
  }
  function place(h, x, z) { if (!h) return; h.p.positionX.value = x; h.p.positionY.value = 1; h.p.positionZ.value = z; }
  function release(h) { const i = act.indexOf(h); if (i < 0) return; act.splice(i, 1); const t = ctx.currentTime; h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(h.g.gain.value, t); h.g.gain.linearRampToValueAtTime(0, t + 0.3); setTimeout(() => h.p.disconnect(), 1500); }
  function schedule() { const until = ctx.currentTime + 0.12; for (const h of act) while (h.next < until) { h.A.play(h.input, h.step, h.next, h); h.step = (h.step + 1) % h.A.steps; h.next += h.dt; } }

  // ---------------------------------------------------------------- ambience bed (CC0 files, loaded on first key press)
  const B = X.ambience, buf = {}, bed = { waves: null, crowd: null, wavesLP: null, mixT: 0, gullT: 0, barkT: 0, w: null };
  // a seamless loop: the last `xf` s are folded onto the start with an equal-power crossfade, so the seam can't click
  function makeLoop(b, xf) {
    const n = Math.min(Math.floor(xf * b.sampleRate), b.length >> 2), L = b.length - n, o = ctx.createBuffer(1, L, b.sampleRate), s = b.getChannelData(0), d = o.getChannelData(0);
    for (let i = 0; i < L; i++) d[i] = s[i];
    for (let i = 0; i < n; i++) { const u = i / n; d[i] = s[i] * Math.sin(u * Math.PI / 2) + s[L + i] * Math.cos(u * Math.PI / 2); }
    return o;
  }
  const ambLoaded = Promise.all(Object.entries(B.files).map(([k, f]) => fetch(B.folder + f).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((a) => ctx.decodeAudioData(a)).then((b) => { buf[k] = b; }).catch((e) => console.warn(`ambience: couldn't load ${f} (${e.message || e}); carrying on without it`)))).then(startBed);
  function loop(b, dest) { const s = ctx.createBufferSource(); s.buffer = makeLoop(b, B.loopFade); s.loop = true; const g = ctx.createGain(); g.gain.value = 0; s.connect(g).connect(dest); s.start(ctx.currentTime, Math.random() * s.buffer.duration); return { s, g }; }
  function startBed() {
    bed.wavesLP = ctx.createBiquadFilter(); bed.wavesLP.type = 'lowpass'; bed.wavesLP.Q.value = 0.5; bed.wavesLP.frequency.value = 1000; bed.wavesLP.connect(amb);
    if (buf.waves) bed.waves = loop(buf.waves, bed.wavesLP);
    if (buf.crowd) bed.crowd = loop(buf.crowd, amb);
    if (buf.roll) startRollLoop(buf.roll);
    const now = ctx.currentTime; bed.gullT = now + rand(2, 6); bed.barkT = now + rand(15, 40); bed.ready = true;
  }
  function oneShot(b, dest, gain, rate = 1, t = ctx.currentTime) { if (!b || !take('fx', 1)) return; const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; const g = ctx.createGain(); g.gain.value = gain; s.connect(g).connect(dest); s.start(t); s.onended = () => { pools.fx.n--; g.disconnect(); }; }
  // the bed's mix for the current weather: the PHASES row and the next one, blended the way the lighting is
  const mixOf = (i, b) => { const A = B.phases[i % 4], Z = B.phases[(i + 1) % 4], m = bed.m || (bed.m = {}); for (const k in A) m[k] = lerp(A[k], Z[k], b); return m; };
  function updateBed(i, b) {
    if (!bed.ready) return; const now = ctx.currentTime, m = mixOf(i, b); bed.w = m;
    if (now >= bed.mixT) { bed.mixT = now + 0.25;   // steer the loops 4× a second, smoothly (no per-frame automation)
      if (bed.waves) glide(bed.waves.g.gain, B.level * m.waves, 0.8); if (bed.crowd) glide(bed.crowd.g.gain, B.level * m.crowd, 0.8); glide(bed.wavesLP.frequency, m.wavesLP, 0.8); }
    // gulls: a call or a small group, somewhere to the side, at a rate that depends on the weather
    if (now >= bed.gullT) { if (m.gullsPerMin > 0.05) { const many = Math.random() < 0.35; oneShot(many ? buf.gulls : buf.gull, side(rand(-0.8, 0.8), 3), B.level * B.gulls * rand(0.5, 1), rand(0.9, 1.1)); }
      bed.gullT = now + clamp(-Math.log(1 - Math.random()) * 60 / Math.max(m.gullsPerMin, 0.05), 1.5, 120); }
    // a dog somewhere down the beach
    if (now >= bed.barkT) { if (m.barksPerMin > 0.05) { const t = now; oneShot(buf.barkFar, side(rand(-0.9, 0.9), 3), B.level * B.barks, rand(0.9, 1.1), t); if (Math.random() < 0.5) oneShot(buf.barkFar, side(rand(-0.9, 0.9), 3), B.level * B.barks * 0.8, rand(0.9, 1.1), t + rand(0.5, 0.8)); }
      bed.barkT = now + clamp(-Math.log(1 - Math.random()) * 60 / Math.max(m.barksPerMin, 0.05), 8, 180); }
  }

  // ---------------------------------------------------------------- per frame (scalars only, no allocations)
  let paramT = 0, beatT = 0;
  function frame(dt, speed, rolling, chargeF, lowHP, phaseI, phaseB) {
    const now = ctx.currentTime;
    // the wheels: steered 20× a second, plus straight away when they leave or touch the ground
    paramT -= dt; const wasRolling = roll.on; roll.on = rolling;
    if (paramT <= 0 || wasRolling !== rolling) { paramT = 0.05;
      const v = clamp((speed - R.speedLo) / (R.speedHi - R.speedLo), 0, 1), on = rolling && speed > 0.3 ? 1 : 0;
      const g = roll.recG ? roll.recG.gain : roll.rg.gain, target = roll.recG ? on * R.level * (0.55 + 0.45 * v) : on * R.rumble * (0.3 + 0.7 * v);
      // take-off and touch-down jump straight to the new level (a few ms, just enough not to click); speed changes glide
      if (wasRolling !== rolling) { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(target, now, 0.006); } else glide(g, target, 0.08);
      if (roll.rec) glide(roll.rec.playbackRate, R.rate[0] + (R.rate[1] - R.rate[0]) * v, 0.15); }
    // the charge tone follows the crouch every frame (it has to feel continuous)
    if (chargeF >= 0) { glide(charge.osc.frequency, C.from * Math.pow(C.to / C.from, chargeF), 0.02); if (!charge.on) { charge.on = true; glide(charge.g.gain, C.level, 0.03); } }
    else if (charge.on) { charge.on = false; glide(charge.g.gain, 0, 0.02); }
    // low health: a soft, low double heartbeat
    if (lowHP) { if (now >= beatT) { beatT = Math.max(now, beatT) + X.lowHealth.every; heartbeat(now + 0.02); } } else beatT = 0;
    if (act.length) schedule();
    updateBed(phaseI, phaseB);
  }
  function heartbeat(t) { const H = X.lowHealth; if (!take('fx', 2)) return; tone(out, t, { f: 62, f2: 48, a: 0.01, d: 0.16, peak: H.level, lp: 200 }); tone(out, t + 0.2, { f: 56, f2: 44, a: 0.01, d: 0.18, peak: H.level * 0.7, lp: 200 }); }

  // ---------------------------------------------------------------- the one-shots
  // a recorded clip (the ollie pop and the landing), once its file has loaded; false means fall back to the synthesized one
  const clip = (b, level) => { if (!b) return false; oneShot(b, out, level, 0.97 + Math.random() * 0.06); return true; };
  const now = () => ctx.currentTime + 0.005;
  const fx = {
    frame, performer, place, release,
    // feet pushing on the concrete as he gets (back) on the board
    push() { if (!take('fx', 3)) return; const t = now(); noise(out, t, { f: 1100, q: 0.9, a: 0.015, d: 0.12, peak: 0.16 }); noise(out, t, { type: 'lowpass', f: 260, a: 0.01, d: 0.1, peak: 0.2 }); noise(out, t + 0.48, { f: 1000, q: 0.9, a: 0.015, d: 0.1, peak: 0.11 }); },
    // the tail snapping on the ground: a crack, a wooden knock and a little body; bigger jumps pop a bit harder
    pop(f = 0.5) { if (clip(buf.pop, X.clips.pop * (0.75 + 0.25 * f))) return; if (!take('fx', 3)) return; const t = now(), k = 0.65 + 0.35 * f;
      noise(out, t, { type: 'highpass', f: 2600, q: 0.7, a: 0.0015, d: 0.025, peak: 0.26 * k }); noise(out, t, { f: 950, q: 6, a: 0.001, d: 0.07, peak: 0.3 * k }); tone(out, t, { f: 170, f2: 70, sweep: 0.07, a: 0.002, d: 0.08, peak: 0.34 * k }); },
    // the board turning under his feet: one airy whoosh, the same for every trick
    flip() { if (!take('fx', 1)) return; noise(out, now(), { f: 500, f2: 2100, sweep: 0.12, q: 1.8, a: 0.09, d: 0.2, peak: 0.16 }); },
    // wheels and deck hitting the ground; heavier from higher up
    land(h = 0.5) { if (clip(buf.land, X.clips.land * (0.7 + 0.3 * h))) return; if (!take('fx', 4)) return; const t = now(), k = 0.6 + 0.4 * h;
      tone(out, t, { f: 120, f2: 45, sweep: 0.12, a: 0.002, d: 0.14, peak: 0.42 * k }); noise(out, t, { type: 'lowpass', f: 520, a: 0.002, d: 0.08, peak: 0.26 * k });
      noise(out, t, { f: 2100, q: 3, a: 0.001, d: 0.03, peak: 0.15 * k }); noise(out, t + 0.028, { f: 1900, q: 3, a: 0.001, d: 0.03, peak: 0.12 * k }); },
    // a landed trick: a short bright two-note chime, a semitone higher for each step of the combo
    success(combo = 1) { if (!take('fx', 2)) return; const t = now() + 0.03, f = X.success.base * semis(Math.min(Math.max(combo, 1), X.success.maxSteps + 1) - 1);
      tone(out, t, { wave: 'triangle', f, a: 0.004, d: 0.2, peak: X.success.level, lp: 5000 }); tone(out, t + 0.065, { wave: 'triangle', f: f * 1.5, a: 0.004, d: 0.26, peak: X.success.level, lp: 5000 }); duck(); },
    // a failed trick: the board clattering away, his feet scuffing, a thump
    bail() { if (!take('fx', 6)) return; const t = now();
      tone(out, t + 0.04, { f: 95, f2: 40, sweep: 0.2, a: 0.004, d: 0.22, peak: 0.42 }); noise(out, t, { f: 1700, f2: 700, sweep: 0.4, q: 0.8, a: 0.02, d: 0.32, peak: 0.12 });
      for (let i = 0; i < 4; i++) noise(out, t + 0.06 + i * rand(0.07, 0.12) + i * 0.03, { f: rand(650, 1400), q: 5, a: 0.001, d: 0.06, peak: 0.3 * (1 - i * 0.18) }); duck(); },
    // running into something: a cone is a hollow plastic knock, anything else a body thump
    hit(cone = false) { if (!take('fx', cone ? 3 : 2)) return; const t = now();
      tone(out, t, { f: 105, f2: 42, sweep: 0.14, a: 0.002, d: 0.18, peak: 0.36 });
      if (cone) { tone(out, t, { wave: 'triangle', f: 430, f2: 300, sweep: 0.1, a: 0.001, d: 0.12, peak: 0.2 }); noise(out, t, { f: 720, q: 4, a: 0.001, d: 0.1, peak: 0.22 }); }
      else noise(out, t, { type: 'lowpass', f: 900, a: 0.003, d: 0.14, peak: 0.24 }); duck(); },
    // a slip: a rubbery squeak, a skid, then a light bump
    slip() { if (!take('fx', 3)) return; const t = now();
      tone(out, t, { f: 1350, f2: 820, sweep: 0.2, a: 0.01, d: 0.16, peak: 0.07, vib: 45, vibRate: 32 }); noise(out, t, { f: 1600, f2: 550, sweep: 0.35, q: 1.2, a: 0.02, d: 0.28, peak: 0.16 });
      tone(out, t + 0.26, { f: 100, f2: 50, a: 0.003, d: 0.12, peak: 0.26 }); duck(); },
    // a close pass: a quick whoosh on the side it went by
    nearMiss(pan = 0) { if (!take('fx', 1)) return; noise(side(pan * 0.7, 0.6), now(), { f: 800, f2: 2600, sweep: 0.16, q: 1.4, a: 0.05, d: 0.14, peak: 0.2 }); },
    // a bicycle bell, ring-ring, where the cyclist is
    bell(x, z) { if (!take('fx', 6)) return; const t = now(), d = spot(x, z, 1.6);
      for (const k of [0, 0.16]) { tone(d, t + k, { f: 2380, a: 0.002, d: 0.55, peak: X.bell }); tone(d, t + k, { f: 3560, a: 0.002, d: 0.32, peak: X.bell * 0.45 }); tone(d, t + k, { f: 5110, a: 0.002, d: 0.18, peak: X.bell * 0.2 }); } },
    // a dog barking where it is (recorded bark, pitched a little per dog)
    bark(x, z, times = 1, rate = 1) { const d = spot(x, z, 1.5, 0.5); for (let i = 0; i < times; i++) oneShot(buf.bark, d, X.bark, rate * rand(0.97, 1.03), ctx.currentTime + i * rand(0.32, 0.42)); },
    // a phone camera: the shutter's two clicks, where the influencer is
    flash(x, z) { if (!take('fx', 2)) return; const t = now(), d = spot(x, z, 0.5, 1.5); noise(d, t, { type: 'highpass', f: 3200, q: 0.7, a: 0.001, d: 0.008, peak: X.flash }); noise(d, t + 0.055, { type: 'highpass', f: 2800, q: 0.7, a: 0.001, d: 0.012, peak: X.flash * 0.82 }); },
    // menus: a soft tick
    click() { if (!take('fx', 2)) return; const t = now(); tone(out, t, { f: 1500, a: 0.001, d: 0.025, peak: 0.1 }); noise(out, t, { type: 'highpass', f: 4000, a: 0.001, d: 0.008, peak: 0.08 }); },
    // 3-2-1 beeps (n = 3, 2, 1) and the higher "go" (n = 0)
    countdown(n) { if (!take('fx', 1)) return; tone(out, now(), { f: n > 0 ? 880 : 1320, a: 0.005, d: n > 0 ? 0.14 : 0.3, hold: 0.06, peak: 0.12 }); },
    // game over: a falling minor phrase over a low note
    gameOver() { if (!take('fx', 4)) return; const t = now() + 0.15, L = X.sting.level;
      tone(out, t, { wave: 'triangle', f: 392, a: 0.006, d: 0.2, peak: L, lp: 2400 }); tone(out, t + 0.17, { wave: 'triangle', f: 311, a: 0.006, d: 0.2, peak: L, lp: 2400 });
      tone(out, t + 0.34, { wave: 'triangle', f: 262, a: 0.006, d: 0.9, hold: 0.1, peak: L, lp: 2000 }); tone(out, t + 0.34, { f: 131, a: 0.02, d: 1.0, hold: 0.1, peak: L * 0.8 }); duck(X.sting.duckDb, X.sting.duckHold); },
    // made the top 5: a rising arpeggio
    jingle() { if (!take('fx', 5)) return; const t = now(); [523, 659, 784, 1047].forEach((f, i) => tone(out, t + i * 0.085, { wave: 'triangle', f, a: 0.004, d: i === 3 ? 0.5 : 0.16, peak: X.jingle, lp: 5000 })); tone(out, t + 0.255, { f: 2094, a: 0.004, d: 0.4, peak: X.jingle * 0.3 }); duck(X.sting.duckDb, 0.6); },
    get ambienceReady() { return !!bed.ready; },
    // test hooks
    get debug() { return { voices: pools.fx.n, perfVoices: pools.perf.n, dropped, performers: act.map((h) => ({ kind: h.kind, x: +h.p.positionX.value.toFixed(2), z: +h.p.positionZ.value.toFixed(2) })), mix: bed.w && { ...bed.w }, roll: { gain: (roll.recG || roll.rg).gain.value, recorded: !!roll.recG }, charge: { on: charge.on, hz: charge.osc.frequency.value } }; },
    logPositions(on) { log = on ? [] : null; }, get positions() { return log; }, loaded: ambLoaded,
  };
  return fx;
}

// the same calls, doing nothing, for before the first key press (the browser won't start audio until then)
export const SILENT_SFX = { frame() {}, performer: () => null, place() {}, release() {}, push() {}, pop() {}, flip() {}, land() {}, success() {}, bail() {}, hit() {}, slip() {}, nearMiss() {}, bell() {}, bark() {}, flash() {}, click() {}, countdown() {}, gameOver() {}, jingle() {}, ambienceReady: false };
