# Boardwalk Skater

A desktop, keyboard-only Three.js endless skater on a Venice-style beach boardwalk. It runs from the title screen through to
game over, with tricks, a weather cycle, saved high scores and a credits screen.

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
| ← → or A D | Tap to carve one lane; hold to keep sliding across lanes without stopping. Works on the ground, crouched and in the air |
| Space | Hold to crouch and charge, release to jump. A quick tap is a plain ollie; a longer hold jumps higher (full charge at 0.45 s). Keep holding and he stays crouched |
| ↑ / ↓ in the air | Tricks (one per jump). They aren't listed in the game: you discover them |
| ↓ on the ground | Swap which foot leads |
| Esc | Pause; Esc, Enter or Space resume. The game also pauses when the tab is hidden or the window loses focus |
| C | Credits, on the title screen |

Tricks: ↑ kickflip · ↓ heelflip · ↑↑ 360 flip · ↓↓ impossible · ↑↓ or ↓↑ hardflip (hidden bonus). Each needs a minimum jump height
(0.60, 0.60, 0.85, 0.95 and 0.75 m) and enough air left to finish. If not, he bails: cone damage, combo lost, a slowdown and a
moment of invincibility. Energy still limits jump height, so big tricks need energy in the bank.

Debug keys:

| Key | Action |
|---|---|
| 1–4 | Jump to a phase: 1 sunny midday, 2 golden hour, 3 overcast fog, 4 blue hour |
| G | Hold or resume the weather cycle (60 s per phase, the last 8 s blending into the next) |
| T | Trick debug overlay: charge, crouch, apex, tricks available, flip window, air left |
| ` | Show the fps and debug-key strip |
| J | Clothing fit test: the game holds still and the camera orbits the player (walk, idle, skate stance, ollie, kickflip, bail); J again for a character in a hoodie, J again to exit |
| L | Character lineup: 24 characters in two rows (the game holds still) |
| K | Close-up at 2 m, stepping through the lineup characters one by one |
| P | Autopilot: a bot plays the game (shown as AUTOPILOT at the top) |
| H | Draw the collision boxes (cyan = skater, red = solid, orange = jumpable, yellow = slip), including each part of a dog-walker pair |
| C | During a run: switch between the chase camera and an eye-level (1.7 m) camera |
| O | Turn ambient occlusion (GTAO) on or off |

## How to play

Skate as far as you can. Speed starts at 27 km/h and climbs (only while you ride without damage) to 230 km/h.

- **Health** (top right): every obstacle you run into costs health: 45 for vehicles, 35 for people of any kind
  (3 hits end the run), 25 for trash cans and shop signs, 20 for cones, dogs and leads, 10 for slipping on pizza or
  poop, and 20 for a wipeout. Each obstacle can only hit you once, and there's no invincibility window, so
  back-to-back hits each count. A hit gives a short camera jolt. After 8 s without damage, health slowly refills
  at 1.5 per second.
- **Energy**: every jump costs 8–40 depending on how high you go. It refills at
  6 per second. A big jump with too little energy is cut down to what you can afford, so a big trick may be out of reach. While you hold jump, the dark end of the bar shows what the
  jump will cost. With no energy you can't jump.
- **Walkers** go both ways. Some stop for a moment, some drift over into the next lane.
- **Cyclists** and **other skaters** ride with you or toward you. Some skaters change lane, leaning for half a
  second first so you can see it coming. Now and then a cyclist or skater also **rides across** the boardwalk.
- **Influencers** stand or back up slowly with their phone held up; their camera flashes as you pass close.
- **Smokers** stand in a lane alone or in a group of two or three, taking drags and blowing smoke.
- **Dog walkers:** the owner in one lane and the dog in the next, with the red lead between them. A short-to-medium
  ollie clears the dog and the lead; the owner can't be jumped.
- **Buskers:** a guitarist, drummer or keyboard player on a rug in an outer lane, or **breakdancers** on cardboard
  with a boombox (one on a headspin, windmill or footwork, a partner toprocking), with a few people watching. The
  rug or cardboard marks the whole footprint; it can't be jumped.
- **Shop signs:** while the shops are open, stand-up signs go out in the right-hand lane in front of the shops they
  belong to: PIZZA HERE at a pizza place, BEST COFFEE IN THE WORLD at a café, 2 FOR $30 SUNGLASSES at a sunglasses
  shop, $5 TATTOOS at a tattoo parlour, and a green leaf at a (green) dispensary. They can be jumped.
- **Vehicles:** from 600 m on, now and then a police SUV or a yellow lifeguard pickup rolls slowly up the boardwalk toward
  you across two lanes. Change lane. Walkers and riders in its lanes always head the same way it does, so nobody
  walks into it.
- You can't jump walkers, riders, influencers or smokers either, so change lane.
- **Knocked-over trash cans** and **cone groups** can be jumped, but they need a fairly well-charged ollie.
- **Pizza** and **dog poop** make you slip: you lose 10 health and some speed. Jump them, or hit jump within 0.1 s
  of touching one to get away clean.
- People sitting at the sides (asking for change, smoking, drum circles), shoppers in front of the open shops and
  police cars parked on the grass or sand are scenery and never in your way.
- At top speed a full charge takes about 29 m of travel, so start holding Space early for cans and cones.

**The weather:** the first run starts in overcast fog, then turns to sunny midday, golden hour and blue hour (and
round again). Losing doesn't reset it: the next run carries on where the last one ended. In the fog and at blue hour the boardwalk is quiet (fewer walkers, cyclists and skaters,
in the lanes and off them) and the shops are shuttered. At midday and golden hour it's at its busiest and every shop is
open, with shoppers out front and signs in the right-hand lane.

Score for distance builds up along these marks: 100 ft 30, 500 ft 200, 1,000 ft 500, 2,000 ft 1,200, 3,000 ft 2,500, 5,000 ft 6,000, and 175 per 100 ft beyond that. A jump is worth 25–100 depending on its height,
plus its trick: kickflip 150, heelflip 175, hardflip 250, 360 flip 325, impossible 400. A jump that clears an
obstacle scores double, plus 75 for the clear. A **close call** (passing within 0.45 m of an obstacle, or clearing
a jumpable with under 0.15 m to spare) scores 60. Landings and close calls multiply by your combo (×2, ×3 … up to
×8), and each one adds to it. The combo resets only when you get hit or wipe out. Speed builds only while you ride
clean: a hit costs half the speed you've built up, a slip or wipeout 20%. The top 5 scores (with a name of up to 10 letters or numbers) and the tricks you've discovered are saved in the browser (versioned key, `boardwalkSkater.save.v1`) and shown on the title and game-over screens.

Around you, pigeons and gulls on the ground take off as you ride up to them. A seagull flock wanders the sky and
lands on lamp tops, trash cans, benches, palm crowns and roofs, then flies off again.

## Files

- `venice-boardwalk.html` — the scene (one ES module), plus the `GAME` tuning object near the top.
- `game.js` — the game loop: states, input, lanes, jump/trick state machine, health and energy, obstacle behaviours,
  collisions, close calls, score, HUD and the autopilot (imported dynamically).
- `director.js` — the spawn director: obstacle patterns by difficulty stage and the validator that rejects any
  pattern without a way through.
- `characters.js` — the rigged crowd, skater, cyclists and dogs (imported dynamically; if it fails to load, the scene
  falls back to the old block figures).
- `assets/characters/` — Quaternius CC0 characters, animations and dogs (see `CREDITS.md`).
- `textures/<asset_id>/` — Poly Haven CC0 maps, shipped at 1K (about 11 MB; see `CREDITS.md`).

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
- **Appearance (phase 3.5):** 20 seeded appearance recipes per body, made once and shared (`makeAppearance` in
  characters.js). Skin uses the 10-tone Monk Skin Tone scale, mapped to albedo on a log luminance curve so the
  tones stay natural in all four lighting phases. The final colour is the target × the texture's own luminance,
  so the face and hand detail survives. Hair, brows, eyes and clothing have their own materials. Hair is a
  luminance-tinted natural range (very dark through grey), and the irises are re-coloured (brown, hazel, green,
  blue, grey). Four builds come from the same mesh (everyday, slim, fuller, plus the original superhero body
  at 8%), derived in bind pose so the vertex count and skin weights don't change. Exactly 3 of every 20 looks (15%)
  are swimwear: women in a bikini (the base body's two-piece in a swim colour) or a one-piece (a swim tank over
  matching bottoms), men in swim trunks.
- **Clothing (outfits.js):** garments are real shells cut from the body surface by bind-pose region masks. They
  are smoothed, pushed out along normals (tops are thicker than bottoms so nothing z-fights), keep the body's
  skin weights, and get their hems snapped to a clean line. The body shader discards any skin under a garment
  using the same masks inset slightly, so nothing pokes through. Hoods, skirts, caps, sunglasses, backpacks and
  pouches are rigid parts weighted to bones. Each appearance's outfit is one merged, vertex-coloured
  `SkinnedMesh` bound to the body skeleton. Skirts are rigid, so seated kinds (sitters, drummers, cyclists,
  skaters, breakdancers) never get one. The performers have their own fixed outfits, and the player's look is a fixed
  recipe, which makes a title-screen character choice a matter of offering a few recipes.
- **Necklines:** sleeved tops (tee, long sleeve, hoodie) cover the shoulders and open only inside a round crew
  collar around the neck (radius 8.5 cm, 9.5 cm for hoodies). A flat neckline cut below the top of these
  muscular shoulders and left them bare. The player wears an oversized hoodie (`loose: 1.6` in his recipe makes
  the shell thicker and smoother, so the build underneath doesn't show).
- **LOD:** each body and outfit has a simplified version (SimplifyModifier: about 12.6K → 5.1K triangles) used
  past 12 m, with hysteresis out to 13.5 m so rigs don't flicker between levels. The lineup and the player always
  use full detail.
- **Budget:** 24 pooled `SkinnedMesh` rigs per body, cloned with `SkeletonUtils.clone`, each with one
  `AnimationMixer`. They go to the nearest visible agents and are re-sorted 5 times a second. The nearest 30
  animate every frame and the rest every 3rd frame (staggered). Only rigs within 30 m cast shadows, eyes and brows
  are drawn only within 18 m, and rigs past 25 m are left out of the GTAO pass. Past 80 m, walkers become one
  instanced flipbook billboard mesh (4 walk frames × front/back), baked from the rigs into an atlas at load
  time. Anything off-screen gets no rig.
- **Procedural animation** (bones edited after `mixer.update()`; the clip pose is saved and restored around each
  edit, because PropertyMixer only writes values that changed): the skater's lean, crouch, ollie pop, kickflip
  foot flick, arm balance and leg IK onto the deck; the selfie arm IK with a phone; the cyclist's pedal and
  handlebar IK; loungers' arms lowered from the A-pose clip. Breakdancers: the free clips have no breaking, so the
  whole rig is turned (headspin: upside down on the head, spinning; windmill: rolling across the upper back while
  spinning, legs held up by IK so they sweep over the top) with limbs posed on top of a base clip; footwork is a
  low crouch circling on one hand; the partner's toprock is `Dance_Loop`.
- Debug: `__vb.chars` (pools, stats, `frozen = true` holds everyone still), `__vb.showSkater = true` keeps the
  skater visible in the `ref` camera.

## Game (game.js)

- **Tuning:** every gameplay number is in the `GAME` object near the top of `venice-boardwalk.html`. That covers the
  speed ramp (`speed.start`, `ramp`, `max`), lane carves (`lanes.carveRatio`, `carveMin`, `carveMax`, `recoverTime`, `lean`), the jump
  (`jump.minHeight`, `maxHeight`, `chargeTime`, `crouchStart`, `crouchFull`, `gravity`, `coyote`), tricks (`tricks.flipWindow`, `airMargin`,
  `inputs`, each trick's `pts`, `minApex` and `dur`, and `bail`), `energy` and `health`, `obstacles` (hitbox sizes and jump clearances), `spawn` (row
  spacing, mover speeds, the skater lane-change telegraph, flash distance, crossing traffic), `director` (stages,
  pattern weights, gap slack, behaviour shares), and `score` (including `nearMiss`, `nearDist`, `nearJump`).
  Each obstacle's `dmg` is the health it costs. `input` maps keys to named actions (`game.press` / `game.release`, ready for touch), and `pause`, `hints`, `save` and `weather` hold those systems' values.
- **Shop signs:** shop stalls are tagged with a kind when the chunk templates are built (tattoo, pizza, coffee,
  sunglasses, dispensary; the café and the INK & IRON corner shop too), and the header sign matches it.
  `shopsBetween()` hands game.js the shops ahead; while `phase.open` is up, about 65% of them put a sign out in the
  right-hand lane, never two within 30 m. Signs within 1.5 s of travel of a row are validated with it (as jumps in
  that lane); the rest stand between rows, far enough from both to carve around.
- **Vehicles (vehicles.js):** procedural police cars, police SUVs and lifeguard pickups: a side profile with filleted
  corners and wheel arches extruded with a deep rounded bevel, tucked in above the beltline and tapered at the nose and
  tail, a curved cabin that leans in toward the roof (framed windows and roof panel painted on), a canvas livery, door lettering and spinning wheels (lifeguard pickups are yellow with red accents). Driving
  ones are a two-lane obstacle (`vehicle` pattern, from stage 2) that moves toward the skater and meets the row line
  when you do. The next row starts past where the car set out, a car never takes a lane a faster oncoming rider is
  using, and walkers or riders spawned in its lanes while it's on the road always head the same way it does, so
  nothing ever meets it head-on. Parked police cars are chunk scenery on the grass or sand.
- **Crowd by phase:** the phase's `crowd` level scales the off-lane crowd and the share of people among the lane
  blockers (`director.peopleShare` × crowd, down to 35% of it on the quiet phases).
- **Timing:** everything runs on delta time. Delta is clamped to 50 ms, and the clock ignores time while the tab is
  hidden. The world (lighting cycle, crowd, skater) stands still while paused.
- **Jump:** the arc is a real parabola under `jump.gravity`; how long you hold the key sets the apex between
  `minHeight` and `maxHeight` (capped by the energy you have). States are ground → charge → air → land, plus slip,
  bail (wipeout) and crash. Below `tricks.ollieBelow` of a full charge it is a plain ollie. Above that, the rest of the
  range is split evenly between the five tricks in `tricks.order`, and each trick takes `durShare` of that jump's air
  time, so it always lands clean. The heelflip spins the other way, the hardflip adds a half shove-it and a vertical
  flip, the 360 flip adds a full shove-it, and the impossible wraps the board end over end around the back truck.
- **Spawn director** (director.js): obstacles come as patterns: a single blocker, a pair, a triple (one lane left
  open), a hazard line with a jumpable in its gap, a busker on one side with walkers on the other, a dog walker
  across two lanes, or a crossing rider. Five stages by distance (`director.stages`, from 0 / 250 / 600 / 1,000 /
  1,600 m) unlock types and patterns, shrink the slack between rows and speed up the movers. Before a pattern is
  placed, the validator turns it into per-lane cells and checks that at least one lane can be ridden straight
  through at the current speed: no solids, every jump clearable with a full ollie, and room to land between jumps.
  Drifting walkers and lane-changing skaters count as blocking both lanes. Rejected patterns are logged to the
  console and re-rolled. Rows are never closer than speed × (reaction + three lane carves + recovery), so the open
  lane is always reachable. Movers are placed so they reach their row exactly when the skater does.
- **Autopilot** (P): the bot reads only the hitboxes and plays with the same carve and jump. It plans with dynamic
  programming over 0.05 s steps and the four lanes, 4 s ahead (collisions cost more the sooner they come), and logs
  a "trap" whenever no plan avoids a collision within the time to carve across every lane. In headless tests (5–10
  simulated minutes per stage, up to the 32 m/s cap) it took no hits; the only trap entries were two late reactions
  at 32 m/s with a free lane alongside, both escaped. `__vb.game.botReport()` returns obstacles per minute, hits,
  traps and pattern counts.
- **Collisions:** each obstacle has one or more hitbox parts (a dog walker has three: owner, lead, dog). They never
  use the visual meshes, and are checked in sub-steps of ≤ 0.3 m so a fast frame can't skip one. Jumpable and slip
  parts are passed when the board is higher than their `clear` value. A hit freezes the action for 0.07 s and shakes
  the camera.
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
  every few seconds and exhale a puff, and drummers beat djembes (arms driven by IK). They sit on the ground: there's no
  floor-sitting clip, so the seated clip's upper body is kept, the pelvis is lowered to the ground, and the legs are
  posed by IK, cross-legged (drummers, some beggars) or knees up with feet flat (`SIT_KINDS` in characters.js). Off-lane ones come from each chunk's layout and are kept even when
  `crowd.sideWalkers` thins the rest of the side crowd.
- **People:** all people obstacles use the rigged crowd and get a rig before anyone else. Walkers and riders moving
  along a lane are placed so they reach their row exactly when you do. Same-way riders are always slower than you,
  so you can catch them. About 70% of blockers are people (`director.peopleShare`). The off-lane crowd (walkers, ambient cyclists, sitters, performers) is
  thinned by `crowd.sideWalkers` (0.015) so each side strip holds about as many people as each lane. Set it to 1
  for the full phase 1 crowd. The ambient crowd,
  performers and selfie-takers stay outside the four lanes (|x| > 4.3 m). Edge scenery never collides.

## Adding a mobile mode later

Everything that depends on the platform is in `QUALITY` at the top of the script: pixel ratio, MSAA, shadow map
size, GTAO, bloom, chunk count, crowd size, env map size and `characters` (rig pool size, full-rate count, LOD radii). Add a `mobile` profile there, set `PLATFORM` from
device detection, and add touch input next to the existing `keydown` handler.

## Debug hooks

`window.__vb` in the console:

- `game` — the game object (`start()`, `kill()`, `st`, `sk`, `OBS`, `spawnObstacle(type, lane, z, opt)`,
  `setAutopilot(on)`, `botReport()`, `director`). `game.st.stageLock = n` pins a difficulty stage for testing.
- `noRender` — skip rendering, so `tick(n, dt)` simulates quickly (used for the headless autopilot tests).
- `timeScale` — slow motion (for example `0.05`) for checking animation.
- `bench(30)` — milliseconds per frame without rAF timing (it forces a GPU sync).
- `info()` — draw calls, triangles and any texture fallbacks used.
