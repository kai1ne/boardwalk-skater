# Boardwalk Skater

A desktop, keyboard-only Three.js endless skater on a Venice-style beach boardwalk. Phase 1 matched the look of the
photos in `reference/`, phase 1b added the rigged crowd, and phase 2 (this version) makes it playable from the title
screen to game over.

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
| Enter / Space | Start, or restart after game over |
| ← → or A D | Tap to carve one lane; hold to keep sliding across lanes without stopping |
| ↑ or Space (or W) | Jump. A quick tap is always a plain ollie. Hold longer (up to about 0.3 s) to jump higher; the height picks the trick: kickflip → heelflip → hardflip → 360 flip → impossible |
| ↑ or ↓ in the air | Switch feet: the body turns so the other foot leads (regular ↔ switch). You land and keep riding that way; landing a switch adds 50 |
| Esc | Pause or resume (the game also pauses when the tab is hidden) |

Debug keys:

| Key | Action |
|---|---|
| 1–4 | Jump to a lighting phase: sunny midday, golden hour, marine-layer fog, blue hour |
| P | Hold or resume the lighting cycle (200 s per phase, the last 60 s blending into the next) |
| H | Draw the collision boxes (cyan = skater, red = solid, orange = jumpable, yellow = slip) |
| C | Switch between the chase camera and an eye-level (1.7 m) camera |
| O | Turn ambient occlusion (GTAO) on or off |

## How to play

Skate as far as you can. Speed starts at 27 km/h and climbs to 58 km/h.

- **Health** (top right): every obstacle you run into costs health: 34 for anything solid (3 hits end the run) and
  10 for slipping on pizza or poop. Each obstacle can only hit you once, and there's no invincibility window, so
  back-to-back hits each count. A hit gives a short camera jolt. After 8 s without damage, health slowly refills
  at 1.5 per second.
- **Energy**: every jump costs 8–40 depending on how high you go (the trick comes with the height). It refills at
  6 per second. A big jump with too little energy is cut down to what you can afford, so you get a lower trick. While you hold jump, the dark end of the bar shows what the
  jump will cost. With no energy you can't jump.
- **People in the lanes:** walkers (some with a dog out front on a lead), cyclists and skaters riding with you or
  toward you, and influencers stopped for a selfie. You can't jump any of them, so change lane. Now and then a
  cyclist or skater also **rides across** the boardwalk.
- **People sitting on buckets and crates:** someone asking for change, someone smoking, and drum circles. They sit
  just off the lanes and in the outer two lanes. You can't jump the ones in a lane.
- **Knocked-over trash cans** and **cone groups** can be jumped, but they need a fairly well-charged ollie.
- **Pizza** and **dog poop** make you slip: you keep your health but lose speed and your combo. Jump them, or hit
  jump within 0.1 s of touching one to get away clean.
- At top speed a full charge takes about 5 m of travel, so start holding jump early for cans and cones.

Score: 1 point per metre (the HUD shows the distance in feet). A jump is worth 25–100 depending on its height,
plus its trick: kickflip 150, heelflip 175, hardflip 250, 360 flip 325, impossible 400. A jump that clears an obstacle scores double, plus 75 for the clear. Each landing multiplies by your combo
(×2, ×3 … up to ×8). The combo grows with every landed jump and resets when you slip, wipe out or get hit, or after
3 s on the ground without a jump. The best score is saved in the browser.

Around you, pigeons and gulls on the ground take off as you ride up to them. A seagull flock wanders the sky and
lands on lamp tops, trash cans, benches, palm crowns and roofs, then flies off again.

## Files

- `venice-boardwalk.html` — the scene (one ES module), plus the `GAME` tuning object near the top.
- `game.js` — the game loop: states, input, lanes, jump/trick state machine, health and energy, obstacle and
  crossing-traffic spawning, collisions, score and HUD (imported dynamically).
- `characters.js` — the rigged crowd, skater, cyclists and dogs (imported dynamically; if it fails to load, the scene
  falls back to the old block figures).
- `assets/characters/` — Quaternius CC0 characters, animations and dogs (see `CREDITS.md`).
- `textures/<asset_id>/` — Poly Haven CC0 maps, shipped at 1K (about 11 MB; see `CREDITS.md`).
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

## Game (game.js)

- **Tuning:** every gameplay number is in the `GAME` object near the top of `venice-boardwalk.html`. That covers the
  speed ramp (`speed.start`, `ramp`, `max`), lane carves (`lanes.carveRatio`, `carveMin`, `carveMax`, `recoverTime`, `lean`), the jump
  (`jump.minHeight`, `maxHeight`, `chargeTime`, `gravity`, `coyote`), tricks (`tricks.ollieBelow`, `order`,
  `durShare`, points), `energy` and `health`, spawn gaps and crossing traffic (`spawn.minGap`, `reaction`,
  `gapJitter`, `rampDist`, weights, `crossEvery`, crossing speeds), the hitbox sizes and the score values.
