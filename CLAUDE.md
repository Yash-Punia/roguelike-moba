# CLAUDE.md

Project Warfront: a 3v3 portrait mobile MOBA with auto-fire combat and an in-match roguelike power draft, set on a fictional world-war front. This repo is the **browser prototype** that plays the full GDD loop offline against bots.

- Design rules and numbers: [docs/GDD.md](docs/GDD.md)
- Architecture and implementation detail: [docs/TDD.md](docs/TDD.md)
- Progress by phase: [MILESTONES.md](MILESTONES.md)
- Decisions log: [DECISIONS.md](DECISIONS.md)

Read the relevant GDD/TDD section before building a feature. Do not copy numbers into code: they belong in `/data`.

## Stack

TypeScript (`strict`), Vite, Three.js (WebGL 2), a small custom ECS, Preact HUD overlay, Howler.js, zod (config validation), lil-gui (debug), Vitest, Playwright, vite-plugin-pwa. No physics engine: 2D circle colliders on the ground plane plus a static obstacle grid. Pin versions in the lockfile.

## Architecture

The simulation only takes **commands** and only produces **snapshots** and **events**. Humans and bots both feed `Command`s (one per player per tick) into `sim`; render, UI and audio read snapshots and events.

| Module | Responsibility | May depend on |
| --- | --- | --- |
| `data` | JSON configs, types, zod validation, unit conversion | nothing |
| `sim` | ECS world, systems, seeded RNG, bots, events. No DOM, Three.js or timers | `data` |
| `input` | Keyboard/mouse/touch → `Command` | `sim` types |
| `render` | Three.js scene, camera, models, VFX; interpolates snapshots | `sim` types, `data` |
| `ui` | Preact HUD and menus | `sim` types, `data` |
| `audio` | Sounds from sim events | `sim` types |
| `tools` | Debug panel, telemetry, replays, perf overlay (dev builds) | everything |
| `app` | Boot, loop, match setup | everything |

Layout follows TDD §13 with the repo root as the project root: `data/`, `assets/`, `src/{sim,data,input,render,ui,audio,tools,app}/`, `tests/`, `scripts/`, `e2e/`.

## Determinism rules (sim)

1. No `Math.random`, `Date`, `performance.now` or timers inside `src/sim`. All randomness comes from the seeded PRNG, split into named streams (`draft`, `ai`, `spread`).
2. Iterate entities in ascending id order. Never iterate an unordered `Set` or object keys whose order could change.
3. All trig goes through `src/sim/math.ts`.
4. `render`, `ui` and `audio` never write sim state.
5. No allocations in per-tick or per-frame hot paths: pool entities, projectiles, particles and events.

## Conventions

- Fixed 30 Hz tick. Config is written in seconds and converted to ticks at load: `round(s × 30)`.
- Percentages are plain numbers in config (`15` = 15%), converted to fractions at load.
- Degrees in config, radians in code.
- Distances in metres. Sim axes: x = left/right, y = towards the Red HQ. Render: sim x → world x, sim y → world −z, height on world y.
- Every gameplay number lives in `/data` and is tunable live from the debug panel.

## Commands

Prefix shell commands with `rtk`. Scripts come online during M1:

- `npm run dev` — Vite dev server
- `npm run build` — production bundle
- `npm run test` — Vitest unit, scenario and determinism tests
- `npm run soak` — headless bot-vs-bot matches
- `npm run e2e` — Playwright smoke tests

## Workflow (hard rules)

- **One feature = one commit**, committed locally on `main`.
- **Never `git push` without the user's explicit go-ahead in that turn.** The user tests each feature before it is pushed.
- Push only up to the last user-tested commit: `git push origin <hash>:main`. Plain `git push` only when every local commit is tested (`[t]`).
- If a feature fails the user's testing, fix it in a follow-up commit. Do not rewrite history unless asked.
- In the same commit as the feature, mark it `[c]` in [MILESTONES.md](MILESTONES.md) and add a [DECISIONS.md](DECISIONS.md) entry for any non-obvious decision made along the way. Backfill the hash in the next commit that touches MILESTONES.md (a commit cannot contain its own hash).
