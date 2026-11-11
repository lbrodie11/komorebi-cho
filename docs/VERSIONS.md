# Pinned versions

Every dependency in `package.json` is pinned to an exact version (no `^`/`~`) so a fresh `npm install` reproduces the build bit-for-bit, and upgrades happen deliberately in their own PR.

Checked against the npm registry on **2026-11-10**.

| Package | Pinned | Latest on npm | Notes |
|---|---|---|---|
| `three` | 0.187.0 | 0.187.0 | r187. |
| `@frame12/static` | 0.2.0 | 0.2.0 | FRAME/12's framework-free renderers (MIT, no runtime dependencies beyond `@frame12/tokens`). Used only by the Journal: sheet, scene and quiet panels, with escaping built in. Only its stylesheet is imported (26 KB, all `f12-` classes; its `:where(html/body)` rules have zero specificity, so the game's own rules win). Themed with the game's colours on `.journal`. |
| `@types/three` | 0.187.0 | 0.187.0 | Must match `three`'s minor exactly. |
| `typescript` | 6.0.3 | 7.0.2 | **Held at 6.0.** `typescript-eslint@8.72.2` declares `typescript >=4.8.4 <6.1.0`, and typed lint rules need its TS API. Move to 7 once typescript-eslint supports it. |
| `vite` | 8.3.7 | 8.3.7 | |
| `vitest` | 5.1.0 | 5.1.0 | Requires Node `^22.12 \|\| ^24 \|\| >=26`. |
| `eslint` | 10.14.0 | 10.14.0 | Flat config (`eslint.config.js`). |
| `@eslint/js` | 10.0.1 | 10.0.1 | ESLint's `recommended` rules. |
| `typescript-eslint` | 8.72.2 | 8.72.2 | `recommendedTypeChecked`. |
| `prettier` | 3.9.10 | 3.9.10 | 2 spaces, single quotes, 160 cols (`.prettierrc.json`). |

## Node

- **Node 24 LTS** (`.nvmrc`). CI reads the same file.
- `engines.node` is `>=22.12`, the floor set by vitest 5 and vite 8. Node 20 reached end of life in April 2026.

## GitHub Actions

| Action | Major |
|---|---|
| `actions/checkout` | v7 |
| `actions/setup-node` | v7 |
| `actions/configure-pages` | v6 |
| `actions/upload-pages-artifact` | v5 |
| `actions/deploy-pages` | v5 |

## Deliberately not added

- `eslint-config-prettier`: neither `@eslint/js` nor `typescript-eslint`'s recommended sets enable formatting rules any more, so there is nothing for it to turn off.
- `globals`: `typescript-eslint` disables `no-undef` for TS files (the compiler already checks it), and the only JS file is the ESLint config itself.
- `playwright`: wanted for visual regression in prompt 15; not needed to land CI.
