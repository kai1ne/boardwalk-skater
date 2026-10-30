// =====================================================================================
// characters.js — rigged, skinned people for the Venice boardwalk (phase 1b)
//
// Assets (all CC0, see CREDITS.md): Quaternius "Universal Base Characters" [Standard] bodies +
// hairstyles, Quaternius "Universal Animation Library" [Standard] clips, Quaternius Shiba Inu /
// Husky (via Poly Pizza). Bodies and clips share the same 65-bone humanoid rig.
//
// Budget: skinned meshes are pooled "rigs" (one AnimationMixer each) handed to the nearest visible
// agents. The nearest Q.nearCount rigs animate every frame, the rest every Q.midEvery frames; past
// Q.rRig metres agents become instanced flipbook billboards baked from the rigs at load time.
// =====================================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { createOutfitBuilder, deriveBody, MASK_GLSL, outfitMaterial } from './outfits.js';

const BASE = 'assets/characters/';
const V3 = THREE.Vector3, QT = THREE.Quaternion;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// deterministic RNG so the crowd looks the same on every load
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let R = mulberry32(4242);
const rand = (a, b) => a + (b - a) * R(), randi = (a, b) => Math.floor(rand(a, b + 1)), chance = (p) => R() < p;
const pick = (arr) => arr[Math.floor(R() * arr.length)];
// merge [geometry, hexColor] pairs into one vertex-coloured geometry (for small props)
function mergeColored0(list) {
  return mergeGeometries(list.map(([g, c]) => { const col = new THREE.Color(c), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g; }));
}
function wpick(pairs) { let s = 0; for (const p of pairs) s += p[1]; let r = R() * s; for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; } return pairs[0][0]; }

// -------------------------------------------------------------------------------------
// Bone helpers (world-space rotations, so they work regardless of each bone's local axes)
// -------------------------------------------------------------------------------------
const _pq = new QT(), _pqi = new QT(), _rq = new QT(), _ax = new V3();
function rotWorld(bone, axisW, angle) {
  if (!angle) return;
  bone.parent.getWorldQuaternion(_pq).normalize(); _pqi.copy(_pq).invert();
  _ax.copy(axisW).applyQuaternion(_pqi).normalize(); _rq.setFromAxisAngle(_ax, angle); bone.quaternion.premultiply(_rq).normalize();
}
// (world quaternions are re-normalised: a rig's slight non-uniform build scale makes decompose() return non-unit values)
function rotWorldQ(bone, qW) { bone.parent.getWorldQuaternion(_pq).normalize(); _pqi.copy(_pq).invert(); _rq.copy(_pqi).multiply(qW).multiply(_pq); bone.quaternion.premultiply(_rq).normalize(); }
function setWorldQ(bone, qW) { bone.parent.getWorldQuaternion(_pq).normalize(); bone.quaternion.copy(_pq.invert()).multiply(qW).normalize(); }

// Analytic two-bone IK (thigh-calf-foot or upperarm-forearm-hand). `pole` is the world
// direction the middle joint should bend toward. Bends first, then swings the chain onto the target.
const _a = new V3(), _b = new V3(), _c = new V3(), _ac = new V3(), _ab = new V3(), _ba = new V3(), _bc = new V3(), _at = new V3(), _ax0 = new V3(), _sw = new QT();
function ik2(A, B, C, target, pole, weight = 1) {
  A.getWorldPosition(_a); B.getWorldPosition(_b); C.getWorldPosition(_c);
  const lab = _a.distanceTo(_b), lcb = _b.distanceTo(_c), lat = clamp(_a.distanceTo(target), 0.02, (lab + lcb) * 0.998);
  _ac.subVectors(_c, _a).normalize(); _ab.subVectors(_b, _a).normalize(); _ba.subVectors(_a, _b).normalize(); _bc.subVectors(_c, _b).normalize();
  const ac_ab_0 = Math.acos(clamp(_ac.dot(_ab), -1, 1)), ba_bc_0 = Math.acos(clamp(_ba.dot(_bc), -1, 1));
  const ac_ab_1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const ba_bc_1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  _ax0.crossVectors(_ac, pole); if (_ax0.lengthSq() < 1e-8) return; _ax0.normalize();
  rotWorld(A, _ax0, (ac_ab_1 - ac_ab_0) * weight); A.updateMatrixWorld(true);
  rotWorld(B, _ax0, (ba_bc_1 - ba_bc_0) * weight); B.updateMatrixWorld(true);
  A.getWorldPosition(_a); C.getWorldPosition(_c);
  _ac.subVectors(_c, _a).normalize(); _at.subVectors(target, _a).normalize();
  _sw.setFromUnitVectors(_ac, _at); if (weight < 1) _sw.slerp(_rq.identity(), 1 - weight);
  rotWorldQ(A, _sw); A.updateMatrixWorld(true);
}

// -------------------------------------------------------------------------------------
// Body shader. Clothes are separate garment meshes (outfits.js); the body discards the skin they cover,
// using the same bind-pose region formulas slightly inset, so no limb can show through. Left painted on
// the skin: swimwear (the base mesh's underwear areas), sandal soles and the player's socks.
// -------------------------------------------------------------------------------------
// average colour of a skin texture's skin (its saturated pixels; the underwear areas are grey), cached per texture
const SKIN_AVG = new Map();
function skinAverage(tex) {
  if (SKIN_AVG.has(tex.uuid)) return SKIN_AVG.get(tex.uuid);
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.drawImage(tex.image, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data;
  let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx > 30 && (mx - mn) / mx > 0.25) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } }
  const col = n ? new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace) : new THREE.Color(0.6, 0.45, 0.35); SKIN_AVG.set(tex.uuid, col); return col;
}
function bodyMaterial(proto, lm, app) {
  // tint = target tone / the texture's average skin colour (linear), so the average lands exactly on the MST colour
  const avg = skinAverage(app.skinTex), target = skinAlbedo(app.mst);
  const tint = new THREE.Color(target.r / Math.max(avg.r, 1e-3), target.g / Math.max(avg.g, 1e-3), target.b / Math.max(avg.b, 1e-3));
  // the base mesh's underwear areas: swimwear when the recipe says so, otherwise skin (they show at necklines and hems)
  const under = app.swim ? new THREE.Color(app.underCol) : target.clone();
  const m = new THREE.MeshStandardMaterial({ map: app.skinTex, normalMap: proto.normalMap, roughnessMap: proto.roughnessMap, roughness: 1, metalness: 0 });
  const u = {
    uLm0: { value: lm[0] }, uLm1: { value: lm[1] }, uLm2: { value: lm[2] },
    uStyle: { value: new THREE.Vector4(app.top, app.bottom, app.shoes, 0) },
    uSkin: { value: tint }, uSkinTarget: { value: target }, uAvgLum: { value: 0.2126 * avg.r + 0.7152 * avg.g + 0.0722 * avg.b }, uShoe: { value: new THREE.Color(app.shoeCol) }, uUnder: { value: under },
    uSocks: { value: app.socks ? 1 : 0 },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBindPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindPos = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${MASK_GLSL}\nvarying vec3 vBindPos;\nuniform vec3 uSkin, uShoe, uUnder, uSkinTarget; uniform float uSocks, uAvgLum;`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (coveredByOutfit(vBindPos) > 0.5) discard;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 base = diffuseColor.rgb; float mx = max(base.r, max(base.g, base.b)), mn = min(base.r, min(base.g, base.b));
          float under = 1.0 - smoothstep(0.12, 0.24, (mx - mn) / max(mx, 1e-3));   // underwear areas are the grey ones
          float lum = dot(base, vec3(0.3, 0.59, 0.11)), ushade = clamp(mix(1.0, lum / 0.38, 0.6), 0.55, 1.15);
          // skin = the target tone × the texture's brightness, with 30% of the tinted texture colour kept for lips and cheeks
          vec3 skin = mix(uSkinTarget * (dot(base, vec3(0.2126, 0.7152, 0.0722)) / max(uAvgLum, 1e-3)), base * uSkin, 0.3);
          vec3 col = mix(skin, uUnder * ushade, under);
          if (uStyle.z > 0.5 && uStyle.z < 1.5) col = mix(col, uShoe * 0.9, 1.0 - csm(0.02, vBindPos.y));   // sandal soles
          if (uSocks > 0.5) col = mix(col, vec3(0.9, 0.9, 0.88), csm(uLm0.x + 0.02, vBindPos.y) * (1.0 - csm(uLm0.x + 0.12, vBindPos.y)));
          diffuseColor.rgb = col; }`);
  };
  m.customProgramCacheKey = () => 'vbCharBody4';
  return m;
}

// -------------------------------------------------------------------------------------
// Appearance tables
// -------------------------------------------------------------------------------------
// Skin: the Monk Skin Tone Scale (Dr. Ellis Monk with Google, CC BY 4.0, skintone.google), MST-1 … MST-10.
// Each body's skin texture is tinted so its average skin colour lands on the chosen tone (the texture keeps the
// detail: lips, shading, freckles). MST-1…5 use the base's Light texture, MST-6…10 its Dark one.
const MST = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420'];
// The swatches are display colours (MST-1 is near-white, MST-10 near-black); as surface albedo that reads as grey
// mannequins and flat black. Keep their order and hue, map their luminance onto a realistic skin-albedo range on a
// log curve (so the ten steps stay evenly spaced), and restore some saturation.
const _mstL = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const MST_LUM = MST.map((h) => _mstL(new THREE.Color(h))), MST_LMAX = Math.max(...MST_LUM), MST_LMIN = Math.min(...MST_LUM);
function skinAlbedo(i, outMin = 0.065, outMax = 0.56, chroma = 0.58) {
  const c = new THREE.Color(MST[i]), L = MST_LUM[i], t = Math.log(L / MST_LMIN) / Math.log(MST_LMAX / MST_LMIN), L2 = outMin * Math.pow(outMax / outMin, t);
  // per-tone saturation so every tone reaches a natural skin chroma (the light swatches are nearly grey)
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), sat = Math.min(4, Math.max(1, chroma / Math.max((mx - mn) / mx, 1e-3)));
  for (const k of ['r', 'g', 'b']) c[k] = Math.max(0, L + (c[k] - L) * sat); c.multiplyScalar(L2 / L);
  // the palest tones get a rosy undertone (blood under thin skin) so they read as alive, not chalky; fades out by MST-5
  const rose = [0.8, 0.65, 0.45, 0.22][i] || 0;
  if (rose) { const p = new THREE.Color('#e5917f'), Lp = 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b, Lc = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; c.lerp(p.multiplyScalar(Lc / Lp), rose); }
  return c;
}
const MST_WEIGHTS = [[0, 1], [1, 1], [2, 1], [3, 1.1], [4, 1.1], [5, 1.1], [6, 1.05], [7, 1], [8, 0.95], [9, 0.85]];
// natural hair colours (any skin tone can have any of them; very dark tones lean toward the darker ones)
const HAIR_PALETTE = { black: '#0f0d0c', darkBrown: '#2b1d15', brown: '#4b3221', lightBrown: '#7a5537', darkBlond: '#9c7a4c', blond: '#cfae74',
  platinum: '#e3d4b0', auburn: '#6e2d18', ginger: '#a4471f', saltPepper: '#5c5a58', gray: '#8f8f8f', white: '#d6d6d2' };
function hairColour(mst) {
  const dark = mst >= 6;
  const k = wpick(dark ? [['black', 0.36], ['darkBrown', 0.3], ['brown', 0.1], ['saltPepper', 0.08], ['gray', 0.07], ['white', 0.03], ['auburn', 0.03], ['darkBlond', 0.03]]
    : [['black', 0.1], ['darkBrown', 0.17], ['brown', 0.17], ['lightBrown', 0.12], ['darkBlond', 0.1], ['blond', 0.09], ['platinum', 0.03], ['auburn', 0.05], ['ginger', 0.05], ['saltPepper', 0.05], ['gray', 0.05], ['white', 0.02]]);
  return HAIR_PALETTE[k];
}
const EYES = { darkBrown: '#2a170d', brown: '#5a3418', hazel: '#7a6230', green: '#4f7a3a', blue: '#4a78b8', gray: '#7f8a94' };
const TOPS = ['#e8322b', '#f4f4f2', '#141414', '#2a6fc9', '#f2cf4a', '#24a865', '#ef8a2a', '#e45a9a', '#6a45c0', '#8f969c', '#efe4cf', '#123c66', '#7fc6d8', '#b52f45', '#3d5a40', '#f2b8c6', '#ffffff', '#c9d6a3'];
const HOODIES = ['#2b2b2e', '#6d7278', '#1f3a5f', '#7a1f2b', '#3d5a40', '#c9b48f', '#e9e4da'];
const DRESSES = ['#e45a9a', '#f2cf4a', '#7fc6d8', '#f4f4f2', '#e8322b', '#24a865', '#6a45c0', '#f08a5d', '#2a6fc9'];
const SHORTS = ['#c9b48f', '#2b3a55', '#5a5a5a', '#3a5f8a', '#6b4a2b', '#e8e2d4', '#2f4a3a', '#1b1b1b', '#b52f45'];
const DENIM = ['#3e5f8a', '#4a6c9b', '#2c4466', '#5b7fae', '#1d2a3c', '#7d93b2'];
const TROUSERS = ['#1b1b1b', '#5a5a5a', '#c9b48f', '#2f4a3a', '#e8e2d4'];
const SWIM = ['#e8322b', '#1d1d1d', '#2a7de1', '#f05aa0', '#ffd23f', '#1fb5a8', '#ffffff', '#ff7a2f'];
const SHOES = ['#f2f2f2', '#1a1a1a', '#c23030', '#2a4f8f', '#7a6a58', '#d9d2c3', '#3d5a40'];
const CAPS = ['#1b1b1b', '#f4f4f2', '#2a6fc9', '#c8102e', '#3d5a40', '#c9b48f'];
const BAGS = ['#2b2b2e', '#c9b48f', '#1f3a5f', '#e45a9a', '#24a865', '#7a1f2b', '#f2cf4a'];
const HAIR_STYLES = { M: [['Hair_Buzzed', 0.35], ['Hair_SimpleParted', 0.35], ['Hair_Long', 0.12], [null, 0.1], ['Hair_Buns', 0.03]],
  F: [['Hair_Long', 0.42], ['Hair_Buns', 0.24], ['Hair_SimpleParted', 0.16], ['Hair_BuzzedFemale', 0.18]] };
