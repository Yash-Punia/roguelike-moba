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
  - Gamma's Heat Wave is a moving aura. **Confirmed by user 2026-10-31.**
  - Alpha's Frag Grenade target order includes the enemy HQ after champions. **Confirmed by user 2026-10-31.**
  - Bazooka Tank is a small tracked vehicle. **Confirmed by user 2026-10-31.**
  - ~~Team size is 3v3.~~ Superseded by D-009.
  - ~~No fog of war beyond Trench concealment.~~ Superseded by D-010.
- Why: unblocks implementation; all are config or small-system changes if revised.
- Alternatives: see the open questions below.

## D-009 — Team size and lane count are chosen before each match
- Date: 2026-10-31
- Source: user instruction
- Decision: match setup picks team size (2v2, 3v3, 4v4 or 5v5) and lane count (2 or 3). Each lane count has its own map file: `data/map-2lane.json` and `data/map-3lane.json`. Any team size can be played on either map.
  - 3v3 on 3 lanes stays the reference mode the GDD numbers are tuned for; other combinations are for playtesting.
  - Duplicate champions are allowed on a team, since the roster has only 3 champions and teams can have up to 5.
  - Bots spread across lanes as evenly as possible; extra champions double up, preferring the centre lane on the 3-lane map.
  - The 2-lane map layout (lane positions, Trench zones, camp and boss pits) is designed when it is built in M3 and logged here then.
  - Until the setup screen exists (M4), both options are set through URL parameters and the debug panel.
- Why: lets the user playtest how team size and lane count change pacing and pressure.
- Alternatives: fixed 3v3 on 3 lanes (the GDD's original design).

## D-010 — Map-wide fog of war, League of Legends style
- Date: 2026-10-31
- Source: user instruction (supersedes the "no fog beyond Trenches" default in D-008)
- Decision: each team sees only what its units and structures can see.
  - **Vision sources:** champions, minions, structures, captured Behemoth and, if added later, wards or powers. Each has a vision radius in config. Starting values to tune: champion 10 m, minion 6 m, Sub-base 10 m, HQ 12 m.
  - **Team vision** is the union of all its sources, recomputed each tick into a per-team grid. An enemy unit is visible only if it stands in a visible cell.
  - **Trenches work like LoL brush**, layered on top of fog: a unit inside a Trench stays hidden even inside enemy vision, unless an enemy is within 3 m or it fired in the last 1 s (the GDD §4 rules).
  - **Always visible:** terrain and structures, as in LoL. Structures are shown in their last known state.
  - **Hidden units** can't be auto-targeted (GDD §6 already requires this) and aren't drawn. Fogged ground is drawn darker in the world.
  - **The minimap** shows the fog: only allied units and visible enemies appear, and fogged areas are dimmed.
  - Bots get exactly the same vision as humans, read from the snapshot. No cheating.
- Why: user wants LoL-style map awareness and ganking, and the minimap to matter.
- Alternatives: Trench concealment only (GDD original). Fog radii are config values, so fog can be tuned very generous if it hurts readability on a 16 m wide portrait view.

---

## Open questions (unresolved)

From GDD §13:
- Launch roster size: 6, 9 or 12 champions?
- (Resolved: Bazooka Tank, Frag Grenade HQ targeting and Heat Wave in D-008; team size in D-009; fog of war in D-010.)

From TDD §13:
- Add a minimal online 1v1/3v3 test (Node server running `sim`) after M5, or is bot play enough?
- Telemetry: automatic capture (needs a backend and consent screen) or manual JSON export?
- Production engine choice, and whether sim math should move to fixed-point now.
- Models: in-house Blender or CC0 stand-ins first?
