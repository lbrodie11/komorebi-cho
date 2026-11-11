# Architecture

## Frame
```
clock.tick(dt) ─► skyAt(hour, rain, season) ─► world.update()        lights, windows, shutters, sway, season, weather
                                             ─► residents.update()    plan → path → walk → act
                                             ─► animals.update()
                                             ─► post.set(sky params)
               every 1 s: noticePass, sound.update, HUD clock, story triggers, bells
               every 10 s: save
render: iso.update (texel snap) ─► post.render: scene → sceneRT (low res, half-float, linear)
                                               → glowRT (half res: bright-neighbour gather)
                                               → composite → canvas (exact integer upscale, pixelated)
```

## Data first
`src/world/layout.ts` is the single source of truth for where things are: regions (walkable surfaces by kind), doors, exits, trees, benches, poles, pond polygon, bridge, islet, steps, obstacles, sign texts, and the quiet props. Builders, nav grid, smart objects and the build tool all read it.

## Navigation
`NavGrid`: 0.5 m cells, static walkability from `terrain.isWalkableSurface`, heights from `terrain.groundHeight`. Neighbouring cells connect only if their height difference is ≤ 0.45 m, so the 1.4 m terrace wall is impassable and the steps are the only way up. Obstacles are reference-counted stamps, so overlapping placements never unblock each other. A* uses an octile heuristic with no corner cutting, followed by line-of-sight smoothing. `version` bumps on every stamp, and agents re-check their remaining path when it changes.

## Residents
Layers: **schedule** (sleep / commute / work windows) → **needs** (fatigue, thirst) → **utility** over smart-object adverts and wander/jog/deliver → **reservation** (slots) → **path** → **action** (pose + dwell in game minutes).

Anti-oscillation:
- tasks commit until their dwell ends
- decisions happen only between tasks
- interruptions go through `endTask()`, which releases the reservation, adds a stand-up delay and shows a bubble

Edits: `BuildTool.place` stamps the grid, registers the smart object and calls `Residents.onPlaced`. That picks nearby curious agents, at most 2 inspectors per object and 3 reactions per edit, and sends them to look. `noticePass` lets passers-by discover things later. Only agents who know an object will use it.

## Pixel pass (src/render/post.ts)
Every final pixel goes through the same ordered steps. Order matters: dither before snapping, glow before tonemap clipping. Palette uniforms are raw sRGB vectors (not `THREE.Color`, which would linearise them). `docs/COLOR.md` traces the colour space at every stage.

- **Glow** is gathered in its own pass at half resolution and upsampled with nearest filtering. The composite caps it hue-preservingly, so piles of lanterns stay warm instead of clipping to white. Clustered player lights also share brightness (`src/world/crowd.ts`).
- **Palette snap** reads a 40³ candidate LUT (`src/render/lut.ts`); `?lutOff` uses the reference loop.
- **Camera steps** (rotate, zoom) are instant. The composite Bayer-dissolves from a snapshot of the previous view for 250 ms, so no frame ever shows geometry sliding across the pixel grid.
- **Pixel scale** (`src/render/pixelscale.ts`): for the palette presets Fine/Classic/Chunky, the canvas is an exact integer upscale of the render target in device pixels, with the render height kept in 220–300 px.
- **Smooth** is the default look for new players (saves keep the look they had). It renders a fixed 540 rows (`SMOOTH_H`, about twice Classic), enlarges by a fractional, filtered scale, and skips the palette snap and dither for full-colour shading (the `snap` uniform).
  - The row count is fixed so its cost is the same on every screen. Following the integer rule on a 720-px screen meant rendering all 1280×720 pixels, and frames reached about 21 ms.
  - Stars sit on a grid at most 300 cells tall, so they look the same at any render height.