// a seeded wardrobe recipe: top / bottom / shoes styles and colours, accessories (codes in outfits.js)
function makeAppearance(sex, i) {
  R = mulberry32(9001 + i * 131 + (sex === 'F' ? 7 : 0));
  R(); const mst = wpick(MST_WEIGHTS), swim = (i * 7 + (sex === 'F' ? 3 : 0)) % 20 < 3;   // exactly 3 looks in every 20 (15%) are swimwear (R() keeps the seeded sequence)
  const a = { sex, mst, tone: mst < 5 ? 0 : 5, swim, underCol: swim ? pick(SWIM) : '#2a2a2e', shoeCol: pick(SHOES), hairCol: hairColour(mst),
    eyeCol: EYES[wpick(mst >= 6 ? [['darkBrown', 0.6], ['brown', 0.3], ['hazel', 0.07], ['green', 0.03]] : [['darkBrown', 0.2], ['brown', 0.25], ['hazel', 0.18], ['green', 0.12], ['blue', 0.17], ['gray', 0.08]])] };
  // swimwear: women in a bikini (the base body's two-piece in a swim colour) or a one-piece (a swim tank over matching bottoms),
  // men in swim trunks; barefoot or in sandals
  if (swim) { a.shoes = chance(0.6) ? 1 : 0; if (sex === 'M') { a.top = 0; a.bottom = 1; a.botCol = pick(SWIM); } else if (Math.floor(i / 7) % 3 !== 1) { a.top = 0; a.bottom = 0; } else { a.top = 1; a.topCol = a.underCol; a.bottom = 0; } }
  else {
    a.top = sex === 'M' ? wpick([[2, 0.42], [3, 0.16], [4, 0.14], [1, 0.16], [0, 0.04]]) : wpick([[2, 0.3], [1, 0.2], [3, 0.12], [4, 0.12], [5, 0.26]]);
    if (a.top === 0) { a.underCol = pick(SWIM); a.swim = true; a.bottom = 1; a.botCol = pick(SWIM); }   // shirtless: board shorts
    a.topCol = a.top === 4 ? pick(HOODIES) : a.top === 5 ? pick(DRESSES) : pick(TOPS);
    if (a.top === 5) { a.bottom = 4; a.skirt = { col: a.topCol, flare: rand(0.08, 0.16) }; }   // sundress: bodice + skirt (the body under the skirt is masked)
    else if (a.top !== 0) { a.bottom = wpick([[1, 0.42], [2, 0.14], [3, 0.44]]); a.denim = a.bottom !== 1 && chance(0.7) || (a.bottom === 1 && chance(0.2));
      a.botCol = a.denim ? pick(DENIM) : a.bottom === 1 ? pick(SHORTS) : pick(TROUSERS); }
    a.shoes = wpick([[2, 0.66], [1, 0.32], [0, 0.02]]);
  }
  a.hair = wpick(HAIR_STYLES[sex]); a.beard = sex === 'M' && chance(0.28);
  a.build = wpick([['everyday', 0.42], ['slim', 0.25], ['fuller', 0.25], ['super', 0.08]]);   // the muscular sculpt in under 10%
  // accessories: caps only over close-cropped hair (or none), so the hair can't push through
  if (!swim && (a.hair === null || a.hair === 'Hair_Buzzed' || a.hair === 'Hair_BuzzedFemale') && chance(0.4)) a.cap = pick(CAPS);
  if (chance(0.3)) a.sunglasses = true;
  if (!swim && chance(0.12)) a.backpack = pick(BAGS); else if (chance(0.12)) a.pouch = pick(BAGS);
  return a;
}
// buskers dress for the job: distinct, recognisable outfits
const PERFORMER_LOOKS = {
  guitar: { top: 3, topCol: '#8a2f2a', bottom: 3, botCol: '#2c4466', denim: true, shoes: 2, shoeCol: '#7a6a58', cap: '#1b1b1b' },
  drum: { top: 1, topCol: '#f2cf4a', bottom: 1, botCol: '#3d5a40', shoes: 1, shoeCol: '#6b4a2b', sunglasses: true },
  piano: { top: 2, topCol: '#141414', bottom: 3, botCol: '#5a5a5a', shoes: 2, shoeCol: '#f2f2f2', sunglasses: true },
  bboy: { top: 3, topCol: '#f2f2ef', trimCol: '#c8102e', bottom: 3, botCol: '#1b1b1b', shoes: 2, shoeCol: '#e8322b' },    // breakdancers: track tops and pants
  bboy2: { top: 2, topCol: '#f2cf4a', bottom: 3, botCol: '#2c4466', shoes: 2, shoeCol: '#f4f4f2' },
};

