# Research notes (verified, Nov 2026)

These facts shaped the scaffold. Re-verify anything version-specific before relying on it.

## Tech
- **three.js:** jsDelivr lists 0.187.0 as `latest` (0.186.x before it). `WebGLRenderer` is still exported from `three`. `Clock` is deprecated since r183 (use `Timer`). Non-raw `ShaderMaterial` on WebGL2 still gets the `gl_FragColor`/`texture2D` compatibility defines.
- **three.js r186:** added `SunLight` and clustered-lighting work for `WebGPURenderer`. We stay on WebGL2: the low-res pixel pass doesn't need WebGPU, and WebGPU on Linux and Steam Deck class hardware is still behind flags.
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