- **Shadows**: the sun's ortho frustum is re-fitted to the diorama every frame (`src/render/shadow.ts`), with bias derived from texel size and sun height. A 1536² map uses `BasicShadowMap` (hard taps); edge softness comes from the dither.
- **Context loss**: the loop pauses on `webglcontextlost` and rebuilds the post targets, LUT and materials on restore (~0.1–0.2 s).
- **Scene alpha is a tag**, not transparency. Ordinary opaque surfaces write 1. Water writes `WATER_MASK` (0.5): the composite mirrors what stands above it into those pixels (a short march up the screen, since an orthographic camera moves a reflected point straight down). Painted signs write `SIGN_MASK` (0.25), and the composite skips dithering there so lettering snaps flat.
- **The floor is #16141f**: the palette has no true black, and night skies stop at that violet.
- **The sky is never dithered.** Sky pixels (`d >= .99999`) skip the palette snap and keep the smooth gradient, clouds, stars and moon, plus ±½/255 of noise against banding. Only the diorama is pixel art; a two-colour checkerboard behind its silhouettes competed with them.
- **The dither is light, only in halos, and pinned to the world.** It applies only where a light's halo falls off (`DITHER_SPREAD`, 0.03, scaled by the halo). There it flips pixels within about 1.5% of the boundary between two shades, so a halo fades through thin seams instead of hard rings. Everywhere else the palette shades in flat clusters. At the old 0.1 everywhere, walls, roofs and lawns were checkered, which hid small details at 1× zoom. The Bayer pattern is offset by the camera's whole-pixel offset (mod 4), and the pixel pass's small halo gathers its 2×2 blocks at the same offset (mod 2). Both travel with the scene when the camera pans. Pinned to the screen, 44% of pixels changed on every one-pixel camera step; now 0.2% do, all of them real scene changes at the frame edges.

## Art direction (prompt 03)
- **Weathering is causal and baked into geometry.** Builders wrap a structure in `kit.weathering({ age, moss }, …)`. Its meshes get subdivided (about 1 m cells), switch to a weathered material twin, and get per-vertex `ao`, `upFacing`, `dripMask` and `age` after the whole diorama exists (`kit.finishWeathering`, maths in `src/world/weathering.ts`). Windows, AC units and downpipes register drip sources, so streaks hang under the things that cause them. The shader (`render/materials.ts`) adds splash-back at the foot of walls, moss on north faces (where `moss` > 0), and wet darkening in rain. The attributes live in the geometry, so moving a building moves its stains.
- **Signs are pixel art, not fonts.** `src/render/glyphs.ts` holds 5×5 kana and 7×7 pictograms. Sign texts are data (`SIGNS` in `layout.ts`), painted at one texel per 0.125 m, about one render pixel at 1× zoom.
- **Foliage** sways in the vertex shader. Each blob moves as a unit, with its phase taken from its position; amplitude follows the weather's wind and is zero with reduced motion. Each blob also varies a little in tone. Autumn leaves and spring petals spawn inside the canopies that drop them (`CANOPIES` in `weather.ts`), from their own RNG stream.
- **Quiet props** (meters, downpipes, pots, crates…) are layout data. They are baked into one mesh per material with `kit.merged`, so the density pass costs few draw calls.
- **Lighting keys** in `sky.ts` name their mood (golden hour 17:30, blue hour 19:15, rainy evening, snowy morning). At blue hour the kissaten window (`materials.cafeLit`) is the warmest light in the frame. Default-view focal order: kissaten → shrine islet → chimney. How to check it is in `docs/CONTRIBUTING.md`.

## Visual detail
The target sits between Stardew Valley and Eastward: rich in objects, quiet in surface noise. Silhouettes read at a distance, structure (windows, rows, joints) at medium zoom, and texture up close.
- **Textures are clusters, not per-texel noise** (`buildTextures`). Each keeps its structure (courses, tile rows, planks, slab joints) and adds only low-contrast, spatially coherent variation: value noise on a 4–16-texel lattice, one tint per slab or stone, quantised to a few steps. Independent random texels (gravel ±90, grass ±50) turned into grain once shrunk.
- **Textures are mipmapped and anisotropic** when minified: a 2.7 m road tile has 8 cm texels, smaller than a render pixel at 1×. They are nearest when magnified, so close-ups stay crisp. That gives level of detail for free: rows and joints resolve at 2–3× zoom and settle into flat tone at 1×. Patterns that are the point (awning stripes, signs) stay nearest at every distance.
- **Weathering streaks are gentle.** Without a dither to blend them, a stain that crosses a palette boundary snaps into a hard patch, so the contact shadow and splash-back carry most of the age.
- Busyness (isolated pixels at game resolution, default view, noon): Classic 3.1% → 1.5%, Smooth 0.20% → 0.12%.

