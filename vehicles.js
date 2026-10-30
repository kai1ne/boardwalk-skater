// =====================================================================================
// vehicles.js — procedural police cars, police SUVs and lifeguard pickups (no CC0 models needed).
//
// Each body is a side profile extruded across the width (rounded by the bevel), with wheel arches cut into the
// profile. The windows are a second, narrower extrusion (the cabin), topped with a roof panel. Liveries are canvas
// textures on the flat body sides, mapped in metres along the car (u = z, v = y). Wheels are separate meshes so a
// driving vehicle can spin them. Geometry and materials are built once per kind and shared by every copy.
// Local frame: front toward +z, x across, y up, ground at y = 0.
// =====================================================================================
import * as THREE from 'three';

const KINDS = {
  policeCar: { L: 4.95, W: 1.86, r: 0.34, wz: [1.5, -1.45], livery: 'police', bar: 'police', barZ: -0.2,
    body: [[2.47, 0.32], [2.49, 0.6], [2.38, 0.8], [1.3, 0.93], [-1.45, 0.98], [-2.35, 0.95], [-2.47, 0.72], [-2.45, 0.32]],
    cabin: [[1.3, 0.93], [0.35, 1.43], [-0.85, 1.45], [-1.45, 0.98]], roof: [0.3, -0.8, 1.44] },
  policeSUV: { L: 5.05, W: 2.0, r: 0.4, wz: [1.55, -1.55], livery: 'police', bar: 'police', barZ: -0.35, pushBar: true,
    body: [[2.52, 0.42], [2.55, 0.85], [2.45, 1.05], [1.35, 1.15], [-2.45, 1.15], [-2.52, 1.0], [-2.5, 0.42]],
    cabin: [[1.35, 1.15], [0.55, 1.84], [-2.3, 1.86], [-2.48, 1.15]], roof: [0.5, -2.25, 1.85] },
  lifeguard: { L: 5.6, W: 2.0, r: 0.4, wz: [1.75, -1.8], livery: 'lifeguard', bar: 'amber', barZ: 0.25, bed: [-0.5, -2.7],
    body: [[2.8, 0.45], [2.83, 0.88], [2.72, 1.08], [1.55, 1.12], [-2.75, 1.12], [-2.8, 0.95], [-2.78, 0.45]],
    cabin: [[1.55, 1.12], [0.85, 1.82], [-0.25, 1.84], [-0.35, 1.12]], roof: [0.82, -0.22, 1.83] },
};

// a closed outline (z, y) with semicircular arches over the wheels cut out of its bottom edge
function bodyShape(K) {
  const s = new THREE.Shape(), pts = K.body, yb = pts[0][1], R = K.r + 0.07;
  s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  for (const wz of [K.wz[1], K.wz[0]]) {   // rear arch, then front, walking the bottom edge toward the nose
    const sb = Math.min(0.99, Math.max(-0.99, (yb - K.r) / R)), b = Math.asin(sb), dz = R * Math.cos(b);
    s.lineTo(wz - dz, yb); for (let k = 1; k < 12; k++) { const th = Math.PI - b - (Math.PI - 2 * b) * k / 12; s.lineTo(wz + R * Math.cos(th), K.r + R * Math.sin(th)); }
    s.lineTo(wz + dz, yb);
  }
  s.lineTo(pts[0][0], pts[0][1]); return s;
}
function polyShape(pts) { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.lineTo(pts[0][0], pts[0][1]); return s; }
// extrude a profile across the car: shape (z, y) → world (x, y, z), centred on x = 0, `width` wide overall
function extrudeAcross(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
  g.rotateY(-Math.PI / 2); g.translate(width / 2 - bevel, 0, 0); g.computeVertexNormals(); return g;
}
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