- **Timing:** everything runs on delta time. Delta is clamped to 50 ms, and the clock ignores time while the tab is
  hidden. The world (lighting cycle, crowd, skater) stands still while paused.
- **Jump:** the arc is a real parabola under `jump.gravity`; how long you hold the key sets the apex between
  `minHeight` and `maxHeight` (capped by the energy you have). States are ground → charge → air → land, plus slip,
  bail (wipeout) and crash. Below `tricks.ollieBelow` of a full charge it is a plain ollie. Above that, the rest of the
  range is split evenly between the five tricks in `tricks.order`, and each trick takes `durShare` of that jump's air
  time, so it always lands clean. The heelflip spins the other way, the hardflip adds a half shove-it and a vertical
  flip, the 360 flip adds a full shove-it, and the impossible wraps the board end over end around the back truck.
- **Crossing traffic:** every 14–30 s a row slot is given to a cyclist or skater riding across the boardwalk at a
  steady speed, timed to be over the lanes when you arrive. They use the rigged crowd: the cyclist rides one of the
  procedural bikes, and the skater rides their own board with feet planted by IK.
- **Fair spawning:** obstacles come in rows. Every row leaves at least one lane completely open. The gap between
  rows is at least speed × (reaction time + three lane slides + recovery), so there is always time to reach the open
  lane. Pedestrians are placed so they reach their row exactly when the skater does, whichever way they walk.
  Obstacles ramp up steadily with distance over `spawn.rampDist` (1,500 m, about 4,900 ft): rows block more lanes
  and the random slack between rows shrinks, but never below that reach-the-open-lane minimum. In testing,
  density went from about 4 obstacles per 100 m at the start to 5 at 800 m and 7 at full difficulty. The weights give
  70% people and 30% objects (cans, cones, pizza, poop).
- **Collisions:** boxes per obstacle type, sized to the lanes. They never use the visual meshes. Jumpable and slip
  obstacles are passed when the board is higher than the obstacle's `clear` value.
- **Skater animation:** the free animation library has no skating clips (the 43 clip names are logged to the
  console at load). So game.js writes a pose each frame (`S.pose`: air, pitch, kickflip roll, crouch, lean,
  foot flick, arm flail, board kicked out), and characters.js turns it into bone edits after `mixer.update()`.
- **Birds:** ground birds within reach of the skater take off in a ragged burst, then fly up and away. A flock of
  9 gulls wanders ahead of the camera and lands on perch points. Lamps, cans, benches and palm crowns come from
  each chunk's layout, and roof spots are found once per building template by casting rays straight down. Perched
  gulls on low spots take off when the skater comes within 6 m. Flying birds are 3 instanced meshes (body plus 2
  wings), with flapping, gliding, banking and folded wings.
- **Player skater:** the body is decimated with three's `SimplifyModifier` (meshoptimizer) from 12,566 to about
  5,650 triangles. Skin weights carry over and the original smooth normals are kept. The skin normal map is
  softened so the 'superhero' muscles read as an everyday build, the eyebrow cards are dropped, and the outfit adds
  white crew socks and white soles. `skaterDecimate` (0.55) sets how much is removed.
- **Seated people:** beggars hold out a cup next to a cardboard sign, smokers raise a cigarette to their mouth
  every few seconds and exhale a puff, and drummers beat djembes (arms driven by IK). Each sits on a bucket or milk
  crate (`SIT_KINDS` in characters.js). Off-lane ones come from each chunk's layout and are kept even when
  `crowd.sideWalkers` thins the rest of the side crowd.
- **People:** all people obstacles use the rigged crowd and get a rig before anyone else. Walkers and riders moving
  along a lane are placed so they reach their row exactly when you do. Same-way riders are always slower than you,
  so you can catch them. Rows pick the lanes that have had the fewest people so far (with some shuffle), so people
  spread evenly across the four lanes. The off-lane crowd (walkers, ambient cyclists, sitters, performers) is
  thinned by `crowd.sideWalkers` (0.015) so each side strip holds about as many people as each lane. Set it to 1
  for the full phase 1 crowd. The ambient crowd,
  performers and selfie-takers stay outside the four lanes (|x| > 4.3 m). Edge scenery never collides.

## Adding a mobile mode later

Everything that depends on the platform is in `QUALITY` at the top of the script: pixel ratio, MSAA, shadow map
size, GTAO, bloom, chunk count, crowd size, env map size and `characters` (rig pool size, full-rate count, LOD radii). Add a `mobile` profile there, set `PLATFORM` from
device detection, and add touch input next to the existing `keydown` handler.

## Debug hooks

`window.__vb` in the console:

- `game` — the game object (`start()`, `kill()`, `st`, `sk`, `OBS`, `spawnObstacle(type, lane, z)`).
- `timeScale` — slow motion (for example `0.05`) for checking animation.
- `shot('ref1')` … `shot('ref6')` — set the camera and phase to match each reference photo.
- `bench(30)` — milliseconds per frame without rAF timing (it forces a GPU sync).
- `info()` — draw calls, triangles and any texture fallbacks used.
