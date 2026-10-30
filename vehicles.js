// =====================================================================================
// vehicles.js — procedural police cars, police SUVs and lifeguard pickups (no CC0 models needed).
//
// Each body is a side profile with filleted corners (curved nose, hood, tail) and wheel arches, extruded across the
// width with a deep rounded bevel, then shaped: the upper body tucks in a little and the nose and tail taper in plan.
// The cabin is a second, narrower extrusion with a curved roofline that leans in toward the roof (tumblehome); its
// window frames, pillars and roof panel are painted on, so it reads as glass in a body-coloured frame. Liveries are
// canvas textures on the flat body sides, mapped in metres along the car (u = z, v = y). Normals are smoothed across
// the bevels. Wheels are separate meshes so a driving vehicle can spin them. Geometry and materials are built once
// per kind and shared by every copy. Local frame: front toward +z, x across, y up, ground at y = 0.
// =====================================================================================
import * as THREE from 'three';

// body / cabin: profile points (z, y), front first, each with a fillet radius; roof: [front z, rear z, top y]
const KINDS = {
  policeCar: { L: 4.95, W: 1.86, r: 0.34, wz: [1.5, -1.45], livery: 'police', bar: 'police', barZ: -0.25, doors: 4,
    body: [[2.4, 0.3, 0], [2.42, 0.56, 0.12], [2.2, 0.74, 0.4], [1.2, 0.86, 0.3], [-1.4, 0.9, 0.3], [-2.22, 0.86, 0.32], [-2.4, 0.66, 0.14], [-2.38, 0.3, 0]],
    cabin: [[1.32, 0.78, 0], [0.3, 1.36, 0.5], [-0.8, 1.38, 0.55], [-1.5, 0.82, 0]], roof: [0.3, -0.8, 1.38] },
  policeSUV: { L: 5.05, W: 2.0, r: 0.4, wz: [1.55, -1.55], livery: 'police', bar: 'police', barZ: -0.45, pushBar: true, doors: 4,
    body: [[2.44, 0.4, 0], [2.47, 0.8, 0.16], [2.32, 0.98, 0.32], [1.3, 1.06, 0.3], [-2.36, 1.06, 0.16], [-2.44, 0.92, 0.12], [-2.42, 0.4, 0]],
    cabin: [[1.42, 0.98, 0], [0.5, 1.76, 0.45], [-2.2, 1.78, 0.3], [-2.42, 1.0, 0]], roof: [0.5, -2.2, 1.78] },
  lifeguard: { L: 5.6, W: 2.0, r: 0.4, wz: [1.75, -1.8], livery: 'lifeguard', bar: 'red', barZ: 0.2, bed: [-0.55, -2.62], doors: 2,
    body: [[2.72, 0.43, 0], [2.76, 0.82, 0.16], [2.6, 1.0, 0.32], [1.5, 1.04, 0.3], [-2.66, 1.04, 0.12], [-2.72, 0.9, 0.12], [-2.7, 0.43, 0]],
    cabin: [[1.62, 0.96, 0], [0.8, 1.74, 0.42], [-0.22, 1.76, 0.22], [-0.36, 0.98, 0]], roof: [0.8, -0.22, 1.76] },
};
const BEV = { body: [0.13, 0.1], cabin: [0.1, 0.08] };   // [bevel thickness (across), bevel size (outward)]