// livery on the body sides: u = z along the car, v = height (both in metres, mapped by repeat/offset)
function liveryTex(K) {
  const L = K.L + 0.2, H = 1.3;
  const t = canvasTex(1024, 256, (x, w, h) => {
    const X = (z) => (z + L / 2) / L * w, Y = (y) => (1 - y / H) * h;
    if (K.livery === 'police') {   // black-and-white: black fenders and quarters, white doors
      x.fillStyle = '#121214'; x.fillRect(0, 0, w, h);
      const d0 = K.wz[1] + K.r + 0.25, d1 = K.wz[0] - K.r - 0.15; x.fillStyle = '#f2f2ef'; x.fillRect(X(d0), 0, X(d1) - X(d0), h);
      x.fillStyle = '#121214'; x.fillRect(0, Y(0.42), w, h);   // black rocker panel below the doors
    } else {   // lifeguard: white with a blue band at the beltline
      x.fillStyle = '#f4f4f1'; x.fillRect(0, 0, w, h); x.fillStyle = '#1f5fb8'; x.fillRect(0, Y(0.86), w, Y(0.74) - Y(0.86));
      x.fillStyle = '#d0d0cc'; x.fillRect(0, Y(0.5), w, h);
    }
  });
  t.repeat.set(1 / L, 1 / H); t.offset.set(0.5, 0); return t;
}
// door lettering, drawn as its own decal so it reads the right way round on both sides
function letterTex(text, fg, bg) { return canvasTex(512, 128, (x, w, h) => { if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; let s = 96; x.font = `900 ${s}px "Arial Black", Impact, sans-serif`; while (x.measureText(text).width > w * 0.92) { s -= 4; x.font = `900 ${s}px "Arial Black", Impact, sans-serif`; }
  x.fillText(text, w / 2, h / 2 + 4); }); }

const M = {
  glass: new THREE.MeshStandardMaterial({ color: 0x33404c, roughness: 0.06, metalness: 0.85 }),   // tinted, reflects the sky
  black: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.2 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.4, metalness: 0.15 }),
  grey: new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.8 }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 0.6, roughness: 0.2 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff2020, emissiveIntensity: 0.5, roughness: 0.3 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc81a1a, emissive: 0xff1a1a, emissiveIntensity: 0.4, roughness: 0.3 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x1a3fc8, emissive: 0x2a5cff, emissiveIntensity: 0.4, roughness: 0.3 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xe8a020, emissive: 0xffa81a, emissiveIntensity: 0.4, roughness: 0.3 }),
};
export const VEHICLE_LIGHTS = [M.red, M.blue, M.amber];   // light-bar materials (the caller can flash them)

function wheelGeo(r) {   // tyre + rim + hub, vertex coloured, axle along x
  const parts = [[new THREE.CylinderGeometry(r, r, 0.26, 20, 1), 0x111112], [new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.27, 16, 1), 0xb8bcc2], [new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.29, 10, 1), 0x6a6e74]];
  const geos = parts.map(([g, c]) => { g = g.toNonIndexed(); const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) col.set([cc.r, cc.g, cc.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; });
  const out = mergeSimple(geos); out.rotateZ(Math.PI / 2); return out;
}
function mergeSimple(geos) {   // non-indexed geometries with the same attributes
  const keys = Object.keys(geos[0].attributes), out = new THREE.BufferGeometry();
  for (const k of keys) { const item = geos[0].attributes[k].itemSize, total = geos.reduce((n, g) => n + g.attributes[k].array.length, 0), arr = new Float32Array(total); let o = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; } out.setAttribute(k, new THREE.BufferAttribute(arr, item)); }
  return out;
}

