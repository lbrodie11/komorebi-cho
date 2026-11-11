# Research notes (verified, Nov 2026)

These facts shaped the scaffold. Re-verify anything version-specific before relying on it.

## Tech
- **three.js:** jsDelivr lists 0.187.0 as `latest` (0.186.x before it). `WebGLRenderer` is still exported from `three`. `Clock` is deprecated since r183 (use `Timer`). Non-raw `ShaderMaterial` on WebGL2 still gets the `gl_FragColor`/`texture2D` compatibility defines.
- **three.js r186:** added `SunLight` and clustered-lighting work for `WebGPURenderer`. We stay on WebGL2: the low-res pixel pass doesn't need WebGPU, and WebGPU on Linux and Steam Deck class hardware is still behind flags.
- **Engine review (2026-11):** stay on three.js `WebGLRenderer`. PlayCanvas (clustered lights, lightmaps, a visual editor) and Babylon.js (SSR, GI, node materials) solve problems we don't have: placed lights already share a fixed pool of 8 real lights plus ground-pool decals, the night has a few dozen lights, not hundreds, and a hosted scene editor works against "everything is code". `WebGPURenderer` doesn't run `ShaderMaterial` or `onBeforeCompile` (our post pass, Film Diffusion, weathering, water and leaves), so moving means rewriting the whole look in TSL; if it's ever worth a look, it's a separate prototype (one shop, one lantern, the pixel pass) with a WebGL2 fallback, judged against the current renderer. `GTAOPass` is out too: it needs three's EffectComposer (we have our own passes), and at 255–540 rows it is blotchy and shifts on every rotate and zoom. Depth comes from per-vertex contact darkening and stable blob shadows instead. The look improves through art direction, not an engine.
- **Lighting units:** three.js uses physically based light units, so intensities in this repo are tuned by eye against the post pass.
- **recast-navigation-js:** its TileCache "assumes small tiles (around 32-64 squared)". It's the upgrade path if grid nav ever limits us (prompt 07).
- **Desktop wrapper:** without Steam, Tauri is preferred over Electron (much smaller installers). Its system webviews vary by OS, so test WebGL2 on WebKitGTK early.

## Market and comparables
- **Quack** (playquack.xyz): an unreleased "tiny, offline farm that lives on your desktop" with a macOS/Windows waitlist. Its site serves a static 2× nearest-neighbour upscaled PNG with a small palette, and its lo-fi piano track is described as a recording of "the game's endless lo-fi piano". Its engine is unverified.
- **Tiny Glade:** launched Sept 23, 2024. Per GameDiscoverCo it had 1,375,441 wishlists and sold 616k copies in under a month. Median playtime about 1 hour, so the payoff must land in the first hour.
- **Rusty's Retirement:** released April 26, 2024, built in Unity, Overwhelmingly Positive on Steam.

## Place
- **Yanesen (Yanaka, Nezu, Sendagi):** narrow lanes, low wooden houses, potted plants outside small homes, about 70 temples in Yanaka alone, and a "cat town" reputation.
- **Sudo-kōen** (Sendagi end of Yanaka): an ornamental pond, a vermilion bridge, a small Benzaiten shrine, and a waterfall down the hill. It inspired our park.
- **Shōtengai:** a local shopping street, often closed to cars and marked by a decorated arch at each end.
- **Building Standards Act Art. 42-2:** for older lanes under 4 m, the road boundary is deemed to be 2 m from the centreline, so rebuilt houses set back while their neighbours don't. That creates staggered frontages, which make a good procedural rule.
- **Soundscape:** the "100 Soundscapes of Japan" (1996, Environment Agency) treats everyday sound as part of place identity.

## Design commitments carried from research
- **Hook:** "Build a tiny neighbourhood, then watch its people discover what you changed."
- **Success test:** move one thing, then watch for three minutes. 4 of 5 testers should be able to describe *who* changed their routine.
- **Crowds:** cap attention slots per new object (2) and reactions per edit (3), and apply a crowd penalty.
- **Narrow alleys under 1.4 m:** managed passages with direction tokens. Local avoidance alone deadlocks there.
- **Lighting:** a few real lights plus many emissives. Glow comes from HDR emissives in the post pass, and exposure is clamped.

## The Noticing Engine (2026-11-11 review of three research reports)
Three outside reports were reviewed: "The Noticing Engine", "Causal Weave" and "Photonic-Acoustic Stigmergy". What we adopted, and why, is in prompt 09b and the prompts listed in `00-README.md`.

