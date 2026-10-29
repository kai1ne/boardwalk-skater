// =====================================================================================
// outfits.js — clothing that fits: garments built from the body's own surface.
//
// The free Quaternius bodies come in underwear, and the only outfit pack made for the rig is medieval
// fantasy, so boardwalk clothes are generated here. A garment is the region of the body surface it
// covers (tee, long sleeve, hoodie, tank, dress bodice, shorts, capris, jeans, sneakers), smoothed so the
// muscles underneath stop showing, and pushed out a little. It keeps the body vertices' skin weights, so
// it deforms exactly with the skeleton. Hoods, skirts and accessories (cap, sunglasses, backpack, pouch)
// are small rigid parts weighted to one or two bones. Everything one character wears is merged into one
// vertex-coloured skinned geometry (one draw call). The body shader discards the skin under each garment
// using the same region formulas (MASK_GLSL, slightly inset), so nothing can poke through.
//
// Regions are defined in bind-pose space (the bind pose is a T-pose): torso/leg bands by y, arm length by |x|,
// using bone landmarks measured from each body:
//   lm[0] = (ankleY, kneeY, hipY, pelvisY)   lm[1] = (chestY, neckY, shoulderX, elbowX)   lm[2] = (wristX, headY, neckZ, -)
// Style codes: top 0 none · 1 tank · 2 tee · 3 long sleeve · 4 hoodie · 5 dress bodice
//              bottom 0 none · 1 shorts · 2 capris · 3 jeans/trousers · 4 under a skirt (body masked, the skirt is a rigid part)
//              shoes 0 barefoot · 1 sandals · 2 sneakers
// =====================================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const cs = (e, x) => smoothstep(e - 0.006, e + 0.006, x);
const mix = (a, b, t) => a + (b - a) * t;

// ---- region masks (k > 0 shrinks the region, k < 0 grows it). Keep JS and GLSL identical. ----
function topMask(x, y, z, st, L, k) {
  const top = st[0]; if (top < 0.5) return 0;
  const ax = Math.abs(x), [l0, l1, l2] = L, tank = top < 1.5 || top > 4.5;
  const sleeve = (tank ? l1.z * 0.95 : top < 2.5 ? mix(l1.z, l1.w, 0.55) + 0.02 : l2.x - 0.035) - k;
  const hem = (top > 4.5 ? l0.z - 0.02 : l0.w - 0.06) + k;
  let t = cs(hem, y) * (1 - cs(sleeve, ax));
  if (!tank) {   // sleeved tops: covered up over the shoulders, open only inside a round crew collar around the neck
    const R = (top > 3.5 ? 0.095 : 0.085) + k, rho = Math.hypot(x, z - L[2].z);
    return t * (1 - cs(l1.y + 0.06 - k, y)) * (1 - cs(l1.y - 0.08 + k, y) * (1 - cs(R, rho)));
  }
  const neck = l1.y - 0.03 - k; t *= 1 - cs(neck, y);
  const scoop = 0.12 + k; t *= 1 - cs(0, z) * cs(neck - scoop + ax * 0.6, y);
  { const upper = cs(l1.y - 0.14 - k, y), strap = 1 - cs((top > 4.5 ? 0.045 : 0.032) - k, Math.abs(ax - l1.z * 0.45)), torso = 1 - cs(l1.z * 1.02 - k, ax); t *= mix(torso, strap, upper); }
  return t;
}
function botMask(x, y, z, st, L, k) {
  const b = st[1]; if (b < 0.5) return 0; const l0 = L[0];
  const end = (b < 1.5 ? l0.y + 0.12 : b < 2.5 ? l0.y - 0.07 : b < 3.5 ? l0.x + 0.04 : l0.y + 0.10) + k;   // 4 = under a skirt: masked only, no shell
  return cs(end, y) * (1 - cs(l0.w + 0.07 - k, y));
}
function shoeMask(x, y, z, st, L, k) { return st[2] > 1.5 ? 1 - cs(L[0].x + 0.03 - k, y) : 0; }