const CACHE = {};
function kindParts(kind) {
  if (CACHE[kind]) return CACHE[kind];
  const K = KINDS[kind], W = K.W;
  const livery = new THREE.MeshStandardMaterial({ map: liveryTex(K), roughness: 0.4, metalness: 0.15 });
  const roofMat = K.livery === 'police' ? M.white : new THREE.MeshStandardMaterial({ color: 0xf4f4f1, roughness: 0.4, metalness: 0.15 });
  const P = {
    K,
    body: extrudeAcross(bodyShape(K), W, 0.06), bodyMats: [livery, K.livery === 'police' ? M.black : roofMat],   // [sides, top/front/back]
    cabin: extrudeAcross(polyShape(K.cabin), W - 0.2, 0.04),
    roof: new THREE.BoxGeometry(W - 0.32, 0.05, K.roof[0] - K.roof[1]).translate(0, K.roof[2], (K.roof[0] + K.roof[1]) / 2), roofMat,
    wheel: wheelGeo(K.r),
    letters: new THREE.PlaneGeometry(1.15, 0.29), lettersMat: new THREE.MeshStandardMaterial({ map: K.livery === 'police' ? letterTex('POLICE', '#111') : letterTex('LIFEGUARD', '#c8102e'), transparent: true, roughness: 0.5 }),
  };
  const front = K.body[0][0], back = K.body[K.body.length - 1][0], hy = K.body[1][1] - 0.04;
  // lamps sit just proud of the bevelled nose and tail; a dark grille between the headlights
  P.heads = [-1, 1].map((s) => new THREE.BoxGeometry(0.34, 0.12, 0.04).translate(s * (W / 2 - 0.3), hy, front + 0.075));
  P.tails = [-1, 1].map((s) => new THREE.BoxGeometry(0.3, 0.14, 0.04).translate(s * (W / 2 - 0.25), K.body[K.body.length - 2][1] - 0.08, back - 0.075));
  P.grille = new THREE.BoxGeometry(W - 0.95, 0.2, 0.03).translate(0, hy - 0.04, front + 0.07);
  const ry = K.roof[2] + 0.025;
  if (K.bar) { P.barL = new THREE.BoxGeometry(0.62, 0.1, 0.26).translate(-0.32, ry + 0.06, K.barZ); P.barR = new THREE.BoxGeometry(0.62, 0.1, 0.26).translate(0.32, ry + 0.06, K.barZ);
    P.barMats = K.bar === 'police' ? [M.red, M.blue] : [M.amber, M.amber]; P.barBase = new THREE.BoxGeometry(1.3, 0.05, 0.32).translate(0, ry + 0.01, K.barZ); }
  if (K.pushBar) P.push = mergeSimple([new THREE.BoxGeometry(1.1, 0.08, 0.08).translate(0, 0.62, front + 0.18), new THREE.BoxGeometry(1.1, 0.08, 0.08).translate(0, 0.92, front + 0.18),
    ...[-0.45, 0.45].map((x) => new THREE.BoxGeometry(0.08, 0.6, 0.08).translate(x, 0.78, front + 0.16))].map((g) => g.toNonIndexed()));
  if (K.bed) P.bed = new THREE.BoxGeometry(W - 0.34, 0.03, K.bed[0] - K.bed[1]).translate(0, K.body[3][1] + 0.005, (K.bed[0] + K.bed[1]) / 2);
  return (CACHE[kind] = P);
}

// a new vehicle group; group.userData.veh = { kind, wheels, r, L, W }
export function makeVehicle(kind) {
  const P = kindParts(kind), K = P.K, g = new THREE.Group(), add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  add(P.body, P.bodyMats); add(P.cabin, M.glass); add(P.roof, P.roofMat);
  for (const h of P.heads) add(h, M.head); for (const t of P.tails) add(t, M.tail); add(P.grille, M.grey);
  if (P.barL) { add(P.barBase, M.black); add(P.barL, P.barMats[0]); add(P.barR, P.barMats[1]); }
  if (P.push) add(P.push, M.black);
  if (P.bed) add(P.bed, M.grey);
  // door lettering on both sides, between the wheels, reading front-to-back the right way round
  const dz = (K.wz[0] + K.wz[1]) / 2 + 0.1, ly = K.livery === 'police' ? 0.68 : 0.62;
  for (const s of [-1, 1]) { const m = add(P.letters, P.lettersMat); m.castShadow = false; m.position.set(s * (K.W / 2 + 0.004), ly, dz); m.rotation.y = s * Math.PI / 2; }
  const wheels = [];
  for (const wz of K.wz) for (const s of [-1, 1]) { const w = new THREE.Mesh(P.wheel, M.wheel); w.castShadow = true; w.position.set(s * (K.W / 2 - 0.16), K.r, wz); g.add(w); wheels.push(w); }
  g.userData.veh = { kind, wheels, r: K.r, L: K.L, W: K.W };
  return g;
}
export const VEHICLE_KINDS = Object.keys(KINDS);
