# Komorebi-chō — Production Prompt Pack

These prompts take the scaffold in `komorebi-cho/` to a polished, free, web release. Each file is one self-contained work order for **Claude Code** (or any coding agent), run from the repo root. Run them **in order**: later prompts assume earlier ones landed.

## How to use a prompt
1. Start a fresh Claude Code session in the repo.
2. Paste the whole prompt file. Every prompt starts with the shared preamble in `_PREAMBLE.md`, so you don't need to add context.
3. Let it work. Every prompt ends with **Acceptance criteria** and **Verify** steps. Don't merge until all pass.
4. Commit on a branch named after the prompt (`p05-building-grammar`), open a PR with screenshots, and merge.
5. Play it for 10 minutes before starting the next prompt. Taste is the bottleneck, not code.

## The sequence
| # | Prompt | Outcome |
|---|---|---|
| 01 | Foundation & CI | Real deps, a clean typecheck against real `@types/three`, CI, Pages deploy |
| 02 | Render pipeline hardening | LUT palette, colour audit, context loss, perf budget, seeded screenshots |
| 03 | Art direction pass | Weathering, signage glyphs, foliage wind, water, light tuning |
| 04 | UI, onboarding & accessibility | Self-hosted fonts, first 90 seconds, touch, a11y, i18n |
| 05 | Procedural building grammar | Buildings as data + grammar; seams between neighbours |
| 06 | Builder v2 | Move/resize buildings, transactions, undo/redo, 30+ placeables, wire rerouting |
| 07 | Navigation v2 | Worker sim, narrow-alley arbitration, crowding, stuck-agent fuzzing |
| 08 | Resident AI v2 | Response curves, social life, memory, visible adaptation, diaries |
| 09 | Animation & feel | Procedural walk cycles, sit/stand contracts, doors, glances/nods/waves, material-and-surface placement sounds, juice |
| 09b | The Noticing Engine | A place field, triangulators, a bond ladder from co-presence, but-for credit for the edit that made a friendship possible |
| 10 | Time, weather & seasons v2 | Weather states, snow cover, festivals, wind and chimes, desire paths and moss, a 72-microseason almanac, real-date option |
| 11 | Music & sound v2 | Bigger composer, spatial emitters, mix targets, captions |
| 12 | Performance & companion mode | Sim snapshots, a Worker sim, batching, cached shadows, idle rendering, desktop strip mode |
| 13 | Save, share & photo | Story postcards, export/import, share codes in URL hash, photo mode v2 |
| 14 | PWA & distribution | Offline install, itch.io, optional Tauri companion |
| 15 | QA & testing | Visual regression, determinism replays, fuzzers, cross-browser matrix |
| 16 | Authenticity & IP review | Cultural pass, invented brands, English-only text QA, sourced claims |
| 17 | Launch | Landing page, press kit, trailer capture, devlog plan |
| 18 | Award polish | First-90-seconds script, juice audit, consistency audit, bug bash |

**Recommended order after 04** (from the 2026-11-11 review, `docs/REVIEW-2026-11-11.md`): do task 9 of prompt 08 (favourites for Mitsuko, Haru and Rin) and task 7 of prompt 10 (lighting gaps) before 05–07. Prompts 05–07 grow the world; those two grow attachment, which is the weakest link today. Then playtest with people who haven't seen it before going wider.

**Added from the 2026-11-11 research review** (`RESEARCH-NOTES.md`, "The Noticing Engine"): prompt 09b runs between 09 and 10. It is the award hook: bonds that grow from co-presence, credited to the edit that made them possible. Later prompts carry its pieces: wind, chimes, desire paths and the almanac (10), sim snapshots and a Worker (12), story postcards (13), its QA (15), claims and credits (16), the festival calendar (17) and the playtest measures (18).

`_PREAMBLE.md` holds the shared context and is already embedded at the top of every prompt. `RESEARCH-NOTES.md` lists the verified facts behind the design decisions.

## Rules of thumb
- **Look at it.** Every visual prompt requires screenshots at Dawn / Noon / Dusk / Night / Rain, in all four seasons where relevant.
- **Small PRs.** If a prompt grows past ~800 changed lines, split it.
- **Never trade the core promise.** The neighbourhood must visibly notice and adapt to what the player builds. Anything that weakens that loses.
