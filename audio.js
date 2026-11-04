// =====================================================================================
// audio.js — the sound graph and the background-music playlist
//
// Graph: two music "decks" (an <audio> element each, streamed, routed in with createMediaElementSource) → deck gain
// (crossfade) → music volume → music mute → duck → pause fade → master (M mutes everything) → limiter → speakers.
// Sound effects (sfx.js) play into `sfx`, the ambience bed into `amb` (its own level); both go through the SFX volume
// and their own pause fade into the master, so they share the M mute and the limiter. Once a pause has faded out the
// whole AudioContext is suspended, so nothing at all plays (or uses CPU) while the game is paused or the tab hidden.
// Nothing is created until the first key press (browsers only let audio start after a user gesture), and the music
// is never decoded into memory: the elements stream it. Exactly two <audio> elements exist for the whole session;
// the idle one preloads the next track, and they swap roles at every crossfade.
// =====================================================================================
import { createSfx, SILENT_SFX } from './sfx.js';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createAudio({ tracks, cfg: A }) {
  // saved settings (this browser only); storage may be blocked, then it lives in memory for this visit
  const prefs = { musicVol: A.musicVolume, sfxVol: A.sfx.volume, musicMuted: false, muted: false };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(A.saveKey) || '{}')); } catch (e) { /* defaults */ }
  prefs.musicVol = clamp(+prefs.musicVol || 0, 0, 1); prefs.sfxVol = clamp(Number.isFinite(+prefs.sfxVol) ? +prefs.sfxVol : A.sfx.volume, 0, 1);
  const savePrefs = () => { try { localStorage.setItem(A.saveKey, JSON.stringify(prefs)); } catch (e) { /* in memory only */ } };

  let ctx = null, node = null, decks = null, cur = null, nxt = null, fx = null;
  let order = [], pos = 0, gamePaused = false, started = false, fading = false;
  const failed = new Set();
  const usable = () => tracks.filter((t, i) => !failed.has(i)).length;

  // playlist: shuffled once, then played in that order forever. A loop:true track crossfades into itself instead.
  function shuffle() {
    order = tracks.map((t, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  }
  function nextIndex(after) {
    if (tracks[after] && tracks[after].loop && !failed.has(after)) return after;
    for (let k = 1; k <= order.length; k++) {
      const p = (order.indexOf(after) + k) % order.length, i = order[p];
      if (!failed.has(i) && (i !== after || usable() === 1)) return i;
    }
    return -1;
  }

  function build() {
    // iOS: Web Audio follows the ring/silent switch unless the audio session says 'playback' (Safari 16.4+). Left to the
    // system by default (A.session null), so a phone on silent stays silent
    try { if (A.session && navigator.audioSession) navigator.audioSession.type = A.session; } catch (e) { /* not supported */ }
    ctx = new AudioContext();
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    node = { musicVol: g(prefs.musicVol), musicMute: g(prefs.musicMuted ? 0 : 1), duck: g(), pause: g(), master: g(prefs.muted ? 0 : 1), sfx: g(), amb: g(), sfxVol: g(prefs.sfxVol), sfxPause: g() };
    // limiter: a hard, fast compressor just under full scale so the music and future effects can never clip together
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = A.limiter.threshold; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.25;
    node.limiter = lim; node.analyser = ctx.createAnalyser(); node.analyser.fftSize = 2048;
    node.musicVol.connect(node.musicMute).connect(node.duck).connect(node.pause).connect(node.master);
    node.sfx.connect(node.sfxVol); node.amb.connect(node.sfxVol); node.sfxVol.connect(node.sfxPause).connect(node.master);
    node.master.connect(lim).connect(ctx.destination); lim.connect(node.analyser);
    decks = [0, 1].map(() => {
      const el = new Audio(); el.preload = 'auto';
      const d = { el, gain: g(0), track: -1 };
      ctx.createMediaElementSource(el).connect(d.gain).connect(node.musicVol);
      el.addEventListener('error', () => onFail(d));
      return d;
    });
    setInterval(tick, 50);
    document.addEventListener('visibilitychange', applyPause);
    fx = createSfx({ ctx, out: node.sfx, amb: node.amb, cfg: A.sfx, duck: (db, hold) => api.duck(db, hold) });   // also starts loading the ambience
  }

  function load(d, i) { d.track = i; d.el.src = A.folder + tracks[i].file; d.el.load(); }
  function play(d) {
    const p = d.el.play(), i = d.track;
    // not allowed yet: try again on the next key press. A bad file also rejects here, but its 'error' event handles that,
    // and a rejection that arrives after the deck has moved on to another track is ignored.
    if (p) p.catch((e) => { if (d.track !== i) return; if (e.name === 'NotAllowedError') started = false; else if (e.name !== 'AbortError' && e.name !== 'NotSupportedError') onFail(d, e.name); });
  }
  function onFail(d, why) {
    const idx = d.track; if (idx < 0 || failed.has(idx)) return;
    failed.add(idx); console.warn(`music: couldn't play ${tracks[idx].file} (${d.el.error ? 'media error ' + d.el.error.code : why || 'play failed'}); skipping it`);
    d.el.removeAttribute('src'); d.el.load(); d.track = -1; d.gain.gain.cancelScheduledValues(ctx.currentTime); d.gain.gain.value = 0;
    if (!usable()) { stopAll(); return; }   // every track failed: stay silent, the game carries on
    const wasFading = fading; fading = false;
    if (d === cur) [cur, nxt] = [nxt, cur];
    if (cur.track < 0) { const i = nextIndex(idx); if (i >= 0) startTrack(cur, i, true); return; }
    if (wasFading || !cur.el.paused) cur.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.05);   // the surviving track carries on
    else { pos = order.indexOf(cur.track); cur.el.currentTime = 0; fadeIn(cur); if (shouldPlay()) play(cur); }   // the preloaded next track takes over
    preloadNext();
  }
  function stopAll() { for (const d of decks) { d.el.pause(); d.gain.gain.value = 0; } fading = false; }
  function fadeIn(d) { const g = d.gain.gain, t = ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 1); }
  function startTrack(d, i, withFade) {
    pos = order.indexOf(i); load(d, i);
    if (withFade) fadeIn(d); else { d.gain.gain.cancelScheduledValues(ctx.currentTime); d.gain.gain.setValueAtTime(1, ctx.currentTime); }
    if (shouldPlay()) play(d);
    preloadNext();
  }
  function preloadNext() { const i = nextIndex(cur.track); if (i >= 0 && !fading && nxt.track !== i) load(nxt, i); }

  const shouldPlay = () => started && !gamePaused && !document.hidden;
  // crossfade gains follow the incoming track's own playback position, so a pause in the middle holds the mix exactly
  function tick() {
    if (!cur || cur.track < 0 || !shouldPlay()) return;
    const el = cur.el, dur = el.duration;
    if (!fading && isFinite(dur) && dur > 0 && el.currentTime >= dur - A.crossfade) {
      if (nxt.track < 0) preloadNext();
      if (nxt.track >= 0) { fading = true; nxt.el.currentTime = 0; nxt.gain.gain.setValueAtTime(0, ctx.currentTime); play(nxt); pos = order.indexOf(nxt.track); }
    }
    if (fading) {
      const p = clamp(nxt.el.currentTime / A.crossfade, 0, 1), t = ctx.currentTime;
      // equal-power curves: two unrelated songs keep a steady loudness through the overlap
      cur.gain.gain.setTargetAtTime(Math.cos(p * Math.PI / 2), t, 0.02); nxt.gain.gain.setTargetAtTime(Math.sin(p * Math.PI / 2), t, 0.02);
      if (p >= 1 || cur.el.ended) {
        cur.el.pause(); cur.gain.gain.setValueAtTime(0, t); nxt.gain.gain.setValueAtTime(1, t);
        [cur, nxt] = [nxt, cur]; fading = false; preloadNext();
      }
    } else if (el.ended) { const i = nextIndex(cur.track); if (i >= 0) { [cur, nxt] = [nxt, cur]; startTrack(cur, i, false); } }   // a track shorter than the crossfade
  }

  // pause / resume with a short fade; the elements really pause, so a long pause costs nothing
  let pauseTimer = 0;
  function applyPause() {
    if (!ctx || !cur) return;
    const t = ctx.currentTime; clearTimeout(pauseTimer);
    for (const gp of [node.pause.gain, node.sfxPause.gain]) { gp.cancelScheduledValues(t); gp.setValueAtTime(gp.value, t); }
    if (shouldPlay()) {
      if (ctx.state === 'suspended') ctx.resume();
      for (const d of fading ? [cur, nxt] : [cur]) if (d.track >= 0 && d.el.paused) play(d);
      node.pause.gain.linearRampToValueAtTime(1, t + A.resumeFade); node.sfxPause.gain.linearRampToValueAtTime(1, t + A.resumeFade);
    } else {
      node.pause.gain.linearRampToValueAtTime(0, t + A.pauseFade); node.sfxPause.gain.linearRampToValueAtTime(0, t + A.pauseFade);
      // once faded: pause the music elements and suspend the context (sounds already scheduled wait, then carry on)
      pauseTimer = setTimeout(() => { if (shouldPlay()) return; for (const d of decks) d.el.pause(); if (ctx.state === 'running') ctx.suspend(); }, A.pauseFade * 1000 + 30);
    }
  }

  const ramp = (param, v) => { const t = ctx.currentTime; param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + 0.05); };
  const api = {
    // call on every key press: the first one (a real user gesture) creates the graph and starts the first track
    unlock() {
      if (started && ctx && (ctx.state === 'running' || gamePaused)) return;   // paused: resuming the game resumes the sound
      if (!ctx) { build(); shuffle(); cur = decks[0]; nxt = decks[1]; }
      ctx.resume(); started = true;   // with no playable music the effects still run
      if (cur.track < 0 && usable()) { const i = nextIndex(order[order.length - 1]); if (i >= 0) startTrack(cur, i, true); }
      else applyPause();
    },
    setPaused(p) { gamePaused = p; applyPause(); },
    toggleMute() { prefs.muted = !prefs.muted; savePrefs(); if (ctx) ramp(node.master.gain, prefs.muted ? 0 : 1); return prefs.muted; },
    toggleMusic() { prefs.musicMuted = !prefs.musicMuted; savePrefs(); if (ctx) ramp(node.musicMute.gain, prefs.musicMuted ? 0 : 1); return prefs.musicMuted; },
    setMusicVolume(v) { prefs.musicVol = clamp(Math.round(v * 20) / 20, 0, 1); savePrefs(); if (ctx) ramp(node.musicVol.gain, prefs.musicVol); return prefs.musicVol; },
    setSfxVolume(v) { prefs.sfxVol = clamp(Math.round(v * 20) / 20, 0, 1); savePrefs(); if (ctx) ramp(node.sfxVol.gain, prefs.sfxVol); return prefs.sfxVol; },
    // a gentle dip in the music under tricks, hits and the game-over sting (dB below normal, held `hold` s)
    duck(db = A.duck.db, hold = A.duck.hold) {
      if (!ctx) return; const t = ctx.currentTime, gd = node.duck.gain, v = Math.pow(10, -Math.abs(db) / 20);
      gd.cancelScheduledValues(t); gd.setValueAtTime(gd.value, t); gd.linearRampToValueAtTime(v, t + A.duck.attack);
      gd.setValueAtTime(v, t + A.duck.attack + hold); gd.linearRampToValueAtTime(1, t + A.duck.attack + hold + A.duck.release);
    },
    get prefs() { return { ...prefs }; },
    get sfx() { return node && node.sfx; },
    get fx() { return fx || SILENT_SFX; },   // the sound effects (no-ops until the first key press)
    // test hooks
    get debug() { return { cfg: A, ctx, node, decks, order, pos, failed: [...failed], fading, cur: cur && cur.track, playing: decks && decks.filter((d) => !d.el.paused).length }; },
  };
  return api;
}