export const MASK_GLSL = /* glsl */`
uniform vec4 uLm0, uLm1, uLm2;
uniform vec4 uStyle;   // top, bottom, shoes, -
float csm(float e, float x) { return smoothstep(e - 0.006, e + 0.006, x); }
float topMask(vec3 p, float k) {
  float top = uStyle.x; if (top < 0.5) return 0.0;
  float ax = abs(p.x); bool tank = top < 1.5 || top > 4.5;
  float sleeve = (tank ? uLm1.z * 0.95 : (top < 2.5 ? mix(uLm1.z, uLm1.w, 0.55) + 0.02 : uLm2.x - 0.035)) - k;
  float hem = (top > 4.5 ? uLm0.z - 0.02 : uLm0.w - 0.06) + k;
  float t = csm(hem, p.y) * (1.0 - csm(sleeve, ax));
  if (!tank) {
    float R = (top > 3.5 ? 0.095 : 0.085) + k, rho = length(vec2(p.x, p.z - uLm2.z));
    return t * (1.0 - csm(uLm1.y + 0.06 - k, p.y)) * (1.0 - csm(uLm1.y - 0.08 + k, p.y) * (1.0 - csm(R, rho)));
  }
  float neck = uLm1.y - 0.03 - k; t *= 1.0 - csm(neck, p.y);
  float scoop = 0.12 + k; t *= 1.0 - csm(0.0, p.z) * csm(neck - scoop + ax * 0.6, p.y);
  { float upper = csm(uLm1.y - 0.14 - k, p.y), strap = 1.0 - csm((top > 4.5 ? 0.045 : 0.032) - k, abs(ax - uLm1.z * 0.45)), torso = 1.0 - csm(uLm1.z * 1.02 - k, ax); t *= mix(torso, strap, upper); }
  return t;
}
float botMask(vec3 p, float k) {
  float b = uStyle.y; if (b < 0.5) return 0.0;
  float end = (b < 1.5 ? uLm0.y + 0.12 : (b < 2.5 ? uLm0.y - 0.07 : (b < 3.5 ? uLm0.x + 0.04 : uLm0.y + 0.10))) + k;
  return csm(end, p.y) * (1.0 - csm(uLm0.w + 0.07 - k, p.y));
}
float shoeMask(vec3 p, float k) { return uStyle.z > 1.5 ? 1.0 - csm(uLm0.x + 0.03 - k, p.y) : 0.0; }
float coveredByOutfit(vec3 p) { float k = 0.012; return max(max(topMask(p, k), botMask(p, k)), shoeMask(p, k)); }
`;

// a subtle woven-fabric normal map shared by every garment
function weaveTexture() {
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'), img = x.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = Math.sin(i / N * Math.PI * 16), b = Math.sin(j / N * Math.PI * 16), w = ((i >> 2) + (j >> 2)) & 1;
    const nx = (w ? a : 0) * 0.35, ny = (w ? 0 : b) * 0.35, k = (j * N + i) * 4; img.data[k] = (nx * 0.5 + 0.5) * 255; img.data[k + 1] = (ny * 0.5 + 0.5) * 255; img.data[k + 2] = 255; img.data[k + 3] = 255; }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(48, 48); return t;
}
export const outfitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, normalMap: weaveTexture(), normalScale: new THREE.Vector2(0.35, 0.35) });

