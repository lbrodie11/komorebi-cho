# Navigation (prompt 07)

How residents get around: what we measured, what we decided, and why.

## The numbers

`NAV_PROFILE=1 npx vitest run tests/nav-profile.test.ts` builds the town headless with **40 residents and 40 placed objects** (the prompt's stress case; the town has 14 residents). It times A* between 200 random pairs of open points, then three game hours of the simulation tick at 20 Hz. On an M-series MacBook (Node 24, a loaded machine):

| | median | p95 | p99 | max |
|---|---|---|---|---|
| A* across the town | 0.05 ms | 0.4–0.6 ms | | 2–3.5 ms |
| Sim tick, 40 residents | 0.05 ms (mean) | 0.14–0.2 ms | 0.3–0.6 ms | about 6 ms (warm-up) |

The grid is 66 × 50 cells at 0.5 m (3,300 cells, about 1,450 walkable). Before this prompt, a path to an unreachable goal searched the whole town (up to 5 ms), and 40 residents re-planning at once could cost 3–4 ms in one tick.

## Decisions

**Keep the grid.** The prompt's rule: under 1 ms per tick, keep it. It runs 20× under that. `recast-navigation` with a TileCache would add a WASM dependency and an obstacle model we don't need for a 33 × 25 m town. Two additions instead:

- **Regions.** `NavGrid` labels connected regions after each change (a flood fill over 3,300 cells, lazily, once per edit). A path between two regions is refused at once, which bounds the worst case. The region most doors and exits open onto is the town; any other region is an **island** that edits sealed off.
- **A path budget.** At most `PATHS_PER_TICK` (6) searches a tick; the rest wait 50 ms. A crowd re-planning together never lands in one frame.

Path caching isn't worth it: paths are short and re-checked only when the grid changes.

**The Worker is deferred, deliberately.** At 0.05 ms a tick (0.3% of a 60 fps frame) moving the simulation off the main thread saves nothing you could measure, and it isn't a small move: `Agent` owns its three.js meshes, so the sim and its view would have to be split, with snapshots and interpolation across the boundary. That split is worth doing when the tick costs something (a much bigger town, hundreds of residents) or when prompt 12's performance pass finds the main thread tight. The sim is already DOM-free, so the boundary is clear when it comes.

## What residents do now

- **Recovery from islands.** Anyone visible on an island (or sitting on a seat inside one) steps over the nearest obstruction back into the town, at walking pace and after a puzzled moment; they never jump. Goals are never picked on islands. In build mode, island ground shows a dotted hint (`BuildTool.showIslands`), so the player can see what an edit sealed off.
- **Local avoidance.** A walker sidesteps anyone within 1.2 m ahead, walking or standing, and eases off when someone is right in front; head-on, both keep left, so they pass. Sidesteps only go onto open ground.
- **Narrow passages** (`src/sim/passage.ts`, `PASSAGES` in layout.ts: the 1.1 m bridge). A direction token: an empty passage goes to the first to ask, the same way follows, the other way waits at the end, facing it. Once someone has waited 6 s, nobody new is let in, the passage drains and the token flips. People watching the koi from the bridge aren't traffic. Avoidance stays on inside: it only moves people onto open ground, so it can't jitter against the railing, and it covers someone stepping off the viewing spot into oncoming traffic.
- **Crowding.** Every smart object has a hard capacity (its slots) and a soft one (`soft`, how many it suits in comfort: one at a shop counter). Desirability is multiplied by `1 / (1 + density × crowdAversion)`, where density is everyone within 2 m (users and passers-by) over the soft capacity; `crowdAversion` is per persona (the kids hardly mind, the bookseller minds a lot). Shops have three queue places out into the lane: when both counters are busy, waiting in line is an option, the queue moves up, the first in line steps up to a free counter, and after 12 game minutes they give up.

## Tests

- `tests/nav.test.ts`: islands and regions, the town region by anchors, recovery at walking pace, the path budget, head-on walkers passing.
- `tests/passage.test.ts`: the token, draining, and two people crossing the bridge from opposite ends (never head-on, both get across).
- `tests/crowd-queue.test.ts`: crowd aversion, and a queue that moves up and steps up.
- `tests/fuzz.test.ts`: 500 edits at 2 a second, and ten fast-forwarded (6×) minutes of an edit every 2 s. Zero exceptions, zero visible teleports, nobody stuck for 5 s, nobody waiting at the bridge for 20 s, nobody standing inside anything, and an exact undo and redo.

## Not done yet

- Off-mesh links (doors, stairs, cats jumping between ledges with their own profile). Doors and stairs already work as ordinary grid cells; cats still walk the grid.
- The Worker (see above).