// a path through the profile points, each corner rounded by its own fillet radius (a quadratic curve through it)
function roundedPath(s, pts, close) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [z, y, r] = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const ends = !close && (i === 0 || i === n - 1);
    if (!r || ends) { if (i === 0) s.moveTo(z, y); else s.lineTo(z, y); continue; }
    const da = Math.hypot(a[0] - z, a[1] - y), db = Math.hypot(b[0] - z, b[1] - y), rr = Math.min(r, da * 0.45, db * 0.45);
    const p0 = [z + (a[0] - z) / da * rr, y + (a[1] - y) / da * rr], p1 = [z + (b[0] - z) / db * rr, y + (b[1] - y) / db * rr];
    if (i === 0) s.moveTo(p0[0], p0[1]); else s.lineTo(p0[0], p0[1]); s.quadraticCurveTo(z, y, p1[0], p1[1]);
  }
}
// the body outline: rounded top profile, then the bottom edge with arches over the wheels (radius leaves room for the bevel)
function bodyShape(K) {
  const s = new THREE.Shape(), pts = K.body, yb = pts[0][1], R = K.r + 0.07 + BEV.body[1];
  roundedPath(s, pts, false);
  for (const wz of [K.wz[1], K.wz[0]]) {   // rear arch, then front, walking the bottom edge toward the nose
    const sb = Math.min(0.99, Math.max(-0.99, (yb - K.r) / R)), b = Math.asin(sb), dz = R * Math.cos(b);
    s.lineTo(wz - dz, yb); for (let k = 1; k < 16; k++) { const th = Math.PI - b - (Math.PI - 2 * b) * k / 16; s.lineTo(wz + R * Math.cos(th), K.r + R * Math.sin(th)); }
    s.lineTo(wz + dz, yb);
  }
  s.lineTo(pts[0][0], pts[0][1]); return s;
}
function cabinShape(K) { const s = new THREE.Shape(); roundedPath(s, K.cabin, true); s.closePath(); return s; }
// extrude a profile across the car: shape (z, y) → world (x, y, z), centred on x = 0, `width` wide overall
function extrudeAcross(shape, width, [bt, bs]) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 5, curveSegments: 8 });
  g.rotateY(-Math.PI / 2); g.translate(width / 2 - bt, 0, 0); return g;
}
// smooth shading: average the face normals of coincident vertices whose faces bend by less than ~55°
function smoothNormals(g, crease = 0.57) {
  g.computeVertexNormals(); const p = g.attributes.position, n = g.attributes.normal, N = p.count, groups = new Map();
  for (let i = 0; i < N; i++) { const k = `${Math.round(p.getX(i) * 2000)},${Math.round(p.getY(i) * 2000)},${Math.round(p.getZ(i) * 2000)}`; let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(i); }
  const out = new Float32Array(N * 3), v = new THREE.Vector3(), w = new THREE.Vector3(), acc = new THREE.Vector3();
  for (const idx of groups.values()) for (const i of idx) { v.fromBufferAttribute(n, i); acc.set(0, 0, 0);
    for (const j of idx) { w.fromBufferAttribute(n, j); if (v.dot(w) > crease) acc.add(w); } acc.normalize(); out[i * 3] = acc.x; out[i * 3 + 1] = acc.y; out[i * 3 + 2] = acc.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3)); return g;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// how much narrower the body is at (y, z): tucked in above the beltline, tapered toward the nose and tail
function bodyTaper(K, y, z) { const belt = K.body[3][1]; return (1 - 0.05 * sstep(belt - 0.35, belt + 0.1, y)) * (1 - 0.07 * sstep(K.L / 2 - 0.9, K.L / 2 + 0.1, Math.abs(z))); }
function shape(g, f) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * f(p.getY(i), p.getZ(i))); p.needsUpdate = true; return g; }

const canvasTex = (w, h, draw, srgb = true) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const mr = (rough, metal) => `rgb(0,${Math.round(rough * 255)},${Math.round(metal * 255)})`;   // roughness (G) / metalness (B) map colour
const GLASS = '#33404c', PILLAR = '#141416';