## Night lighting (src/world/lighting.ts, lightpools.ts)
Every important light is built in five layers, each with its own job:
1. **Ambient:** the sun/hemisphere rig keeps unlit surfaces readable.
2. **Emissive core:** the glass or lamp head.
3. **Local fill:** a few real point lights.
4. **Ground pool or spill:** where the light lands.
5. **Optical halo:** the glow, Film Diffusion.

Brightness follows a hierarchy (`EMISSIVE`): kissaten 3.2, streetlamps 2.7, shops 2.0, lanterns 2.0, homes 1.5. The warm/cool separation carries the night; exposure is never raised to compensate.
- **Windows fade, vary and follow their building.**
  - Levels come from the clock alone (`windowLevel`), so a paused or jumped clock agrees with a running one. Each window fades over 18 in-world minutes.
  - About one home window in five stays dark on any night (a different set each day), and each home has its own lamp warmth.
  - Shop windows follow their own shop's hours (the shutter's), so a closed shop goes dark.
  - Glass brightness comes in 8 shared material steps per kind, so every window fades on its own schedule without a material per window.
- **Pools are authored decals, not shadowed lights** (`LightPools`). Streetlamps and vending machines get round pools. Ground-floor shop and kissaten windows get a spill that opens outward from the glass (`windowSpill`), so it can't leak through the building.
  - Upper-floor windows get none.
  - Spills stop at the plinth edge; a window facing straight off it gets none.
  - Pools add light on colour only (destination alpha untouched, so the water and sign tags survive). They are depth-tested and never write depth, so walls and residents in front hide them.
  - They follow the lamp level or their window's level, cast no shadows, and cost one small draw each. In the palette looks they fall off in banded rings, like hand-drawn pixel-art lamplight.
- Reference scene for lighting changes: the kissaten at 19:15 in light rain (`?hour=19.25&weather=rain`, zoomed to the café).

## Film Diffusion (src/render/diffusion.ts, diffusion-pass.ts)
A restrained lens-diffusion setting, 0–20% (Settings → Film Diffusion; new players start at 5%). Glow gathers around real light sources, and dithered surfaces read as tone. Geometry edges, outlines, window frames, foliage clusters, residents and the DOM HUD stay as crisp as at 0%.

**At exactly 0% nothing new runs.** The pixel pass draws the canvas at internal resolution, and CSS enlarges it with `image-rendering: pixelated`; no diffusion target is even allocated. Above 0% the canvas switches to device resolution. That switch changes the canvas size, so it happens in `resize()`, never per frame.

