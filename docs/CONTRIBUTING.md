# Contributing

Read `CLAUDE.md` (the non-negotiables) and `docs/ARCHITECTURE.md` first.

## Setup

```bash
nvm use        # Node 24, from .nvmrc
npm ci
npm run dev
```

Add `?debug` to the URL for the stats overlay: fps and frame time, CPU and sim-tick time, draw calls, triangles, textures, and how many residents are on screen.

## Branches

One branch per unit of work, named `pNN-topic`:

- `NN` is the prompt number from `prompts/` (`p05-building-grammar`, `p12-batching`).
- Work that isn't from a prompt uses `p00-` plus a short topic (`p00-fix-cat-pathing`).

Keep PRs small. If a branch grows past ~800 changed lines, split it. Mechanical changes (formatting, renames) go in their own commit so the review can skip them.

## Pull requests

`.github/pull_request_template.md` fills in automatically. It asks for:

- **What & why.** Link the prompt if there is one.
- **Screenshots** before and after, at Dawn (6:00), Noon (12:00), Dusk (18:00), Night (22:00) and in Rain. Required for anything visual, including "this shouldn't have changed the look". Use the seeded URL; it renders the identical frame every time, so before/after shots can be diffed pixel for pixel:
  ```
  /?seed=1&hour=18&season=spring&weather=clear&freeze=1
  /?seed=1&hour=12&season=spring&weather=rain&freeze=1
  ```
  Wait until `__komorebi.frames > 20`, then capture `#view`. Add `&lutOff` to render with the reference palette loop. Seeded runs use the new-player defaults: the Smooth look and 5% Film Diffusion. Add `&pixel=classic` (or `fine`, `chunky`) for the palette pixel art, `&diffusion=0` for no diffusion, or `&diffusion=20` for the strongest.
- **Render changes**: run `scripts/diffusion-shots.mjs`. It takes the six reference views at 1280×720 (DPR 1) and 1920×1080 (DPR 2) with real device pixel ratios, in the look you pass (Smooth by default; run `classic` too, since the palette looks must keep snapping exactly), and writes sha256 hashes. Diff each shot against the previous build: the hashes tell you which views changed, and any change at 0% must be one you meant. It needs Playwright, which isn't a project dependency yet; the script's header says how to install it without saving.
- **Art direction** (visual PRs): a contact sheet of 4 times × 2 weathers × 4 seasons (`hour=6,12,18,22`, `weather=clear,rain`, every `season`) at the seeded URL. Squint at it: buildings must separate from ground and sky at every hour. At the default view the eye should land on the kissaten first, then the shrine islet, then the chimney. To check, blur a seeded frame heavily (or squint) and see which landmark holds the most contrast.
- **Performance**: the `?debug` numbers at the default view.
- **Known gaps**: what you didn't do, and why.

## Definition of done

A change is done when all of these hold:

1. `npm run lint && npm run typecheck && npm test && npm run build` pass locally, and CI is green.
2. No `any`, no `@ts-ignore` / `@ts-expect-error`, no `eslint-disable` without a comment explaining why.
3. New logic in `src/sim`, `src/core` or `src/audio/theory.ts` has unit tests.
4. You ran it and **looked**: screenshots at the five states above, and zero console errors or warnings in Chrome and Firefox.
5. Frame budget holds: 60 fps at default view on an M1/M2 Air. Check `?debug` before and after for draw calls and frame time.
6. The non-negotiables in `CLAUDE.md` still hold: code-only art, palette snap, no fail states, no teleporting residents, edits as transactions, named RNG streams, fictional specificity.
7. Docs are updated if behaviour or architecture changed, including `docs/VERSIONS.md` if a dependency moved.

## Style

Prettier owns formatting (`npm run format`). ESLint owns correctness (`npm run lint` runs both checks). Comments say *why*, not *what*.

## Deploys

Every push to `main` builds and deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`). One-time setup: **Settings → Pages → Source: GitHub Actions**.
