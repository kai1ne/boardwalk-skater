# Credits

## Textures — Poly Haven (CC0 1.0)

All photo textures come from [Poly Haven](https://polyhaven.com). Each asset page was checked and lists the
license as **CC0** (public domain, no attribution required; credited here anyway). Files were fetched through the
public API (`api.polyhaven.com/files/<id>`) at 2K JPG resolution, and each was checked against the API's md5. They
are shipped downscaled to 1K (JPG quality 88) to keep the download small, about 11 MB for all seven sets.
Maps used: diffuse, OpenGL normal (`nor_gl`), roughness, and AO where offered.

| Asset | Used for | Author(s) | Page | License |
|---|---|---|---|---|
| Concrete Floor 03 (`concrete_floor_03`) | Main boardwalk slabs | Rob Tuytel (processing), Matterfield (photography) | https://polyhaven.com/a/concrete_floor_03 | CC0 |
| Concrete Tiles (`concrete_tiles`) | Pale paver strips, tinted light gray in code | Dimitrios Savva | https://polyhaven.com/a/concrete_tiles | CC0 |
| Damaged Concrete Floor (`damaged_concrete_floor`) | Wear/stain blend layer on walk and pavers | Rob Tuytel | https://polyhaven.com/a/damaged_concrete_floor | CC0 |
| Painted Concrete 02 (`painted_concrete_02`) | Normal + roughness detail on benches, curbs and the flagpole base | Rob Tuytel | https://polyhaven.com/a/painted_concrete_02 | CC0 |
| Grass Ground (`grass_ground`) | Dry, patchy lawn (picked as the driest grass set; blended with dirt by a procedural mask) | Charlotte Baglioni | https://polyhaven.com/a/grass_ground | CC0 |
| Dirt Floor (`dirt_floor`) | Bare patches in the lawn | eye-candy.xyz | https://polyhaven.com/a/dirt_floor | CC0 |
| Sand 03 (`sand_03`) | Beach sand (the listed alternate; re-tinted pale) | Charlotte Baglioni | https://polyhaven.com/a/sand_03 | CC0 |

The scene loads these files from `textures/` and doesn't call the Poly Haven API at runtime. (Coast Sand 04 was
downloaded as a first choice for the beach, but it was too dark for Venice sand and has been removed.)
Thanks to Poly Haven for the API.

## Characters, animation and dogs (CC0 1.0)

Files are in `assets/characters/`. Each pack page and its bundled license file was checked first: all list
**CC0 1.0 Universal**. Only the free tiers were downloaded; the paid Pro and Source tiers were not.

| File(s) in `assets/characters/` | Source | Author | License |
|---|---|---|---|
| `Superhero_Male_FullBody.gltf/.bin`, `Superhero_Female_FullBody.gltf/.bin` (the 2 bodies in the free tier), `tex/T_Superhero_*` | Universal Base Characters [Standard], https://quaternius.itch.io/universal-base-characters (also https://quaternius.com/packs/universalbasecharacters.html) | Quaternius | CC0 (`LICENSE_UniversalBaseCharacters.txt`) |
| `hair/Hair_Buzzed`, `Hair_SimpleParted`, `Hair_Long`, `Hair_Buns`, `Hair_BuzzedFemale`, `Hair_Beard`, `Eyebrows_*` (.gltf/.bin), `tex/T_Hair_*`, `tex/T_Eye_*` | Same pack ("Rigged to Head Bone" glTF versions) | Quaternius | CC0 |
| `UAL1_Standard.glb` (43 clips, root motion disabled) | Universal Animation Library [Standard], https://quaternius.itch.io/universal-animation-library (also https://quaternius.com/packs/universalanimationlibrary.html) | Quaternius (with animator Gonzalo Furnier) | CC0 (`LICENSE_UniversalAnimationLibrary.txt`) |
| `dogs/Shiba_Inu.glb` | https://poly.pizza/m/y4wdQpg767 | Quaternius | CC0 1.0 (as listed on the page) |
| `dogs/Husky.glb` | https://poly.pizza/m/wcWiuEqwzq | Quaternius | CC0 1.0 (as listed on the page) |

Processing: the textures were downscaled from 2K PNG to 1K JPG, and the glTF image URIs were rewritten to
match. The meshes and animations are unchanged. The original zips are kept in `assets/characters/_src/` for
provenance (that folder isn't loaded at runtime and can be deleted). The UAL root-motion file (`_RM`) was used
offline only, to measure stride speeds.

**Bicycles:** I found no CC0 rigged or static bicycle. Every Poly Pizza bicycle I checked was CC-BY 3.0, so the
bikes are a procedural placeholder in `characters.js`. Clothing, the skateboard, the phone, towels, the speaker,
the tip hat and the dog leads are procedural too. The phase 2 obstacles are procedural or reuse the scene's own
props: knocked-over trash cans and cone groups reuse the scenery meshes, and the pizza box, slices, grease streak and
dog poop are built in `game.js`. The flying pigeons and seagulls, the crossing skaters' boards, and the buckets, crates, djembes, cups, cardboard
signs, cigarettes and smoke puffs are procedural too. No new asset files were added in phase 2.

## Procedural (canvas-generated, original)

Generated at runtime, with no external assets: corrugated roofing and roll-up shutter normal maps, stucco, stone
blocks, asphalt, trash-can ribs, fabric weave, palm trunk rings, palm frond atlas (fan, dead and feather fronds),
graffiti, murals (an original seagull character and an original portrait), billboards and hand-painted signs,
merchandise walls, window interiors, art-table paintings, sandwich boards, marquee bulb lettering, the cafe awning
lettering, pavement decals (slab seams, hairline cracks, oil and tire stains, gum spots, damp patches, blue-gray
swirls, a painted X and painted road text), the US flag, and an invented state-style flag. All business names, tags
and ads are invented.

## Libraries

- [three.js](https://threejs.org) r186 (0.186.1), MIT License, loaded from cdn.jsdelivr.net.
