# Colour pipeline

The palette is the art direction (`src/render/palette.ts`). In the pixel-art presets (Fine, Classic, Chunky) every diorama pixel is one of its entries. The sky backdrop is a smooth gradient (never snapped), and the Smooth preset shades the whole diorama in full colour. Above 0% Film Diffusion, the diffusion passes deliberately add in-between tones: blended dither and glow. They work from palette-snapped pixels, never instead of them. Getting there safely means knowing which colour space each number is in. This page traces a pixel from material to screen.

## Stages

| Stage | Where | Space | Range |
|---|---|---|---|
| Material/light colours | `new THREE.Color('#hex')`, `color.set('#hex')` | sRGB hex in, **linear** inside three | 0–1 |
| Albedo textures | `CanvasTexture` with `colorSpace = SRGBColorSpace`, mipmapped when minified | sRGB bytes, decoded to **linear** on sample | 0–1 |
| Light pools | additive decals, colour only (alpha untouched) | **linear** light added to the scene | 0–~0.6 |
| Vertex colours (fireflies) | `BufferAttribute('color')` | **linear** HDR emission, authored as such | 0–~5 |
| Scene render | `PostPass.sceneRT` (half-float, `NoColorSpace`) | **linear** light, HDR; alpha is a surface tag (1 opaque, 0.5 water, 0.25 sign) | 0–∞ |
| Glow gather | `PostPass.glowRT` (half-float, half res) | **linear** HDR excess | 0–∞ |
| Composite: scene | `toSRGB(tonemap(lin × exposure))` | **sRGB**, then hue-shifted shading | 0–1 |
| Composite: sky, mist, moon | uniforms from `hexToSrgb` | **sRGB** (raw) | 0–1 |
| Composite: glow | hue-preserving cap, then `toSRGB(…) × 0.55`, added | **sRGB** | 0–0.55 |
| Dither | `+ (Bayer4 − 0.5) × 0.03 × halo`, only inside light halos, Bayer pinned to the world | **sRGB**, may leave [0,1] | about −0.015 to 2.4 |
| Palette snap | candidate LUT or `?lutOff` loop; the sky skips it (smooth gradient, ±½/255 noise) | **sRGB** palette entry | exactly palette (diorama) |
| Canvas (0% Film Diffusion) | `ShaderMaterial` with no `colorspace_fragment` | values written as-is: **sRGB** | — |
| Film Diffusion: pix → resolved | RGBA8 targets; dither blend in sRGB | **sRGB** (blended dither leaves the palette on purpose) | 0–1 |
| Film Diffusion: glow pyramid | HalfFloat targets from the exposed scene | **linear** HDR | 0–8 |
| Film Diffusion: canvas | resolved → linear, + glow (soft-clipped below 1), → sRGB, ±½/255 noise | **sRGB** | 0–1 |

Two rules hold this together:

1. **Linear until the tonemap, sRGB after.** Lighting maths happens in linear. Everything artists pick by eye (sky keys, mist, palette) is compared and mixed in sRGB, because that's the space the palette was authored in.
2. **The composite writes sRGB bytes straight to the canvas.** The final `ShaderMaterial` doesn't include three's `colorspace_fragment` or `tonemapping_fragment`. `renderer.outputColorSpace` (sRGB) and `toneMapping` (none) therefore never touch it. A palette value of `#3f3a58` lands on screen as exactly `#3f3a58`.

## Why the palette isn't `THREE.Color`

`THREE.Color('#3f3a58')` stores the colour **linearised** (about `0.050, 0.042, 0.098`), because three's colour management assumes hex means sRGB and works in linear. The palette snap compares against colours *after* the composite has converted to sRGB. Passing `THREE.Color` uniforms would compare sRGB pixels against linear palette entries and snap everything toward the dark end.

The palette and the sky, mist and moon colours are therefore passed as raw `Vector3`s from `hexToSrgb()` (`src/core/math.ts`), which only divides by 255. The same applies to anything else the post shader compares or mixes in sRGB.

## Textures

