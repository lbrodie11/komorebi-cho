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
- **Pixel scale** (`src/render/pixelscale.ts`): the canvas is an exact integer upscale of the render target in device pixels. Presets Fine/Classic/Chunky keep the render height in 220–300 px.
- **Shadows**: the sun's ortho frustum is re-fitted to the diorama every frame (`src/render/shadow.ts`), with bias derived from texel size and sun height. A 1536² map uses `BasicShadowMap` (hard taps); edge softness comes from the dither.
- **Context loss**: the loop pauses on `webglcontextlost` and rebuilds the post targets, LUT and materials on restore (~0.1–0.2 s).
- **Scene alpha is a tag**, not transparency. Ordinary opaque surfaces write 1. Water writes `WATER_MASK` (0.5): the composite mirrors what stands above it into those pixels (a short march up the screen, since an orthographic camera moves a reflected point straight down). Painted signs write `SIGN_MASK` (0.25), and the composite skips dithering there so lettering snaps flat.
- **The floor is #16141f**: the palette has no true black, and night skies stop at that violet.

## Art direction (prompt 03)
- **Weathering is causal and baked into geometry.** Builders wrap a structure in `kit.weathering({ age, moss }, …)`. Its meshes get subdivided (about 1 m cells), switch to a weathered material twin, and get per-vertex `ao`, `upFacing`, `dripMask` and `age` after the whole diorama exists (`kit.finishWeathering`, maths in `src/world/weathering.ts`). Windows, AC units and downpipes register drip sources, so streaks hang under the things that cause them. The shader (`render/materials.ts`) adds splash-back at the foot of walls, moss on north faces (where `moss` > 0), and wet darkening in rain. The attributes live in the geometry, so moving a building moves its stains.
- **Signs are pixel art, not fonts.** `src/render/glyphs.ts` holds 5×5 kana and 7×7 pictograms. Sign texts are data (`SIGNS` in `layout.ts`), painted at one texel per 0.125 m, about one render pixel at 1× zoom.
- **Foliage** sways in the vertex shader. Each blob moves as a unit, with its phase taken from its position; amplitude follows the weather's wind and is zero with reduced motion. Each blob also varies a little in tone. Autumn leaves and spring petals spawn inside the canopies that drop them (`CANOPIES` in `weather.ts`), from their own RNG stream.
- **Quiet props** (meters, downpipes, pots, crates…) are layout data. They are baked into one mesh per material with `kit.merged`, so the density pass costs few draw calls.
- **Lighting keys** in `sky.ts` name their mood (golden hour 17:30, blue hour 19:15, rainy evening, snowy morning). At blue hour the kissaten window (`materials.cafeLit`) is the warmest light in the frame. Default-view focal order: kissaten → shrine islet → chimney. How to check it is in `docs/CONTRIBUTING.md`.

## Seeded runs
`?seed=N&hour=H&season=S&weather=clear|rain&freeze=1` (`src/core/params.ts`) seeds the sim's RNG streams and warms the sim up for 3 in-world hours with a fixed timestep (`src/sim/warmup.ts`), landing exactly on `hour`. `freeze=1` then stops time, residents and animation, so every frame is identical. Scripted runs never read or write the save.

## Audio
Nothing plays until a user gesture (`Sound.enable`). Music schedules ~150 ms ahead on a 25 ms timer. Every note is a few oscillators with envelopes, all routed through lofi → saturation → compressor, plus the reverb send. Ambience is persistent noise beds (rain, wind, water, cicadas) plus scheduled one-shots (birds, insects, crows, bike bells, drips, temple bell).

## Known simplifications (see the prompt pack for upgrades)
- Grid nav instead of recast TileCache; no local avoidance between residents
- Buildings are hand-placed in `buildings.ts`, not grammar-generated
- Placeables only: buildings can't be moved yet
- Single thread (the sim is DOM-free so it can move to a Worker)
- Fonts load from Google Fonts in dev; self-host for release