// weld vertices that share a position (UV seams) into groups, with averaged normals and neighbour lists,
// so smoothing treats the surface as one piece
function weld(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index.array, nV = pos.count;
  const group = new Int32Array(nV), keyMap = new Map(); let nG = 0;
  for (let i = 0; i < nV; i++) { const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`; let g = keyMap.get(k); if (g === undefined) { g = nG++; keyMap.set(k, g); } group[i] = g; }
  const gp = new Float32Array(nG * 3), gn = new Float32Array(nG * 3), gc = new Float32Array(nG);
  for (let i = 0; i < nV; i++) { const g = group[i] * 3; gp[g] = pos.getX(i); gp[g + 1] = pos.getY(i); gp[g + 2] = pos.getZ(i); gn[g] += nor.getX(i); gn[g + 1] += nor.getY(i); gn[g + 2] += nor.getZ(i); gc[group[i]]++; }
  for (let g = 0; g < nG; g++) { const l = Math.hypot(gn[g * 3], gn[g * 3 + 1], gn[g * 3 + 2]) || 1; gn[g * 3] /= l; gn[g * 3 + 1] /= l; gn[g * 3 + 2] /= l; }
  const nbr = Array.from({ length: nG }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = group[idx[t + e]], b = group[idx[t + (e + 1) % 3]]; if (a !== b) { nbr[a].add(b); nbr[b].add(a); } }
  return { group, nG, gp, gn, nbrA: nbr.map((s) => Int32Array.from(s)) };
}

// -------------------------------------------------------------------------------------
// Derived builds. The free bodies are 'Superhero' sculpts; everyday builds come from reshaping them in bind
// pose: Taubin smoothing (no shrinkage) softens the muscle definition on the torso and limbs (head, hands
// and feet untouched), the upper torso narrows a little, and 'fuller' adds a soft belly and hips. The vertex
// count, UVs and skin weights are unchanged, so every animation still fits.
// -------------------------------------------------------------------------------------
const BUILDS = {
  everyday: { iters: 10, narrow: 0.05, offset: -0.002, belly: 0, hips: 0 },
  slim:     { iters: 10, narrow: 0.08, offset: -0.007, belly: 0, hips: 0 },
  fuller:   { iters: 10, narrow: 0.02, offset: 0.004, belly: 0.04, hips: 0.016 },
};
export function deriveBody(geo, lm, kind) {
  const P = BUILDS[kind], W = weld(geo), { group, nG, gp, gn, nbrA } = W, [l0, l1, l2] = lm;
  const w = new Float32Array(nG), q = Float32Array.from(gp);
  for (let g = 0; g < nG; g++) { const x = gp[g * 3], y = gp[g * 3 + 1];
    w[g] = (1 - smoothstep(l1.y - 0.04, l1.y + 0.02, y)) * (1 - smoothstep(l2.x - 0.09, l2.x - 0.04, Math.abs(x))) * smoothstep(l0.x + 0.03, l0.x + 0.1, y); }
  const tmp = new Float32Array(nG * 3);
  const pass = (f) => { for (let g = 0; g < nG; g++) { let sx = 0, sy = 0, sz = 0; const nb = nbrA[g]; for (const o of nb) { sx += q[o * 3]; sy += q[o * 3 + 1]; sz += q[o * 3 + 2]; }
      const n = nb.length || 1, k = f * w[g]; tmp[g * 3] = q[g * 3] + (sx / n - q[g * 3]) * k; tmp[g * 3 + 1] = q[g * 3 + 1] + (sy / n - q[g * 3 + 1]) * k; tmp[g * 3 + 2] = q[g * 3 + 2] + (sz / n - q[g * 3 + 2]) * k; } q.set(tmp); };
  for (let i = 0; i < P.iters; i++) { pass(0.5); pass(-0.53); }
  for (let g = 0; g < nG; g++) { const x = q[g * 3], y = q[g * 3 + 1], z = q[g * 3 + 2], ax = Math.abs(gp[g * 3]);
    // narrower upper torso (not the arms), fading out toward the waist
    const torso = (1 - smoothstep(l1.z * 0.8, l1.z * 1.0, ax)) * smoothstep(l0.w, l1.x, y) * (1 - smoothstep(l1.y - 0.02, l1.y + 0.03, y));
    q[g * 3] = x * (1 - P.narrow * torso);
    let off = P.offset * w[g];
    if (P.belly && gn[g * 3 + 2] > 0) off += P.belly * Math.exp(-(((y - (l0.w + (l1.x - l0.w) * 0.3)) / 0.11) ** 2) - (x / 0.16) ** 2) * gn[g * 3 + 2];
    if (P.hips) off += P.hips * Math.exp(-(((y - l0.z) / 0.1) ** 2)) * (ax < l1.z * 0.9 ? 1 : 0);
    for (let c = 0; c < 3; c++) q[g * 3 + c] += gn[g * 3 + c] * off; }
  // write back to every vertex and recompute smooth normals over the welded surface
  const out = geo.clone(), pos = out.attributes.position, idx = out.index.array, fn = new Float32Array(nG * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { const g = group[i]; pos.setXYZ(i, q[g * 3], q[g * 3 + 1], q[g * 3 + 2]); }
  for (let t = 0; t < idx.length; t += 3) { const g0 = group[idx[t]], g1 = group[idx[t + 1]], g2 = group[idx[t + 2]];
    a.fromArray(q, g0 * 3); b.fromArray(q, g1 * 3).sub(a); c.fromArray(q, g2 * 3).sub(a); b.cross(c); for (const g of [g0, g1, g2]) { fn[g * 3] += b.x; fn[g * 3 + 1] += b.y; fn[g * 3 + 2] += b.z; } }
  const nor = out.attributes.normal; for (let i = 0; i < pos.count; i++) { const g = group[i]; a.fromArray(fn, g * 3).normalize(); nor.setXYZ(i, a.x, a.y, a.z); }
  pos.needsUpdate = true; nor.needsUpdate = true; out.computeBoundingSphere(); return out;
}

// -------------------------------------------------------------------------------------
// Per body: welded adjacency (for smoothing) and bind-space reference points for the rigid parts
// -------------------------------------------------------------------------------------
export function createOutfitBuilder({ geo, lm, boneIndex, bonePos, eyesBox }) {
  const pos = geo.attributes.position, idx = geo.index.array, nV = pos.count;
  const { group, nG, gp, gn, nbrA } = weld(geo);
  // bind-space body extents used to place hoods, caps and bags
  let headTop = -1e9, backZ = 0; for (let i = 0; i < nV; i++) { const y = pos.getY(i); if (y > headTop) headTop = y; if (Math.abs(pos.getX(i)) < 0.1 && Math.abs(y - lm[1].x) < 0.06) backZ = Math.min(backZ, pos.getZ(i)); }

  // ---- a garment shell over the region where mask(vertex) > 0.5 ----
  function shell(maskFn, thick, iters, colorFn) {
    const m = new Float32Array(nV); for (let i = 0; i < nV; i++) m[i] = maskFn(pos.getX(i), pos.getY(i), pos.getZ(i));
    const tris = []; for (let t = 0; t < idx.length; t += 3) if (m[idx[t]] > 0.5 || m[idx[t + 1]] > 0.5 || m[idx[t + 2]] > 0.5) tris.push(idx[t], idx[t + 1], idx[t + 2]);
    if (!tris.length) return null;
    const used = new Map(); for (const v of tris) if (!used.has(v)) used.set(v, used.size);
    const inG = new Uint8Array(nG); for (const v of used.keys()) inG[group[v]] = 1;
    // boundary groups (a neighbour outside the garment) stay put while the inside is smoothed
    const q = new Float32Array(nG * 3), pin = new Uint8Array(nG);
    for (let g = 0; g < nG; g++) if (inG[g]) { for (let c = 0; c < 3; c++) q[g * 3 + c] = gp[g * 3 + c] + gn[g * 3 + c] * thick; for (const n of nbrA[g]) if (!inG[n]) { pin[g] = 1; break; } }
    const tmp = new Float32Array(nG * 3);
    for (let it = 0; it < iters; it++) {
      for (let g = 0; g < nG; g++) { if (!inG[g]) continue; if (pin[g]) { tmp[g * 3] = q[g * 3]; tmp[g * 3 + 1] = q[g * 3 + 1]; tmp[g * 3 + 2] = q[g * 3 + 2]; continue; }
        let sx = 0, sy = 0, sz = 0, n = 0; for (const o of nbrA[g]) if (inG[o]) { sx += q[o * 3]; sy += q[o * 3 + 1]; sz += q[o * 3 + 2]; n++; }
        if (!n) { tmp[g * 3] = q[g * 3]; tmp[g * 3 + 1] = q[g * 3 + 1]; tmp[g * 3 + 2] = q[g * 3 + 2]; continue; }
        tmp[g * 3] = mix(q[g * 3], sx / n, 0.6); tmp[g * 3 + 1] = mix(q[g * 3 + 1], sy / n, 0.6); tmp[g * 3 + 2] = mix(q[g * 3 + 2], sz / n, 0.6); }
      q.set(tmp);
      // never let the fabric sink into the body: keep at least 60% of the thickness along the normal
      for (let g = 0; g < nG; g++) if (inG[g]) { const d = (q[g * 3] - gp[g * 3]) * gn[g * 3] + (q[g * 3 + 1] - gp[g * 3 + 1]) * gn[g * 3 + 1] + (q[g * 3 + 2] - gp[g * 3 + 2]) * gn[g * 3 + 2];
        if (d < thick * 0.6) for (let c = 0; c < 3; c++) q[g * 3 + c] += gn[g * 3 + c] * (thick * 0.6 - d); }
    }
    // straight edges: vertices just outside the region slide along their edges to where the mask crosses 0.5
    const snap = new Float32Array(nG * 3), snapN = new Uint16Array(nG);
    for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) for (const f of [1, 2]) {
      const vo = tris[t + e], vi = tris[t + (e + f) % 3]; if (m[vo] >= 0.5 || m[vi] < 0.5) continue;
      const go = group[vo], gi = group[vi], w = Math.min(1, Math.max(0, (m[vi] - 0.5) / Math.max(m[vi] - m[vo], 1e-4)));
      for (let c = 0; c < 3; c++) snap[go * 3 + c] += q[gi * 3 + c] + (q[go * 3 + c] - q[gi * 3 + c]) * w; snapN[go]++; }
    for (let g = 0; g < nG; g++) if (snapN[g]) for (let c = 0; c < 3; c++) q[g * 3 + c] = snap[g * 3 + c] / snapN[g];
    const n = used.size, P = new Float32Array(n * 3), UV = new Float32Array(n * 2), SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), C = new Float32Array(n * 3);
    const uv = geo.attributes.uv, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, col = new THREE.Color();
    for (const [v, j] of used) { const g = group[v]; P.set([q[g * 3], q[g * 3 + 1], q[g * 3 + 2]], j * 3); UV.set([uv.getX(v), uv.getY(v)], j * 2);
      SI.set([si.getX(v), si.getY(v), si.getZ(v), si.getW(v)], j * 4); SW.set([sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)], j * 4);
      colorFn(pos.getX(v), pos.getY(v), pos.getZ(v), col); C.set([col.r, col.g, col.b], j * 3); }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); out.setAttribute('color', new THREE.BufferAttribute(C, 3));
    out.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    out.setIndex(tris.map((v) => used.get(v))); out.computeVertexNormals(); return out;
  }
  // ---- a rigid part (bind-space geometry) weighted to one bone, or blended between two ----
  function rigid(g, bone, color, blend) {
    g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const n = g.attributes.position.count, SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4), C = new Float32Array(n * 3), c = new THREE.Color(color), p = g.attributes.position;
    for (let i = 0; i < n; i++) { C.set([c.r, c.g, c.b], i * 3);
      if (blend) { const [b2, w2] = blend(p.getX(i), p.getY(i), p.getZ(i)); SI.set([boneIndex[bone], boneIndex[b2], 0, 0], i * 4); SW.set([1 - w2, w2, 0, 0], i * 4); }
      else { SI.set([boneIndex[bone], 0, 0, 0], i * 4); SW.set([1, 0, 0, 0], i * 4); } }
    g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    const ind = []; for (let i = 0; i < n; i++) ind.push(i); g.setIndex(ind); return g;
  }
  const [l0, l1] = lm, head = bonePos.Head, neck = bonePos.neck_01;
  const PARTS = {
    hood(color) { const g = new THREE.TorusGeometry(0.11, 0.05, 8, 18, Math.PI * 1.25); g.rotateZ(-Math.PI * 0.125); g.rotateX(Math.PI / 2); g.scale(1.05, 1, 0.9); g.translate(0, l1.y - 0.01, neck.z - 0.035); return rigid(g, 'spine_03', color); },
    skirt(color, flare) {   // a flared skirt from the hips to above the knee, following the thighs a little as they swing
      const y0 = l0.z + 0.06, y1 = l0.y + 0.07, pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(new THREE.Vector2(mix(0.165, 0.165 + flare, Math.pow(t, 1.3)), mix(y0, y1, t))); }
      const g = new THREE.LatheGeometry(pts.reverse(), 24); g.scale(1.12, 1, 0.92);
      return rigid(g, 'pelvis', color, (x, y) => [x > 0 ? 'thigh_l' : 'thigh_r', 0.45 * smoothstep(y0, y1, y) * Math.min(1, Math.abs(x) / 0.12)]); },
    cap(color) { const top = new THREE.SphereGeometry(0.106, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); top.scale(1, 0.7, 1.1); top.translate(0, headTop - 0.068, head.z - 0.01);
      const brim = new THREE.CylinderGeometry(0.085, 0.085, 0.008, 16, 1, false, -Math.PI / 2, Math.PI); brim.scale(1, 1, 1.25); brim.rotateX(0.12); brim.translate(0, headTop - 0.066, head.z + 0.075);   // a peak that sticks out in front
      return rigid(mergeGeometries([top.toNonIndexed(), brim.toNonIndexed()].map((g) => { g.deleteAttribute('uv'); return g; })), 'Head', color); },
    sunglasses() { const ey = eyesBox ? (eyesBox.min.y + eyesBox.max.y) / 2 : head.y + 0.07, ez = eyesBox ? eyesBox.max.z + 0.012 : head.z + 0.1, parts = [];
      for (const s of [-1, 1]) { parts.push(new THREE.CylinderGeometry(0.019, 0.019, 0.004, 14).rotateX(Math.PI / 2).scale(1.2, 0.85, 1).translate(s * 0.032, ey, ez),   // oval lenses
        new THREE.BoxGeometry(0.004, 0.005, 0.095).translate(s * 0.058, ey + 0.006, ez - 0.048)); }                                                           // arms back to the ears
      parts.push(new THREE.BoxGeometry(0.018, 0.004, 0.004).translate(0, ey + 0.006, ez));
      return rigid(mergeGeometries(parts.map((g) => g.toNonIndexed())), 'Head', '#151515'); },
    backpack(color) { const g = new THREE.BoxGeometry(0.28, 0.36, 0.13, 2, 2, 1); g.translate(0, l1.x - 0.06, backZ - 0.09); return rigid(g, 'spine_03', color); },
    pouch(color) { const g = new THREE.BoxGeometry(0.2, 0.15, 0.06); g.translate(0.08, l0.w + 0.02, 0.15); return rigid(g, 'pelvis', color); },
  };

  // ---- one character's outfit: shells + parts, merged ----
  // recipe: { top, bottom, shoes, topCol, botCol, shoeCol, trimCol?, denim?, skirt?: {col, flare}, cap?, sunglasses?, backpack?, pouch? }
  const _c = new THREE.Color(), _t = new THREE.Color();
  function build(r) {
    const st = [r.top, r.bottom, r.shoes], L = lm, parts = [];
    const speck = (x, y, z) => 0.92 + 0.16 * ((Math.sin(x * 917.1 + y * 311.7 + z * 543.3) * 43758.5453) % 1 + 1) % 1;
    // layering: tops always sit further out than bottoms, so a shirt hem lies over the waistband instead of z-fighting with it
    // r.loose (> 1) makes the top oversized: thicker and smoothed further, so the muscles underneath stop showing
    if (r.top) parts.push(shell((x, y, z) => topMask(x, y, z, st, L, -0.012), (r.top === 4 ? 0.03 : r.top === 3 ? 0.019 : 0.016) * (r.loose || 1), Math.round((r.top === 4 ? 14 : 10) * (r.loose || 1)), (x, y, z, c) => {
      c.set(r.topCol); if (r.trimCol && topMask(x, y, z, st, L, 0.02) < 0.5) c.set(r.trimCol); }));
    if (r.bottom && r.bottom < 4) parts.push(shell((x, y, z) => botMask(x, y, z, st, L, -0.012), r.bottom === 3 ? 0.008 : 0.01, 8, (x, y, z, c) => { c.set(r.botCol); if (r.denim) c.multiplyScalar(speck(x, y, z)); }));
    if (r.shoes === 2) parts.push(shell((x, y, z) => shoeMask(x, y, z, st, L, -0.012), 0.018, 4, (x, y, z, c) => { c.set(y < 0.028 ? (r.soleCol || '#f2f0ea') : r.shoeCol); }));
    if (r.top === 4) parts.push(PARTS.hood(r.topCol));
    if (r.skirt) parts.push(PARTS.skirt(r.skirt.col, r.skirt.flare));
    if (r.cap) parts.push(PARTS.cap(r.cap));
    if (r.sunglasses) parts.push(PARTS.sunglasses());
    if (r.backpack) parts.push(PARTS.backpack(r.backpack));
    if (r.pouch) parts.push(PARTS.pouch(r.pouch));
    const list = parts.filter(Boolean).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k); return g.index ? g : g; });
    if (!list.length) return null;
    const merged = mergeGeometries(list); merged.computeBoundingSphere(); return merged;
  }
  return { build, headTop };
}