Every `CanvasTexture` used as albedo sets `colorSpace = THREE.SRGBColorSpace`, so the GPU decodes it to linear before lighting:

- `src/render/materials.ts`: `makeTexture()` (all procedural detail maps; `tex2()` clones keep the setting)
- `src/sim/bubbles.ts`: thought-bubble sprites
- `Materials.sign()` (`src/render/materials.ts`): signs painted from the glyph atlas; lit signs reuse the same texture as their emissive map

The palette LUT (`Data3DTexture`) holds palette **indices**, not colours. It is `NoColorSpace`, `NearestFilter`, and read with `texelFetch`, so it's never converted or filtered.

The render targets are `NoColorSpace`. three writes linear into them and the composite reads linear back.

**Adding a texture?** If it carries colour, set `SRGBColorSpace`. If it carries data (masks, indices, noise), leave it `NoColorSpace`.

## The palette LUT

The snap used to loop over every palette entry (47) per pixel. It now reads a 40³ candidate table (`src/render/lut.ts`, 256 KB, baked once at startup).

- **Why candidates.** A plain nearest-colour LUT is wrong wherever a cell straddles the boundary between two palette colours. Ordered dithering deliberately puts pixels on those boundaries. A plain 64³ table disagreed with the loop on about 5% of frame pixels. Each cell now stores up to 4 palette indices: every colour that wins at any of its 8 corners or its centre. The shader picks the nearest of those to the *exact* colour with the same weighted distance (`0.3, 0.59, 0.11`).
- **Why the axis goes past 1.0.** Dither pushes near-black below 0, and glow and stars push lit pixels above 1. Cells clamped at the cube face would miss the true winner for those. Each axis has 32 cells over [−1/16, 1] and 8 coarse cells over [1, 2.5].
- **Result.** LUT vs `?lutOff` differs on 0.00–0.02% of render pixels across the five reference shots (target: under 0.5%). The bake itself is unit-tested against the exact search (`tests/lut.test.ts`).

## No true black

The palette's darkest entry is `#16141f`, a deep violet. The old `#0b0a12` was cut in prompt 03: at night it filled about 20% of the frame (sky dither, plinth, shadows) and read as pure black. Night sky keys stop at `#16141f` too. The brightest entries (`#fff1c4`, `#f6efe0`, `#eef2f5`) are warm or cool off-whites, so pure white can't occur either. In practice they appear only in glow cores, stars, lit windows and snow.

## Checking it

- `?lutOff` swaps the LUT for the reference loop; diff the two with the seeded screenshot URL (`docs/CONTRIBUTING.md`).
- To audit textures, search for `CanvasTexture`/`DataTexture` and confirm each sets a colour space on purpose.

## Colour direction (2026-11-11)
The palette is the identity: violet shadows instead of black, walnut and earth materials, amber light, a few seasonal accents. What changed is how it's used.
- **Colour script.** Each sky key in `src/render/sky.ts` says what its hour should make the player feel (dawn: the town waking; 17:30: nostalgia; 19:15: quiet wonder, the benchmark), beside the numbers that do it.
- **Night silhouettes.** `#2e2a42` roofs on a `#1f2c45` night sky are 1.01:1 by luminance, and the outline pass used to darken edges into the sky. Where an edge meets a dark sky it now gets a faint cool moonlit rim instead; by day the dark outline stays. One rule in the shared post pass covers all four looks.
- **Accent budget.** `ACCENT_BUDGET` in `lighting.ts` scales only the accent lights (paper lanterns, glowing signs, the red light boxes) per season: autumn 0.85 and spring 0.92, so the trees and blossoms lead. Windows, streetlamps and the café are never scaled.
- **UI on the sky.** The subtitle sits straight on the sky (muted grey on day blue is 2.3:1); a 1 px ink outline keeps it legible on every sky. Photos never include the HUD.
- **Smooth and the palette looks** share the same tonemap, hue shift, outlines and glow; Smooth skips only the dither and the snap. They should match in mood and hierarchy, not RGB: prompt 10 task 8 makes that a greyscale ranking check.
