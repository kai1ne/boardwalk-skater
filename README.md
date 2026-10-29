# Venice Boardwalk — Phase 1 (look-dev)

A desktop-only Three.js scene of a Venice-style beach boardwalk. In this phase the only goal is to look as close
to the photos in `reference/` as possible. There's no gameplay yet.

## Run

Browsers block texture loading from `file://`, so serve the folder over HTTP:

```bash
cd "Venice Boardwalk Game"
python3 -m http.server 8000
```

Then open <http://localhost:8000/venice-boardwalk.html>. You need an internet connection, because three.js r186
loads from jsDelivr through an import map.

## Controls

| Key | Action |
|---|---|
| 1–4 | Jump to a phase: sunny midday, golden hour, marine-layer fog, blue hour |
| P | Pause or resume the lighting cycle (20 s per phase, with a smooth blend into the next) |
| Space | Stop or start the placeholder skater |
| J / K | Make the skater do an ollie or a kickflip (they also happen on their own every 5–9 s) |
| C | Switch between the chase camera and an eye-level (1.7 m) camera |
| O | Turn ambient occlusion (GTAO) on or off |

## Files

- `venice-boardwalk.html` — the scene (one ES module).
- `characters.js` — the rigged crowd, skater, cyclists and dogs (imported dynamically; if it fails to load, the scene
  falls back to the old block figures).
- `assets/characters/` — Quaternius CC0 characters, animations and dogs (see `CREDITS.md`).
- `textures/<asset_id>/` — Poly Haven CC0 maps at 2K (see `CREDITS.md`).
- `reference/` — the reference photos.

## How it's built

- **Infinite scroll:** 10 pooled chunks of 40 m are recycled along −Z. The right side picks from 18 prebuilt,
  merged building templates (stall rows, teal arcade, red-awning cafe, side-street corner, blue mural block).
  Props are `InstancedMesh` slots that get rewritten when a chunk is recycled, so nothing is allocated per frame.
- **Ground:** custom world-space PBR shaders. Each map is sampled twice (once rotated and rescaled) with a
  noise-driven blend, plus large-scale variation, to hide tiling. Canvas decals add seams, cracks, stains, gum
  spots, damp patches and paint. The lawn, dirt and sand are mixed by procedural masks.
- **Atmosphere:** the fog chunks are overridden with exponential height fog. `scene.fog` is a `THREE.Fog`, with
  `near` used as the density and `far` as the height falloff. There's also a procedural sky dome with clouds, a
  PMREM environment map rebuilt from the sky, ACES tone mapping, PCF soft shadows (in r186, `PCFSoftShadowMap`
  was removed and `PCFShadowMap` with `shadow.radius` replaces it), and a texel-snapped shadow camera that
  follows the viewer.
- **Post-processing:** RenderPass → GTAO (half resolution, with the sky and foliage excluded) → god rays →
  UnrealBloom → OutputPass → vignette and film grain.
- **Performance:** an adaptive resolution governor moves the pixel ratio between 1 and min(devicePixelRatio, 2)
  to hold about 60 fps.

## People (characters.js)

- **Rig and clips:** the bodies and the Universal Animation Library share one 65-bone humanoid rig. The real clip
  names are logged to the console at load time, and behaviours are mapped from that list (for example
  walk → `Walk_Loop`, sit → `Sitting_Idle_Loop`, performer → `Dance_Loop` / `Idle_Talking_Loop` /
  `Spell_Simple_Idle_Loop`, cyclist → `Driving_Loop`). Clips are retargeted when loaded: per-bone translation
  and scale tracks are dropped (they carry the mannequin's proportions), and pelvis travel is scaled by each
  body's leg length.
- **No foot sliding:** walk speed = root-motion stride (measured from the `_RM` file: 0.975 m/s for Walk_Loop)
  × leg ratio × timeScale × body scale. Couples share the leader's speed and adjust their own timeScale to match.
- **Variety:** 20 appearances per body (6 skin tones, tops, bottoms, shoes, swimwear, 6 hairstyles plus beards,
  8 hair colours). Each one is a shared material made once. Clothes are painted onto the base bodies in a shader,
  using bind-pose (T-pose) bands measured from the bones, and pushed out a few mm for thickness. Height and build
  vary through slight non-uniform scale.
- **Budget:** 24 pooled `SkinnedMesh` rigs per body, cloned with `SkeletonUtils.clone`, each with one
  `AnimationMixer`. They go to the nearest visible agents and are re-sorted 5 times a second. The nearest 30
  animate every frame and the rest every 3rd frame (staggered). Only rigs within 30 m cast shadows, eyes and brows
  are drawn only within 18 m, and rigs past 25 m are left out of the GTAO pass. Past 80 m, walkers become one
  instanced flipbook billboard mesh (4 walk frames × front/back), baked from the rigs into an atlas at load
  time. Anything off-screen gets no rig.
- **Procedural animation** (bones edited after `mixer.update()`; the clip pose is saved and restored around each
  edit, because PropertyMixer only writes values that changed): the skater's lean, crouch, ollie pop, kickflip
  foot flick, arm balance and leg IK onto the deck; the selfie arm IK with a phone; the cyclist's pedal and
  handlebar IK; loungers' arms lowered from the A-pose clip.
- Debug: `__vb.chars` (pools, stats, `frozen = true` holds everyone still), `__vb.showSkater = true` keeps the
  skater visible in the `ref` camera.

## Adding a mobile mode later

Everything that depends on the platform is in `QUALITY` at the top of the script: pixel ratio, MSAA, shadow map
size, GTAO, bloom, chunk count, crowd size, env map size and `characters` (rig pool size, full-rate count, LOD radii). Add a `mobile` profile there, set `PLATFORM` from
device detection, and add touch input next to the existing `keydown` handler.

## Debug hooks

`window.__vb` in the console:

- `shot('ref1')` … `shot('ref6')` — set the camera and phase to match each reference photo.
- `bench(30)` — milliseconds per frame without rAF timing (it forces a GPU sync).
- `info()` — draw calls, triangles and any texture fallbacks used.