| Target | Size | Format | Contents and encoding |
|---|---|---|---|
| scene (existing) | internal | HalfFloat + depth texture, Nearest | linear HDR before exposure; alpha tags water and signs |
| glow (existing) | internal / 2 | HalfFloat, Nearest | the pixel pass's own small halo (faded as diffusion rises) |
| prev ×2 (existing) | internal | RGBA8, Nearest | camera-step dissolve snapshots |
| pix | internal | RGBA8, Nearest | pixel-pass output as sRGB values; alpha = dither flag |
| resolved | internal | RGBA8, Linear | pix after dither blending, sRGB values |
| glow pyramid, 5 down + 4 up | 1/2 … 1/32 of the padded grid (internal + 32, rounded up to 32) | HalfFloat, Linear (UnsignedByte if half floats aren't renderable) | linear light |
| canvas | min(DPR, 2) × CSS box, capped at 2560×1440 pixels (`MAX_OUTPUT_PIXELS`) | default | sRGB |

None of the new targets has a depth buffer or mipmaps. All are reallocated on resize, disposed when the setting returns to 0%, and rebuilt after a lost context. Nothing converts colour automatically: `renderer.toneMapping` is never set (NoToneMapping), and none of the post `ShaderMaterial`s includes `colorspace_fragment`. Tone mapping happens once, in the pixel pass.

Passes above 0%:
1. **Pixel pass → pix.** Unchanged, except:
   - it writes a flag (alpha 1 where the dithered palette pick differs from the undithered one);

   The dither itself stays at full strength: it carries the in-between colours the palette lacks.
2. **Dither blend → resolved.** A 3×3 tent in sRGB over neighbours that are also flagged and lie on the same surface (`|Δdepth| < 0.00075`, about 0.3 m: the camera is orthographic, near 1, far 400, so depth is linear). The result mixes in by `resolve`. Unflagged pixels (outlines, windows, silhouettes, flat colour) pass through untouched.
3. **Glow pyramid.**
   - The first downsample gathers an exact 2×2 box from the exposed HDR scene through a soft-knee bright pass (T = 1.6, K = 0.4, clamped at 8).
   - Measured: sunlit cream reaches about 1.16 at noon; lights at night run 2–24. So noon glow covers 0.02% of the frame, night about 20%.
   - Four bilinear downsamples and four tent upsamples follow (`mix(level, tent(lower), 0.7)`).
   - **The pyramid is anchored to the world.** Its grid is offset by the camera's whole-pixel offset mod 32, so a halo slides with its lantern when the camera pans. Without the anchor, glow energy pulsed ±5% with a 4-pixel period.
4. **Composite → canvas** (2 texture reads).
   - A sharp-bilinear enlargement of `resolved`: each game pixel is a flat block, with an `edge`-wide filtered step between blocks.
   - Glow added in linear light as `base + room·(1 − e^(−add/room))`: it never passes 1 and never darkens.
   - Back to sRGB, plus ±½/255 noise against banding.
   - The pixel pass's old halo fades by up to 60% so the two don't stack.

`diffusionParams(s, scale)` maps the slider to `glowAmt`, `resolve` and `edge`. All are 0 at 0%, continuous and non-decreasing (no step of 0.001 changes any of them by more than 0.01), with a gentle start (t^1.4). The threshold, knee and blur width don't follow the slider. Photos (`P`, then Capture) render 1080 px tall with the window's aspect and the current setting, whatever the display's DPR.

## Seeded runs
`?seed=N&hour=H&season=S&weather=clear|rain&freeze=1` (`src/core/params.ts`, plus `&diffusion=P` for Film Diffusion in percent) seeds the sim's RNG streams and warms the sim up for 3 in-world hours with a fixed timestep (`src/sim/warmup.ts`), landing exactly on `hour`. `freeze=1` then stops time, residents and animation, so every frame is identical. Scripted runs never read or write the save. At runtime, `__komorebi.freeze({ hour, season, weather, time, target, zoom, yaw })` pins the camera and shader time too, and `__komorebi.setDiffusion(s)` sets Film Diffusion; `scripts/diffusion-shots.mjs` uses both.

## Audio
Nothing plays until a user gesture (`Sound.enable`). Music schedules ~150 ms ahead on a 25 ms timer. Every note is a few oscillators with envelopes, all routed through lofi → saturation → compressor, plus the reverb send. Ambience is persistent noise beds (rain, wind, water, cicadas) plus scheduled one-shots (birds, insects, crows, bike bells, drips, temple bell).

## Known simplifications (see the prompt pack for upgrades)
- Grid nav instead of recast TileCache; no local avoidance between residents
- Buildings are hand-placed in `buildings.ts`, not grammar-generated
- Placeables only: buildings can't be moved yet
- Single thread (the sim is DOM-free so it can move to a Worker)
- Fonts load from Google Fonts in dev; self-host for release