// livery on the body sides: u = z along the car, v = height (both in metres, mapped by repeat/offset)
function liveryTex(K) {
  const L = K.L + 0.4, H = 1.4;
  const t = canvasTex(1024, 256, (x, w, h) => {
    const X = (z) => (z + L / 2) / L * w, Y = (y) => (1 - y / H) * h;
    if (K.livery === 'police') {   // black-and-white: black fenders and quarters, white doors
      x.fillStyle = '#121214'; x.fillRect(0, 0, w, h);
      const d0 = K.wz[1] + K.r + 0.25, d1 = K.wz[0] - K.r - 0.15; x.fillStyle = '#f2f2ef'; x.fillRect(X(d0), 0, X(d1) - X(d0), h);
      x.fillStyle = '#121214'; x.fillRect(0, Y(0.4), w, h);   // black rocker panel below the doors
    } else {   // lifeguard: yellow with a red band at the beltline and a red rocker panel
      x.fillStyle = '#f2c21b'; x.fillRect(0, 0, w, h); x.fillStyle = '#c8102e'; x.fillRect(0, Y(0.84), w, Y(0.76) - Y(0.84));
      x.fillRect(0, Y(0.48), w, h);
    }
  });
  t.repeat.set(1 / L, 1 / H); t.offset.set(0.5, 0); return t;
}
// cabin sides (caps, u = z, v = y): glass inside a dark frame, with B-pillars on four-door cars;
// cabin top/front/back (side walls, u = z): glass, with the roof panel painted in the body colour
function cabinTextures(K, roofCol) {
  const L = K.L + 0.4, H = 2.2, X = (z, w) => (z + L / 2) / L * w, Y = (y, h) => (1 - y / H) * h;
  const c = K.cabin, cz = c.reduce((s, p) => s + p[0], 0) / c.length, cy = c.reduce((s, p) => s + p[1], 0) / c.length;
  const inset = c.map(([z, y]) => { const dz = cz - z, dy = cy - y, d = Math.hypot(dz, dy) || 1; return [z + dz / d * 0.11, y + dy / d * 0.09]; });
  const caps = (glass, frame) => (x, w, h) => { x.fillStyle = frame; x.fillRect(0, 0, w, h); x.fillStyle = glass; x.strokeStyle = glass; x.lineJoin = 'round'; x.lineWidth = 18;
    x.beginPath(); inset.forEach(([z, y], i) => (i ? x.lineTo(X(z, w), Y(y, h)) : x.moveTo(X(z, w), Y(y, h)))); x.closePath(); x.fill(); x.stroke();
    if (K.doors === 4) { const bz = (K.wz[0] + K.wz[1]) / 2 + 0.05; x.fillStyle = frame; x.fillRect(X(bz - 0.06, w), 0, X(bz + 0.06, w) - X(bz - 0.06, w), h); } };
  const sides = (glass, roof) => (x, w, h) => { x.fillStyle = glass; x.fillRect(0, 0, w, h); const g = x.createLinearGradient(X(K.roof[1], w), 0, X(K.roof[0], w), 0), e = 0.12 / (K.roof[0] - K.roof[1]);
    g.addColorStop(0, glass); g.addColorStop(e, roof); g.addColorStop(1 - e, roof); g.addColorStop(1, glass); x.fillStyle = g; x.fillRect(X(K.roof[1], w), 0, X(K.roof[0], w) - X(K.roof[1], w), h); };
  const fit = (t, v) => { t.repeat.set(1 / L, v ? 1 / H : 1); t.offset.set(0.5, 0); return t; };
  const mat = (draw, drawMR, v) => new THREE.MeshStandardMaterial({ map: fit(canvasTex(1024, v ? 256 : 4, draw), v), roughnessMap: fit(canvasTex(1024, v ? 256 : 4, drawMR, false), v), metalnessMap: null, roughness: 1, metalness: 1 });
  const capM = mat(caps(GLASS, PILLAR), caps(mr(0.06, 0.85), mr(0.5, 0.2)), true), sideM = mat(sides(GLASS, roofCol), sides(mr(0.06, 0.85), mr(0.4, 0.15)), false);
  capM.metalnessMap = capM.roughnessMap; sideM.metalnessMap = sideM.roughnessMap;   // one map: roughness in G, metalness in B
  return [capM, sideM];
}
// door lettering, drawn as its own decal so it reads the right way round on both sides
function letterTex(text, fg, bg) { return canvasTex(512, 128, (x, w, h) => { if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; let s = 96; x.font = `900 ${s}px "Arial Black", Impact, sans-serif`; while (x.measureText(text).width > w * 0.92) { s -= 4; x.font = `900 ${s}px "Arial Black", Impact, sans-serif`; }
  x.fillText(text, w / 2, h / 2 + 4); }); }

const M = {
  black: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.2 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.8 }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 0.6, roughness: 0.2 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff2020, emissiveIntensity: 0.5, roughness: 0.3 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc81a1a, emissive: 0xff1a1a, emissiveIntensity: 0.4, roughness: 0.3 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x1a3fc8, emissive: 0x2a5cff, emissiveIntensity: 0.4, roughness: 0.3 }),
};
export const VEHICLE_LIGHTS = [M.red, M.blue];   // light-bar materials (the caller can flash them)

function wheelGeo(r) {   // rounded tyre + rim + hub, vertex coloured, axle along x
  const tyre = new THREE.LatheGeometry([[r * 0.6, -0.13], [r - 0.04, -0.13], [r, -0.09], [r, 0.09], [r - 0.04, 0.13], [r * 0.6, 0.13]].map(([a, b]) => new THREE.Vector2(a, b)), 24);
  const parts = [[tyre, 0x111112], [new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.24, 18, 1), 0xb8bcc2], [new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.27, 10, 1), 0x6a6e74]];
  const geos = parts.map(([g, c]) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; });
  const out = mergeSimple(geos); out.rotateZ(Math.PI / 2); return out;
}
function mergeSimple(geos) {   // non-indexed geometries with the same attributes
  const keys = Object.keys(geos[0].attributes), out = new THREE.BufferGeometry();
  for (const k of keys) { const item = geos[0].attributes[k].itemSize, total = geos.reduce((n, g) => n + g.attributes[k].array.length, 0), arr = new Float32Array(total); let o = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; } out.setAttribute(k, new THREE.BufferAttribute(arr, item)); }
  return out;
}
const pill = (len, r) => new THREE.CapsuleGeometry(r, len, 4, 10).rotateZ(Math.PI / 2);   // a rounded bar along x

