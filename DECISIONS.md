# Decisions

A log of important project decisions. Newest entries go at the bottom; superseded entries are marked, not deleted.

Entry format:

```
## D-NNN — Title
- Date:
- Source: TDD (inherited) | made during development
- Decision:
- Why:
- Alternatives:
```

---

## Inherited from the TDD

## D-001 — Web prototype stack
- Date: 2026-10-31
- Source: TDD §2 (inherited)
- Decision: TypeScript strict + Vite + Three.js + custom ECS + Preact HUD + Howler + zod + lil-gui + Vitest + Playwright + vite-plugin-pwa. No physics engine.
- Why: fast iteration, small bundle, full control over determinism, typed configs.
- Alternatives: Babylon.js, PlayCanvas, bitECS/miniplex, Rapier, Jest, webpack.

## D-002 — Fixed 30 Hz deterministic simulation
- Date: 2026-10-31
- Source: TDD §4 (inherited)
- Decision: sim advances in fixed 30 Hz ticks; render interpolates. Seeded PRNG with named streams; no wall-clock or `Math.random` in sim.
- Why: replays, soak testing and a future authoritative server all depend on determinism.
- Alternatives: variable timestep (rejected: non-deterministic).

## D-003 — Sim / client split behind a Command → Snapshot/Events boundary
- Date: 2026-10-31
- Source: TDD §3 (inherited)
- Decision: `sim` knows nothing about the browser. It consumes `Command`s and emits snapshots and events. Bots produce the same `Command`s as humans.
- Why: replays, live tuning, bots on the same code path, server-ready, engine-portable reference implementation.
- Alternatives: game logic inside render objects (rejected: untestable, not portable).

## D-004 — Data-driven numbers and powers
- Date: 2026-10-31
- Source: TDD §5 (inherited)
- Decision: every gameplay number lives in `/data` JSON validated with zod. Powers are lists of effect records interpreted by generic systems.
- Why: tune without code changes; add powers in data.
- Alternatives: hard-coded per-power classes (rejected: slow to tune).

---

## Made during development

## D-005 — Repository root is the project root
- Date: 2026-10-31
- Source: made during development
- Decision: the TDD's `warfront-web/` folder maps to this repo's root. `data/`, `src/`, `tests/` etc. sit at the top level next to `docs/`.
- Why: the repo exists only for the web prototype; a nested folder adds nothing.
- Alternatives: `warfront-web/` subfolder (revisit if a native project joins this repo).

## D-006 — Milestones reconstructed from text
- Date: 2026-10-31
- Source: made during development
- Decision: [MILESTONES.md](MILESTONES.md) uses 5 milestones rebuilt from TDD §13 and GDD §11/§13 prose, because the roadmap and milestone diagrams were missing from the exported docs.
- Why: the text gives the count (5), duration (~12 weeks), gates (end of M2 = single-lane feel, end of M5 = playtest build) and asset priority, which is enough to plan.
- Alternatives: wait for the diagrams. Replace this breakdown if they differ.

## D-007 — Git workflow
- Date: 2026-10-31
- Source: made during development (from user instruction)
- Decision: one feature per commit, committed locally on `main`. Nothing is pushed until the user has tested and explicitly says to push. Failed tests are fixed in follow-up commits, not by rewriting history.
- Why: the user wants to test every feature before it reaches `origin/main`.
- Alternatives: feature branches + PRs (not requested; can switch later).

## D-008 — Working defaults for design open questions
- Date: 2026-10-31
- Source: made during development
- Decision: where the GDD states a current proposal, build that until told otherwise:
  - Gamma's Heat Wave is a moving aura.
  - Alpha's Frag Grenade target order includes the enemy HQ after champions.
  - Bazooka Tank is a small tracked vehicle.
  - Team size is 3v3.
  - No fog of war beyond Trench concealment.
- Why: unblocks implementation; all are config or small-system changes if revised.
- Alternatives: see the open questions below.

---

## Open questions (unresolved)

From GDD §13:
- Bazooka Tank: small tracked vehicle (default) or heavy infantryman?
- Frag Grenade: include HQ in target order (default) or champion → Sub-base → minion?
- 3v3 final, or test 5v5 once the core loop is proven?
- Heat Wave: moving aura (default) or fixed zone?
- Fog of war beyond Trench concealment?
- Launch roster size: 6, 9 or 12 champions?

From TDD §13:
- Add a minimal online 1v1/3v3 test (Node server running `sim`) after M5, or is bot play enough?
- Telemetry: automatic capture (needs a backend and consent screen) or manual JSON export?
- Production engine choice, and whether sim math should move to fixed-point now.
- Models: in-house Blender or CC0 stand-ins first?