**Sources behind 09b:**
- **William H. Whyte**, *The Social Life of Small Urban Spaces* (1980), from the Street Life Project: people go where people are, where there's sun, water, trees and food, and where there's a *triangulator*, an external stimulus that gets strangers talking. We found no shipped game using triangulation as a bond trigger.
- **Jan Gehl:** necessary, optional and social activity. These map onto our schedule (necessary), utility (optional, raised by the player's edits) and bonds (resultant social).
- **Stanley Milgram**, "The Familiar Stranger" (1972), and **Paulos & Goodman**, CHI '04 (DOI 10.1145/985692.985721): people we see repeatedly but never speak to. Their Jabberwocky device counted co-presence without interaction, the closest computational analogue to our ladder. Relationship sims usually model interaction-driven meters instead.
- **Story sifting** already exists: Felt (ICIDS 2019), Winnow (AIIDE 2021), Ryan's Sheldon, and composable sifting patterns (FDG '25). Viv records causal links as actions happen. None of them *tests* causation counterfactually; the closest is outside games (Halpern–Pearl causal models in explainable RL, Gerstenberg's counterfactual simulation model). Our decision-point but-for test is a pragmatic simplification: "made possible" versus "helped" covers overdetermination, not every Halpern–Pearl edge case.
- **Why not rollouts:** agent sims with pathfinding reservations are chaotic. One changed choice reshuffles reservations and A* ties, and the futures diverge. Common random numbers only help while branches stay aligned. So paired full-future rollouts are a QA metric at most (09b task 7).
- **Desire paths:** Helbing, Keltsch & Molnár, "Modelling the evolution of human trail systems", *Nature* 388, 47–50 (1997). The CHI '25 "Pathways of Desire" study (Lankes, Wallner & Kocur) is about *players'* footprints in a 2D game (they followed earlier players' paths 9.73% of the time), not NPC trails. Don't cite it for ours.
- **Prospect-refuge** (Appleton) and **isovists** (Benedikt) are established in architecture. We use them as a seat-choice term: modestly novel, not a breakthrough.

**Market and awards (checked 2026-11-11):**
- **Tiny Glade:** over 1M wishlists by June 16, 2024; 1,375,441 at launch and 616k sold in under a month (GameDiscoverCo); median playtime about 1 h 4 min.
- **Minami Lane:** over 30k wishlists after its Feb 2024 Next Fest demo, about 48k near launch (developer interview). Doot posted 10k copies on day one, then 28k in week 1, 50k in month 1 and 75k by month 3. Any exact conversion rate is an estimate.
- **Unpacking:** two BAFTAs in 2022 (Narrative, and EE Game of the Year). Its audio is "over 14,000 foley wav files". Jeff van Dyck is composer and audio director; Angela van Dyck worked on the sounds.
- **Typical playtimes in the genre** (HowLongToBeat, secondhand): Townscaper about 1 h; Minami Lane, Islanders and Unpacking 3–4 h; Dorfromantik about 5 h. Reviews of Tiny Glade and Townscaper complain that there's nothing to do after an hour, or that the world feels lifeless without people. Our residents answer the second complaint; consequence that compounds over days answers the first.
- **IGF 2026:** Titanium Court took the Grand Prize and Excellence in Design. 2027 entries ran Aug 10 to Sept 13, 2026, with a $75 fee ($25 for students); the ceremony is March 3, 2027.
- **BAFTA 2026:** Debut Game went to Clair Obscur: Expedition 33, Game Design to Blue Prince, and Game Beyond Entertainment to Despelote.
- **Coziness:** "safety, abundance, softness" is Project Horseshoe's 2017 report (Short, Cook, Howe et al.).

**Browser facts:**
- **GitHub Pages can't set custom headers,** so no COOP/COEP and no `SharedArrayBuffer` without the coi-serviceworker shim, which forces a reload on first visit. Use Workers with transferable `ArrayBuffer`s.
- **`CompressionStream`** (including `deflate-raw`) is Baseline 2023: Chrome and Edge 103, Firefox 113, Safari 16.4.
- **`OffscreenCanvas`** arrived in Safari 16.4, but the WebGL context in workers only came in 17.0. Feature-detect inside the worker.

**Considered and set aside:**
- **2D Radiance Cascades GI.** It's flatland light transport, so it can't represent occlusion under eaves and canopies, which is our lighting. Most implementations want compute shaders, and the palette and dither would hide its gains.
- **A narrative director steering residents.** It risks feeling scripted; triangulators make moments without steering anyone.
- **LLM dialogue.** It costs determinism, privacy and tone, and doesn't fix what's missing (consequence).
- **An economy, streaks or daily rewards.** They contradict the no-pressure design.
- **A full structure-of-arrays rewrite.** A snapshot/restore (prompt 12) gives what it would, at 14 residents.
- **Pentatonic scale-of-the-hour music.** The score is authored; the chimes are untuned bells, not melody.

**Treat with care:** the third report said the repository was inaccessible and built on guesses (Japanese web fonts, a 128×128 grid, a 2D top-down game). Its specific numbers (704 KB fields, pathfinding timings, a 27% conversion rate, a six-month development time) weren't verified. Only the ideas above were taken from it.

## Pixel-readability review (2026-11-11), checked against the code
Two outside reports on pixel text, pixel-perfect rendering and code-made birds. Both said they couldn't see the repository, so each claim was checked against the code.

**Already true:**
- **Whole-number upscaling** of a low-resolution render target in the palette looks: `pixelscale.ts`, with a render height of 220–300 rows. Smooth is a deliberate full-color look at 540 rows.
- **Exact pixel sizing:** `renderer.setPixelRatio(1)`, with the canvas sized from `devicePixelContentBoxSize`.
- **No jitter:** the camera snaps to whole texels every frame and the leftover sub-pixel is presented through a one-pixel overscan (`camera.ts`). That is the WebGL version of the reports' "+2 px overscan, fractional blit".
- **Nearest filtering where it matters:** sprites and painted signs magnify with `NearestFilter`.
- **A stable post pass:** the palette and dither are world-anchored and stable.
- **Accessibility:** reduced motion exists, and the HUD is DOM text (screen-reader friendly), with Text size.

**Fixed after the review:**
- **Birds** were single boxes that stretched and spun. They now have a rig and held wing frames on twos, pigeons peck instead of spinning, and a sparrow flock hops and startles together. More species are in prompt 09c.
- **Lettering:** a Plain choice (the system sans), as Dead Cells offers, for readers who find the pixel font hard.
- **Text size:** a Largest step at 2× (WCAG resize text), with Settings rows that wrap instead of overlapping.
- **Phones** zoom out to 0.5× (0.65× before), so the first view on a portrait phone shows the whole diorama.

**Not applicable, or set aside:**
- **Canvas 2D advice** (`fillText` blur, `imageSmoothingEnabled`, a 320×180 Canvas buffer, Bresenham clean-up): we render in WebGL, and the HUD is DOM text, not text drawn into the low-resolution buffer.
- **"NearestFilter on every texture":** tiling surface textures keep mipmapped minification on purpose. Nearest minification sparkles as the camera moves, which is worse than the slight softening the palette snap removes anyway.
- **Japanese bitmap fonts** (Misaki, PixelMplus, k8x12, DotGothic16): the game shows no Japanese script.
- **Radiance Cascades and pentatonic scales:** set aside earlier (see "The Noticing Engine").

**Taken into later prompts:**
- a fixed simulation step with interpolation (12);
- a DPR matrix, contrast sampled over the canvas, texture-filter and shimmer checks (15);
- a readability audit (18).

## Light and sky review (2026-11-11), checked against the code
Two outside reports on the times of day, clouds, water and atmosphere. Neither could see the repository; one worked from four screenshots.

**True, and fixed:**
- **Dawn and sunset were twins.** The 05:36 and 18:24 sky keys shared their horizon, sun and fill colors. Dawn is now cool and pale.
- **Stars showed below the plinth.** They now fade out under the horizon line.
- **Windows and signs changed shape while zooming in Smooth** (the owner's own screenshots). The scene was sampled once per pixel and signs used nearest filtering at about one texel per pixel. Smooth now multisamples 4× and uses enlarged, mipmapped sign textures.

**True, taken into prompt 10b:**
- Flat midday contrast.
- The bright void under the plinth by day, and the plinth melting into the night sky.
- Smudgy clouds and a smooth moon beside pixel art.
- Night lights without a clear hierarchy or bedtimes.
- No bathhouse steam.

**False or already handled:**
- **"Shadows don't reverse between dawn and dusk":** the sun does cross (`sunDirection`).
- **"Trees cast solid blobs":** canopies already cast dappled shadows; what's missing is contrast.
- **"Fireflies at uniform brightness":** they pulse.
- **"No sound", "the water is static", "no camera movement", "check NearestFilter and setPixelRatio":** all present. See the pixel-readability review above.
- **"Round the camera position to integers":** the camera snaps to render texels and presents the sub-pixel remainder, which is the correct version of that advice.

**Rejected:** see "Not doing" in prompt 10b.

**Places and practices** (not re-verified here; check before quoting publicly):
- Tokyo neighborhood bathhouses typically open mid-afternoon to late evening.
- Sprinkling water on the street (uchimizu) is a long-standing summer habit.
- The sunset view from Yanaka's "Sunset Steps".
- Perez, Alexander & Bailey (2013, *BMC Psychiatry*): a meta-analysis that found no consistent effect of air ions on mood or relaxation.