const CACHE = {};
function kindParts(kind) {
  if (CACHE[kind]) return CACHE[kind];
  const K = KINDS[kind], W = K.W, police = K.livery === 'police', paint = police ? '#f2f2ef' : '#f2c21b';
  const livery = new THREE.MeshStandardMaterial({ map: liveryTex(K), roughness: 0.4, metalness: 0.15 });
  const topMat = police ? M.black : new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.4, metalness: 0.15 });   // hood, nose and tail
  const cabinW = W - 0.26, cb = K.cabin[0][1], ct = K.roof[2];
  const P = {
    K,
    body: smoothNormals(shape(extrudeAcross(bodyShape(K), W, BEV.body), (y, z) => bodyTaper(K, y, z))), bodyMats: [livery, topMat],   // [sides, top/front/back]
    cabin: smoothNormals(shape(extrudeAcross(cabinShape(K), cabinW, BEV.cabin), (y, z) => (1 - 0.16 * sstep(cb, ct + 0.08, y)) * bodyTaper(K, Math.min(y, K.body[3][1]), z))),
    cabinMats: cabinTextures(K, paint),
    wheel: wheelGeo(K.r),
    letters: new THREE.PlaneGeometry(1.15, 0.29), lettersMat: new THREE.MeshStandardMaterial({ map: police ? letterTex('POLICE', '#111') : letterTex('LIFEGUARD', '#c8102e'), transparent: true, roughness: 0.5 }),
  };
  // lamps on the rounded nose and tail (just proud of the bevel), a dark grille between the headlights
  const front = K.body[0][0] + BEV.body[1], back = K.body[K.body.length - 1][0] - BEV.body[1], hy = (K.body[0][1] + K.body[1][1]) / 2 + 0.06, ty = (K.body[K.body.length - 1][1] + K.body[K.body.length - 2][1]) / 2 + 0.08;
  P.heads = [-1, 1].map((s) => new THREE.BoxGeometry(0.34, 0.11, 0.05).translate(s * (W / 2 - 0.34), hy, front + 0.01));
  P.tails = [-1, 1].map((s) => new THREE.BoxGeometry(0.3, 0.13, 0.05).translate(s * (W / 2 - 0.3), ty, back - 0.01));
  P.grille = new THREE.BoxGeometry(W - 1.05, 0.16, 0.04).translate(0, hy - 0.02, front + 0.005);
  const ry = ct + BEV.cabin[1] - 0.01;
  if (K.bar) { P.barL = pill(0.44, 0.06).translate(-0.3, ry + 0.09, K.barZ); P.barR = pill(0.44, 0.06).translate(0.3, ry + 0.09, K.barZ);
    P.barMats = police ? [M.red, M.blue] : [M.red, M.red]; P.barBase = new THREE.BoxGeometry(1.2, 0.04, 0.26).translate(0, ry + 0.02, K.barZ); }
  if (K.pushBar) P.push = mergeSimple([pill(1.0, 0.04).translate(0, 0.6, front + 0.14), pill(1.0, 0.04).translate(0, 0.9, front + 0.14),
    ...[-0.45, 0.45].map((x) => new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8).translate(x, 0.76, front + 0.12))].map((g) => { g = g.index ? g.toNonIndexed() : g; return g; }));
  if (K.bed) P.bed = new THREE.BoxGeometry(W - 0.55, 0.03, K.bed[0] - K.bed[1]).translate(0, K.body[3][1] + BEV.body[1] + 0.004, (K.bed[0] + K.bed[1]) / 2);
  return (CACHE[kind] = P);
}

// a new vehicle group; group.userData.veh = { kind, wheels, r, L, W }
export function makeVehicle(kind) {
  const P = kindParts(kind), K = P.K, g = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add(P.body, P.bodyMats); add(P.cabin, P.cabinMats);
  for (const h of P.heads) add(h, M.head); for (const t of P.tails) add(t, M.tail); add(P.grille, M.grey);
  if (P.barL) { add(P.barBase, M.black); add(P.barL, P.barMats[0]); add(P.barR, P.barMats[1]); }
  if (P.push) add(P.push, M.black);
  if (P.bed) add(P.bed, M.grey);
  // door lettering on both sides, between the wheels, reading front-to-back the right way round
  const dz = (K.wz[0] + K.wz[1]) / 2 + 0.1, ly = police(K) ? 0.64 : 0.6, lx = K.W / 2 * bodyTaper(K, ly, dz) + 0.004;
  for (const s of [-1, 1]) { const m = add(P.letters, P.lettersMat); m.castShadow = false; m.position.set(s * lx, ly, dz); m.rotation.y = s * Math.PI / 2; }
  const wheels = [];
  for (const wz of K.wz) for (const s of [-1, 1]) { const w = new THREE.Mesh(P.wheel, M.wheel); w.castShadow = true; w.position.set(s * (K.W / 2 - 0.17), K.r, wz); g.add(w); wheels.push(w); }
  g.userData.veh = { kind, wheels, r: K.r, L: K.L, W: K.W };
  return g;
}
const police = (K) => K.livery === 'police';
export const VEHICLE_KINDS = Object.keys(KINDS);