// -------------------------------------------------------------------------------------
export async function createCharacters(ctx) {
  const { renderer, scene, camera, chunks, skater, S } = ctx;
  const Q = Object.assign({ rigsPerSex: 30, nearCount: 30, rFull: 40, rRig: 80, rImp: 260, shadowDist: 30, midEvery: 3, walkers: 260,
    cyclists: 10, dogs: 6, appearances: 20, skaterDecimate: 0.55, lodNear: 12, lodFar: 13.5, lodReduce: 0.6 }, ctx.Q || {});
  const loader = new GLTFLoader(), texLoader = new THREE.TextureLoader();
  const load = (u) => loader.loadAsync(BASE + u);
  const HAIR_FILES = ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_BuzzedFemale', 'Hair_Beard'];
  const loadTex = (u) => texLoader.loadAsync(BASE + u).then((t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; return t; });
  const [gM, gF, gA, gShiba, gHusky, texML, texFL, ...gHair] = await Promise.all([
    load('Superhero_Male_FullBody.gltf'), load('Superhero_Female_FullBody.gltf'), load('UAL1_Standard.glb'),
    load('dogs/Shiba_Inu.glb'), load('dogs/Husky.glb'),
    loadTex('tex/T_Superhero_Male_Light.jpg'), loadTex('tex/T_Superhero_Female_Light_BaseColor.jpg'),
    ...HAIR_FILES.map((h) => load(`hair/${h}.gltf`))]);
  const clipNames = gA.animations.map((c) => c.name);
  console.log('[characters] Universal Animation Library clips (%d):', clipNames.length, clipNames.join(', '));
  console.log('[characters] Shiba Inu clips:', gShiba.animations.map((c) => c.name).join(', '));

  // map behaviours onto the real clip names (no guessing: look them up in the list above)
  const findClip = (...pats) => { for (const p of pats) { const n = clipNames.find((c) => (p instanceof RegExp ? p.test(c) : c === p)); if (n) return n; } return null; };
  const CLIP = {
    walk: findClip('Walk_Loop', /^Walk/), walkFormal: findClip('Walk_Formal_Loop', /Walk.*Formal/), jog: findClip('Jog_Fwd_Loop', /Jog/),
    idle: findClip('Idle_Loop', /^Idle/), talk: findClip('Idle_Talking_Loop', /Talk/), sit: findClip('Sitting_Idle_Loop', /Sitting_Idle/),
    sitTalk: findClip('Sitting_Talking_Loop', /Sitting_Talk/), dance: findClip('Dance_Loop', /Dance/), spell: findClip('Spell_Simple_Idle_Loop', /Spell.*Idle/),
    drive: findClip('Driving_Loop', /Driv/), crouchIdle: findClip('Crouch_Idle_Loop', /Crouch_Idle/),
    lie: findClip('A_TPose', /TPose/),   // relaxed A-pose, used lying on a towel (no lying clip in the free set)
  };
  for (const k in CLIP) if (!CLIP[k]) console.warn('[characters] no clip for', k, '- falling back to idle'), CLIP[k] = CLIP.idle;
  console.log('[characters] behaviour → clip map:', JSON.stringify(CLIP));
  // root-motion speeds measured from UAL1_Standard_RM.glb (root displacement / clip duration) at mannequin scale
  const RM_SPEED = { Walk_Loop: 0.975, Walk_Formal_Loop: 0.975, Jog_Fwd_Loop: 5.357 };

  // ---------------- bodies ----------------
  const tmpV = new V3();
  function boneY(root, name) { root.getObjectByName(name).getWorldPosition(tmpV); return tmpV.y; }
  function boneX(root, name) { root.getObjectByName(name).getWorldPosition(tmpV); return Math.abs(tmpV.x); }
  gA.scene.updateMatrixWorld(true); const manHipY = boneY(gA.scene, 'thigh_l');
  function prepBody(g, sex, lightTex) {
    const root = g.scene; root.updateMatrixWorld(true);
    let body, eyes, brows;
    root.traverse((o) => { if (!o.isSkinnedMesh) return; const n = o.material.name; if (/Eyes/.test(n)) eyes = o; else if (/Hair/.test(n)) brows = o; else body = o; });
    const lm = [new THREE.Vector4(boneY(root, 'foot_l'), boneY(root, 'calf_l'), boneY(root, 'thigh_l'), boneY(root, 'pelvis')),
      new THREE.Vector4(boneY(root, 'spine_03'), boneY(root, 'neck_01'), boneX(root, 'upperarm_l'), boneX(root, 'lowerarm_l')),
      new THREE.Vector4(boneX(root, 'hand_l'), boneY(root, 'Head'), (root.getObjectByName('neck_01').getWorldPosition(tmpV), tmpV.z), 0)];
    const k = boneY(root, 'thigh_l') / manHipY;   // leg-length ratio vs the animation mannequin
    // retarget: keep bone rotations, drop per-bone translation/scale (mannequin proportions), scale pelvis travel by leg ratio
    const clips = {};
    for (const clip of gA.animations) {
      const tracks = [];
      for (const t of clip.tracks) {
        const dot = t.name.lastIndexOf('.'), node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
        if (node === 'root') continue;
        if (prop === 'quaternion') tracks.push(t);
        else if (prop === 'position' && node === 'pelvis') { const c = t.clone(); for (let i = 0; i < c.values.length; i++) c.values[i] *= k; tracks.push(c); }
      }
      clips[clip.name] = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    }
    const speed = {}; for (const n in RM_SPEED) speed[n] = RM_SPEED[n] * k;
    for (const o of [body, eyes, brows]) if (o) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; }
    if (eyes) eyes.castShadow = false;
    const mat = body.material;
    return { sex, g, lm, k, clips, speed, height: boneY(root, 'Head') + 0.17, protoMat: mat, skinTex: [lightTex, mat.map], eyesMat: eyes && eyes.material };
  }
  const BODY = { M: prepBody(gM, 'M', texML), F: prepBody(gF, 'F', texFL) };
  // detail LOD: a reduced body mesh per sex (meshoptimizer; skin weights carried over). Rigs use the full mesh within
  // Q.lodNear metres and the reduced one beyond Q.lodFar (the gap is hysteresis, so nobody flickers between the two)
  const simplifier = new SimplifyModifier();
  // body variants per sex: the original 'super' sculpt plus everyday, slim and fuller builds derived from it
  // (outfits.js). Each has a full and a reduced mesh and its own outfit builders (garments are cut from its surface)
  const VARIANTS = ['super', 'everyday', 'slim', 'fuller'];
  for (const sex of ['M', 'F']) { const B = BODY[sex]; let body, eyes; B.g.scene.traverse((o) => { if (o.isSkinnedMesh) { if (/Eyes/.test(o.material.name)) eyes = o; else if (!/Hair/.test(o.material.name)) body = o; } });
    const base = body.geometry.clone(); for (const n of Object.keys(base.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(n)) base.deleteAttribute(n);
    const boneIndex = {}; body.skeleton.bones.forEach((b, i) => { boneIndex[b.name] = i; });
    const bonePos = {}; for (const n of ['Head', 'neck_01', 'spine_03', 'pelvis']) bonePos[n] = B.g.scene.getObjectByName(n).getWorldPosition(new V3());
    eyes.geometry.computeBoundingBox(); const ctx = { lm: B.lm, boneIndex, bonePos, eyesBox: eyes.geometry.boundingBox };
    B.variants = {};
    for (const kind of VARIANTS) {
      const full = kind === 'super' ? base : deriveBody(base, B.lm, kind); let low = full;
      try { low = await simplifier.modify(full.clone(), Math.round(full.attributes.position.count * Q.lodReduce)); low.computeBoundingSphere(); }
      catch (err) { console.warn('[characters] body LOD failed, using the full mesh everywhere:', err); }
      B.variants[kind] = { kind, geoFull: full, geoLow: low, outfit: { full: createOutfitBuilder({ ...ctx, geo: full }), low: createOutfitBuilder({ ...ctx, geo: low }) } };
    }
    B.geoFull = base; B.geoLow = B.variants.super.geoLow; B.outfit = B.variants.super.outfit;
    console.log('[characters] %s body variants %s: %d → %d triangles (LOD)', sex, VARIANTS.join('/'), base.index.count / 3, B.geoLow.index.count / 3); }

  // ---------------- hair: rigged-to-head meshes re-expressed in Head-bone space (static, no skinning) ----------------
  const HAIR_GEO = {}; const hairMat0 = {};
  gHair.forEach((g, i) => {
    let sm; g.scene.traverse((o) => { if (o.isSkinnedMesh) sm = o; }); if (!sm) return;
    g.scene.updateMatrixWorld(true);
    const hi = sm.skeleton.bones.findIndex((b) => b.name === 'Head');
    const mtx = new THREE.Matrix4().multiplyMatrices(sm.skeleton.boneInverses[hi], sm.bindMatrix);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', sm.geometry.attributes.position.clone()); geo.setAttribute('normal', sm.geometry.attributes.normal.clone());
    geo.setAttribute('uv', sm.geometry.attributes.uv.clone()); geo.setIndex(sm.geometry.index.clone()); geo.applyMatrix4(mtx); geo.computeBoundingSphere();
    HAIR_GEO[HAIR_FILES[i]] = geo; hairMat0[HAIR_FILES[i]] = sm.material;
  });
  const HAIR_MATS = new Map();
  // hair colour: the texture's brightness (normalised to its average) times the chosen colour, so any colour
  // from black to white comes out true instead of being multiplied into the texture's own brown
  const lumAvg = new Map();
  function texLumAvg(tex) { if (lumAvg.has(tex.uuid)) return lumAvg.get(tex.uuid); const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.drawImage(tex.image, 0, 0, 32, 32);
    const d = x.getImageData(0, 0, 32, 32).data; let L = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { L += (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255; n++; }
    const v = Math.pow(Math.max(L / Math.max(n, 1), 0.05), 2.2); lumAvg.set(tex.uuid, v); return v; }
  function lumTinted(src, col, rough) {
    const m = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, color: new THREE.Color(col), roughness: rough, side: THREE.DoubleSide }), k = 1 / texLumAvg(src.map);
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        diffuseColor.rgb *= vec3( dot( sampledDiffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) * ${k.toFixed(4)} );
        diffuseColor.a *= sampledDiffuseColor.a;
      #endif`); };
    m.customProgramCacheKey = () => 'vbHairLum' + k.toFixed(3); return m;
  }
  function hairMat(style, col) {
    const src = hairMat0[style], key = src.map.uuid + col;
    if (!HAIR_MATS.has(key)) HAIR_MATS.set(key, lumTinted(src, col, 0.62));
    return HAIR_MATS.get(key);
  }
  const browMats = {}; for (const sex of ['M', 'F']) { let br; BODY[sex].g.scene.traverse((o) => { if (o.isSkinnedMesh && /Hair/.test(o.material.name)) br = o.material; }); browMats[sex] = br; }
  function browMat(sex, col) { const src = browMats[sex], key = 'brow' + sex + col;
    if (!HAIR_MATS.has(key)) HAIR_MATS.set(key, lumTinted(src, col, 0.7));
    return HAIR_MATS.get(key); }
  // eye colour: the iris (the saturated pixels of the brown eye texture) re-coloured, keeping its shading; the whites stay white
  const EYE_MATS = new Map();
  function eyeMat(sex, col) { const key = sex + col; if (EYE_MATS.has(key)) return EYE_MATS.get(key);
    const src = BODY[sex].eyesMat, m = src.clone(), c = new THREE.Color(col);
    m.onBeforeCompile = (sh) => { sh.uniforms.uIris = { value: c }; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uIris;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 b = diffuseColor.rgb; float mx = max(b.r, max(b.g, b.b)), mn = min(b.r, min(b.g, b.b)), sat = (mx - mn) / max(mx, 1e-3);
          float iris = smoothstep(0.18, 0.35, sat); diffuseColor.rgb = mix(b, uIris * (0.35 + 1.6 * dot(b, vec3(0.3, 0.59, 0.11))), iris); }`); };
    m.customProgramCacheKey = () => 'vbEye'; EYE_MATS.set(key, m); return m; }

  // ---------------- appearances: tinted material variants, created once and shared ----------------
  const APPS = { M: [], F: [] };
  for (const sex of ['M', 'F']) for (let i = 0; i < Q.appearances; i++) {
    const a = makeAppearance(sex, i), B = BODY[sex];
    a.skinTex = B.skinTex[a.mst < 5 ? 0 : 1];
    a.mat = bodyMaterial(B.protoMat, B.lm, a); a.hairMat = hairMat(a.hair || 'Hair_Beard', a.hairCol); a.browMat = browMat(sex, a.hairCol); a.eyeMat = eyeMat(sex, a.eyeCol);
    a.variant = B.variants[a.build]; a.outfit = { full: a.variant.outfit.full.build(a), low: a.variant.outfit.low.build(a) };
    a.id = APPS[sex].length; APPS[sex].push(a);
  }
  // buskers: one look per act and body, built the same way
  const PERF_APPS = { M: {}, F: {} };
  for (const sex of ['M', 'F']) for (const act in PERFORMER_LOOKS) { const B = BODY[sex], a = Object.assign(makeAppearance(sex, 500 + Object.keys(PERFORMER_LOOKS).indexOf(act) * 7), { skirt: undefined, backpack: undefined, pouch: undefined, cap: undefined, sunglasses: undefined }, PERFORMER_LOOKS[act]);
    if (a.cap && !(a.hair === null || /Buzzed/.test(a.hair || ''))) a.hair = sex === 'M' ? 'Hair_Buzzed' : 'Hair_BuzzedFemale';
    a.skinTex = B.skinTex[a.mst < 5 ? 0 : 1]; a.mat = bodyMaterial(B.protoMat, B.lm, a); a.hairMat = hairMat(a.hair || 'Hair_Beard', a.hairCol); a.browMat = browMat(sex, a.hairCol); a.eyeMat = eyeMat(sex, a.eyeCol);
    a.build = 'everyday'; a.variant = B.variants.everyday; a.outfit = { full: a.variant.outfit.full.build(a), low: a.variant.outfit.low.build(a) }; a.id = 100 + Object.keys(PERFORMER_LOOKS).indexOf(act); PERF_APPS[sex][act] = a; }
  // the player: a fixed recipe, so he looks the same every run (oversized blue hoodie, black shorts, black skate shoes, white socks)
  const skaterApp = Object.assign(makeAppearance('M', 77), { top: 4, loose: 1.6, bottom: 1, shoes: 2, topCol: '#2f5daa', trimCol: '#244a8a', botCol: '#18181a', denim: false, shoeCol: '#1a1a1a', socks: true,   // oversized blue hoodie, black shorts
    underCol: '#222', hair: 'Hair_SimpleParted', hairCol: '#2a1c14', beard: false, mst: 6, eyeCol: EYES.darkBrown, cap: undefined, sunglasses: undefined, backpack: undefined, pouch: undefined, skirt: undefined });
  skaterApp.skinTex = BODY.M.skinTex[skaterApp.mst < 5 ? 0 : 1]; skaterApp.mat = bodyMaterial(BODY.M.protoMat, BODY.M.lm, skaterApp); skaterApp.hairMat = hairMat(skaterApp.hair, skaterApp.hairCol); skaterApp.browMat = browMat('M', skaterApp.hairCol); skaterApp.eyeMat = eyeMat('M', skaterApp.eyeCol);
  skaterApp.build = 'everyday'; skaterApp.variant = BODY.M.variants.everyday;
  skaterApp.outfit = { full: skaterApp.variant.outfit.full.build(skaterApp) }; skaterApp.outfit.low = skaterApp.outfit.full;

  // ---------------- props shared by rigs ----------------
  const phoneMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.3, metalness: 0.4, emissive: 0x9ab8ff, emissiveIntensity: 0.0 });
  const phoneGeo = new THREE.BoxGeometry(0.075, 0.155, 0.009);
  const leashMat = new THREE.MeshStandardMaterial({ color: 0xd2342a, roughness: 0.6 }), leashGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5).translate(0, 0.5, 0);   // unit cord along +y, stretched hand → collar

  // ---------------- rigs ----------------
  const OV_BONES = ['spine_01', 'spine_02', 'neck_01', 'Head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
  class Rig {
    constructor(sex) {
      const B = BODY[sex]; this.sex = sex; this.B = B;
      this.root = SkeletonUtils.clone(B.g.scene); this.wrap = new THREE.Group(); this.wrap.add(this.root);
      this.bones = {}; this.root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; if (o.isSkinnedMesh) { o.frustumCulled = false;
        const n = o.material.name; if (/Eyes/.test(n)) this.eyes = o; else if (/Hair/.test(n)) this.brows = o; else this.body = o; } });
      this.hair = new THREE.Mesh(HAIR_GEO.Hair_Buzzed, hairMat('Hair_Buzzed', '#222')); this.beard = new THREE.Mesh(HAIR_GEO.Hair_Beard, this.hair.material);
      for (const m of [this.hair, this.beard]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.bones.Head.add(m); }
      this.phone = new THREE.Mesh(phoneGeo, phoneMat); this.phone.visible = false; this.wrap.add(this.phone);
      // everything this character wears: one skinned mesh on the same skeleton as the body
      this.outfit = new THREE.SkinnedMesh(new THREE.BufferGeometry(), outfitMaterial); this.outfit.frustumCulled = false; this.outfit.castShadow = true; this.outfit.receiveShadow = true;
      this.body.parent.add(this.outfit); this.outfit.position.copy(this.body.position); this.outfit.quaternion.copy(this.body.quaternion); this.outfit.scale.copy(this.body.scale);
      this.outfit.bind(this.body.skeleton, this.body.bindMatrix);
      this.mixer = new THREE.AnimationMixer(this.root); this.actions = {}; this.cur = null; this.agent = null; this.acc = 0; this.inScene = false; this.shadow = null;
    }
    setApp(a) {
      this.app = a; this.body.material = a.mat; if (this.brows) this.brows.material = a.browMat; if (this.eyes && a.eyeMat) this.eyes.material = a.eyeMat;
      const v = a.variant || this.B.variants.super; this.body.geometry = this.lodFull === false ? v.geoLow : v.geoFull;
      this.hair.visible = !!a.hair && !a.cap; if (a.hair) { this.hair.geometry = HAIR_GEO[a.hair]; this.hair.material = a.hairMat; }   // close-cropped hair sits under a cap
      this.beard.visible = !!a.beard; if (a.beard) this.beard.material = a.hairMat;
      this.showOutfit();
    }
    showOutfit() { const o = this.app && this.app.outfit, g = o && (this.lodFull === false ? o.low : o.full); this.outfit.visible = !!g; if (g) this.outfit.geometry = g; }
    setShadow(on) { if (this.shadow === on) return; this.shadow = on; this.body.castShadow = on; this.hair.castShadow = on; this.beard.castShadow = on; this.outfit.castShadow = on; if (this.brows) this.brows.castShadow = false; }
    setDetail(near) { if (this.eyes) this.eyes.visible = near; if (this.brows) this.brows.visible = near; }
    setLOD(full) { if (this.lodFull === full) return; this.lodFull = full; const v = (this.app && this.app.variant) || this.B.variants.super; this.body.geometry = full ? v.geoFull : v.geoLow; this.showOutfit(); }
    action(name) { let a = this.actions[name]; if (!a) a = this.actions[name] = this.mixer.clipAction(this.B.clips[name]); return a; }
    play(name, { fade = 0.3, time, ts = 1 } = {}) {
      const a = this.action(name);
      if (this.cur === a) { a.timeScale = ts; return a; }
      a.reset(); a.timeScale = ts; a.setEffectiveWeight(1); if (time !== undefined) a.time = time % a.getClip().duration; a.play();
      if (this.cur && fade > 0) this.cur.crossFadeTo(a, fade, false); else if (this.cur) this.cur.stop();
      this.cur = a; return a;
    }
    snap(name, time, ts) { this.restore(); this.mixer.stopAllAction(); this.cur = null; this.play(name, { fade: 0, time, ts }); this.mixer.update(0); this.ovSaved = false; }
    // Procedural overrides: PropertyMixer only writes a bone when its sampled value changes, so bones we bend
    // after mixer.update() would keep (and compound) last frame's edit. Save the clip pose, restore it before the next update.
    update(dt) { this.restore(); this.mixer.update(dt); }
    saveOverride() { if (!this.ov) this.ov = OV_BONES.map((n) => [this.bones[n], new QT()]); for (const [b, q] of this.ov) q.copy(b.quaternion); this.ovSaved = true; }
    restore() { if (this.ovSaved) for (const [b, q] of this.ov) b.quaternion.copy(q); this.ovSaved = false; }
  }
  const POOL = { M: [], F: [] };
  for (const sex of ['M', 'F']) for (let i = 0; i < Q.rigsPerSex; i++) POOL[sex].push(new Rig(sex));
  const crowdGroup = new THREE.Group(); crowdGroup.name = 'crowd'; scene.add(crowdGroup);

  // ---------------- calibration: pelvis offsets for seated clips, foot heights ----------------
  const calib = {};
  { const r = POOL.M[0], rf = POOL.F[0];
    for (const rig of [r, rf]) {
      const c = calib[rig.sex] = {};
      for (const k of ['sit', 'drive', 'idle']) { rig.snap(CLIP[k], 0, 1); rig.wrap.updateMatrixWorld(true); rig.bones.pelvis.getWorldPosition(tmpV); c[k] = tmpV.clone();
        rig.bones.ball_l.getWorldPosition(tmpV); c[k + 'Toe'] = tmpV.y; }
      rig.snap(CLIP.idle, 0, 1); rig.wrap.updateMatrixWorld(true); rig.bones.foot_l.getWorldPosition(tmpV); c.footH = tmpV.y;
    } }

  // ---------------- impostor atlas: flipbook billboards baked from the rigs ----------------
  const FR = 4, CW = 48, CH = 96, NV = Q.appearances * 2, COLS = 16, ROWS = Math.ceil(NV * 2 * FR / COLS);
  const atlasRT = new THREE.WebGLRenderTarget(COLS * CW, ROWS * CH, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  {
    const bake = new THREE.Scene(); bake.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.78));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(0.3, 1, 0.4); bake.add(dl, dl.target);
    const oc = new THREE.OrthographicCamera(-0.5, 0.5, 2.0, 0, 0.1, 10);
    const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha(), prevTM = renderer.toneMapping;
    renderer.setRenderTarget(atlasRT); renderer.setClearColor(0x000000, 0); renderer.clear();
    let cell = 0;
    for (const sex of ['M', 'F']) { const rig = POOL[sex][1]; bake.add(rig.wrap); rig.setDetail(false);
      for (const a of APPS[sex]) { rig.setApp(a); a.cell0 = cell;
        for (let f = 0; f < FR; f++) { rig.snap(CLIP.walk, (f / FR) * rig.B.clips[CLIP.walk].duration, 1);
          for (let v = 0; v < 2; v++) {   // v0 = front (faces camera), v1 = back
            const col = cell % COLS, row = Math.floor(cell / COLS); cell++;
            oc.position.set(0, 0, v ? -3 : 3); oc.lookAt(0, 0, 0); oc.position.y = 0; oc.updateMatrixWorld();
            atlasRT.viewport.set(col * CW, row * CH, CW, CH); atlasRT.scissor.set(col * CW, row * CH, CW, CH); atlasRT.scissorTest = true;
            renderer.setRenderTarget(atlasRT); renderer.render(bake, oc);
          } } }
      bake.remove(rig.wrap); rig.setDetail(true); }
    atlasRT.scissorTest = false; atlasRT.viewport.set(0, 0, atlasRT.width, atlasRT.height);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear, prevAlpha); renderer.toneMapping = prevTM;
  }
  const IMP_N = 240;
  const impGeo = new THREE.PlaneGeometry(1, 2).translate(0, 1, 0);
  const aCell = new THREE.InstancedBufferAttribute(new Float32Array(IMP_N * 2), 2); impGeo.setAttribute('aCell', aCell);
  const impMat = new THREE.MeshStandardMaterial({ map: atlasRT.texture, alphaTest: 0.45, roughness: 0.9, metalness: 0 });
  impMat.onBeforeCompile = (s) => {
    s.uniforms.uCellSize = { value: new THREE.Vector2(CW / atlasRT.width, CH / atlasRT.height) };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell; uniform vec2 uCellSize;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * uCellSize + aCell;')
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(vec3(0.0, 0.55, 1.0));');
  };
  const impostors = new THREE.InstancedMesh(impGeo, impMat, IMP_N); impostors.frustumCulled = false; impostors.count = 0; impostors.castShadow = false; impostors.receiveShadow = false;
  scene.add(impostors);

  // ---------------- dogs ----------------
  function prepDog(g, name) {
    const box = new THREE.Box3().setFromObject(g.scene, true), size = box.getSize(new V3());
    const s = 0.62 / size.y;   // ~0.62 m to the top of the head
    g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    const walk = g.animations.find((c) => c.name === 'Walk') || g.animations.find((c) => /Walk/.test(c.name));
    const idle = g.animations.find((c) => c.name === 'Idle') || g.animations[0];
    // stride from the front-paw sweep during one walk cycle (stance ≈ 60% of the cycle)
    const tmp = SkeletonUtils.clone(g.scene); tmp.scale.setScalar(s); const mx = new THREE.AnimationMixer(tmp); const act = mx.clipAction(walk); act.play();
    let paw = null; tmp.traverse((o) => { if (o.isBone && !paw && /(Front|F).*(Foot|Paw|Toe)|(Foot|Paw).*(Front|F)|FrontLeg.*4|Hand/i.test(o.name)) paw = o; });
    let zmin = 1e9, zmax = -1e9;
    if (paw) for (let i = 0; i <= 24; i++) { mx.setTime(i / 24 * walk.duration); tmp.updateMatrixWorld(true); paw.getWorldPosition(tmpV); zmin = Math.min(zmin, tmpV.z); zmax = Math.max(zmax, tmpV.z); }
    const stride = paw ? (zmax - zmin) / 0.6 : 0.6; const speed = clamp(stride / walk.duration, 0.4, 2.5);
    return { g, name, s, walk, idle, speed };
  }
  const DOG_T = [prepDog(gShiba, 'shiba'), prepDog(gHusky, 'husky')];
  class DogRig { constructor(T) { this.T = T; this.root = SkeletonUtils.clone(T.g.scene); this.root.scale.setScalar(T.s); this.wrap = new THREE.Group(); this.wrap.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root); this.walk = this.mixer.clipAction(T.walk); this.idle = this.mixer.clipAction(T.idle); this.walk.play(); this.idle.play(); this.idle.weight = 0;
    this.leash = new THREE.Mesh(leashGeo, leashMat); this.leash.frustumCulled = false; this.leash.castShadow = true;
    this.agent = null; this.inScene = false; } }
  const DOGS = []; for (let i = 0; i < Q.dogs; i++) DOGS.push(new DogRig(DOG_T[i % 2]));

  // ---------------- bikes (no CC0 rigged bicycle found: procedural placeholder) ----------------
  const bikeFrameMats = ['#2a7de1', '#d9342b', '#1b1b1b', '#e8e2d4', '#24a865', '#f2cf4a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.5 }));
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 }), steelMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.35, metalness: 0.8 });
  const BK = { wheelR: 0.34, wheelZ: 0.53, crank: new V3(0, 0.3, 0.02), crankR: 0.17, saddle: new V3(0, 0.93, -0.24), grip: new V3(0.26, 1.1, 0.3) };
  function tube(a, b, r) { const d = new V3().subVectors(b, a), g = new THREE.CylinderGeometry(r, r, d.length(), 6); g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(new QT().setFromUnitVectors(new V3(0, 1, 0), d.clone().normalize())); g.translate(a.x, a.y, a.z); return g; }
  const bikeFrameGeo = (() => { const bb = BK.crank, st = new V3(0, 0.85, -0.2), ht = new V3(0, 0.88, 0.36), hb = new V3(0, 0.62, 0.42), rw = new V3(0, BK.wheelR, -BK.wheelZ), fw = new V3(0, BK.wheelR, BK.wheelZ);
    return mergeGeometries([tube(bb, st, 0.02), tube(bb, hb, 0.022), tube(st, ht, 0.02), tube(ht, hb, 0.022), tube(hb, fw, 0.016), tube(bb, rw, 0.014), tube(st, rw, 0.013),
      tube(ht, new V3(0, 1.06, 0.4), 0.015), tube(new V3(0, 1.06, 0.4), new V3(0, BK.grip.y, BK.grip.z), 0.014)]); })();
  const bikeSteelGeo = mergeGeometries([tube(new V3(-BK.grip.x, BK.grip.y, BK.grip.z), new V3(BK.grip.x, BK.grip.y, BK.grip.z), 0.012), new THREE.BoxGeometry(0.1, 0.05, 0.25).translate(0, BK.saddle.y - 0.02, BK.saddle.z),
    tube(new V3(0, 0.85, -0.2), new V3(0, BK.saddle.y - 0.03, BK.saddle.z), 0.012)]);
  const wheelGeo = new THREE.TorusGeometry(BK.wheelR - 0.02, 0.022, 6, 24).rotateY(Math.PI / 2);
  const spokeGeo = mergeGeometries([0, 1, 2, 3].map((i) => new THREE.BoxGeometry(0.004, (BK.wheelR - 0.03) * 2, 0.006).rotateX(i * Math.PI / 4)));
  const crankGeo = mergeGeometries([new THREE.BoxGeometry(0.02, 0.02, BK.crankR * 2 + 0.02).translate(0.09, 0, 0), new THREE.BoxGeometry(0.02, 0.02, BK.crankR * 2 + 0.02).translate(-0.09, 0, 0), new THREE.CylinderGeometry(0.08, 0.08, 0.01, 12).rotateZ(Math.PI / 2).translate(0.07, 0, 0)]);
  class Bike { constructor(i) { this.g = new THREE.Group(); const fr = new THREE.Mesh(bikeFrameGeo, bikeFrameMats[i % bikeFrameMats.length]), st = new THREE.Mesh(bikeSteelGeo, steelMat);
    this.wheels = [-1, 1].map((s) => { const w = new THREE.Group(); w.position.set(0, BK.wheelR, s * BK.wheelZ); w.add(new THREE.Mesh(wheelGeo, tireMat), new THREE.Mesh(spokeGeo, steelMat)); return w; });
    this.crank = new THREE.Mesh(crankGeo, steelMat); this.crank.position.copy(BK.crank);
    for (const m of [fr, st, this.crank, ...this.wheels.flatMap((w) => w.children)]) { m.castShadow = true; m.receiveShadow = true; }
    this.g.add(fr, st, this.crank, ...this.wheels); this.agent = null; this.inScene = false; } }
  const BIKES = []; for (let i = 0; i < 6; i++) BIKES.push(new Bike(i));

  // ---------------- station props (speaker / tip hat / towel) ----------------
  const towelMats = ['#e8322b', '#2a7de1', '#f2cf4a', '#24a865', '#e45a9a', '#f4f4f2'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
  const towelGeo = new THREE.BoxGeometry(0.85, 0.012, 1.85).translate(0, 0.006, 0);
  const speakerGeo = new THREE.BoxGeometry(0.34, 0.5, 0.3).translate(0, 0.25, 0), speakerMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6 });
  const hatGeo = new THREE.CylinderGeometry(0.16, 0.13, 0.08, 14, 1, true).translate(0, 0.04, 0), hatMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.9, side: THREE.DoubleSide });
  // bench sitters use the chair clip on a bench; the beggar, smoker and drummers sit on the ground (FLOOR = the
  // seat height the chair clip is placed at, so the pelvis ends up just above the ground; legs are posed by IK)
  const SIT_KINDS = new Set(['sit', 'beg', 'smoke', 'drum', 'guitar']), FLOOR = 0.03;
  const drumGeo = new THREE.LatheGeometry([[0.09, 0], [0.12, 0.04], [0.075, 0.2], [0.07, 0.3], [0.13, 0.46], [0.17, 0.56], [0.175, 0.6], [0, 0.6]].map(([x, y]) => new THREE.Vector2(x, y)), 18);
  const drumMats = ['#7a4a26', '#5a3418', '#9a6232'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  const cupGeo = new THREE.CylinderGeometry(0.045, 0.036, 0.11, 12, 1, true).translate(0, 0.055, 0), cupMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8, side: THREE.DoubleSide });
  const cigGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 6).rotateX(Math.PI / 2), cigMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7, emissive: 0xff5a10, emissiveIntensity: 0 });
  const signTex = ['ANYTHING|HELPS', 'HUNGRY|GOD BLESS'].map((txt) => { const c = document.createElement('canvas'); c.width = 256; c.height = 184; const x = c.getContext('2d');
    x.fillStyle = '#b48a5a'; x.fillRect(0, 0, 256, 184); for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(80,50,20,${Math.random() * 0.12})`; x.fillRect(Math.random() * 256, Math.random() * 184, 3, 3); }
    x.fillStyle = '#1a1410'; x.font = 'bold 40px "Marker Felt", "Comic Sans MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    txt.split('|').forEach((line, i) => { x.save(); x.translate(128, 60 + i * 64); x.rotate((Math.random() - 0.5) * 0.08); x.fillText(line, 0, 0); x.restore(); });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; });
  const signGeo = new THREE.PlaneGeometry(0.5, 0.36).translate(0, 0.18, 0), signMats = signTex.map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.95, side: THREE.DoubleSide }));
  const guitarGeo = mergeColored0([[new THREE.SphereGeometry(1, 14, 8).scale(0.2, 0.16, 0.06), 0x9a5a2a], [new THREE.SphereGeometry(1, 12, 8).scale(0.15, 0.12, 0.062).translate(0.17, 0, 0), 0x9a5a2a],
    [new THREE.CylinderGeometry(0.045, 0.045, 0.01, 12).rotateX(Math.PI / 2).translate(0.05, 0, 0.06), 0x1a120c], [new THREE.BoxGeometry(0.5, 0.045, 0.025).translate(0.52, 0, 0.02), 0x3a2414], [new THREE.BoxGeometry(0.12, 0.06, 0.03).translate(0.82, 0, 0.02), 0x2a1a10]]);
  const keysGeo = mergeColored0([[new THREE.BoxGeometry(1.0, 0.06, 0.3).translate(0, 0.85, 0), 0x18181a], [new THREE.BoxGeometry(0.94, 0.012, 0.13).translate(0, 0.885, 0.07), 0xf2f0ea],
    ...[-0.4, 0.4].flatMap((x) => [[new THREE.BoxGeometry(0.03, 0.82, 0.03).translate(x, 0.41, -0.06).rotateX(0.18), 0x2a2a2a], [new THREE.BoxGeometry(0.03, 0.82, 0.03).translate(x, 0.41, 0.06).rotateX(-0.18), 0x2a2a2a]])]);
  const propVcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  // breakdancers' floor: two flattened cardboard boxes, and a boombox at the edge (handle, two speakers, tape deck)
  const cardMat = new THREE.MeshStandardMaterial({ color: 0xb08a5c, roughness: 0.95 }), cardGeo = new THREE.BoxGeometry(1.0, 0.008, 1.5).translate(0, 0.004, 0);
  const boomGeo = mergeColored0([[new THREE.BoxGeometry(0.52, 0.27, 0.15).translate(0, 0.135, 0), 0x2a2a2e],
    ...[-0.16, 0.16].flatMap((x) => [[new THREE.CylinderGeometry(0.085, 0.085, 0.02, 16).rotateX(Math.PI / 2).translate(x, 0.13, 0.08), 0x9a9ea4], [new THREE.CylinderGeometry(0.065, 0.065, 0.025, 16).rotateX(Math.PI / 2).translate(x, 0.13, 0.085), 0x121214]]),
    [new THREE.BoxGeometry(0.12, 0.07, 0.02).translate(0, 0.16, 0.08), 0xc9ccd0], [new THREE.TorusGeometry(0.17, 0.012, 6, 16, Math.PI).translate(0, 0.27, 0), 0x6a6e74]]);
  function makeBreakStage() { const g = new THREE.Group(), a = new THREE.Mesh(cardGeo, cardMat), b = new THREE.Mesh(cardGeo, cardMat), bx = new THREE.Mesh(boomGeo, propVcol);
    a.position.set(-0.42, 0, 0.05); a.rotation.y = 0.08; b.position.set(0.45, 0.003, -0.08); b.rotation.y = -0.12; bx.position.set(1.15, 0, -0.55); bx.rotation.y = -0.6;
    for (const m of [a, b, bx]) { m.castShadow = m === bx; m.receiveShadow = true; g.add(m); } g.visible = false; return g; }
  class Prop { constructor() { this.towel = new THREE.Mesh(towelGeo, towelMats[0]); this.speaker = new THREE.Mesh(speakerGeo, speakerMat); this.hat = new THREE.Mesh(hatGeo, hatMat);
    this.drum = new THREE.Mesh(drumGeo, drumMats[0]); this.drum.scale.setScalar(0.8);   // a smaller djembe for playing seated on the ground
    this.cup = new THREE.Mesh(cupGeo, cupMat); this.sign = new THREE.Mesh(signGeo, signMats[0]); this.cig = new THREE.Mesh(cigGeo, cigMat);
    this.guitar = new THREE.Mesh(guitarGeo, propVcol); this.keys = new THREE.Mesh(keysGeo, propVcol); this.stage = makeBreakStage();
    this.g = new THREE.Group(); this.g.add(this.towel, this.speaker, this.hat, this.drum, this.cup, this.sign, this.cig, this.guitar, this.keys, this.stage);
    this.g.traverse((m) => { if (m.isMesh) { m.castShadow = m !== this.cig; m.receiveShadow = true; } }); this.agent = null; this.inScene = false; } }
  const PROPS = []; for (let i = 0; i < 48; i++) PROPS.push(new Prop());

  // ---------------- agents ----------------
  // Walkers live in a global pool spanning ~300 m around the camera; stations come from chunk layouts.
  const WALKERS = [];
  const LANE_CLEAR = Q.laneClear ?? 4.3;   // half-width of the play lanes kept free of ambient people
  const GAME_AGENTS = [];                  // pedestrians placed and moved by game.js (obstacles); rigged before anyone else
  R = mulberry32(31337);
  // people who sit or ride never get a dress: a skirt hangs straight and can't follow thighs bent forward
  const NO_SKIRT = new Set(['sit', 'beg', 'smoke', 'drum', 'guitar', 'cycle', 'skate', 'bboy']);
  function newAgent(kind, sex) { const s = sex || (chance(0.5) ? 'M' : 'F'); let app = pick(APPS[s]);
    if (NO_SKIRT.has(kind)) { const ok = APPS[s].filter((x) => !x.skirt); app = ok[Math.floor(R() * ok.length)]; }
    // the free bodies are 'Superhero' builds: narrow them in x/z for everyday proportions
    return { kind, sex: s, app, scale: s === 'M' ? rand(0.92, 1.03) : rand(0.9, 0.99), w: s === 'M' ? rand(0.84, 0.97) : rand(0.88, 0.99), x: 0, y: 0, z: 0, ry: 0, dir: 1, ts: 1, speed: 0,
      clip: CLIP.idle, t0: rand(0, 10), rig: null, dist: 1e9, vis: false, seen: -1, stopT: 0, stopFor: 0, stopClip: CLIP.idle, leader: null, offX: 0, offZ: 0,
      dog: null, dogRig: null, bike: null, prop: null, phase: R() }; }
  for (let i = 0; i < Q.walkers; i++) {
    const prev = WALKERS[i - 1];
    if (prev && !prev.leader && chance(0.22)) { const a = newAgent('walk'); a.leader = prev; a.gait = prev.gait; a.clip = prev.clip; a.offX = chance(0.5) ? 0.55 : -0.55; a.offZ = rand(-0.25, 0.25); WALKERS.push(a); continue; }
    const a = newAgent('walk'); a.gait = wpick([['walk', 0.8], ['formal', 0.12], ['jog', 0.08]]);
    a.clip = a.gait === 'jog' ? CLIP.jog : a.gait === 'formal' ? CLIP.walkFormal : CLIP.walk;
    a.ts = a.gait === 'jog' ? rand(0.66, 0.78) : rand(1.05, 1.32);
    a.speed = BODY[a.sex].speed[a.clip] * a.ts * a.scale;
    if (a.gait !== 'jog' && chance(0.07)) a.dog = DOG_T[randi(0, 1)];
    WALKERS.push(a);
  }
  const CYCLISTS = []; for (let i = 0; i < Q.cyclists; i++) { const a = newAgent('cycle'); a.speed = rand(3.8, 5.8); a.clip = CLIP.drive; a.crank = rand(0, 6.28); a.bikeId = i % BIKES.length; CYCLISTS.push(a); }
  function respawn(a, zRef, init) {
    if (a.kind === 'cycle') { a.dir = chance(0.5) ? 1 : -1; a.x = a.dir > 0 ? rand(-6.6, -6.1) : rand(-5.6, -5.1); a.z = init ? zRef - rand(-10, 280) : (a.dir > 0 ? zRef - rand(220, 280) : zRef - rand(200, 280)); return; }
    // ambient walkers stay off the four play lanes (|x| < LANE_CLEAR): right-hand strip, left pavers, or the grass
    const zone = R(); a.x = zone < 0.43 ? rand(LANE_CLEAR + 0.6, 8.6) : (zone < 0.86 ? -rand(LANE_CLEAR + 0.6, 7.2) : rand(-14, -8.2));   // right strip, left pavers (equal shares), grass
    a.dir = chance(0.5) ? 1 : -1; a.z = init ? zRef - rand(-10, 280) : zRef - rand(200, 290); a.stopT = rand(4, 30); a.stopFor = 0;
  }

  // station agents keyed on the station object (chunks rebuild their station lists when recycled)
  function stationAgent(st) {
    if (st.agent) return st.agent;
    R = mulberry32(st.seed); const a = newAgent(st.t, st.sex);
    a.x = st.x; a.y = st.y || 0; a.z = st.z; a.ry = st.ry || 0; a.st = st; a.scale = clamp(a.scale, 0.93, 1.0);
    if (st.t === 'sit') a.clip = chance(0.4) ? CLIP.sitTalk : CLIP.sit;
    else if (SIT_KINDS.has(st.t)) a.clip = CLIP.sit;
    else if (st.t === 'perform') a.clip = st.act === 'dance' ? CLIP.dance : st.act === 'spell' ? CLIP.spell : CLIP.talk;
    else if (st.t === 'watch' || st.t === 'selfie') a.clip = chance(0.3) && st.t === 'watch' ? CLIP.talk : CLIP.idle;
    else if (st.t === 'lie') a.clip = CLIP.lie;
    else if (st.t === 'browse') a.clip = chance(0.4) ? CLIP.talk : CLIP.idle;
    else if (st.t === 'bboy') { a.move = st.move; a.clip = bboyClip(st.move); a.app = PERF_APPS[a.sex][st.look] || a.app; }
    a.ts = st.t === 'lie' ? 0.35 : rand(0.85, 1.1);
    return (st.agent = a);
  }

  // game-controlled pedestrians: a stride-matched walker whose x/z the game owns (a.speed is the walk speed in m/s)
  function addGameWalker({ x, z, dir, seed, dog }) {
    R = mulberry32(seed >>> 0); const a = newAgent('walk'); a.game = true; a.gait = 'walk'; a.clip = CLIP.walk;
    a.ts = rand(dog ? 0.95 : 1.0, dog ? 1.1 : 1.25); a.speed = BODY[a.sex].speed[a.clip] * a.ts * a.scale; a.x = x; a.z = z; a.dir = dir; a.stopT = 1e9;
    if (dog) a.dog = DOG_T[randi(0, 1)];   // walks on a lead just ahead of the owner, in the same lane
    GAME_AGENTS.push(a); return a;
  }
  // people standing or lying still in a lane: 'selfie' (phone held up, a.ry = facing) or 'lie' (on a towel)
  function addGameStation({ kind, x, z, ry, seed, sex, move, look }) {
    R = mulberry32(seed >>> 0); const a = newAgent(kind, sex); a.game = true; a.x = x; a.y = 0; a.z = z; a.ry = ry; a.scale = clamp(a.scale, 0.93, 1.0);
    if (PERF_APPS[a.sex][look || kind]) a.app = PERF_APPS[a.sex][look || kind];   // buskers and breakdancers wear their act's outfit
    a.st = { t: kind, seed: seed >>> 0, noStage: true }; a.clip = kind === 'lie' ? CLIP.lie : SIT_KINDS.has(kind) ? CLIP.sit : kind === 'watch' && chance(0.35) ? CLIP.talk : CLIP.idle; a.ts = kind === 'lie' ? 0.35 : rand(0.85, 1.1);
    if (kind === 'bboy') { a.move = move || 'toprock'; a.clip = bboyClip(a.move); a.ts = 1; }
    if (SIT_KINDS.has(kind)) a.y = FLOOR;   // sitting on the ground
    GAME_AGENTS.push(a); return a;
  }
  function setClip(a, name, ts = a.ts) { a.clip = CLIP[name] || name; a.ts = ts; if (a.rig) a.rig.play(a.clip, { fade: 0.3, ts }); }
  function removeGameWalker(a) { const i = GAME_AGENTS.indexOf(a); if (i >= 0) GAME_AGENTS.splice(i, 1); if (a.rig) releaseRig(a.rig); }
  // game-controlled traffic crossing the boardwalk along x (dirX = ±1); the game sets a.x and a.speed each frame
  // riders: dirX = ±1 crosses the boardwalk; dirZ = ±1 rides along a lane (+1 = toward the camera)
  function addGameCyclist({ x, z, dirX, dirZ, seed }) {
    R = mulberry32(seed >>> 0); const a = newAgent('cycle'); a.game = true; a.clip = CLIP.drive; a.crank = rand(0, 6.28); a.x = x; a.z = z; a.speed = 0;
    a.yaw = dirZ ? (dirZ > 0 ? 0 : Math.PI) : (dirX > 0 ? Math.PI / 2 : -Math.PI / 2);   // rig faces +z at yaw 0
    GAME_AGENTS.push(a); return a;
  }
  function addGameSkater({ x, z, dirX, dirZ, seed }) {
    R = mulberry32(seed >>> 0); const a = newAgent('skate'); a.game = true; a.clip = CLIP.idle; a.ts = 0.6; a.x = x; a.z = z; a.speed = 0;
    a.yaw = dirZ ? (dirZ > 0 ? Math.PI : 0) : (dirX > 0 ? -Math.PI / 2 : Math.PI / 2);   // a board group travels along -z at yaw 0
    a.deckColor = pick([0x1d1d1f, 0x2a6fc9, 0xc9302c, 0x24a865, 0xf2cf4a]);
    GAME_AGENTS.push(a); return a;
  }

  // ---------------- skater rig (always full detail) ----------------
  const FLIP_H = 0.06;
  // skateboard: board (pitch/yaw) > flip (roll about the deck's long axis) > deck + wheels
  const truckMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.35, metalness: 0.85 }), wheelMat = new THREE.MeshStandardMaterial({ color: 0xf1e7c8, roughness: 0.5 }),
    woodMat = new THREE.MeshStandardMaterial({ color: 0xb07a45, roughness: 0.7 });
  // deck outline: straight rails with rounded nose and tail, extruded thin, then the last 15 cm at each end bent up
  // into the kicktails
  function deckGeo(hw, y0, th) {
    const shape = new THREE.Shape(), L = 0.33, cap = 0.1, N = 10;   // rails to |z| = L, then a rounded cap of length `cap`
    shape.moveTo(hw, -L); shape.lineTo(hw, -0.28); shape.lineTo(hw, 0.28); shape.lineTo(hw, L);
    for (let i = 1; i <= N; i++) { const a = i / N * Math.PI; shape.lineTo(hw * Math.cos(a), L + cap * Math.sin(a)); }
    shape.lineTo(-hw, 0.28); shape.lineTo(-hw, -0.28); shape.lineTo(-hw, -L);
    for (let i = 1; i < N; i++) { const a = Math.PI + i / N * Math.PI; shape.lineTo(hw * Math.cos(a), -L + cap * Math.sin(a)); }
    const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
    const p = g.attributes.position, kick = Math.tan(0.32);
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i), e = Math.abs(z) - 0.28; if (e > 0) p.setY(i, p.getY(i) + e * kick); }
    g.computeVertexNormals(); return g;
  }
  const deckTopGeo = deckGeo(0.098, 0.010, 0.004), deckPlyGeo = deckGeo(0.1, -0.002, 0.012);
  const truckGeo = mergeGeometries([-1, 1].flatMap((s) => [new THREE.BoxGeometry(0.06, 0.035, 0.05).translate(0, -0.02, s * 0.22), new THREE.CylinderGeometry(0.008, 0.008, 0.19, 6).rotateZ(Math.PI / 2).translate(0, -0.056, s * 0.22)]));
  const wheelGeo2 = new THREE.CylinderGeometry(0.027, 0.027, 0.032, 14).rotateZ(Math.PI / 2);
  function makeBoard(deckColor) {
    const board = new THREE.Group(), flip = new THREE.Group(); flip.position.y = FLIP_H; board.add(flip);
    const deck = new THREE.Group(); deck.position.y = 0.083 - FLIP_H; deck.add(new THREE.Mesh(deckTopGeo, new THREE.MeshStandardMaterial({ color: deckColor, roughness: 0.95 })), new THREE.Mesh(deckPlyGeo, woodMat), new THREE.Mesh(truckGeo, truckMat)); flip.add(deck);
    const wheels = []; for (const s of [-1, 1]) for (const xs of [-1, 1]) { const w = new THREE.Mesh(wheelGeo2, wheelMat); w.position.set(xs * 0.085, 0.027 - FLIP_H, s * 0.22); flip.add(w); wheels.push(w); }
    board.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return { board, flip, deck, wheels, g: board, agent: null, inScene: false };
  }
  const sk = new Rig('M'); sk.setApp(skaterApp); sk.setShadow(true);
  // the player: the everyday build's reduced mesh (light, ~5k triangles) and a softer skin normal map
  sk.body.geometry = skaterApp.variant.geoLow;
  skaterApp.mat.normalScale.set(0.4, 0.4); skaterApp.mat.roughness = 1;
  if (sk.brows) sk.brows.visible = false;   // brows/eye cards add little at chase-camera distance
  const mainBoard = makeBoard(0x1d1d1f), board = mainBoard.board, flip = mainBoard.flip; skater.add(board); skater.add(sk.wrap);
  sk.wheels = mainBoard.wheels; sk.deck = mainBoard.deck; sk.snap(CLIP.idle, 0, 0.6);
  const SKT = { lean: 0, prevX: S.x, vx: 0, wheelA: 0, stanceA: Math.PI / 2 };
  const DECK_TOP = 0.083 + 0.014;

  // ---------------- per-frame state ----------------
  const frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(new V3(), 1.4), camPos = new V3();
  const cands = []; let tick = 0, lodT = 0, initDone = false, lastZ = 0;
  const stats = { rigs: 0, near: 0, mid: 0, imp: 0, mixers: 0, dogs: 0 };
  function visible(x, y, z, r) { _sph.center.set(x, y, z); _sph.radius = r; return frustum.intersectsSphere(_sph); }

  function ensureInScene(o) { if (!o.inScene) { crowdGroup.add(o.wrap || o.g); o.inScene = true; } }
  function removeFromScene(o) { if (o.inScene) { crowdGroup.remove(o.wrap || o.g); o.inScene = false; } }
  function releaseRig(r) { const a = r.agent; if (a) { a.rig = null; if (a.dogRig) { a.dogRig.agent = null; removeFromScene(a.dogRig); a.dogRig.leash.removeFromParent(); a.dogRig = null; }
      if (a.bike) { a.bike.agent = null; removeFromScene(a.bike); a.bike = null; } if (a.board) { a.board.agent = null; removeFromScene(a.board); a.board = null; } if (a.prop) { a.prop.agent = null; removeFromScene(a.prop); a.prop = null; } }
    r.agent = null; r.phone.visible = false; removeFromScene(r); }
  function assignRig(a) {
    const pool = POOL[a.sex]; let r = null; for (const x of pool) if (!x.agent && !x.lineup) { r = x; break; } if (!r) return false;
    // IK-driven rigs keep a uniform scale so world-space bone maths stays exact
    const wb = a.kind === 'cycle' || a.kind === 'selfie' || a.kind === 'skate' || a.kind === 'piano' || a.kind === 'bboy' || (SIT_KINDS.has(a.kind) && a.kind !== 'sit') ? 1 : a.w;
    r.agent = a; a.rig = r; r.setApp(a.app); r.acc = 0; r.wrap.scale.set(a.scale * wb, a.scale, a.scale * wb);
    placeRig(a); r.snap(currentClip(a), a.t0 + performance.now() * 0.001, a.ts); r.phone.visible = a.kind === 'selfie'; ensureInScene(r);
    if (a.dog) { let d = DOGS.find((x) => !x.agent && x.T === a.dog) || DOGS.find((x) => !x.agent);
      if (!d && a.game) { d = DOGS.find((x) => x.agent && !x.agent.game); if (d) releaseRig(d.agent.rig); }   // game dogs take one from the ambient crowd
      if (d) { d.agent = a; a.dogRig = d; ensureInScene(d); crowdGroup.add(d.leash); } }
    if (a.kind === 'cycle') { let b = BIKES.find((x) => !x.agent);
      if (!b && a.game) { b = BIKES.find((x) => x.agent && !x.agent.game); if (b) releaseRig(b.agent.rig); }   // game traffic takes a bike from an ambient cyclist
      if (b) { b.agent = a; a.bike = b; ensureInScene(b); } }
    if (a.kind === 'skate') { const bd = CRUISE_BOARDS.find((x) => !x.agent); if (bd) { bd.agent = a; a.board = bd; bd.deck.children[0].material.color.setHex(a.deckColor); ensureInScene(bd); } }
    if (a.kind === 'lie' || a.kind === 'piano' || (a.kind === 'perform' && a.st.act !== 'spell') || (SIT_KINDS.has(a.kind) && a.kind !== 'sit') || a.kind === 'smokeStand' || (a.kind === 'bboy' && !a.st.noStage)) { const p = PROPS.find((x) => !x.agent); if (p) { p.agent = a; a.prop = p; ensureInScene(p); setupProp(a); } }
    return true;
  }
  function setupProp(a) { const p = a.prop, lie = a.kind === 'lie', perf = a.kind === 'perform', sit = SIT_KINDS.has(a.kind), h = a.st.seed >>> 3;
    p.towel.visible = lie; p.speaker.visible = perf && a.st.act === 'dance'; p.hat.visible = perf;
    p.towel.material = towelMats[h % towelMats.length];
    p.drum.visible = a.kind === 'drum'; p.drum.material = drumMats[h % drumMats.length]; p.drum.position.set(0, 0, 0.52);
    p.guitar.visible = a.kind === 'guitar'; p.keys.visible = a.kind === 'piano'; p.keys.position.set(0, 0, 0.42);
    p.cup.visible = a.kind === 'beg'; p.sign.visible = a.kind === 'beg'; p.sign.material = signMats[h % signMats.length]; p.sign.position.set(-0.42, 0, 0.3); p.sign.rotation.set(-0.25, 0.35, 0);
    p.cig.visible = a.kind === 'smoke' || a.kind === 'smokeStand'; p.stage.visible = a.kind === 'bboy';
    p.g.position.set(a.x, sit ? a.y - FLOOR : a.y, a.z); p.g.rotation.set(0, a.ry, 0); p.g.updateMatrixWorld(true);
    p.speaker.position.set(0.9, 0, -0.3); p.hat.position.set(0.1, 0, 0.75); p.towel.position.set(0, 0, 0); }
  function consider(a) { const dx = a.x - camPos.x, dz = a.z - camPos.z; a.dist = Math.sqrt(dx * dx + dz * dz); a.seen = tick; a.key = a.game ? a.dist - 1e4 : a.dist;
    a.vis = a.dist < Q.rImp && visible(a.x, 0.9, a.z, a.kind === 'cycle' ? 1.8 : 1.4); if (a.vis && a.dist < (a.game ? Q.rRig * 2 : Q.rRig)) cands.push(a); }   // game obstacles get rigs further out (they spawn further ahead at speed)
  // walkers side-step people standing on the walk (performers, their audience, selfie-takers)
  const OBST = [];
  function avoidX(a) { let off = 0; for (let i = 0; i < OBST.length; i++) { const o = OBST[i], dz = Math.abs(o.z - a.z), dx = a.x - o.x;
      if (dz < 3 && Math.abs(dx) < 1.1) off += Math.sign(dx || 1) * (1.1 - Math.abs(dx)) * smooth(3, 0.8, dz); } a.avoid = lerp(a.avoid || 0, off, 0.15); return a.avoid; }
  function currentClip(a) { return a.kind === 'walk' && a.stopFor > 0 ? a.stopClip : a.clip; }

  // world placement for an agent's rig root
  const _q = new QT(), _e = new THREE.Euler(), _lq = new QT(), _Zax = new V3(0, 0, 1);
  function placeRig(a) {
    const r = a.rig, w = r.wrap, c = calib[a.sex];
    if (a.kind === 'walk') { w.position.set(a.x + (a.game ? 0 : avoidX(a)), 0, a.z); w.rotation.set(0, a.stopFor > 0 ? a.stopYaw : (a.dir > 0 ? 0 : Math.PI), 0); }
    else if (SIT_KINDS.has(a.kind)) { // put the clip's pelvis 0.1 m above the seat, slightly behind the seat centre
      const px = c.sit.x * a.scale, pz = c.sit.z * a.scale, py = c.sit.y * a.scale; const sn = Math.sin(a.ry), cs = Math.cos(a.ry);
      const tx = a.x - sn * 0.05, tz = a.z - cs * 0.05; w.position.set(tx - (px * cs + pz * sn), a.y + 0.11 - py, tz - (-px * sn + pz * cs)); w.rotation.set(0, a.ry, 0); }
    else if (a.kind === 'lie') {   // on the back on a towel: tipped 90° about x, head toward -z before the yaw
      const h = 0.85 * a.scale; w.position.set(a.x + Math.sin(a.ry) * h, a.y + 0.13 * a.scale, a.z + Math.cos(a.ry) * h); w.rotation.set(-Math.PI / 2, a.ry, 0, 'YXZ'); }
    else if (a.kind === 'cycle') { const b = a.bike, yaw = a.yaw ?? (a.dir > 0 ? 0 : Math.PI); w.rotation.set(0, yaw, 0);
      const py = c.drive.y * a.scale, pz = c.drive.z * a.scale, off = BK.saddle.z - pz;
      w.position.set(a.x + Math.sin(yaw) * off, BK.saddle.y + 0.1 - py, a.z + Math.cos(yaw) * off);
      if (b) { b.g.position.set(a.x, 0, a.z); b.g.rotation.set(0, yaw, 0); } }
    else if (a.kind === 'skate') {   // cruising side-on on a board, like the player's skater; a.lean tips rider and board about the travel axis
      _q.setFromAxisAngle(_UP, a.yaw); if (a.lean) _q.multiply(_lq.setFromAxisAngle(_Zax, a.lean));
      const bd = a.board; if (bd) { bd.board.position.set(a.x, 0, a.z); bd.board.quaternion.copy(_q); }
      w.quaternion.copy(_q).multiply(_sideQ); _p.set(-0.03, -0.3 * 0.24, 0).applyQuaternion(_q); w.position.set(a.x + _p.x, _p.y, a.z + _p.z); }
    else if (a.kind === 'bboy') bboyPlace(a, w);
    else { w.position.set(a.x, a.y, a.z); w.rotation.set(0, a.ry, 0); }
  }

  // ---------------- breakdancers ----------------
  // The free clip set has no breaking, so the power moves are posed here: the whole rig turns (headspin: upside down,
  // spinning on the top of the head; windmill: rolling across the upper back while the body spins about it) and the
  // limbs are set on top of a base clip. Footwork circles low on one hand; toprock is the dance clip.
  function bboyClip(move) { return move === 'footwork' ? CLIP.crouchIdle : move === 'toprock' ? CLIP.dance : CLIP.idle; }
  let curT = 0; const _bq1 = new QT(), _bq2 = new QT(), _bq3 = new QT(), _bv = new V3(), _Xa = new V3(1, 0, 0);
  function bboyPlace(a, w) {
    const k = curT + a.phase * 10, s = a.scale, Bd = BODY[a.sex];
    if (a.move === 'headspin') { _bq1.setFromAxisAngle(_Ya, k * 4.2); _bq2.setFromAxisAngle(_Xa, Math.PI); w.quaternion.copy(_bq1).multiply(_bq2); w.position.set(a.x, a.y + Bd.height * s - 0.03, a.z); }
    else if (a.move === 'windmill') {   // lie on the back (head toward -z), roll about the spine, spin about the vertical, pivoting on the upper back
      const ph = k * 3.0; _bq1.setFromAxisAngle(_Ya, ph + a.ry); _bq2.setFromAxisAngle(_Zax, ph); _bq3.setFromAxisAngle(_Xa, -Math.PI / 2); w.quaternion.copy(_bq1).multiply(_bq2).multiply(_bq3);
      _bv.set(0, Bd.lm[1].x * s, 0).applyQuaternion(w.quaternion); w.position.set(a.x - _bv.x, a.y + 0.16 - _bv.y, a.z - _bv.z); }
    else if (a.move === 'footwork') { w.position.set(a.x, a.y - 0.12, a.z); w.rotation.set(0, a.ry + k * 1.2, 0); }
    else { w.position.set(a.x, a.y, a.z); w.rotation.set(0, a.ry + Math.sin(k * 0.6) * 0.6, 0); }   // toprock, turning to the crowd
  }
  const _Ya = new V3(0, 1, 0);
  function bboyPose(a, r) {
    const B = r.bones, k = curT + a.phase * 10; r.wrap.updateMatrixWorld(true); r.wrap.getWorldQuaternion(_q);
    _f.set(0, 0, 1).applyQuaternion(_q); _r.set(-1, 0, 0).applyQuaternion(_q);   // the body's own forward / right (they turn over with it)
    if (a.move === 'headspin') {   // legs split in a wide V that opens and closes a little, arms out
      const v = 0.75 + Math.sin(k * 1.3) * 0.12; rotWorld(B.thigh_l, _f, v); rotWorld(B.thigh_r, _f, -v); rotWorld(B.upperarm_l, _f, 1.15); rotWorld(B.upperarm_r, _f, -1.15);
    } else if (a.move === 'windmill') {   // legs held up in a wide V while the body rolls under them (they swap sides over the top), arms tucked to the chest
      B.pelvis.getWorldPosition(_hp); _h.set(_r.x, 0, _r.z); const side = _h.length(); _h.normalize();
      for (const sd of [1, -1]) { const L = sd > 0; _t.copy(_hp).addScaledVector(_UP, 0.62 + 0.1 * (1 - side)).addScaledVector(_h, -sd * 0.7 * side);
        _p.copy(_UP).addScaledVector(_h, -sd); ik2(L ? B.thigh_l : B.thigh_r, L ? B.calf_l : B.calf_r, L ? B.foot_l : B.foot_r, _t, _p); }
      rotWorld(B.upperarm_l, _f, 0.35); rotWorld(B.upperarm_r, _f, -0.35); rotWorld(B.lowerarm_l, _r, 1.6); rotWorld(B.lowerarm_r, _r, 1.6);
    } else if (a.move === 'footwork') {   // squatting low on the right hand, legs sweeping out and back in turn
      rotWorld(B.spine_01, _r, -0.55); rotWorld(B.spine_01, _f, 0.35); B.spine_01.updateMatrixWorld(true);
      B.pelvis.getWorldPosition(_hp); const fh = calib[r.sex].footH, p = k * 2.6;
      for (const side of [1, -1]) { const L = side > 0, ph = p + (L ? 0 : Math.PI), out = 0.3 + 0.24 * Math.max(0, Math.sin(ph));
        _t.copy(_hp).addScaledVector(_r, -side * out).addScaledVector(_f, 0.2 * Math.cos(ph)); _t.y = a.y + fh;
        _p.copy(_f).addScaledVector(_UP, 0.5).addScaledVector(_r, -side * 0.6); ik2(L ? B.thigh_l : B.thigh_r, L ? B.calf_l : B.calf_r, L ? B.foot_l : B.foot_r, _t, _p); }
      _t.copy(_hp).addScaledVector(_r, 0.36).addScaledVector(_f, -0.18); _t.y = a.y + 0.07; _p.copy(_r).addScaledVector(_UP, -0.3); ik2(B.upperarm_r, B.lowerarm_r, B.hand_r, _t, _p);
      rotWorld(B.upperarm_l, _f, 0.9);
    }
  }

  // ---------------- procedural overrides (run after mixer.update) ----------------
  const _t = new V3(), _p = new V3(), _h = new V3(), _f = new V3(), _r = new V3(), _u = new V3(0, 1, 0), _d = new V3(), _u0 = new V3(0, 1, 0);
  function selfie(r, t) {
    const B = r.bones; r.wrap.updateMatrixWorld(true);
    r.wrap.getWorldQuaternion(_q); _f.set(0, 0, 1).applyQuaternion(_q); _r.set(-1, 0, 0).applyQuaternion(_q);
    B.Head.getWorldPosition(_h);
    _t.copy(_h).addScaledVector(_f, 0.42).addScaledVector(_u, 0.1 + Math.sin(t * 0.7) * 0.02).addScaledVector(_r, 0.12);
    _p.copy(_u).multiplyScalar(-0.7).addScaledVector(_r, 0.7);
    ik2(B.upperarm_r, B.lowerarm_r, B.hand_r, _t, _p);
    rotWorld(B.Head, _r, 0.1); B.Head.updateMatrixWorld(true);
    // phone in the palm, screen toward the face (placed in world space, stored in the wrapper's frame)
    B.hand_r.getWorldPosition(_p); _p.addScaledVector(_f, 0.04).addScaledVector(_u, 0.04);
    _d.subVectors(_h, _p).normalize(); _phM.lookAt(_d, _O, _u); _phQ.setFromRotationMatrix(_phM);
    r.phone.position.copy(_p); r.wrap.worldToLocal(r.phone.position);
    r.phone.quaternion.copy(_q).invert().multiply(_phQ); r.phone.scale.set(1 / r.wrap.scale.x, 1 / r.wrap.scale.y, 1 / r.wrap.scale.z);
  }
  const _phM = new THREE.Matrix4(), _phQ = new QT(), _O = new V3();
  // lying on the towel: bring the T-pose arms down beside the body, slight knee bend
  // seated people: drumming hands on the djembe, a cigarette raised to the mouth now and then, a cup held out
  const _hp = new V3(), _sq = new QT();
  function handTo(mesh, prop, hand, fwd, up) { hand.updateMatrixWorld(true); hand.getWorldPosition(_hp).addScaledVector(_f, fwd).addScaledVector(_UP, up); prop.g.worldToLocal(_hp); mesh.position.copy(_hp); }
  // a drag every ~7 s: the right hand comes up to the mouth, then a puff on the exhale (sitting or standing smokers)
  function smokeArm(a, r, t) {
    const B = r.bones, P = a.prop; r.wrap.updateMatrixWorld(true); r.wrap.getWorldQuaternion(_q);
    _f.set(0, 0, 1).applyQuaternion(_q); _r.set(-1, 0, 0).applyQuaternion(_q);
    const c = (t + a.phase * 7) % 7, lift = smooth(0, 0.7, c) * (1 - smooth(2.3, 3.0, c));
    B.Head.getWorldPosition(_h);
    if (lift > 0.01) { _t.copy(_h).addScaledVector(_f, 0.11).addScaledVector(_UP, -0.07).addScaledVector(_r, 0.02);
      _p.copy(_UP).multiplyScalar(-0.7).addScaledVector(_r, 0.6); ik2(B.upperarm_r, B.lowerarm_r, B.hand_r, _t, _p, lift); }
    else if (a.kind === 'smokeStand') { B.upperarm_r.getWorldPosition(_hp); _t.copy(_hp).addScaledVector(_UP, -0.46).addScaledVector(_f, 0.13).addScaledVector(_r, 0.1);   // cigarette held low at the side between drags
      _p.copy(_UP).multiplyScalar(-1).addScaledVector(_r, 0.5); ik2(B.upperarm_r, B.lowerarm_r, B.hand_r, _t, _p, 1); }
    if (P) { handTo(P.cig, P, B.hand_r, 0.05, 0.0); P.cig.rotation.set(0, 0, 0); }
    cigMat.emissiveIntensity = 1.5;
    if (a.puffC !== undefined && a.puffC < 3.1 && c >= 3.1) puff(_h.x + _f.x * 0.15, _h.y - 0.04, _h.z + _f.z * 0.15);   // exhale after the drag
    a.puffC = c;
  }
  function sitArms(a, r, t) {
    const B = r.bones, P = a.prop; r.wrap.updateMatrixWorld(true); r.wrap.getWorldQuaternion(_q);
    _f.set(0, 0, 1).applyQuaternion(_q); _r.set(-1, 0, 0).applyQuaternion(_q);   // character forward / right
    const g0 = a.y - FLOOR, fh = calib[r.sex].footH * 0.8;
    // legs on the ground: drummers (and half the beggars) cross-legged, everyone else knees up with feet flat
    const cross = a.kind === 'drum' || a.kind === 'guitar' || (a.kind === 'beg' && a.phase < 0.5);
    B.pelvis.getWorldPosition(_hp);
    for (const side of [1, -1]) {   // +1 = left leg
      const L = side > 0;
      if (cross) { _t.copy(_hp).addScaledVector(_f, 0.3).addScaledVector(_r, side * 0.12); _p.copy(_r).multiplyScalar(-side).addScaledVector(_UP, 0.35).addScaledVector(_f, 0.4); }
      else { _t.copy(_hp).addScaledVector(_f, 0.5).addScaledVector(_r, -side * 0.17); _p.copy(_UP).addScaledVector(_f, 0.6).addScaledVector(_r, -side * 0.25); }
      _t.y = g0 + fh;
      ik2(L ? B.thigh_l : B.thigh_r, L ? B.calf_l : B.calf_r, L ? B.foot_l : B.foot_r, _t, _p);
    }
    // the free hand rests on its knee (both hands drum for drummers, the guitarist plays)
    if (a.kind !== 'drum' && a.kind !== 'guitar') { B.calf_l.getWorldPosition(_t); _t.addScaledVector(_UP, 0.06).addScaledVector(_f, -0.04); _p.copy(_UP).multiplyScalar(-1).addScaledVector(_r, -0.5);
      ik2(B.upperarm_l, B.lowerarm_l, B.hand_l, _t, _p, 0.85); }
    if (a.kind === 'guitar' && P) {   // guitar across the lap, neck up to the left: strum with the right hand, fret with the left
      B.pelvis.getWorldPosition(_hp); _t.copy(_hp).addScaledVector(_f, 0.24).addScaledVector(_UP, 0.26).addScaledVector(_r, 0.04);
      _gx.copy(_r).multiplyScalar(-Math.cos(0.5)).addScaledVector(_UP, Math.sin(0.5)).normalize(); _gz.copy(_f); _gy.crossVectors(_gz, _gx).normalize(); _gz.crossVectors(_gx, _gy);
      _gm.makeBasis(_gx, _gy, _gz); _gq.setFromRotationMatrix(_gm); P.g.getWorldQuaternion(_sq); P.guitar.quaternion.copy(_sq.invert().multiply(_gq));
      _hp.copy(_t); P.g.worldToLocal(_hp); P.guitar.position.copy(_hp);
      const strum = Math.sin(t * 7 + a.phase * 6);
      _p.copy(_t).addScaledVector(_f, 0.07).addScaledVector(_UP, strum * 0.06).addScaledVector(_gx, 0.04); _h.copy(_UP).multiplyScalar(-1).addScaledVector(_r, 0.6); ik2(B.upperarm_r, B.lowerarm_r, B.hand_r, _p, _h);
      _p.copy(_t).addScaledVector(_gx, 0.5 + Math.sin(t * 0.9 + a.phase * 3) * 0.06).addScaledVector(_f, 0.05); _h.copy(_UP).multiplyScalar(-1).addScaledVector(_r, -0.6); ik2(B.upperarm_l, B.lowerarm_l, B.hand_l, _p, _h);
      return;
    }
    if (a.kind === 'drum') {
      for (const side of [1, -1]) {   // +1 = left hand; hands alternate, each beat is a quick drop onto the head
        const beat = Math.max(0, Math.sin(t * (8 + a.phase * 2) + a.phase * 6.28 + (side > 0 ? 0 : Math.PI)));
        _t.set(a.x, g0 + 0.5 + beat * 0.13, a.z).addScaledVector(_f, 0.52).addScaledVector(_r, -side * 0.07);
        _p.copy(_r).multiplyScalar(-side * 0.8).addScaledVector(_UP, -0.5);
        const L = side > 0; ik2(L ? B.upperarm_l : B.upperarm_r, L ? B.lowerarm_l : B.lowerarm_r, L ? B.hand_l : B.hand_r, _t, _p);
      }
    } else if (a.kind === 'smoke') { smokeArm(a, r, t);
    } else if (a.kind === 'beg') {
      B.upperarm_r.getWorldPosition(_hp); _t.copy(_hp).addScaledVector(_f, 0.42).addScaledVector(_UP, -0.26 + Math.sin(t * 1.3 + a.phase * 6) * 0.03).addScaledVector(_r, 0.3);   // cup held out beside the knees
      _p.copy(_UP).multiplyScalar(-1).addScaledVector(_r, 0.4); ik2(B.upperarm_r, B.lowerarm_r, B.hand_r, _t, _p, 0.9);
      if (P) handTo(P.cup, P, B.hand_r, 0.03, 0.02);
    }
  }
  const _gx = new V3(), _gy = new V3(), _gz = new V3(), _gm = new THREE.Matrix4(), _gq = new QT();
  // standing keyboard player: hands walk up and down the keys, a little bounce on each note
  function pianoArms(a, r, t) {
    const B = r.bones; r.wrap.updateMatrixWorld(true); r.wrap.getWorldQuaternion(_q); _f.set(0, 0, 1).applyQuaternion(_q); _r.set(-1, 0, 0).applyQuaternion(_q);
    for (const side of [1, -1]) { const L = side > 0, k = t * 2.2 + a.phase * 6 + (L ? 0 : 1.7);
      _t.set(a.x, 0.9 + Math.max(0, Math.sin(k * 3)) * 0.03, a.z).addScaledVector(_f, 0.36).addScaledVector(_r, -side * (0.18 + Math.sin(k) * 0.08));
      _p.copy(_UP).multiplyScalar(-1).addScaledVector(_r, -side * 0.7); ik2(L ? B.upperarm_l : B.upperarm_r, L ? B.lowerarm_l : B.lowerarm_r, L ? B.hand_l : B.hand_r, _t, _p); }
    rotWorld(B.Head, _r, 0.25);
  }
  const cueTex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const bellTex = cueTex((x) => { x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.arc(32, 32, 30, 0, 6.29); x.fill(); x.fillStyle = '#ffd23f';
    x.beginPath(); x.moveTo(18, 42); x.quadraticCurveTo(20, 14, 32, 14); x.quadraticCurveTo(44, 14, 46, 42); x.closePath(); x.fill(); x.fillRect(14, 41, 36, 5); x.beginPath(); x.arc(32, 50, 4, 0, 6.29); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 3; for (const s of [-1, 1]) { x.beginPath(); x.arc(32, 30, 24, s > 0 ? -0.5 : Math.PI - 0.3, s > 0 ? 0.3 : Math.PI + 0.5); x.stroke(); } });
  const flashTex = cueTex((x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,250,235,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  const CUES = []; for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: bellTex, transparent: true, depthWrite: false })); s.visible = false; s.renderOrder = 5; crowdGroup.add(s); CUES.push(s); }
  function cue(a, type) { const s = CUES.find((c) => !c.visible); if (!s || !a.rig) return; s.userData = { a, type, t: 0, life: type === 'bell' ? 1.1 : 0.22 };
    s.material.map = type === 'bell' ? bellTex : flashTex; s.material.blending = type === 'bell' ? THREE.NormalBlending : THREE.AdditiveBlending; s.material.needsUpdate = true; s.visible = true; }
  function updateCues(dt) { for (const s of CUES) if (s.visible) { const u = s.userData; u.t += dt; const a = u.a, k = u.t / u.life;
      if (k >= 1 || !a.rig) { s.visible = false; continue; }
      if (u.type === 'bell') { s.position.set(a.x, 2.3 + Math.abs(Math.sin(u.t * 14)) * 0.08, a.z); s.scale.setScalar(0.65); s.material.opacity = 1 - smooth(0.7, 1, k); s.material.rotation = Math.sin(u.t * 24) * 0.3; }
      else { a.rig.phone.getWorldPosition(s.position); s.scale.setScalar(0.5 + k * 1.2); s.material.opacity = 1 - k; s.material.rotation = 0; } } }
  // debug lineup (L): 24 pooled rigs (12 per body, one appearance each) in two rows facing +z, idling, full detail
  const LINEUP = { rigs: [] };
  function lineup(on, cx = 0, cz = 0, clip = 'idle') {
    for (const r of LINEUP.rigs) { r.lineup = false; removeFromScene(r); } LINEUP.rigs = [];
    if (!on) return [];
    let i = 0;
    for (let k = 0; k < 12; k++) for (const sex of ['M', 'F']) {
      const r = POOL[sex].find((x) => !x.lineup && (!x.agent || !x.agent.game)); if (!r) continue; if (r.agent) releaseRig(r);
      r.lineup = true; const a = APPS[sex][k % APPS[sex].length]; r.setApp(a); r.setShadow(true); r.setDetail(true); r.setLOD(true); r.phone.visible = false;
      const row = i < 12 ? 0 : 1, col = i % 12; r.wrap.scale.setScalar(1); r.wrap.position.set(cx + (col - 5.5) * 0.85 + row * 0.42, 0, cz + row * 2.2); r.wrap.rotation.set(0, Math.PI, 0);
      r.snap(CLIP[clip] || clip, i * 0.37, 1); ensureInScene(r); LINEUP.rigs.push(r); i++;
    }
    return LINEUP.rigs.map((r) => ({ x: r.wrap.position.x, z: r.wrap.position.z, sex: r.sex, app: r.app.id }));
  }
  // smoke puffs: a small pool of fading spheres
  const PUFFS = []; { const pg = new THREE.SphereGeometry(0.05, 8, 6);
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xdcdcdc, transparent: true, opacity: 0, depthWrite: false })); m.visible = false; m.userData.t = 9; m.frustumCulled = false; crowdGroup.add(m); PUFFS.push(m); } }
  function puff(x, y, z) { const m = PUFFS.find((p) => p.userData.t > 2.4); if (!m) return; m.userData.t = 0; m.position.set(x, y, z); m.visible = true; }
  function updatePuffs(dt) { for (const m of PUFFS) if (m.visible) { const u = m.userData; u.t += dt; m.position.y += dt * 0.22; m.position.x += dt * 0.06;
    m.scale.setScalar(1 + u.t * 1.3); m.material.opacity = 0.2 * (1 - u.t / 2.4); if (u.t > 2.4) m.visible = false; } }
  function lieArms(r) { const B = r.bones; r.wrap.updateMatrixWorld(true); r.wrap.getWorldQuaternion(_q); _f.set(0, 0, 1).applyQuaternion(_q); _r.set(1, 0, 0).applyQuaternion(_q);
    rotWorld(B.upperarm_l, _f, -1.25); rotWorld(B.upperarm_r, _f, 1.25); rotWorld(B.lowerarm_l, _f, 0.15); rotWorld(B.lowerarm_r, _f, -0.15);
    rotWorld(B.thigh_l, _r, -0.25); rotWorld(B.calf_l, _r, 0.45); }
  const _pedal = new V3(), _grip = new V3(), _bq = new QT();
  function cycle(a, r) {
    const B = r.bones, b = a.bike; r.wrap.updateMatrixWorld(true); r.wrap.getWorldQuaternion(_bq);
    _f.set(0, 0, 1).applyQuaternion(_bq); _r.set(1, 0, 0).applyQuaternion(_bq);
    rotWorld(B.spine_01, _r, 0.5); rotWorld(B.neck_01, _r, -0.35); B.spine_01.updateMatrixWorld(true);
    const ox = b ? b.g.position.x : a.x, oz = b ? b.g.position.z : a.z;
    for (const side of [1, -1]) {   // side +1 = character left (+x local)
      const ang = a.crank + (side > 0 ? 0 : Math.PI);
      _pedal.set(side * 0.1, BK.crank.y + Math.cos(ang) * BK.crankR, BK.crank.z + Math.sin(ang) * BK.crankR).applyQuaternion(_bq); _pedal.x += ox; _pedal.z += oz; _pedal.y += calib[a.sex].footH * 0.5;
      _p.copy(_f).multiplyScalar(1).addScaledVector(_u, 0.2);
      const L = side > 0; ik2(L ? B.thigh_l : B.thigh_r, L ? B.calf_l : B.calf_r, L ? B.foot_l : B.foot_r, _pedal, _p);
      _grip.set(side * BK.grip.x * 0.9, BK.grip.y, BK.grip.z).applyQuaternion(_bq); _grip.x += ox; _grip.z += oz;
      _p.copy(_u).multiplyScalar(-0.6).addScaledVector(_r, side * 0.8);
      ik2(L ? B.upperarm_l : B.upperarm_r, L ? B.lowerarm_l : B.lowerarm_r, L ? B.hand_l : B.hand_r, _grip, _p);
    }
  }

  // skater: lean, crouch, ollie pop, arm balance, kickflip foot flick — all on the bones, board kept in sync
  const _bw = new QT(), _footRel = {}, _tmpQ = new QT(), _wq = new QT(), _sideQ = new QT().setFromAxisAngle(new V3(0, 1, 0), Math.PI / 2), _Z = new V3(0, 0, 1);
  { sk.wrap.position.set(0, 0, 0); sk.wrap.quaternion.copy(_sideQ); skater.updateMatrixWorld(true); sk.wrap.getWorldQuaternion(_wq); _wq.invert();
    for (const n of ['foot_l', 'foot_r']) { const q = new QT(); sk.bones[n].getWorldQuaternion(q); _footRel[n] = q.premultiply(_wq); } }
  // the same foot-to-deck rotation for each body (cruising skaters can be either)
  const FOOT_REL = { M: _footRel, F: {} };
  { const r = POOL.F[0]; r.snap(CLIP.idle, 0, 0.6); r.wrap.position.set(0, 0, 0); r.wrap.quaternion.copy(_sideQ); r.wrap.scale.setScalar(1); r.wrap.updateMatrixWorld(true);
    r.wrap.getWorldQuaternion(_wq); _wq.invert(); for (const n of ['foot_l', 'foot_r']) { const q = new QT(); r.bones[n].getWorldQuaternion(q); FOOT_REL.F[n] = q.premultiply(_wq); } }
  const CRUISE_BOARDS = [0x1d1d1f, 0x2a6fc9, 0xc9302c, 0x24a865, 0xf2cf4a].map(makeBoard);
  // The pose comes from game.js through S.pose (all optional, 0 = neutral riding):
  //   air (board height, m), airN (0..1 of the jump apex), pitch (board nose-up), roll (kickflip, rad), crouch (+ = knees bent),
  //   flick (front-foot kick 0..1), lift (feet hover during a flip, m), flipping, lean (rad, into the turn),
  //   spin (impossible: end-over-end, rad), flickDir (-1 = heelflip), stance (+1 regular / -1 switch),
  //   bodyPitch (+ = leaning back), flail (arm windmill 0..1), boardZ / boardYaw (board kicked out), offBoard (0..1 feet leave the deck)
  const POSE0 = {};
  // debug fit test (J): FIT.clip = 'walk' / 'idle' plays that clip on the player with no skate pose and the board
  // hidden; FIT.rig is a second character in a hoodie standing beside him
  const FIT = { clip: null, rig: null };
  function fitView(on, x = 0, z = 0) {
    if (FIT.rig) { FIT.rig.lineup = false; removeFromScene(FIT.rig); FIT.rig = null; }
    FIT.clip = null; board.visible = true; if (!on) return null;
    const app = APPS.M.find((a) => a.top === 4) || APPS.F.find((a) => a.top === 4); if (!app) return null;
    const sex = APPS.M.includes(app) ? 'M' : 'F', r = POOL[sex].find((x) => !x.lineup && (!x.agent || !x.agent.game)); if (!r) return null; if (r.agent) releaseRig(r);
    r.lineup = true; r.setApp(app); r.setShadow(true); r.setDetail(true); r.setLOD(true); r.phone.visible = false;
    r.wrap.scale.setScalar(1); r.wrap.position.set(x, 0, z); r.wrap.rotation.set(0, Math.PI, 0); r.snap(CLIP.walk, 0, 1); ensureInScene(r); FIT.rig = r;
    return { sex, app: app.id };
  }
  function fitClip(name) {
    FIT.clip = name === 'walk' || name === 'idle' ? name : null; board.visible = !FIT.clip;
    sk.play(FIT.clip === 'walk' ? CLIP.walk : CLIP.idle, { fade: 0.2, ts: FIT.clip === 'walk' ? 1 : 0.6 });
    if (FIT.rig) FIT.rig.play(name === 'walk' ? CLIP.walk : CLIP.idle, { fade: 0.2, ts: 1 });
  }
  function updateSkater(dt, t) {
    const B = sk.bones, P = S.pose || POSE0;
    if (FIT.clip) { if (FIT.rig) FIT.rig.update(dt); _stQ.setFromAxisAngle(_UP, Math.PI); sk.wrap.quaternion.copy(_stQ); sk.wrap.position.set(0, 0, 0); sk.update(dt); return; }
    if (FIT.rig) FIT.rig.update(dt);
    SKT.vx = lerp(SKT.vx, (S.x - SKT.prevX) / Math.max(dt, 1e-4), 1 - Math.exp(-dt * 6)); SKT.prevX = S.x;
    if (P.lean !== undefined) SKT.lean = P.lean;
    else { const targetLean = clamp(-SKT.vx * 0.22, -0.3, 0.3); SKT.lean = lerp(SKT.lean, S.moving ? targetLean : 0, 1 - Math.exp(-dt * 5)); }
    const air = P.air || 0, airN = P.airN || 0, flick = P.flick || 0, lift = P.lift || 0, off = P.offBoard || 0, flail = P.flail || 0, charge = P.charge || 0;
    const crouch = 0.22 + Math.sin(t * 1.3) * 0.03 + (P.crouch || 0) + Math.abs(SKT.lean) * 0.3;
    // board: pops around the tail (lift compensates the nose-up pitch), flips about its long axis
    const pitch = P.pitch || 0, roll = (P.roll || 0) + SKT.lean * 0.45;
    const spin = P.spin || 0;   // impossible: the board wraps end over end around the back truck (z = +0.22)
    board.position.set(0, air + Math.sin(pitch) * 0.36 + 0.22 * Math.sin(spin), (P.boardZ || 0) + 0.22 - 0.22 * Math.cos(spin)); board.rotation.set(pitch + spin, P.boardYaw || 0, 0); flip.rotation.z = roll;
    if (S.moving) SKT.wheelA -= S.speed * dt / 0.027; for (const w of sk.wheels) w.rotation.x = SKT.wheelA;
    // stance: regular (left foot forward, body facing +x) or switch (right foot forward). A change turns the body
    // through facing forward; st runs +1 → -1 and mirrors everything side-dependent below
    const stTarget = (P.stance ?? 1) > 0 ? Math.PI / 2 : Math.PI * 1.5;
    SKT.stanceA += clamp(stTarget - SKT.stanceA, -dt * 12, dt * 12); const st = Math.sin(SKT.stanceA);
    _stQ.setFromAxisAngle(_UP, SKT.stanceA);
    // body root: between the feet, side-on, drops with crouch, rises with the board, leans into turns
    _tmpQ.setFromAxisAngle(_X, P.bodyPitch || 0); _rq2.setFromAxisAngle(_Z, SKT.lean); sk.wrap.quaternion.copy(_tmpQ).multiply(_rq2).multiply(_stQ);
    sk.wrap.position.set(-0.03 * st, air - crouch * 0.24 + lift * 0.6, 0.0);
    sk.update(dt); sk.saveOverride();
    skater.updateMatrixWorld(true);
    skater.getWorldQuaternion(_bw); _f.set(0, 0, -1).applyQuaternion(_bw); _r.set(1, 0, 0).applyQuaternion(_bw); _u.set(0, 1, 0).applyQuaternion(_bw);
    // upper body: twist toward travel, forward bend with crouch, arms out for balance (rising in the air, windmilling when off balance)
    rotWorld(B.spine_02, _u, 0.32 * st); rotWorld(B.spine_01, _f, (0.12 + crouch * 0.35) * st); rotWorld(B.neck_01, _u, 0.45 * st); rotWorld(B.Head, _u, 0.42 * st);
    const armOut = 0.85 + airN * 0.7 + flick * 0.3 + Math.sin(t * 2.1) * 0.06 - charge * 0.5;   // arms drop and reach forward as the charge winds up
    rotWorld(B.upperarm_l, _r, (armOut + flail * Math.sin(t * 15) * 0.7) * st); rotWorld(B.upperarm_r, _r, (-armOut - flail * Math.sin(t * 15 + 1.7) * 0.7) * st);
    rotWorld(B.upperarm_l, _f, SKT.lean * 0.5 + flail * 0.5); rotWorld(B.upperarm_r, _f, SKT.lean * 0.5 - flail * 0.5);
    if (charge) { rotWorld(B.spine_02, _f, charge * 0.3 * st); rotWorld(B.neck_01, _f, -charge * 0.5 * st); rotWorld(B.lowerarm_l, _r, charge * 0.7 * st); rotWorld(B.lowerarm_r, _r, -charge * 0.7 * st); }
    sk.root.updateMatrixWorld(true);
    // feet: IK onto the deck (left = front foot toward the nose); during a flip they hover over the
    // un-rolled board, and the front foot flicks out toward the toe edge
    const flipping = !!P.flipping;
    sk.deck.updateMatrixWorld(true); sk.deck.getWorldQuaternion(_wq);
    const fh = calib.M.footH * 0.92;
    if (off < 0.999) for (const n of ['l', 'r']) {
      const front = (n === 'l') === (st >= 0);   // the left foot leads in regular stance, the right in switch
      _t.set(-0.035 * st, DECK_TOP - 0.083 + fh + lift, (front ? -0.19 : 0.22) * Math.abs(st));
      if (flipping) { _t.y += 0.083; _t.applyEuler(_e.set(pitch, 0, 0)); _t.y += board.position.y; skater.localToWorld(_t); }
      else sk.deck.localToWorld(_t);
      if (front && flick) _t.addScaledVector(_r, flick * 0.16 * (P.flickDir || 1) * st).addScaledVector(_f, flick * 0.06).addScaledVector(_u, flick * 0.06);
      _p.copy(_r).multiplyScalar(0.8 * st).addScaledVector(_f, front ? 0.5 : -0.5);
      ik2(B['thigh_' + n], B['calf_' + n], B['foot_' + n], _t, _p, 1 - off);
      if (off < 0.01) { _tmpQ.copy(flipping ? _bw : _wq).multiply(_stQ).multiply(_footRel['foot_' + n]); setWorldQ(B['foot_' + n], _tmpQ); }
    }
  }
  const _X = new V3(1, 0, 0), _rq2 = new QT(), _UP = new V3(0, 1, 0), _wq2 = new QT(), _stQ = new QT();

  // a crossing skater: relaxed crouch, arms out, feet planted on the deck by IK
  function cruise(a, r) {
    const B = r.bones, bd = a.board; if (!bd) return;
    r.wrap.updateMatrixWorld(true); bd.board.updateMatrixWorld(true);
    bd.board.getWorldQuaternion(_bq); _f.set(0, 0, -1).applyQuaternion(_bq); _r.set(1, 0, 0).applyQuaternion(_bq);
    rotWorld(B.spine_02, _UP, 0.3); rotWorld(B.spine_01, _f, 0.2); rotWorld(B.neck_01, _UP, 0.45); rotWorld(B.Head, _UP, 0.4);
    rotWorld(B.upperarm_l, _r, 0.8); rotWorld(B.upperarm_r, _r, -0.8);
    r.root.updateMatrixWorld(true); bd.deck.updateMatrixWorld(true); bd.deck.getWorldQuaternion(_wq2);
    const rel = FOOT_REL[r.sex], fh = calib[r.sex].footH * 0.92;
    for (const n of ['l', 'r']) { const front = n === 'l';
      _t.set(-0.035, DECK_TOP - 0.083 + fh, front ? -0.19 : 0.22); bd.deck.localToWorld(_t);
      _p.copy(_r).multiplyScalar(0.8).addScaledVector(_f, front ? 0.5 : -0.5);
      ik2(B['thigh_' + n], B['calf_' + n], B['foot_' + n], _t, _p);
      _tmpQ.copy(_wq2).multiply(_sideQ).multiply(rel['foot_' + n]); setWorldQ(B['foot_' + n], _tmpQ); }
  }

  // ---------------- main update ----------------
  const FIX_DT = 1 / 60;
  function update(dt, t, phase) {
    tick++; if (api.frozen) dt = 0;   // debug: hold the crowd still for close-up screenshots
    curT = t;
    camera.updateMatrixWorld(); camPos.setFromMatrixPosition(camera.matrixWorld);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(_pm);
    const zRef = camPos.z, crowd = phase.crowd, nWalk = Math.round(crowd * WALKERS.length * api.walkerScale);
    if (!initDone || Math.abs(zRef - lastZ) > 40) {   // first frame or a camera teleport: scatter everyone around the view again
      R = mulberry32(777); for (const a of WALKERS) { if (a.rig) releaseRig(a.rig); respawn(a, zRef, true); } for (const a of CYCLISTS) { if (a.rig) releaseRig(a.rig); respawn(a, zRef, true); }
      initDone = true; lodT = 0; }
    lastZ = zRef;
    phoneMat.emissiveIntensity = 0.15 + phase.night * 1.2;

    // simulate walkers (cheap, all of them)
    for (let i = 0; i < nWalk; i++) { const a = WALKERS[i];
      if (a.leader) { const L = a.leader; a.dir = L.dir; a.x = L.x + a.offX; a.z = L.z + a.offZ; a.stopFor = L.stopFor; a.stopClip = L.stopClip; a.stopYaw = L.stopYaw;
        a.ts = L.speed / (BODY[a.sex].speed[a.clip] * a.scale); a.speed = L.speed; continue; }
      if (a.stopFor > 0) { a.stopFor -= dt; if (a.stopFor <= 0 && a.rig) a.rig.play(a.clip, { fade: 0.35, ts: a.ts }); }
      else { a.z += a.dir * a.speed * dt; a.phase += dt * a.speed / 1.3; a.stopT -= dt;
        if (a.stopT <= 0 && a.gait !== 'jog') { a.stopT = rand(12, 40); a.stopFor = rand(3, 8); a.stopClip = chance(0.5) ? CLIP.talk : CLIP.idle; a.stopYaw = (a.dir > 0 ? 0 : Math.PI) + rand(-1.2, 1.2);
          if (a.rig) a.rig.play(a.stopClip, { fade: 0.35, ts: rand(0.9, 1.1) }); } }
      if (a.z > zRef + 14 || a.z < zRef - 300) { respawn(a, zRef, false); if (a.rig) releaseRig(a.rig); }
    }
    for (const a of GAME_AGENTS) if (a.kind === 'cycle') a.crank += a.speed * dt / BK.wheelR * 0.36;
    for (const a of CYCLISTS) { a.z += a.dir * a.speed * dt; a.crank += a.speed * dt / BK.wheelR * 0.36; if (a.z > zRef + 16 || a.z < zRef - 300) { respawn(a, zRef, false); if (a.rig) releaseRig(a.rig); } }
    for (let i = nWalk; i < WALKERS.length; i++) if (WALKERS[i].rig) releaseRig(WALKERS[i].rig);

    // LOD assignment (5 Hz): nearest visible agents get rigs, sticky between passes
    lodT -= dt;
    if (lodT <= 0) { lodT = 0.2; cands.length = 0;
      for (let i = 0; i < nWalk; i++) consider(WALKERS[i]);
      for (const a of GAME_AGENTS) consider(a);
      const nCyc = Math.round(CYCLISTS.length * api.walkerScale);   // walkerScale thins everyone off the lanes: walkers, cyclists, station people
      CYCLISTS.forEach((a, i) => { if (crowd > 0.15 && i < nCyc) consider(a); else { a.vis = false; if (a.rig) releaseRig(a.rig); } });
      for (const ch of chunks) if (ch.stations) for (const st of ch.stations) { if (crowd < st.minCrowd || (st.open && phase.open < 0.5) || (!st.always && ((Math.imul(st.seed, 2654435761) >>> 0) / 4294967296) >= api.walkerScale)) { if (st.agent && st.agent.rig) releaseRig(st.agent.rig); continue; } consider(stationAgent(st)); }
      cands.sort((p, q) => p.key - q.key);   // game pedestrians first, then by distance
      OBST.length = 0; for (const a of cands) if (a.kind === 'perform' || a.kind === 'watch' || a.kind === 'selfie' || a.kind === 'smokeStand' || a.kind === 'browse' || a.kind === 'bboy') OBST.push(a);
      const keepM = Q.rigsPerSex, keepF = Q.rigsPerSex; let nM = 0, nF = 0;
      for (const a of cands) { if (a.sex === 'M' ? nM++ < keepM : nF++ < keepF) a.want = tick; }
      for (const sex of ['M', 'F']) for (const r of POOL[sex]) if (r.agent && (r.agent.want !== tick || r.agent.seen !== tick)) releaseRig(r);
      for (const a of cands) if (a.want === tick && !a.rig) assignRig(a);
    }

    // animate rigs: nearest Q.nearCount every frame, the rest every Q.midEvery frames (staggered)
    stats.rigs = 0; stats.near = 0; stats.mid = 0; stats.mixers = 0; stats.dogs = 0;
    let rank = 0;
    for (const a of cands) { const r = a.rig; if (!r) continue; stats.rigs++;
      placeRig(a);
      const near = rank++ < Q.nearCount && a.dist < Q.rFull + 10;
      r.setShadow(a.dist < Q.shadowDist); r.setDetail(a.dist < 18); r.setLOD(a.dist < (r.lodFull ? Q.lodFar : Q.lodNear));
      r.acc += dt;
      if (near || (tick + r.body.id) % Q.midEvery === 0) { if (a.kind === 'walk' && a.stopFor <= 0 && r.cur) r.cur.timeScale = a.ts; r.update(r.acc); r.acc = 0; stats.mixers++;
        if (a.kind === 'skate') { r.saveOverride(); cruise(a, r); }
        else if (a.kind === 'beg' || a.kind === 'smoke' || a.kind === 'drum' || a.kind === 'guitar') { r.saveOverride(); sitArms(a, r, t); }
        else if (a.kind === 'piano') { r.saveOverride(); pianoArms(a, r, t); }
        else if (a.kind === 'smokeStand') { r.saveOverride(); smokeArm(a, r, t); }
        else if (a.kind === 'bboy' && a.move !== 'toprock') { r.saveOverride(); bboyPose(a, r); }
        else if (a.kind === 'selfie') { r.saveOverride(); selfie(r, t); } else if (a.kind === 'lie') { r.saveOverride(); lieArms(r); } else if (a.kind === 'cycle') { r.saveOverride(); cycle(a, r); } }
      if (near) stats.near++; else stats.mid++;
      // dog on a lead, trotting beside the owner at the owner's pace
      // dog on a lead at the owner's pace: ambient dogs trot alongside; game dogs walk out to the side (a.dogSide m)
      // so the lead stretches across a lane, held in the hand on that side
      const d = a.dogRig; if (d) { stats.dogs++; const side = a.game ? (a.dogSide || 0) : (a.offX >= 0 ? -1 : 1) * 0.75, moving = a.stopFor <= 0 && !a.halt;
        d.wrap.position.set(a.x + side, 0, a.z + a.dir * (a.game ? (a.dogSide ? 0.35 : 1.25) : 0.9)); d.wrap.rotation.y = moving ? (a.dir > 0 ? 0 : Math.PI) : d.wrap.rotation.y;
        d.walk.weight = lerp(d.walk.weight, moving ? 1 : 0, 1 - Math.exp(-dt * 6)); d.idle.weight = 1 - d.walk.weight; d.walk.timeScale = a.speed / (d.T.speed);
        d.mixer.update(dt); const leftX = a.dir > 0 ? 1 : -1; (side * leftX > 0 ? r.bones.hand_l : r.bones.hand_r).getWorldPosition(_p);
        d.wrap.updateMatrixWorld(true); _h.set(0, 0.45, 0.25); d.wrap.localToWorld(_h);
        _d.subVectors(_h, _p); const len = _d.length(); d.leash.position.copy(_p); d.leash.quaternion.setFromUnitVectors(_u0, _d.divideScalar(Math.max(len, 1e-4))); d.leash.scale.set(1, len, 1); }
      if (a.board) for (const w of a.board.wheels) w.rotation.x -= a.speed * dt / 0.027;
      if (a.bike) { const b = a.bike; for (const w of b.wheels) w.rotation.x += a.speed * dt / BK.wheelR; b.crank.rotation.x = a.crank - Math.PI / 2; }
    }

    // impostors: visible walkers past rig range (or over budget)
    let n = 0; const ca = aCell.array;
    for (let i = 0; i < nWalk && n < IMP_N; i++) { const a = WALKERS[i]; if (!a.vis || a.rig) continue;
      const dx = a.x - camPos.x, dz = a.z - camPos.z; if (dx * dx + dz * dz < 16 * 16) continue;
      const front = a.stopFor > 0 ? 1 : (a.dir > 0 ? 1 : 0), f = a.stopFor > 0 ? 0 : Math.floor((a.phase % 1) * FR);
      const cell = a.app.cell0 + f * 2 + (front ? 0 : 1), col = cell % COLS, row = Math.floor(cell / COLS);
      ca[n * 2] = col * CW / atlasRT.width; ca[n * 2 + 1] = row * CH / atlasRT.height;
      const yaw = Math.atan2(camPos.x - a.x, camPos.z - a.z);
      _q.setFromAxisAngle(_u.set(0, 1, 0), yaw); _M.compose(_p.set(a.x, 0, a.z), _q, _S.set(a.scale * a.w, a.scale, 1)); impostors.setMatrixAt(n++, _M); }
    impostors.count = n; impostors.instanceMatrix.needsUpdate = true; aCell.needsUpdate = true; stats.imp = n;

    updatePuffs(dt); updateCues(dt);
    for (const r of LINEUP.rigs) r.update(dt);
    updateSkater(dt, t);
  }
  const _M = new THREE.Matrix4(), _S = new V3();

  // the half-res GTAO pass skips distant rigs and billboards (their contact AO is sub-pixel anyway)
  const aoHidden = [];
  // (the camera-flash / bell sprites and smoke puffs are see-through: the AO pass would draw them as solid quads and
  // darken a box over whoever is behind them)
  function beforeAO() { aoHidden.length = 0; impostors.visible = false; for (const o of CUES.concat(PUFFS)) if (o.visible) { o.visible = false; aoHidden.push(o); } for (const sex of ['M', 'F']) for (const r of POOL[sex]) if (r.agent && r.agent.dist > 25 && r.wrap.visible) { r.wrap.visible = false; aoHidden.push(r.wrap); } }
  function afterAO() { impostors.visible = true; for (const w of aoHidden) w.visible = true; }
  const api = { frozen: false, walkerScale: 1, update, addGameWalker, addGameCyclist, addGameSkater, addGameStation, setClip, cue, lineup, fitView, fitClip, fitRig: () => FIT.rig, removeGameWalker, removeGameAgent: removeGameWalker, beforeAO, afterAO, makeBreakStage, stats, CLIP, clipNames, BODY, POOL, APPS, WALKERS, CYCLISTS, DOGS, skaterRig: sk, atlas: atlasRT, impostors, crowdGroup };
  return api;
}
