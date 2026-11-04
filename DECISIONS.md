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
- ~~Models: in-house Blender or CC0 stand-ins first?~~ Resolved for the prototype in D-020.

## D-011 — TypeScript pinned to 6.0; libraries added only when used
- Date: 2026-10-31
- Source: made during development
- Decision: TypeScript 6.0.3 (not 7.0) with `moduleResolution: "bundler"`. All dependencies pinned exactly. Preact, Howler, Playwright and vite-plugin-pwa are added in the milestone that first uses them, not up front.
- Why: typescript-eslint 8.72 supports TypeScript `<6.1`, and lint carries the determinism rules for `src/sim/**`. Unused libraries add install weight and upgrade churn.
- Alternatives: TypeScript 7 without type-aware lint (rejected: loses the determinism lint).

## D-012 — Joystick dead zone default 3 mm
- Date: 2026-10-31
- Source: made during development
- Decision: `data/input.json` defaults to a 3 mm (~11 px) dead zone, 60 px ring radius, full speed at 60% of the ring, 3.8 px/mm. All tunable live.
- Why: the GDD's 8 mm (~30 px) dead zone with the TDD's 60 px ring and 60% full-speed point (36 px) leaves ~6 px of analog range, so the stick would act like an on/off switch and undermine the Gate 1 movement-feel test.
- Alternatives: GDD's 8 mm with a larger ring (changes the TDD's ring size instead). Revisit after phone playtests.

## D-013 — Tick rate is a code constant; camera and input numbers live in data
- Date: 2026-10-31
- Source: made during development
- Decision: `TICK_HZ = 30` is a constant in `src/data/schema.ts`, not a config value. Camera (`data/camera.json`) and input (`data/input.json`) numbers are config so they can be tuned live. Camera timing stays in seconds because it runs in real time, not ticks.
- Why: the tick length is architecture (replays, conversions); changing it at runtime is not supported. Camera and joystick feel are exactly what playtests tune.
- Alternatives: tick rate in `match.json` (rejected: implies it is safely tunable).

## D-014 — `Command` movement is in world space
- Date: 2026-10-31
- Source: made during development
- Decision: `Command.moveX/moveY` are world-space directions (x right, y towards the Red HQ). The input layer rotates the stick 180° for a local Red player, whose camera looks towards −y.
- Why: bots naturally think in world space, so humans and bots share one code path, and replays don't depend on which camera recorded them. TDD §3 left this unspecified.
- Alternatives: screen-space commands rotated in the sim (rejected: the sim would need to know about cameras).

## D-015 — ECS keeps component stores sorted by entity id
- Date: 2026-10-31
- Source: made during development
- Decision: sparse-set stores insert and remove with splices so `ids` is always ascending; entity ids are never reused. `snapshot()` reuses its objects between calls.
- Why: ascending-id iteration (determinism rule 2) for free in every system, and no stale-id aliasing. O(n) splices are negligible at ~100 entities.
- Alternatives: unsorted dense arrays with a sort per system (more code, same result at this scale).

## D-016 — Camera solves for 16 m width; visible depth follows from the aspect
- Date: 2026-10-31
- Source: made during development
- Decision: the camera keeps the TDD rule (35° vertical FOV, 60° pitch, distance solved each frame so the view is 16 m wide at the framed point, which sits 40% up the screen). Visible ground depth is whatever that produces: roughly 32 m at 9:16 and 40 m at 9:19.5, not the GDD's 26 m. Smoothing is exponential (first-order, critically damped) with a 0.15 s time constant; look-ahead is 2 m along the move direction. All values in `data/camera.json`.
- Why: 16 × 26 m only fits a ~3:4 frame at this FOV; width is what keeps every phone fair. The deeper view also matters for the D-010 fog radii (10 m champion vision covers a small part of the screen).
- Alternatives: lower FOV or steeper pitch to hit 26 m depth (changes the GDD look); tune live once fog exists.

## D-017 — Concept art is the source of truth for look and map layout
- Date: 2026-11-01
- Source: user instruction
- Decision: everything in `concept_arts/` is followed for the prototype: the style guide SG-01 (palette, scale, shape and colour rules, tri budgets), the hero, unit, structure and prop sheets, and the map spec `warfront_map_layouts.md` with plan sheets MP-01 (The Front, 3 lanes) and MP-02 (The Bridgehead, 2 lanes).
  - It supersedes the M1 greybox data: the map grows from 36 × 110 m to 68 × 164 m, lanes from 6 m straight strips to 8 m Catmull-Rom curves, HQs move to (0, ∓72), spawn pads to (0, ∓66.5), Sub-bases to y ∓40. Palette hexes in `src/render/palette.ts` follow SG-01 where they differ.
  - Map geometry comes from the spec; gameplay numbers (damage, ranges, timings) still come from the GDD. Conflicts are logged here as they are found.
  - The 2-lane layout D-009 left open is The Bridgehead from MP-02.
- Why: the user designed the look and layout and wants the prototype to follow it.
- Alternatives: keep the greybox layout until after Gate 1 (rejected: Gate 1 tests lane feel, which depends on lane width and bends).

## D-018 — Walkability is built from map shapes; heights are render-only
- Date: 2026-11-01
- Source: made during development
- Decision: the jungle is raised ground that units cannot enter; movement off the lanes happens only in trenches, rooms and sunken arenas. The map file describes walkable shapes, which are rasterised into the existing 0.5 m grid (`src/sim/grid.ts`, 136 × 328 cells on The Front); every other cell is blocked.
  - Lanes: spline control points swept to the lane width. Trenches: polylines swept to 4 m (5 m ramps). Aprons and bases: ellipses. Rooms and arenas: circles. Bridges: rectangles. Fords: polylines tagged as water (−20% move speed). The river is blocked.
  - Splines are sampled at load with plain arithmetic, so the grid is identical on every machine.
  - Terrain heights (trenches −0.85 m, arenas −0.5 m, jungle +0.3 to +1.4 m) exist only in render. Raised jungle ground blocks line of sight for shots and fog (M3).
  - Trenches still act as LoL-style brush for fog (D-010).
- Why: the concept jungle is a trench network, not open ground with boxes. A 2D grid keeps the sim simple and deterministic.
- Alternatives: obstacle rectangles placed by hand (rejected: curved lanes would need hundreds); navmesh (unneeded at this map size).

## D-019 — Map sheet team sizes are recommendations
- Date: 2026-11-01
- Source: made during development
- Decision: the map spec lists The Front for 3v3 or 5v5 and The Bridgehead for 2v2 or 3v3. D-009 stands: any team size can be played on either map. The listed sizes are the intended modes.
- Why: the user asked for every combination to be playable for testing.
- Alternatives: restrict team sizes per map (revisit after playtests).

## D-020 — Prototype models are built from primitives in code
- Date: 2026-11-01
- Source: made during development
- Decision: heroes, units, structures and props are low-poly models assembled from Three.js primitives with flat SG-01 colours and no textures. Each model keeps its sheet's top-down silhouette cue (Alpha's square cap; Beta's round cap and scarf; Gamma's barrel and tanks) and SG-01 scale: heroes about 1.9 m and 3 heads tall, soldiers about 1.15 m. Team colour sits on the top half only. Models are built in the milestone that adds the unit, and stay within the SG-01 tri budgets. A glTF file can replace any model later through `assets.json` (M5).
- Why: matches the flat-shaded, untextured style exactly, needs no asset pipeline, and keeps the download small.
- Alternatives: Blender models (better fidelity, slower to iterate); CC0 stand-ins (would not match the sheets).

## D-021 — Cloud sessions work on a pushed branch
- Date: 2026-11-01
- Source: user request (continue work in a cloud session)
- Decision: a cloud session commits features on `wip/<milestone>` and pushes that branch. It never pushes `main`. The user tests by checking the branch out locally (`npm run dev`, LAN URL for the phone) and says which commits passed; those reach `main` on the user's go-ahead. Local sessions keep D-007 unchanged.
- Why: a cloud session's commits are lost unless pushed, and the user can't test from the cloud machine. Pushing a non-main branch keeps `main` limited to tested work.
- Alternatives: pull requests per feature (heavier than needed now).

## D-022 — Map v2 format: walkable shapes painted in order
- Date: 2026-11-02
- Source: made during development
- Decision: `map.walkable` is one ordered list of shapes (`path`, `ellipse`, `circle`, `rect`), each with a `surface` (dirt, grass, trench, arena, crater) and a render-only `height`. Shapes are painted in list order onto the 0.5 m grid by cell centre; the last shape over a cell owns it. Uncovered cells are jungle (blocked); `obstacles` rects are stamped blocked on top.
  - Paths are uniform Catmull-Rom curves with clamped ends, sampled at `splineSamples` (16) per segment by plain arithmetic in `src/data/map-geometry.ts`, shared by the sim grid and render terrain. Lanes and trenches are both paths (the spec draws trenches as curves too); ramps slope via `endHeight`, the Behemoth bowl via `centreHeight`.
  - M2 builds only the centre lane of The Front: both bases (50 × 26 m), aprons (24 × 15 m), both trunks, both Crater branches, the Crater (walkable floor radius 9 m of the spec's 9–10 m, leaving a rock rim to the 7 m branches) and its four 5 m ramps. Outer lanes, rooms and trenches come with M3.
  - Render terrain is a heightfield on grid corners. Near walkable edges, corner heights follow each shape's true signed distance with a 0.6 m slope up to the jungle, so walls trace the curves instead of the grid's staircase; render-only, so the sim is unaffected. Units are placed on the terrain height.
  - The HQs stay as obstacle rects (5 × 4.2 m) until structures become entities. The M1 movement tests use an open fixture map (`tests/fixtures/map-open.json`); the determinism test runs on the real map.
- Why: one ordered list makes overlaps (lane over apron, lane over ramp, arena over ramp) explicit in data; cell-centre painting keeps the grid exact and simple.
- Alternatives: separate arrays per shape type with fixed priority (less flexible); centripetal Catmull-Rom (unneeded: control points are evenly spaced).

## D-023 — Map distances follow the concept spec; GDD timings are unchanged
- Date: 2026-11-02
- Source: user decision
- Decision: The Front's centre lane is about 157 m HQ to HQ (trunk 51 + branch 55 + trunk 51), against the ~96 m the GDD's wave timing (first wave 0:15, then every 25 s), minion speed (2.6 m/s, ~60 s to cross) and XP pacing were tuned for. M2 keeps the GDD numbers as they are and tunes live during the Gate 1 playtests.
- Why: the numbers are all in `/data` and live-tunable; guessing a rescale before playing adds noise to the Gate 1 test.
- Alternatives: pre-scale wave timing and minion speed to the longer lane.

## D-024 — M2 build order and pull-ins from M3
- Date: 2026-11-02
- Source: user decision
- Decision: M2 rows are built in a playable order (see MILESTONES.md M2): death and respawn move up before minions so kills work, win/lose before the HUD, the HUD before the Ultimate button and draft tray, and the bot last. Minimal versions of three M3 items are pulled into M2 because the single lane needs them: the respawn timer formula (4 s + 1.2 s × level, capped at 18 s), champion-kill XP and Ultimate charge for the killer only (no 8 s assists), and the spawn-pad heal (10% max HP/s). Undocumented numbers needed along the way are chosen in the feature's commit, put in `/data` and logged here.
- Why: each commit can then be tested in the browser, and Gate 1 needs kills to matter.
- Alternatives: build in MILESTONES row order (several commits would be untestable until the HUD and bot exist).

## D-025 — Structures: placements in the map, footprints stamped into the grid
- Date: 2026-11-02
- Source: made during development
- Decision: structure placements (id, kind, team, lane, x, y) live in `map.structures`, from the spec's coordinates; per-kind stats live in the new `data/structures.json`. Each structure has two sizes:
  - **Footprint**, stamped into the obstacle grid by cell centre so units walk round it. Sub-base: 1.6 m circle, covering the 2.9 m hexagon plus its sandbag ring. HQ: the spec's 5 × 4.2 m rectangle.
  - **Collider radius**, for targeting and hits measured to the edge (GDD §6). Sub-base 1.45 m (half the hexagon), HQ 2.3 m (between the half-depth and half-width). Neither is in the docs; tune live.
  - Structures never move, so they need no Motion and the movement system ignores them; live edits rebuild the grid.
  - Snapshots now carry `kind` and `modelId`, and render builds models from `src/render/models.ts` (pillbox, command bunker, champion placeholder until feature 7).
  - Spawn pads are render-only map dressing at `map.spawn`, not entities; the pad heal (feature 8) checks distance to `map.spawn`.
  - Sampled lane routes for minions are deferred to the waves feature, where they are first used.
- Why: placements are map layout (D-017), stats are gameplay data; stamping keeps one collision system (the grid) for terrain and buildings.
- Alternatives: static circle-vs-circle colliders for structures (a second collision path in movement; rectangles fit the HQ poorly).

## D-026 — Terrain mesh is cut along true shape edges; straight-lane toggle
- Date: 2026-11-02
- Source: user report (staircase edges on lane walls) and user choice (try both lane styles)
- Decision: render terrain is a contour mesh (`src/render/terrain-mesh.ts`, no Three.js, unit tested).
  - Cells within 2 cells of an owner change are cut along each shape's signed-distance contour in paint order, then the jungle remainder is cut at the 0.6 m slope line into slope and top pieces. All other cells stay two triangles.
  - Cut points are refined onto the contour (Illinois regula falsi) from canonically ordered edge endpoints, and every vertex height comes from one ground function, so the mesh is crack-free.
  - Slopes use mud (#6B5540) as exposed earth. Build time is about 0.3–0.4 s on desktop for The Front.
  - The sim's walkability grid is unchanged (0.5 m cells): the visible edge can sit up to a quarter cell from where movement stops, which the 0.5 m unit radius hides.
  - Lane style is a live choice for playtesting: `map.splineSamples` 16 gives the spec's curves (default), 1 gives straight segments between the control points. Set it in the debug panel (the terrain rebuilds live) or with `?straight` in the URL.
- Why: the 0.5 m grid heightfield stair-stepped every non-axis-aligned edge, whatever the lane shape; straight lanes alone would not fix it.
- Alternatives: finer grid mesh (more triangles, still stepped); separate lane ribbon meshes with boolean cut-outs in the jungle (much more code).

## D-027 — Lanes are straight segments by default
- Date: 2026-11-02
- Source: user choice after comparing both styles (D-026)
- Decision: `map.splineSamples` is 1, so lanes, branches and ramps run straight between the spec's control points with angled bends, instead of the spec's Catmull-Rom curves (a deliberate deviation from D-017). Control points, widths and positions are unchanged. `?curved` draws the curves (16 samples) for comparison.
- Why: the faceted look fits the flat-shaded low-poly style better.
- Alternatives: the spec's curves (kept as a URL toggle).

## D-028 — Combat components: undocumented numbers and test scaffolding
- Date: 2026-11-02
- Source: made during development
- Decision:
  - **Projectile speeds:** Sub-base bullets and HQ flak travel at 30 m/s (not in the GDD/TDD; Alpha's 25 m/s is). Whether flak is a projectile or an instant hit is settled with the structure rules (feature 10).
  - **Weapon intervals** stay rounded to whole ticks at load (0.833 s → 25 ticks, 1 s → 30) per the conventions. Fire-rate bonuses will run on a fractional cooldown accumulator (feature 5), so percentage stacks are not lost to rounding.
  - **Stats:** champions carry Damage, FireRate, MaxHp, MoveSpeed, Range, DamageTaken and UltCharge, computed as `(base + flat) × (1 + Σpct) × Πmult` and cached until marked dirty (`src/sim/stats.ts`). Move speed and max HP are now derived from stats; live max-HP edits keep the unit's HP fraction.
  - **Spatial index:** 4 m buckets over the map, holding every unit with Health, rebuilt each tick after movement; queries return ascending ids.
  - **`units.json`** (MG Soldier) is deferred to the waves feature, where it is first used.
  - **`?dummy`:** spawns an idle enemy Alpha at (0, ∓50), in front of your Sub-base, to test combat against until the bot replaces it. `PlayerSetup.spawnAt` supports it.
  - **World HP bars:** team-coloured fill on a dark back, unlit billboards drawn over the models. Units tick every 250 HP (GDD §10); structures tick every 1,000 HP, since 250 HP ticks turn a 10,000 HP bar into an unreadable barcode.
- Why: unblocks combat with values that are easy to tune live.
- Alternatives: 250 HP ticks on structures too (rejected after a visual check).

## D-029 — Auto-targeting details the GDD leaves open
- Date: 2026-11-02
- Source: made during development
- Decision: champion targeting (`src/sim/systems/targeting.ts`) follows GDD §6 / TDD §6.2, with these readings:
  - **Every tick, not every 0.1 s:** candidates are re-evaluated each tick from the spatial index. It is cheap and only makes switches up to 2 ticks more responsive; all timings stay as specified.
  - **Distance** is from the shooter's centre to the target's collider edge, for range, stickiness, ties and the 1.5 m switch rule. The GDD pseudocode's plain `dist` is read as rule 3's edge distance.
  - **Ties:** units within 0.5 m of the nearest unit in the top class are tied; the lowest HP% wins, then the nearer, then the lower id.
  - **Stickiness** keeps the current target out to range + 0.5 m even when it is no longer a candidate (the GDD pseudocode only kept it inside range; rule 4 wins).
  - **Higher-class override** counts consecutive ticks with a higher class in range (5 ticks = 0.15 s rounded up from 4.5), resetting if it leaves; the switch goes to whichever unit is best on the 5th tick.
  - **Retarget pause** follows any death of the current target (GDD §3), not just the shooter's own kill (TDD wording). A target that merely leaves range or turns invulnerable is dropped without the pause.
  - **Not yet:** line of sight and fog/Trench visibility (M3, D-010, D-018). Structures (aggro rules, feature 10) and minions (feature 9) get their own targeting.
  - All five tuning values live in the new `data/combat.json`.
  - **Target line pulled forward** from the HUD feature: a team-coloured ground ribbon from the local champion to its target, with a ring round the target, so targeting is visible before shooting exists.
- Why: matches the stated rules where the GDD prose and pseudocode disagree; the prose is more specific.
- Alternatives: 3-tick candidate rebuild (no benefit at this scale).

## D-030 — Bullets fly straight with lead aim and hit the first enemy in their path
- Date: 2026-11-02
- Source: user choice (bullet behaviour); the rest made during development
- Decision:
  - **Behaviour (user choice):** bullets fly straight towards where the target will be. The aim leads the target's current velocity by solving the intercept with the bullet's speed. A bullet hits the first living enemy unit along its path, so minions and structures can body-block and a sharp change of direction can dodge. Allies never block. This fits Piercing Rounds and Ricochet in the GDD. `combat.weapons.bulletAim` switches to `direct` (straight at the current position) or `homing` (curves onto the target and ignores everything else) for comparison.
  - **Aim and fire:** the aim (upper body) turns at 720°/s and the weapon fires only within 10° of the target direction. The bullet itself leaves along the exact target direction, so the aim only gates firing, and a 10° error never turns into a 1.2 m miss at 7 m. Bullets spawn at the shooter's collider edge.
  - **Cooldown:** each tick it counts down by the fire-rate stat and carries the remainder when it fires, so +20% fire rate gives exactly 1.2× the shots over time.
  - **Bullet flight:** bullets are 0.1 m in radius and fly the shooter's range plus 2 m before expiring. Hits use a swept segment-vs-circle test against the 4 m spatial index. Bullets currently fly over raised jungle ground; line of sight arrives in M3 (D-018). Invulnerable units still stop bullets but take no damage.
  - **Pool:** projectiles live in a pooled struct-of-arrays (`src/sim/projectiles.ts`), not as ECS entities, so firing allocates nothing. The snapshot lists them with velocity in m/s.
  - **Damage for now:** hits apply raw damage (shield first, then HP, floored at 0) until the TDD §6.4 pipeline arrives in feature 6. Only champions fire for now: structures (feature 10) and minions (feature 9) fire once their own targeting exists.
  - **Debug tools:** `PlayerSetup.unarmed` gives a champion no weapon. `?dummy` is now unarmed and `?dummy=armed` fires back. In debug builds, `window.warfront.loop` exposes pause and time scale.
  - **Render:** tracers are flat 0.9 m instanced quads in a lightened team colour at gun height (1 m), interpolated along their velocity. Models turn with their aim until champions get separate legs (feature 7).
  - **Noted for later:** GDD §11 shows the local player's team in Blue and the enemy in Red, whatever the true side (the Brawl Stars convention). Render still uses true team colours. *(Done in D-039.)*
- Why: positioning stays the core skill while bullets remain readable and fair; lead aim keeps auto-fire reliable against steady movement.
- Alternatives: homing bullets (no dodging or blocking); direct aim (moving targets mostly missed).


## D-031 — Damage pipeline: hooks before powers, damage numbers pulled forward
- Superseded in part by D-032 (crits are random rolls, not every Nth shot).
- Date: 2026-11-02
- Source: user choice (damage numbers and debug modifiers to make it testable); the rest made during development
- Decision:
  - **Stages:** `src/sim/damage.ts` runs every hit through TDD §6.4 in queue order: base → attacker (`Damage`, then `DamageVsChampions` or `DamageVsStructures` by the target's kind) → the hit's crit multiplier → target (`DamageTaken`, then structure rules) → shield, then HP → lethal check → log and `damage` event. Named powers feed these generic stats and hooks when they arrive: Hollow Points, Heat Wave and Supply Drop feed `Damage`; Bounty Hunter feeds vs champions; Demolition Expert and the Bazooka bonus feed vs structures; Flak Vest, Dug In and Tracer Rounds feed `DamageTaken`. Backdoor protection and the Bazooka's resistance plug into the marked structure-rules step.
  - **Multiplier stats:** `Damage` is now a multiplier with base 1 (level growth goes into its base), like FireRate and DamageTaken. Bullets carry the weapon's base damage. The two "vs" stats are also multipliers with base 1, because a base-0 stat stays 0 under `(base + flat) × (1 + Σpct)`. So Hollow Points and Bounty Hunter multiply together (1.12 × 1.2), as separate modifiers in the TDD list.
  - **Read at hit time:** attacker modifiers are read when the bullet lands, not when it is fired; a missing attacker counts as ×1. Flights last at most about 0.4 s.
  - **Crit** is a per-hit multiplier carried by the projectile (1 = none). The runtime weapon has `critEvery` / `critMult` and a shot counter, which Dead Eye will set.
  - **Floats:** damage stays a float and only the display rounds. Rounding each hit would erase small damage-over-time ticks (burn at 20/s is 0.67 per tick).
  - **Lethal save:** a generic `Health.lethalSaves` counter. A save leaves 1 HP and makes the unit invulnerable until `tick + combat.damage.lethalSaveSeconds` (45 ticks). The deadline is stored as a tick (`invulnUntil`) rather than a countdown, so targeting and damage agree on the same tick. Timed invulnerability also makes the unit untargetable, like the HQ flag. Last Stand will arm the save once per life.
  - **No damage, no log:** invulnerable and dead targets take nothing and aren't logged; they still stop bullets (D-030). A hit the shield fully absorbs is logged and announced.
  - **Damage log:** a struct-of-arrays ring (`src/sim/damage-log.ts`) that keeps at least `combat.damage.logSeconds` (8 s, the assist window). It overwrites entries older than the window and doubles in size instead of dropping in-window entries. Readers: structure aggro, call-for-help, assists, Ult charge and telemetry.
  - **Events:** `damage` events are pooled objects, valid until the next step. The snapshot now carries `shield` and effective `invulnerable`.
  - **Damage numbers** (pulled forward from the HUD, GDD §10): a pooled DOM layer over the canvas. Damage to your team shows in white, to enemies in hazard gold; a fully absorbed hit shows in grey. A crit is 1.4× larger with a "!", and a lethal save reads "SAVED". The numbers rise 1 m and fade over 0.8 s.
  - **Debug cheats:** the F1 "Local champion" folder sets the damage %, damage taken %, vs champions % and vs structures % stats and crit every N shots, gives a shield and arms a lethal save. It writes through `sim.debug`, outside the command stream, so a match that uses it won't replay. Replays (M5) will record these as debug commands.
- Why: later features (structures, minions, powers, assists) only add inputs to fixed stages instead of reordering damage, and the stages can be tested now.
- Alternatives: snapshot attacker modifiers at fire time (more state per bullet for no visible difference); integer damage (breaks damage over time).

## D-032 — Critical hits are random rolls with a crit chance
- Date: 2026-11-02
- Source: user request after testing D-031
- Decision: a shot is a critical hit with probability `critChance` (0–1, on the runtime weapon, 0 by default), rolled at fire time on a new seeded `crit` RNG stream. The roll is skipped when the chance is 0, so matches without crits draw no random numbers, and shooters fire in ascending id order, so rolls stay deterministic. Crit damage is `combat.damage.critMultiplier` (2, live-tunable), carried by the projectile into pipeline stage 3. The debug "Local champion" folder sets "crit chance %". This replaces D-031's every-Nth-shot crit (`critEvery`, `critMult`, shot counter).
- Open: GDD Dead Eye ("every 6th revolver shot is a critical hit") needs re-reading when powers land, for example as a crit-chance bonus. The GDD is unchanged for now.
- Why: the user wants crits to be random.
- Alternatives: crit chance as a `Stats` entry (flat-based, base 0), which would let powers stack chance through the stat formula; worth revisiting with the power catalogue.

## D-033 — Alpha: Steady Hand, Frag Grenade, fire pool and model
- Date: 2026-11-02
- Source: user choices (pull passive charge forward; Space/E plus a temporary button); the rest made during development
- Decision:
  - **Pulled forward from features 13–14 (user choice):** passive Ultimate charge (0 → 100 over `ultChargeSeconds`, × the Ult-charge stat), the Ultimate's target query with `ultTargetable` in the snapshot, Space/E to cast, and a plain temporary round button at the bottom right. The button fills clockwise, glows when ready and greys out without a target. Kill and damage charge and the brass gauge stay in features 13 and 14. Debug "Fill Ultimate" fills the charge.
  - **Stat sources are deltas:** traits, debug cheats and later powers add their percentage on gain and remove the same amount on loss (`addPct`), so they stack instead of overwriting each other.
  - **Steady Hand** counts ticks with the stick at rest (intent, not velocity, so being blocked doesn't break it). The bonus applies at 15 ticks and drops on the first tick of movement.
  - **Ultimate target query:** within cast range to the collider edge, the first class in the config's order that has a living, targetable enemy, nearest within it. An invulnerable HQ is skipped. A press without full charge or a target does nothing and keeps the charge.
  - **The grenade** is a pooled lob to the target's position at cast time and lands exactly `flightSeconds` (18 ticks) later. Zones and lobs advance before new casts within a tick. The blast hits every living enemy whose collider overlaps the 3 m circle, through the damage pipeline. The arc apex (2.5 m, `arcHeight`) is render only.
  - **Fire pool** hits every 0.5 s (`zone.tickSeconds`) for dps × 0.5 = 25, eight times over 4 s. That's the same DPS, but in readable damage numbers instead of 30 tiny ones a second. The first burn is a full period after landing. Structures take `structurePct` (50%) through a per-hit structure share in the pipeline's structure-rules step; the blast itself hits structures in full.
  - **Level** is stored on the champion (1 until XP). Per-level damage and DPS are already applied through it.
  - **Model (CH-01):** primitives, about 700 triangles, built at about 2.28 m and scaled 0.84 to the sheet's 1.9 m, with a big square head (three heads tall). The legs turn with the movement facing and the upper body with the aim (this ends D-030's whole-model aim turn for champions with an upper body). The revolver arm is held out in the attack pose so the gun shows the aim. A faint brass ring at the feet shows Steady Hand.
  - **Effects:** danger-red landing disc and ring for the whole flight (0.6 s, above the GDD's 0.5 s minimum), an olive grenade on its arc, a fire-colour flash with smoke blocks, and the fire pool as a scorched disc with flickering flame cones that shrink away in its last 0.5 s.
- Why: Alpha's whole kit is testable in the browser now, without waiting for the HUD and charge features.
- Alternatives: a dev cooldown instead of passive charge, or keyboard-only casting (both rejected by the user).

## D-034 — Death, respawn and the spawn-pad heal
- Date: 2026-11-02
- Source: user choices (camera follows the killer; debug units respawn at their own spot); the rest made during development
- Decision:
  - **Knock-out:** after the damage stage, a champion at 0 HP that isn't already down gets `respawnTicks = round(min(18, 4 + 1.2 × level) s)` (156 ticks at level 1) and a `death` event with its killer. The killer is the source of the lethal hit, stored as `Health.killer`; a debug kill has none. It keeps its position, level and Ultimate charge. It doesn't move or take input, and it doesn't fire, charge, get targeted or take damage (those already skipped HP 0). Its passive charge pauses while it's down.
  - **Respawn** runs first in the tick (TDD §4 "spawners and timers"). When the timer runs out the champion redeploys at home, facing the enemy, with full HP, no shield or timed invulnerability, a reset weapon and target, and its Ultimate charge kept, and a `respawn` event fires.
  - **Home:** the team's HQ pad (`map.spawn`). A champion placed with a debug spawn point (`?dummy`, tests) respawns at that spot instead (user choice).
  - **Spawn-pad heal:** living champions whose centre is within 2.3 m of their own team's pad (half the 4.6 m pad) heal 10% max HP per second, applied every tick and capped at max HP. It heals HP, not shield, and is never applied on the enemy pad or a debug spawn spot. Both numbers are in `match.json`, with the respawn formula.
  - **Camera (user choice):** while you're down, the camera follows your killer for the whole timer, then pans back to you on the pad. With no killer it stays on your body. `scene.update` now takes the local champion (target line, team colours) and the camera focus separately.
  - **Visuals:**
    - knock-out: the model tips backwards over 0.35 s, the cap flies off and bounces twice, brown dust puffs appear, and after 1 s it all fades over 0.6 s using per-model material copies that are put back on respawn;
    - respawn: a grey smoke pop on the pad;
    - the HP bar is hidden while down;
    - a move of more than 5 m in one tick snaps instead of interpolating, so a respawn doesn't streak across the map.
  - **Countdown:** a plain centred "REDEPLOYING IN n" until the M4 respawn overlay. The ULT button greys out while you're down.
  - **Debug:** `sim.debug.kill` sends a lethal hit through the normal pipeline (a lethal save still applies). The F1 Local champion folder has "Kill me" and "Kill dummy".
  - **Not yet:** kill XP and kill charge (M2 features 11 and 13), assists, bounties, the Sudden Death ×1.5, the Redeploy sprint (M3), and the spectate switch to a teammate (no teammates until M3).
- Why: kills now cost the loser time, which Gate 1 needs, and both sides of a death can be tested in the browser.
- Alternatives: the GDD's killer-for-2-s then teammate (no teammates yet); staying on your own body (user preferred following the killer).

## D-035 — MG Soldier waves: lanes, targeting, call for help, separation
- Date: 2026-11-02
- Source: user choice (whole waves alternate branches); the rest made during development
- Decision:
  - **Scope (M2):** MG Soldiers only, in the centre lane only (`waves.lanes`). Not yet:
    - M3: the Bazooka Tank, the +6%/min scaling, Shock Troops, and the outer lanes;
    - M2 feature 11: minion XP.
  - **Lanes in data:** `map.lanes` lists route steps from Blue to Red, each naming the `path` shapes that can be taken there (two at the Crater). At load every combination becomes one polyline, sampled like the terrain (`splineSamples`), so minions follow the visible lane, straight or curved. Red walks the same polylines reversed.
  - **Branches (user choice):** wave n (scheduled or debug, one shared count) takes branch n mod 2, west first, the same for both teams, so the waves meet head-on at the Crater.
  - **Waves:** the first at 15 s (tick 450), then every 25 s. Each team spawns a row of 3 at its end of the lane, 1.1 m apart and offset to the right of travel, and each keeps its place in the row along the route. `waves.enabled` (`?nowaves` in the URL, or live in F1) switches them off; "Spawn wave now" is in the F1 Waves folder.
  - **Numbers the docs leave open** (all in `units.json`, live-tunable):
    - 0.35 m collider (the sheet makes minions 60% of a hero's height);
    - 25 m/s bullets;
    - `acquireRange` 7 m to notice and walk to a target.

    The GDD numbers: HP 300, 2.6 m/s, 8 damage 3×/s, 5 m range, 6 m leash, call for help 6 m for 3 s.
  - **Targeting:**
    - A live call-for-help target comes first. Otherwise the order is nearest enemy minion, then structure, then champion, within 7 m to the collider edge.
    - The current target is kept while it is still the best class and within 7.5 m.
    - Only targets the minion could shoot without leaving the lane by more than the leash count (lane distance ≤ leash + range + target radius), so a minion never oscillates at the leash.
    - Firing reuses the champions' weapon system: aim turn, fire cone, lead and bullets.
  - **Movement:**
    - A minion walks to its target until it is in range, never stepping beyond 6 m from its lane.
    - With no target it marches waypoint to waypoint, holding its place in the row.
    - Lanes run straight through their Sub-bases, so a minion whose straight line crosses a structure's footprint steers along the tangent round the nearer side. The tangent is the centre direction turned by asin(clearance / distance), computed without trig. A* arrives with the bots in M4.
  - **Call for help:** after the damage stage, every hit this tick by an enemy champion on an allied champion pulls that ally's minions within 6 m of the champion that was hit onto the attacker for 90 ticks. They react on the next tick, matching TDD §6.2's "previous tick's damage log".
  - **Separation** (TDD §6.1), after movement:
    - overlapping minions each move half the overlap × 0.5 per tick, so a crowd settles softly;
    - a minion overlapping a champion moves aside on its own (× 0.5 per tick);
    - champions are never pushed;
    - a push into a blocked cell is dropped.
  - **Death:**
    - A minion at 0 HP fires a `death` event with its killer and is removed that tick.
    - Its component objects go to a per-sim pool that the next spawns reuse; entity ids are still never reused (`World.create`).
    - The app now passes events to render before the snapshot, so the knock-out takes over the model before capture would drop it, and removes it after the fade.
  - **Render:**
    - The MG Soldier is about 400 triangles: a team dome helmet with a darker rim (it bounces off on a knock-out), a big round head, green uniform, khaki backpack, and an LMG with a drum at port arms.
    - Its legs and upper body are separate parts, and it marches with a bouncy bob.
    - Its HP bar is small, ticking every 250 HP.
    - Minion tracers are 55% size at gun height (0.5 m). The snapshot's projectiles now carry `ownerKind`.
- Why: the lane now has its rhythm and the trading-inside-the-wave risk the GDD wants. It plays on the real map: a browser run showed soldiers stuck on their own Sub-base until the tangent steering went in.
- Alternatives: per-soldier branches, or mirrored branches per team (the user picked whole waves); a navmesh or A* for minions now (deferred to M4).

## D-036 — Structures fight back
- Date: 2026-11-02
- Source: user choices (Sub-bases never regenerate; towers keep their target); the rest made during development
- Decision:
  - **Aggro (GDD §5), before the weapons fire:**
    1. An enemy champion that hit an allied champion standing in range last tick (damage log) pulls fire onto itself at once, if it is in range too.
    2. Otherwise the tower keeps its current target while it stays alive, targetable and in range (user choice, classic MOBA tower focus).
    3. With no target, the nearest enemy minion, else the nearest enemy champion.

    Structures never shoot structures. Range is to the collider edge.
  - **Firing** reuses the shared weapon system: aim turn, fire cone, lead, 30 m/s bullets.
  - **HQ flak** (D-028's open point) fires two bullets per shot: one at its target and one at a second target picked by the same order. A weapon with `targets ≥ 2` fires at `secondaryOf`.
  - **Warm-up:** decided at fire time. Each consecutive shot at the same champion adds 25%, up to +100% (200, 250, 300, 350, 400, 400). A shot at a minion, a change of target, or 90 ticks without firing resets it. The bullet carries the warmed-up base damage; the multiplier also travels as `boost` so render can grow the tracer.
  - **Backdoor protection:** evaluated once per tick. A structure with no living enemy minion within 10 m is flagged, and the damage pipeline's structure step takes 50% off. It applies to every source: champions, the grenade and the fire pool.
  - **HQ gate:** an HQ is invulnerable while every Sub-base of its team stands. It is re-evaluated at spawn and whenever a Sub-base falls. A team with no Sub-bases (test maps) has no gate. Invulnerable units are already skipped by champion targeting, the Ultimate query and the damage pipeline.
  - **Regen:** `regen` per structure in `structures.json`. The HQ heals 1% max HP per second while no living enemy champion or minion is within 12 m. Sub-bases never heal (user choice, reading the GDD's "None").
  - **Destruction:** a structure at 0 HP is marked destroyed and emits `structureDestroyed` with its killer. It stops targeting and firing and stays as rubble: its footprint remains in the grid and minions still steer round it.
  - **Not yet:**
    - structure XP: M2 feature 11;
    - winning on the HQ: feature 12;
    - Shock Troops: M3;
    - HQ last line, +50% fire rate below 30%: M4;
    - damage-state art at 66% and 33%: M5.
  - **Render:**
    - structures no longer turn whole with their aim: the pillbox gun rides a turret ring and each HQ flak mount turns on its own (`aimParts`);
    - an invulnerable HQ shows a faint team-colour dome;
    - a fallen structure throws up smoke and dust, loses its gun, flag and mast, darkens towards scorched earth and sinks to 35% height as rubble;
    - structure tracers are 1.3× size at 1.6 m and grow with warm-up.
  - **Debug:** F1 → Structures → "Destroy enemy centre Sub-base" and an "HQ shields" toggle. Test arenas keep structures unarmed and HQs ungated unless a test asks (`armed`, `shielded`), with backdoor and regen off, so older combat tests keep their numbers.
- Why: diving is now risky and minions matter, and the lane order (Sub-base before HQ) is enforced.
- Alternatives: re-picking the nearest minion every tick (rejected by the user); Sub-base regen above 50% (the user read "None" literally); instant-hit flak.

## D-037 — XP, levels and stat growth
- Date: 2026-11-02
- Source: made during development
- Decision:
  - **Data:** `data/progression.json` holds the GDD §8 table (100, 120 … 300 XP per level, total 2,200 at level 12), the 10 m share radius, MG Soldier 30 XP, champion kill 120 + 25 × victim level + 30, and Sub-base 150. XP past the level-12 total is dropped. One grant can raise several levels, with a `levelUp` event for each.
  - **XP sources in M2:**
    - a minion's XP is split evenly between the living enemy champions within 10 m of where it fell, whoever killed it (no last hits);
    - a champion kill pays the killing champion everything, with no assists until M3 (D-024);
    - a kill by a structure, a minion or a debug kill pays nothing;
    - a fallen Sub-base pays every champion of the other team 150, dead ones included ("whole team").

    Grants are read from this tick's events in order, after the death systems.
  - **Growth** is part of `base` (TDD §5): max HP × (1 + 5% × (level − 1)) and damage × (1 + 4% × (level − 1)). Other sources (Steady Hand, powers, debug) keep their percentages.
  - **Level-up HP:** a living champion gains the max HP it just got (MOBA convention). A live config edit still keeps the HP fraction.
  - **The Ultimate scales twice:** the Frag Grenade's own +20 per level and the champion's +4% damage per level both apply, because every hit takes the damage stat at pipeline stage 2 (D-031). At level 3 the blast does 290 × 1.08 = 313. Revisit in tuning if Ultimates grow too fast.
  - **Already level-aware:** the respawn timer (7.6 s at level 3) and the grenade read the level directly.
  - **Render:**
    - champions' HP bars carry a small level badge (white number on the bar's dark back, shared canvas textures);
    - a level-up flashes a brass ring and a light pillar at the feet, with a "LEVEL n" callout through the damage-number pool;
    - no XP floaters, which would be noise until the HUD's XP bar (row 14).
  - **Debug:** F1 → Local champion → "+100 XP" and "Level up". Debug grants are queued to the start of the next step so their `levelUp` events reach render.
- Why: kills and pushing now pay, and levels make the respawn timer, the grenade and the stats grow as the GDD intends. The draft (row 13) hooks onto `levelUp`.
- Alternatives: keep the HP fraction on a level-up; floating "+XP" numbers.

## D-038 — Win and lose on HQ destruction
- Date: 2026-11-02
- Source: user choice (minimal banner, sim stops); the rest made during development
- Decision:
  - **Match state:** the sim keeps `{ phase: 'live' | 'ended', winner, endTick }` (TDD §6.12's `Ended`; Deploy and Sudden Death join in M3). After the structure deaths each tick, the first HQ in event order that fell this tick ends the match, and the other team wins. A same-tick double fall therefore resolves deterministically. A `matchOver` event fires once.
  - **Frozen after the end:** `step()` returns at once with no events and no tick advance, so the final state stays put and replays stay bit-identical.
  - **Kills and deaths** per champion: a death counts on every knock-out; a kill counts only for an enemy champion who landed the lethal hit (no assists until M3). They are in the snapshot for the banner now and the M4 scoreboard.
  - **HQ fall, render:**
    - the camera moves to the fallen HQ;
    - 5 staggered explosions go off across the bunker, 120 ms apart;
    - the radio mast leaves the bunker and topples over 0.8 s;
    - the bunker collapses to rubble as before.
  - **Slow motion:** 1 s of real time at ×0.25. The sim is already frozen, so this scales a render clock that every effect now runs on (blasts, smoke, knock-outs, the collapse, damage numbers), rather than the loop's tick rate.
  - **Banner (user choice):** a brass VICTORY pennant or a torn muted-red DEFEAT banner, with the match time, the local champion's level and K/D, and "Play again", which reloads the page. The ULT button and respawn countdown hide. The full Results screen stays in M4.
  - **Debug:** F1 → Structures → "Win now (destroy enemy HQ)" and "Lose now" (`sim.debug.destroyHq(team)` drops the gate and lands a lethal hit through the pipeline).
  - **Not yet:** the 13:00 time-out, Sudden Death and Surrender (M3); the Results screen and telemetry (M4/M5); victory and defeat poses (M5).
- Why: a pushed lane now ends the match, which completes the core loop for Gate 1.
- Alternatives: keep simulating behind the banner; build the Results screen now (both declined by the user).

## D-039 — Minimal HUD, and your team is always Blue
- Date: 2026-11-02
- Source: user choices (top strip with structures and score; your team drawn Blue now); the rest made during development
- Decision:
  - **First `ui` code:** Preact 11.0.1 and @preact/signals 2.11.3, pinned exactly. The newest releases were days old; these had been out for weeks. TSX uses `jsx: react-jsx` with `jsxImportSource: preact`, and Vite needs no plugin. The HUD is a `pointer-events: none` layer in `#frame` with sizes in container query units, so it scales with the frame and never blocks the joystick.
  - **State flow (TDD §10):** `ui/store.ts` holds a few signals. `updateHud(snapshot, localId, localTeam)` fills them every third tick (10 Hz) and on the tick the match ends; structure lists are only replaced when something changed. The sim is unchanged.
  - **Top strip (user choice):**
    - the timer in the centre, with the takedown score below it (yours in light blue · theirs in light red);
    - your structures on the left and the enemy's on the right, HQ first: a hexagon for a Sub-base, a square for the HQ, each with 4 HP pips;
    - a white outline while an HQ is shielded, grey with ✕ once destroyed.

    Debug builds move the FPS overlay below the strip.
  - **Bottom left:**
    - a level badge (a brass ring) with rank chevrons above it: one per 3 levels, gold at 12 (GDD §11);
    - the HP bar with 250 HP segments and `hp / max`;
    - a thin brass XP bar showing progress through the current level, full at 12.
  - **Your team is Blue (user choice, GDD §10, closes D-030's note):**
    - `displayTeam(team, viewer)` maps the viewer's team to Blue and the enemy to Red; neutral is unchanged;
    - render applies it to models, HP bars, spawn pads, tracers and the target line;
    - the HUD uses it for sides and score.

    Playing `?team=red` looks exactly like playing Blue. The sim keeps true teams.
  - **Stays out:**
    - minimap, notifications, scoreboard (M4);
    - the draft tray and brass Ultimate gauge (their rows);
    - the respawn overlay (M4: the plain countdown stays);
    - the stencil font and canvas textures (M5).
  - **Bundle:** +24 kB gzipped (208 kB total).
- Why: progression and the push state are now readable at a glance during play, and the HUD is the base the draft tray and Ultimate gauge build on.
- Alternatives: timer only (the user chose the fuller strip); true team colours until later (the user chose now).

## D-040 — Ultimate charge from kills, and the brass Ultimate button
- Date: 2026-11-02
- Source: made during development
- Decision:
  - **Kill charge (GDD §8)**, from the same death events as XP, in points of the 0–100 meter (`progression.json` → `ultCharge`):
    - every living enemy champion within 10 m of a dying MG Soldier gains +3 each; the table says "dies within 10 m", so it is not split like XP;
    - the champion who lands a takedown gains +25. That is the killer only until assists (D-024); a dead killer keeps it, since charge survives death;
    - structure and debug kills give none.
  - **One charge path:** passive and event charge both go through `addUltCharge`, which multiplies by the Ult-charge stat (Quick Charge's "+15% from all sources" will feed it) and caps at 100.
  - **The button (GDD §3, §11; TDD §10):** a 22 mm SVG brass pressure gauge at the bottom right, sized with `input.pxPerMm` (84 px today, never under 64), replacing D-033's placeholder:
    - a brass bezel, a dark face and 12 ticks;
    - a blue ring that fills clockwise from 12 o'clock, and a brass needle sweeping 270° (7:30 empty → 4:30 full);
    - when ready, the ring turns gold and the gauge pulses with a brass glow;
    - with no target it is greyed with a crossed-circle icon, still showing the charge, and a tap does nothing (matching the sim);
    - a small "Space" plate above it while the last input was a keyboard; a touch or click hides it.
  - **Fast path (TDD §10):** rendered once with Preact, then the dash offset, needle angle and state classes are written straight into the DOM each tick, with no re-renders.
  - **Module boundaries:** the press latch and last-input tracking stay in `input` (`pressUlt`, `lastInput`), and `app` wires the gauge to them, so `ui` never imports `input`.
  - **Not yet:**
    - charge from damage dealt and taken, camps, bosses and assists; Overcharge and Underdog (M3);
    - the ready chime, haptics and sparks round the button (M5).
- Why: fights and waves now feed the Ultimate as the GDD intends, and the button reads as the game's main action.
- Alternatives: split minion charge like XP; re-render the gauge through the 10 Hz store (too choppy for the ring).

## D-041 — Basic draft: Commons, tray, auto-pick
- Date: 2026-11-02
- Source: made during development
- Decision:
  - **Catalogue as data:** `data/powers.json` holds the 8 Commons as TDD §5 effect records with tags and one line of card text, plus the draft rules (3 cards, 10 s, 2 queued, caps 3/2/1). There are two generic effect types:
    - `stat`: a pct per stack through the D-033 delta model, re-deriving speed and max HP. Field Rations' new max HP is gained as HP;
    - `regen`: Field Medic.

    Rares and Epics will add records, and new effect types only where needed.
  - **Offers:** each level-up below 12 queues an offer of distinct Commons, still under their stack caps (`pool` is `all` or the champion's id), drawn from the seeded `draft` stream.
  - **Pulled forward from M3** because they are cheap and keep the Common tier sane:
    - the stack caps;
    - the queue: 2 waiting behind the live offer, and a third auto-picks the oldest first.
  - **Live offer:** only the front offer is live. It resolves on a `draftPick` (keys 1–3, or a tap on a card), or after 300 ticks with the **recommended** card: the one sharing the most tags with powers already owned, earlier slot on a tie. The tray highlights it. The next offer's timer starts when it reaches the front. Picking works while knocked out.
  - **Field Medic:** any damage dealt or taken stamps the champion's last combat tick. After 3 s without one, it heals 2% max HP per second per stack.
  - **Tray (GDD §10, §11):**
    - "FIELD ORDERS" cards in khaki paper with a bronze (Common) frame, showing the name, text and owned stacks ("1/3");
    - a brass highlight on the recommended card, a brass timer bar, and a "+1" badge for waiting offers;
    - "1/2/3" key plates after keyboard input.

    It sits above the Ultimate gauge and the HP block. Only the cards take taps, which never spawn the joystick. Play never pauses. The tray updates from the 10 Hz store, and immediately on an offer or a pick.
  - **Pick callout:** a brass "+ Power name" callout rises over the champion when it takes a power.
  - **Test arenas** run with an empty catalogue (`withPowers` restores it), so older tests' level-ups don't auto-pick powers.
  - **Not yet (M3 "Full draft rules"):** Rare and Epic cards and rarity odds, the guaranteed Epic at 4/8/12, the signature slot, the reroll, Gamma weapon adaptation, and bot draft scoring (row 16). 3D card icons are M5.
- Why: the roguelike half of the loop is playable: builds now diverge level by level without pausing the fight.
- Alternatives: auto-picking slot 1 instead of a recommendation; leaving caps and the queue for M3.

## D-042 — The M2 lane bot
- Superseded in part by D-043 (bot v2: modes, personality, pushes).
- Date: 2026-11-02
- Source: user choices (a plain load is you vs the bot; the bot casts its Ultimate now); the rest made during development
- Decision:
  - **Shape (TDD §7):**
    - the bot lives in `src/sim/bots/`;
    - it reads only the previous snapshot, plus config and the lane polylines;
    - it returns the same `Command` a human sends;
    - it keeps its goal state outside the sim, so the sim stays commands in, snapshots out, and bot matches are deterministic.

    The app (and headless tests) ask each bot for its command before every step.
  - **Lane navigation:** a `LaneTrack` turns the centre lane's first branch into distance along it (`s`) and back. The bot aims at the lane point up to 6 m towards its target (far enough that the aim lies beyond a Sub-base the lane passes through), then steers round structures with the minions' tangent rule, now shared as `steerAround`.
  - **Goals:** re-decided every 6 ticks; a goal is kept at least 1 s, except retreat. Numbers are in `data/bots.json` (Normal-tier, live-tunable).
    - **Retreat** (emergency): below 30% HP it follows the lane home to its pad and heals there until 90%.
    - **Trade:** when the enemy champion is within 10 m, its HP share is at least the enemy's, and the enemy isn't under one of its own structures (range + 1 m), it kites at 95% of its range, never stepping into the enemy tower's range.
    - **Farm** (default):
      - it stands behind its front-most minion, 85% of its range short of the enemy front (the enemy's front-most minion, or their tower);
      - it never drops back past its hold point, 4 m in front of its own Sub-base, so a fresh wave walks up to it;
      - with no wave out, it waits at that hold point.
  - **Tower rule:** the bot enters an enemy tower's range only while that tower is shooting one of its minions, so it pushes with its wave but never dives alone.
  - **Ultimate (user choice):** it casts when full and the Ultimate's target is a champion, or 3+ enemy minions are within 3 m of its minion target. The snapshot now carries `ultTargetId`.
  - **Draft:** none of its own; offers time out to the recommended card.
  - **Default match (user choice):** a plain load is your Alpha against a Red bot Alpha in the centre lane with waves:
    - `?nobot` plays alone;
    - `?dummy` and `?dummy=armed` replace the bot;
    - `?team=red` makes the bot Blue.

    The F1 panel shows the bot's current goal.
  - **Checked:** a 10-minute bot-vs-bot match on The Front runs clean: both farm and trade, 21 grenades are cast, Red reaches level 12 with 4 takedowns, and the Sub-bases hold.
  - **Not yet (M4):** A\* and Trenches, camps, bosses and ganks, dodging telegraphs, tag-weighted drafting, Easy/Normal/Hard tiers, and lane assignment for many bots.
- Why: the single lane now has an opponent that farms, trades and backs off, which is what Gate 1 needs to judge whether positioning decides trades.
- Alternatives: start alone unless `?bot`; no bot Ultimate until M4 (both declined by the user).

## D-043 — Bot v2: utility modes, wave play, personality
- Date: 2026-11-02
- Source: user playtest ("it never pushes my Sub-base, it just stays near its own base"); user choices (random seed per load, assertive band); research below
- Decision:
  - **Why v1 stayed home:**
    - it farmed only behind its own front minion, so it fell back to its Sub-base whenever you cleared its wave;
    - nothing ever chose to push or siege;
    - it walked home below 30% HP and stayed until 90% (a quarter of its time in tests);
    - it traded only when at least as healthy as you, and never near your tower.
  - **Research applied:**
    - Dota 2's bot API scores a desire (0–1) for every mode each think and runs the highest; push modes drop out with enemies near ([Valve wiki](https://developer.valvesoftware.com/wiki/Dota_Bot_Scripting), [push-mode example](https://github.com/furiouspuppy/Dota2_Bots/blob/master/mode_push_tower_bot_meepo.lua)).
    - Wave play: freeze near your tower when behind; push and crash a winning wave to siege; trade when the enemy wave isn't on you ([LoL Theory](https://blog.loltheory.gg/wave-management-league-of-legends/), [Guild Order](https://guildorder.com/games/league/guides/lane-phase-wave-management)).
    - Riot's bots fail both ways: wave-ignoring aggression feeds, passivity bores ([PBE thread](https://devtrackers.gg/leagueoflegends/p/29d572ed-pbe-bugs-feedback-thread-14-6-new-bots)).
    - Human feel comes from a consistent personality plus a mood that shifts with success, not raw noise ([Tanks VR devlog](https://www.indiedb.com/news/tanks-vr-devlog-6-bots-progress), [arXiv 2603.05352](https://arxiv.org/html/2603.05352v1)).
    - Macro (where to be) is separate from micro (how to fight) ([HMS, arXiv 1812.07887](https://arxiv.org/pdf/1812.07887)).
  - **Lane read** (`src/sim/bots/lane-read.ts`), from the snapshot only:
    - both wave fronts and the wave advantage at the clash;
    - the enemy champion's HP, level and respawn;
    - time-to-kill both ways, from weapon DPS and level;
    - the enemy tower: range, whom it shoots, our minions at it;
    - whether the enemy stands under its tower;
    - enemy minions near us (call for help);
    - whether our tower is threatened.
  - **Modes** (`src/sim/bots/bot.ts`), scored every 0.2 s; the current one gets +0.15 while its patience lasts (hysteresis):
    - **retreat**: below its personal HP threshold; it heals on the pad up to its return threshold;
    - **backoff**: drops behind its wave or into its own tower range when losing a fight, or when the enemy tower turns on it;
    - **defend**: back to its tower against a wave, and eager when you stand under it;
    - **freeze**: near its own tower when 2+ levels or 30% HP behind *and* you are within 18 m;
    - **contest**: clears your wave, up to 4 m ahead of its own (1 m when you are near);
    - **push**: up to 4 m ahead of its winning wave, or as far as is safe while you are dead. Never back past its hold point, 4 m in front of its Sub-base, so a fresh wave walks up to it;
    - **siege**: at its range from your tower, but only while the tower shoots its minions; out the moment it turns on the bot;
    - **trade**: steps in to its spacing when you are within 10 m, off your tower and out of your wave. Desire rises with HP and level lead and the time-to-kill ratio;
    - **allin**: chases when it can kill you within 2.5 s and faster than you can kill it, or when you are under 35% HP and it is healthier. It dives your tower only with risk tolerance ≥ 0.6, ≥ 60% HP and you within two shots.
  - **Micro:**
    - it weaves sideways while fighting (amplitude and period from its personality), dodging lead-aimed bullets;
    - with a 2% chance per decision it hesitates for 0.3–0.6 s;
    - structure steering is shared with minions.
  - **Ultimate:** on a champion while fighting, when you are under 60% HP, or when confident; on 3+ bunched minions while contesting, pushing, sieging or defending.
  - **Personality** (`src/sim/bots/personality.ts`), rolled once per match from the seeded `ai` stream within the assertive band (user choice):
    - aggression 0.45–0.95;
    - risk tolerance 0.3–0.9;
    - retreat at 18–30% HP, return at 70–90%;
    - spacing 80–100% of range;
    - weave 0.4–1.2 m every 0.7–1.4 s;
    - patience 0.6–1.6 s.
  - **Confidence:**
    - +0.25 per takedown, +0.1 per 1,000 tower damage nearby, −0.3 per death;
    - halves every 30 s;
    - clamped to ±0.5;
    - added to aggression.
  - **Seed (user choice):** each page load picks a random match seed in `app` (the sim stays deterministic for a seed); `?seed=N` replays one. The seed is logged to the console and shown in F1 → Match. F1 → Bot shows the mode, confidence, every desire and the personality.
  - **Measured on The Front:**
    - against an idle player the bot spends 92% of the match in your half and takes your Sub-base at 210–240 s (seeds 1–3);
    - bot vs bot (5 seeds) gives varied results: K/D from 6/0 to 0/6, up to about 5,000 structure damage in a match where v1 did at most about 900, and one Sub-base falls;
    - the HQ is still out of reach solo: flak and regen hold it until Shock Troops (M3).
  - **Not yet (M4):** A\* and Trenches, camps, bosses and ganks, dodging telegraphs, tag-weighted drafting, and difficulty tiers (this is one assertive band).
- Why: the opponent now contests, pushes and punishes, and each match feels different, which Gate 1 needs.
- Alternatives: keep v1 and just raise its numbers (still no reason to push); a fixed seed (every match identical); a very aggressive band (feeds, per Riot's experience).

## D-044 — Gate 1 performance pass
- Date: 2026-11-02
- Source: user choice (Gate 1 perf pass before M3); made during development
- Decision:
  - **Measured:** the busy single-lane scene is seed 11 at 0:50, both waves at the Crater, 15 units on the map, same camera.
    - Before: **444 draw calls and 201k triangles** per frame, shadow pass included, against TDD §12's mobile budget of ≤ 120 calls and ≤ 150k triangles.
    - Causes: the terrain was one 96,752-triangle mesh that was never culled and was drawn in both passes. Models were primitives, one draw each (Alpha 44 meshes, MG Soldier 22, Sub-base 19, HQ 21), mostly drawn twice for shadows. HP bars were 3–7 meshes each.
  - **Baked models** (`src/render/bake.ts`):
    - each model is built once per (kind, id, team), then every mesh is merged into the moving part that owns it (root, upper body, cap, each gun, mast, falling parts), with its material colour stored as a vertex colour and one shared flat-shaded Lambert material;
    - the shield dome and Steady Hand ring keep their own materials;
    - instances are clones sharing the template's geometry, with their animated parts found again by name (Three's `clone` JSON-copies `userData`, so templates hold no object references);
    - mesh counts: Alpha 3 + ring, MG Soldier 3, Sub-base 3, HQ 4 + dome, spawn pad 1, all sandbag blocks 1;
    - triangles are unchanged, and knock-out fades and rubble tinting work as before (the tint now multiplies the vertex colours).
  - **Terrain tiles:** the same triangles regrouped by centroid into 12 m tiles (about 80 on The Front), so frustum culling drops off-screen tiles in both passes. No seams, since no vertex moves.
  - **Instanced HP bars:**
    - all backs, fills (team colour per instance) and 250/1,000 HP ticks draw as three `InstancedMesh`es;
    - one update per frame faces them to the camera;
    - level badges stay as a few small meshes.
  - **Soldier shadows:** soldiers cast no shadow-map shadows. One instanced soft dark disc sits under each instead (a common mobile trick). Champions, structures and terrain keep real shadows.
  - **Allocations:**
    - the app's per-tick `find`/`some` calls and the bot's `for…of` loops are now indexed loops;
    - the sim already pools units, projectiles, lobs, zones and events.
  - **Perf overlay (dev, pulled from the M5 debug row):** fps, worst frame, sim time per tick, render CPU time, and the last frame's draw calls and triangles.
  - **After**, in the same scene: **91 draw calls and 76k triangles**. At the rubble view it's 79 calls and 70k triangles; at the base, 83 and 59k. Screenshots before and after match, apart from soldier shadows becoming discs.
  - **Sim:** a 10-minute headless bot-vs-bot match on The Front averages 0.06 ms per tick (p99 0.23 ms, a single 5 ms JIT warm-up tick), well inside 4 ms.
  - **Left for M5:** adaptive pixel ratio, GPU particles, and instancing whole soldiers (needed only if M3's ~50 minions push past the budget).
- Why: Gate 1 needs 60 fps on a mid-range phone, and M3 roughly quadruples the units; the per-unit cost had to drop now.
- Alternatives: lower the shadow map or drop shadows (visible quality loss); instance every soldier now (needs per-instance animation and fading; deferred until M3 shows it's needed).

## D-045 — M3 works directly on `main`, pushed per feature
- Date: 2026-11-02
- Source: user decision (after merging `wip/m2` into `main`, PR #1)
- Decision: from M3, cloud sessions commit each feature on `main` and push it straight away. The user pulls `main`, tests, and any failure gets a follow-up fix commit (no history rewrites). MILESTONES rows go `[c]` → `[p]` (the next commit backfills the hash) → `[t]` once tested. This replaces D-021 (the `wip/<milestone>` branch) and the "push only on go-ahead" rule of D-007 for this way of working.
- Why: Gate 1 is passed and the core is proven; the extra branch and merge step cost more than they protect. A cloud session must push to keep its work.
- Alternatives: keep `wip/m3` (one more merge per milestone); commit on `main` but push only on go-ahead (work is lost if the cloud session ends first).

## D-046 — M3 build order
- Date: 2026-11-02
- Source: user choice
- Decision: M3 rows are built in a playable order (see MILESTONES.md M3): The Front complete first, then match config with every slot filled by the lane bot, so the default match becomes 3v3 and every later feature is tested in a real 3v3; then Beta and Gamma, the Bazooka Tank and Shock Troops, Trenches, line of sight and fog of war, the power catalogue and full draft, Ultimate charge sources, the rest of respawn, match phases, and The Bridgehead last. The first map feature makes every trench, room and arena walkable but empty: medkits come with the Trenches feature, camps and bosses in M4.
- Why: the map and team size frame every other M3 feature; building the roster on a 1v1 lane would need retesting on the full map anyway.
- Alternatives: roster first (Beta and Gamma tested only in one lane); MILESTONES row order (the Bridgehead and match config before any champion).

## D-047 — The Front complete
- Date: 2026-11-02
- Source: made during development; user choice (rooms and arenas as empty shells, D-046)
- Decision:
  - **Map data** (`data/map-3lane.json`) from the spec's MP-01 tables:
    - the left and right lanes (8 m); the spec lists the right lane Red → Blue, so its points are stored reversed to run Blue → Red like every lane route;
    - the four outer Sub-bases at the spec's coordinates, with their lane ids;
    - the trench network: the spec's Red-half trenches plus their twins at (−x, −y), 38 paths and 374 m of centre line (the spec says 375 m);
    - the 12 rooms (C1–C4, M1–M4, S1–S4) at trench depth, and the Halftrack and Field Gun arenas (13 m wide, so r 6.5 m, sunk 0.5 m).
  - **Paint order:** bases, aprons, trenches, rooms, arenas, the Crater ramps and bowl, then lanes. Lanes paint over trench ends; rooms and arenas over trench ends inside them.
  - **Heights** (render-only, D-018): trenches and rooms −0.85 m, arenas −0.5 m. The spec gives no entry profile, so a trench floor slopes linearly between the floors at its two ends (room −0.85, arena −0.5, lane 0): every lane entry is a ramp. The lane-to-lane trench by the east Crater branch is two halves dipping to −0.85 m in the middle.
  - **Empty shells:** rooms and arenas are walkable but hold nothing yet. Medkits come with the Trenches feature, camps and bosses in M4. All rooms use the trench surface.
  - **Waves** run on all three lanes. The user's wave tuning (5 soldiers every 15 s from 0:05) is unchanged, so about 60–90 soldiers are on the map from the first minute (the GDD's 3 every 25 s would give about a third of that).
  - **Snapshots** carry `lane`: a minion's lane id, a Sub-base's placement lane, '' for the rest.
  - **Bot:** `createBot` takes a lane id (default `centre`) instead of using the first lane. Its lane read counts only its lane's minions and Sub-bases (and both HQs); before, outer-lane waves read as enemies at its door.
    - It also ignores minions more than `bots.lane.branchReach` (6 m) from the branch it walks. An east-branch minion near y = 0 is equally far from both trunk ends of the west-branch track, so its lane position flipped between about 50 m and 105 m. On the full map that held the bot back behind waves it could not reach.
    - Measured (bot vs an idle player, seeds 1–8, share of minutes 1–4 spent in your half): with only the lane filter 0.29–0.52; with both 0.98–1.00. On centre-only waves 0.81–1.00 (was 0.83–1.00).
    - Tried and dropped: projecting onto the nearest branch, and walking the branch its wave is on. With waves every 15 s alternating branches the bot ran back and forth between them. Lane assignment and branch choice belong to the bot slots (M3) and A\* (M4).
  - **Terrain mesh:** the full map has saddle cells, where the slopes of two nearby shapes reach into opposite corners of one 0.5 m cell and the cut contour crosses it four times. `split` now cuts each inside arc off as its own piece instead of assuming two crossings. Slivers under 1e-6 m² are dropped, since their winding can flip once stored as float32.
  - **Perf** (seed 11, D-044 method, software GL in headless Chromium, so only calls and triangles count):
    - quiet views: 58–92 draw calls, 61–81k triangles;
    - busy outer lane at 0:57 with 66 soldiers: 104–126 calls, 74–86k triangles.
    - Calls reach the ≤ 120 mobile budget in the busiest view. Instancing soldiers (left open in D-044) is the next lever, best done once the bot slots fill the map.
  - **Tests:** the lane-read test pinned 3 soldiers implicitly and broke with the wave-config commit (`1ddb04b`); it now sets them. The determinism test gets a 30 s timeout for the busier map (about 4.5 s per run).
- Why: the full map is the frame for every other M3 feature.
- Alternatives: the spec's trench floors flat at −0.85 m with a step into the lanes (looks like a cliff); separate short ramp shapes at each entry (more data for the same look).

## D-048 — Match config and bot slots: default 3v3
- Date: 2026-11-03
- Source: made during development (plan approved by the user)
- Decision:
  - **Team size:** `match.teamSize` (2–5, default 3) in `data/match.json`; `?size=N` overrides it, and the debug panel's Match folder has a team-size picker that reloads with `?size=N` (a match can't be resized once it starts). Every slot but yours is a lane bot. `?lane=left|centre|right` picks your lane (default centre).
  - **Lane count deferred:** `map-2lane.json` (The Bridgehead) doesn't exist yet and is last in D-046, so the lane-count switch moves to the Bridgehead row. No `?lanes=` param until it does something.
  - **Lane spread** (`src/sim/match-setup.ts`, D-009, TDD §7): your lane goes to slot 0; each other slot takes the lane with the fewest champions so far, ties to the centre and then the map's other lanes in file order. 3 → C L R; 4 → C L R C; 5 → C L R C L. Both teams spread the same way, so every lane faces an equal number. Champion lane preferences (Gamma centre, Beta a side lane) come with Beta and Gamma.
  - **Champions:** bots cycle through the roster in order (all Alpha today; duplicates allowed, D-009).
  - **Player ids:** 0 is you, 1 the enemy in your lane, then your team's other slots, then the enemy's. Input (player 0), the debug panel's bot folder and "Kill enemy" (player 1) and the existing tests keep working unchanged. Bots are created and asked for commands in ascending player id, because they share the `ai` stream.
  - **`?nobot` and `?dummy`** keep their meaning (you alone; a 1v1 against a dummy) and skip the slot filler.
  - **Which enemy a bot reads:** the lane read used the last enemy champion in the snapshot, which in 3v3 is the highest id anywhere on the map. It now takes the nearest live enemy champion within `bots.lane.threatRadius` (18 m, the old `FREEZE_THREAT` constant moved to data), else the nearest enemy in any state. A lane opponent knocked out nearby still reads as down (the push bonus) while its teammates play other lanes. With one enemy the pick is unchanged, so the 1v1 bot tests and D-047's measurements still hold.
  - **No spawn offsets:** champions never push each other (separation moves only minions), so a team stacks on its pad and fans out as the bots walk to their lanes. Two bots sharing a lane at 4v4+ can overlap; they diverge through their personalities.
  - **Perf** (seed 11, 3v3, D-047 method, software GL in the desktop app's browser pane, so only calls and triangles count): at 0:55–1:01 with about 60 soldiers, 89–117 draw calls and 64–81k triangles across the left lane, right lane, Crater and Blue trunk. Within the ≤ 120 / ≤ 150k mobile budget; soldier instancing stays the next lever. The pane's first 5v5 frame took about 16 s (shader and shadow setup in software GL); 3v3 starts in a few seconds there.
  - **Tests:** `tests/match-setup.test.ts` covers the spread, the player order, the enemy pick with several enemies, an all-bot 3v3 that repeats exactly for a seed, and every bot standing in its own lane at the first clash (30 s).
- Why: every later M3 feature (Beta, Gamma, Trenches, fog) is tested in a real 3v3 (D-046).
- Alternatives: your team first in the player order (would make player 1 an ally and break the debug hooks and tests); spawn offsets on the pad (not needed while champions don't collide).

## D-049 — Beta: Burst SMG, Light Feet, Lead Storm
- Date: 2026-11-03
- Source: user choices (move speed 5.7 m/s; bots mix the roster, you pick with `?champ=`, Beta prefers a side lane); the rest made during development
- Decision:
  - **Numbers** (`data/champions.json`): GDD §7 values, except:
    - move speed 5.7 m/s, which keeps the GDD's Beta/Alpha ratio over the user's tuned 5 m/s Alpha;
    - SMG bullets fly at 25 m/s (not in the GDD; Alpha's speed);
    - collider radius 0.45 m (the slimmest hero).
  - **Burst SMG:** every weapon gets `burstCount` (default 1) and `burstGapSeconds`, so there is one weapon path, not a `burst` kind.
    - A trigger pull fires bullet 1 at the target; the other 3 follow along the current aim 2 ticks apart.
    - Each bullet rolls ±4° spread on the seeded `spread` stream and its own crit. Straight bullets hit the first enemy on their path, so spread can miss or hit a bystander.
    - A burst finishes even if its target dies; only a knock-out or a channel cancels it. The 0.85 s cooldown starts with the first bullet.
  - **Light Feet:** +20% move speed through the stat pipeline, on while `tick − lastCombatTick ≥ 2 s` (stamped by every damage dealt or taken). The trait system now switches on the trait id; `steadyPct` became `traitPct`, and the snapshot's `steady` became `traitActive`.
  - **Speed factors on `Motion`:** `slowTicks` / `slowMult` and `channelMult`, applied in the movement system on top of the stat speed. They work the same for minions, which have no Stats. No generic `Status` store yet (TDD §5); it can replace these when burns and buffs arrive.
  - **Lead Storm:**
    - castable only with a target (GDD §6: the button greys otherwise); a press while channelling is ignored and spends nothing;
    - a 0.5 s windup shows the red strip before any damage (the GDD's telegraph rule), then 3 s of fire, so the GDD's damage totals hold;
    - the strip turns towards the Ultimate target (refreshed every tick at 10 m, class order), else her facing, at 90°/s;
    - it hits every enemy overlapping the 10 × 4 m strip every 0.1 s for 2 bullets' worth (24 at level 1, plus the per-level bonus, then the damage pipeline like the grenade) and refreshes a 35% slow for 1.5 s;
    - structures take full damage (the GDD says "every enemy in the line");
    - she moves at 70% for the whole channel and doesn't fire her SMG;
    - a knock-out ends it (`channelEnd` event).
  - **Roster mix:** `matchSlots` takes `localChampion` (`?champ=`, unknown ids fall back to the first champion). Bots cycle the roster by team slot, so a 3v3 side is Alpha, Beta, Alpha. Champions may set `lanePreference`; among the bots (slot 0 keeps its lane) those with a preference choose first. Player 1 is still the enemy in your lane.
  - **Bots:** the lane read's DPS estimate counts the whole burst. Ultimate and draft logic are unchanged.
  - **Render:**
    - Beta's model per CH-02, 608 triangles in 4 baked meshes. Her aviator cap is the knock-out `cap`.
    - The trait ring is brass for Steady Hand and dust-coloured for Light Feet.
    - Lead Storm: a danger-red strip (solid in the windup, faint while firing) with a looping tracer stream; her upper body sprays along the strip.
  - **Perf** (seed 11, 3v3, sim advanced to 0:57 with bots idle, so about 80 soldiers): 99–105 draw calls, 80–85k triangles across the left lane, right lane, Crater and Blue trunk. In the browser pane, the long first frames seen in D-048 come from the pane running hidden in the background; with it shown, a match starts in about 5 s.
  - **Cut for now:**
    - Extended Mag and Adrenaline (with the power catalogue);
    - the scarf's spring chain (static tail);
    - shell casings and dust swirls on slowed units;
    - line of sight for the SMG and the strip (its own M3 row);
    - merging Lead Storm's damage numbers (each 0.1 s hit shows its own "24").
- Why: Beta is the next M3 champion (D-046); her burst, speed and slow are what make her play differently from Alpha.
- Alternatives:
  - a `burst` weapon kind (a second fire path);
  - slows as stat multipliers (minions have no Stats, and multiply-then-divide drifts);
  - damage from the cast tick with no windup (breaks the telegraph rule).

## D-050 — Gamma: Flamethrower, Charge, Heat Wave
- Date: 2026-11-03
- Source: made during development (plan approved by the user; the speed follows the user's rule for Beta in D-049)
- Decision:
  - **Numbers** (`data/champions.json`): GDD §7 values, except move speed 4.3 m/s (the GDD's 3.0 / 3.5 ratio against the tuned 5 m/s Alpha, the rule from D-049) and collider radius 0.6 m (the widest silhouette).
  - **Flamethrower:** weapon kind `cone`, with no projectile.
    - It aims and checks its fire cone like a gun. Every 0.2 s (6 ticks) it pushes a hit of 28 on every living enemy whose collider overlaps the 4 m × 40° sector along its aim, through the hit queue.
    - It ignores sandbags (GDD §4); raised jungle blocks it once line of sight lands.
    - `projectileSpeed` now defaults to 0, and cones skip lead.
    - The range is the Range stat, so Range powers already lengthen it. Weapon adaptation for projectile powers comes with the full draft.
  - **Charge:** +30% move speed while the stick points within 45° of the nearest living enemy champion within 8 m, found by looping the champion store. It needs no visibility until fog of war arrives. It uses the trait system shared with Light Feet (`traitPct`, `speed` refreshed).
  - **Heat Wave:**
    - It needs no target: `ultTarget` returns the caster, so the button lights whenever charged. A press while the aura runs does nothing.
    - The aura is champion state (`auraTicks`), not a zone, so it moves with Gamma.
    - Every 0.5 s, allied champions and minions inside heal 3%/s of their max HP and enemy ones take a burn of 3%/s of theirs. Structures are skipped.
    - The burn is an **exact** hit: it skips the attacker's modifiers (Gamma's damage stat and his own wave's +20%) but keeps the target's.
    - **±20% damage dealt** is step 2 of the pipeline (`dealtMult`): ×1.2 if the source stands in an allied wave, ×0.8 in an enemy one, read from positions at hit time. Each side counts once. It works for minions, which have no Stats.
    - It ends early on a knock-out.
  - **Bots:** Gamma prefers the centre lane. In the default 3v3 you hold the centre, so the Gamma bot takes the free side lane (bots take the lanes humans didn't choose, TDD §7).
    - Heat Wave rule (TDD §7): cast when an enemy champion and 2 or more allied units are inside, or when below 40% HP with an enemy champion inside. Unlike the other Ultimates, it may be cast while retreating, since it heals him.
  - **Render:**
    - Gamma's model per CH-03, 692 triangles in 4 baked meshes. The lenses are flat orange in the baked mesh rather than an emissive material (that would add draw calls); the helmet dome is the knock-out `cap`.
    - A steam-grey trait ring for Charge.
    - Flame blobs tumble from the nozzle through the sector while `firing`.
    - A pulsing gold Heat Wave ring and faint floor move with him.
  - **Perf** (seed 11, 3v3 with a Beta and a Gamma per side, sim advanced to 0:57 with bots idle, 81 soldiers): 90–110 draw calls, 63–84k triangles.
  - **Cut for now:**
    - scorch decals;
    - the gold and red glow on units inside the wave, and embers;
    - steam bursts for Charge;
    - the spline hose;
    - Napalm Tank and Inferno Shell (power catalogue);
    - weapon adaptation (full draft).
- Why: Gamma completes the roster, so every later M3 feature is tested with all three kits (D-046).
- Alternatives:
  - Heat Wave as a zone in the zone pool (it would need an attach-to-owner field and still a damage hook);
  - aura buffs as stat multipliers (minions have no Stats);
  - burn through the full pipeline (it would scale with Gamma's level and his own +20%).

## D-051 — Pacing pass: matches by about 5 minutes; waves from caves behind the HQs
- Date: 2026-11-03
- Source: user feedback (3v3 matches run too long, aim for about 5 minutes; level cap 25 and HQ max HP −25% per lost Sub-base proposed by the user; waves spawning in your face at the HQ, so add a cave behind each HQ with single-file waves like LoL). User choices: no hard end (no base burning or score at 5:00), level cap reached around 4:30, waves stay 5 every 15 s. The rest made during development.
- Decision:
  - **Baseline** (all-bot 3v3, seeds 1–3, headless in the dev page): no match ended within 20 minutes. One or two Sub-bases fell per match, every champion sat at level 12 from minutes 5–8, and the HQs were never even scratched.
    - Why: HQ flak (300 damage to 2 targets per second) killed every soldier in one hit and outranged the champions. Bots never sieged without soldiers to soak the shots, and the HQ regenerated 100 HP/s whenever clear.
    - Each side's fresh waves met the other's mid-lane and traded evenly, so even a team that had taken a Sub-base never reached the HQ.
    - Halving structure HP alone changed almost nothing.
  - **What shipped:**
    - **Level cap 25** (`xpPerLevel` 60, 66 … 198): the leading champion reaches 25 at about 4:00–4:30. Growth stays +5% HP and +4% damage per level.
    - **Draft offers every second level** (`draft.levelsPerOffer` 2: levels 3, 5 … 25), so a match still offers about a dozen cards.
    - **HQ max HP −25% of base per lost Sub-base** (`hqHpPerSubBaseLostPct`), keeping its HP fraction. With all three lost, an HQ has 25% of its HP. It is recomputed with the HQ gate, and on live config edits.
    - **Waves grow +25% HP and damage per minute** at spawn (`scalePctPerMinute`; the GDD's +6%/min, raised for 5-minute matches).
    - **Shock Troops, minimal:** once a team's enemy Sub-base in a lane falls, that team's soldiers in the lane spawn with ×3 HP and damage (`shockTroopsMult`). This is the asymmetry that breaks the even mid-lane trades. The Shock Troops unit and model stay on their M3 row.
    - **Lighter structures:** Sub-base 3,500 HP firing 120; HQ 6,000 HP with flak 150 and no regen.
  - **Measured** (all-bot, headless, seeds 1–10 for 3v3, 1–4 for 2v2 and 5v5):
    - 3v3: median 4:43; 8 of 10 seeds end by 5:56, the slowest 7:03 (its first Sub-base fell at 5:12);
    - 2v2: median 5:32, all by 6:07;
    - 5v5: median 4:55, all by 5:21.
    - Bots are a cautious proxy: they only siege with soldiers soaking tower fire. A human who commits to a push should end it sooner.
    - A regression test guards that seed 1 3v3 ends inside 6 minutes.
  - **Levers tried and their effect** (3v3, a few seeds each):
    - half structure HP: no match ended within 15 minutes;
    - level cap 25 alone: all 3 Sub-bases of a side by about 5:40, but no HQ;
    - adding no HQ regen and flak 150: seeds from 4:40 to past 12 minutes;
    - adding waves +25–40%/min: still past 10 minutes in some seeds (both sides scale alike);
    - adding a respawn cap of 30 s: little change;
    - adding Shock Troops: every seed ended, median 5:50;
    - adding Sub-base guns at 120 and a 6,000 HP HQ: median 4:43 (shipped).
  - **Caves:**
    - each lane's route now starts at a cave mouth behind its team's HQ, at (0, ∓80);
    - 4 m dirt paths skirt the bunker: the left lane round its left side, the centre and right lanes round its right (`blue-cave-*`, `red-cave-*` in `map-3lane.json`);
    - `map.caves` places the render model: a rock mound on the back edge with a timber-framed dark mouth, sandbags and a team sign.
    - A wave now leaves the cave **single file**: one soldier per lane every 0.6 s (`spawnGapSeconds`), with no sideways offset, so they march as a line. The debug wave still spawns a whole row at once.
  - **Bot fix:** a retreating bot followed its lane track to the track's start, which is now the cave, then got stuck behind the HQ, off the healing pad, and stayed in retreat for good. It now leaves the track once level with its pad.
  - **Tests:** the open-map fixture pins the old level table, draft spacing and structure stats, so the combat tests keep their numbers. New tests cover the HQ cut, Shock Troops, the cave routes, draft spacing, single-file spawning, wave scaling and the match-length guard. One cave path at 3.5 m left an inverted 1.4e-6 m² terrain sliver, so the paths are 4 m.
- Why: shorter matches were the user's top playtest complaint; the cave stops waves spawning on top of attackers at the HQ.
- Alternatives (offered, declined for now):
  - a hard end at 5:00: base burning from 4:00, or a score at 5:00;
  - also not taken: longer late respawns (measured little effect), and more structure HP cuts alone (no effect without Shock Troops).

## D-052 — HQ max HP cut is a toggle, off by default

- Decision: `structures.rules.hqHpCutEnabled` (default `false`) switches the D-051 HQ max HP cut on or off; `hqHpPerSubBaseLostPct` keeps the size (25). It is a checkbox in the debug panel under structures.json, and a live change re-cuts the HQ at once, keeping its HP fraction.
- Why: the user wants to playtest without the cut first.
- Measured (all-bot 3v3, seeds 1–10): cut off, median 4:55, range 3:04–7:04; cut on, median 4:31, range 3:03–7:03. Shock Troops do most of the work, so the 6-minute guard test still passes with the cut off. The cut tests turn it on explicitly.

## D-053 — Bazooka Tank and wave composition
- Date: 2026-11-04
- Source: user choice (a tank every second wave, from the start); the rest made during development
- Decision:
  - **Cadence:** `waves.tankEveryNthWave` 2. Counted from 1, so the opening wave is soldiers only and waves 2, 4, 6 … bring a tank. The GDD's "every third, every second from 5:00" doesn't fit 15 s waves and 5-minute matches. Schema default 0 (no tanks), so test fixtures that set their own waves are unchanged.
  - **Single file:** the tank is the last slot of its lane's wave and leaves the cave `spawnGapSeconds` after the last soldier, so it marches behind them. The match loop counts slots, not soldiers. The debug wave puts the tank in the middle of the soldier row.
  - **Numbers** (`data/units.json`): GDD §5 (100-damage rocket every 2 s, 6 m range, 1.5 m splash, 2.2 m/s, 80 XP, +8% charge), except **600 HP instead of 1,100** (pacing, below). Rockets fly at 14 m/s. `minionXp` and `ultCharge.minion` gain a `bazookaTank` entry. Death events now carry the minion's `unit`, since the entity is gone by the time progression reads them.
  - **Rocket:** weapon kind `rocket` with `splashRadius`, fired down the bullet path. The projectile pool stores the splash radius and the structure multiplier at fire time, because the tank may be dead when its rocket lands. On impact, every other living enemy whose collider is within the splash takes the same hit, in ascending id order from the spatial query. Allies are never hit.
  - **Structure bonuses:**
    - +100% vs structures (`weapon.vsStructuresPct`) rides on the hit's existing `structureMult`, which until now carried only the fire pool's 50%. Minions have no Stats, so the stat route doesn't apply.
    - 50% less damage from structures (`structureResistPct` on the unit) is applied in the damage pipeline's structure step whenever the source is a structure.
  - **Render:** primitive model per UN-01, baked to a hull plus a turret that tracks targets; the gunner's helmet flies off on a knock-out. No marching bob. Rockets draw as fat, low tracers. No impact puff: the current explosion effect costs about 6 draw calls per blast, with the budget already near 117 of 120 (D-048). Impact puffs come with the M5 particle pool.
  - **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, HQ cut off):
    - no tanks: median about 5:09;
    - GDD tank (1,100 HP): median about 5:46, range 3:49–9:20. Matches got longer: each side's tank holds its lane and wipes the other side's soldiers with splash, so lane clashes stay even.
    - tank damage 50: median about 4:30;
    - **tank 600 HP: median about 5:05, range 3:17–9:12 (shipped).** This keeps the GDD siege damage and the old pace. The seed 1 guard ends at 5:58.
- Why: the Bazooka Tank is the next M3 row (D-046). It gives waves a siege unit that champions have to deal with.
- Alternatives: the GDD cadence (median about 4:53 over 10 seeds; declined, the user chose every second wave); halving tank damage (shorter, but weaker sieges); an explosion puff per rocket (draw-call budget).

## D-054 — Shock Troops unit
- Date: 2026-11-04
- Source: user choice (keep the D-051 ×3 and add the GDD rule); the rest made during development
- Decision:
  - **Rule:** once the enemy Sub-base in a lane falls, that team's waves there have `shockExtraSoldiers` (1) more soldiers, all Shock Troopers, and a Bazooka Tank every wave. All of them, the tank included, carry `shockTroopsMult` ×3. The schema default for `shockExtraSoldiers` is 0, so fixtures that set their own waves are unchanged.
  - **Unit:** `shockTrooper` in `units.json` copies the MG Soldier's stats; the ×3 makes the difference. Its radius is 12% larger (0.39 m), and it is worth the soldier's 30 XP and +3% charge.
  - **Single file:** each lane builds its own wave from its own state. The match loop walks slots up to the longest possible wave (soldiers + extra + tank); a lane that is already out skips the rest. A lane that breaks mid-wave switches over from the next slot.
  - **Model** (UN-01): the MG Soldier's model scaled ×1.12, with goggles on the helmet, a team armband, a bigger pack and spare drums. It keeps the soldier's LMG, not the sheet's SMG; the gun swap is cosmetic and left for later.
  - **Pacing** (all-bot, headless, HQ cut off): 3v3 seeds 1–20 median about 5:11 (3:29–9:06); 2v2 seeds 1–10 median about 5:34; 5v5 seeds 1–10 median about 5:06. That is inside the 4:30–5:30 target, so no lever was pulled. The lever ready for when matches run short: the tank skips the ×3.
- Why: the Shock Troops row of M3 (D-046). It turns the D-051 multiplier into the visible unit and wave the GDD describes.
- Alternatives: replace the ×3 with the GDD rule alone (declined: D-051 showed the ×3 is what ends matches); ×3 on the troopers only (kept in reserve).

## D-055 — Bazooka Tank back to the GDD's 1,100 HP
- Date: 2026-11-04
- Source: user choice
- Decision: `units.bazookaTank.maxHp` goes back to 1,100, replacing the 600 HP pacing cut in D-053.
- Measured (all-bot, headless, HQ cut off, with Shock Troops from D-054):
  - 3v3, seeds 1–20: median about 5:17, range 3:33–9:17. Five seeds run past 8:00; at 600 HP, one did.
  - 2v2, seeds 1–10: median about 6:32, range 4:25–11:18.
  - 5v5, seeds 1–10: median about 4:37.
  - The seed 1 3v3 guard ends at 5:57, still inside 6 minutes.
- Why: the user wants the tank at its GDD strength for the playtest. The 3v3 median stays inside the 4:30–5:30 target; the cost is a longer tail and slower 2v2 matches.
- Alternatives: keep 600 HP (D-053); halve the tank's damage instead (median about 4:30 before Shock Troops).

## D-056 — Trenches: concealment, sandbags and medkits
- Date: 2026-11-04
- Source: user choices (the GDD concealment rule, sandbags in trench rooms only, an Ultimate cast reveals, arenas don't conceal); the rest made during development
- Decision:
  - **Zones:** every grid cell whose walkable shape has surface `trench` (trenches and the 12 rooms) gets a zone, numbered 1–4 by quadrant (sign of x and y). No trench crosses x = 0 or y = 0. Lanes painted over trench mouths, boss arenas and the Crater have no zone. "Entries" are the D-047 lane mouths; nothing new was built for them.
  - **Concealment** (GDD §4, over TDD §6.9's narrower rule): a unit in a zone is hidden from the enemy team unless one of these holds:
    - an enemy unit stands in the same zone;
    - an enemy unit is within `combat.trench.revealRadius` (3 m);
    - the unit fired, cast an Ultimate, or is channelling one within `revealSeconds` (1 s = 30 ticks).
  - **How it runs:** structures neither hide nor reveal.
    - `visibilitySystem` runs after movement and before any targeting, and keeps a per-team bit mask on a `Concealment` component (champions and minions).
    - Champion, structure, minion and Ultimate targeting all skip hidden units, as does Gamma's Charge.
    - Bots skip hidden enemies through the snapshot's `visibleMask`. Hidden units stay in the snapshot, because allies need them.
    - Area damage ignores concealment: rocket splash, fire pool, Heat Wave, Lead Storm, flames.
  - **Sandbags:** the map's existing `obstacles` (kind `sandbag`) now also fill a `shotBlocked` grid. The spec gives no coordinates, so they are placed by hand:
    - each medkit room gets a short wall (0.5 × 1.5 m), 1.25 m from the crate towards the room's lane mouth;
    - each sniper nest gets a three-piece horseshoe in the room's dead side, open to the back. These are axis-aligned rects, 2 m across.
    - The Red half is the (−x, −y) twin.
    - A test checks that every trench point stays reachable for a champion-sized unit.
    - Arena and Crater covers come with the bosses in M4.
  - **Bullets:** each tick, a grid ray march (`rayBlocked`) runs along the bullet's path. A bullet that reaches a sandbag before any unit stops there, and a rocket bursts there.
    - The splash still reaches units behind the wall. Grenade lobs and flames ignore sandbags.
    - Blast cover and targeting line of sight come with the next row. Until then, a unit can target an enemy behind a wall and waste shots on it.
  - **Medkits:** `map.medkits` holds the M1–M4 room centres. A ready crate goes to the first living champion (ascending id) below max HP within `combat.medkit.pickupRadius` (1.2 m). It heals 25% of max HP and returns after 45 s.
    - Crates start ready. Minions don't take them. The sim emits a `medkitTaken` event.
  - **Render:**
    - Enemies hidden from your team fade out over 0.2 s, using transparent copies of their materials, and fade back in when revealed. Their HP bar, blob shadow, flames, Heat Wave ring and damage numbers are hidden meanwhile. A knock-out ends the fade first.
    - Sandbags now sit on the ground they stand on, which is sunk in a trench, in two courses.
    - Crates are cream with a khaki band and a white cross, shown while ready.
  - **Measured:** about 80–96 draw calls by the Blue base with the room in view (budget 120).
- Why: the Trenches row of M3 (D-046). Trenches become LoL-style brush with cover and sustain, and the next row (line of sight) only has to mark raised ground in `shotBlocked` and reuse `rayBlocked`.
- Alternatives:
  - The TDD rule (3 m or fired only, no same-zone sight). Declined: the GDD says enemies outside the trench.
  - Zones as flood-filled connected trench pieces. Quadrants match the GDD's "4 Trench zones" and need no fill.
  - Rotated sandbag shapes. Axis-aligned rects reuse the existing obstacle stamp.

## D-057 — Line of sight
- Date: 2026-11-04
- Source: plan approved by the user; the rest made during development
- Decision:
  - **Two flags per cell** in the grid's `shotBlocked` layer:
    - `COVER`: sandbags.
    - `GROUND`: raised jungle, meaning any cell no walkable shape covers.
    - Structure footprints carry neither, so towers stay shootable.
  - `rayBlocked` takes a mask of the flags to test. Mask `SHOT` = both.
  - **The rule:** a weapon targets and hits only what nothing in its path stops. Rays run centre to centre.
    - Flames (cone weapons) use `GROUND`, so they pass over sandbags (GDD §4) but not an earth bank.
    - Bullets, rockets and flak use `SHOT`.
  - **Targeting:** champion, Sub-base and HQ, and minion targeting all check the line, current targets and call-for-help included. A target that steps behind cover is dropped at once.
    - In champion targeting the ray runs last, only for a candidate that could become the best, so each shooter casts only a few rays a tick.
  - **Ultimates:**
    - Frag Grenade targets need `GROUND` sight: it is lobbed over sandbags.
    - Lead Storm targets need a clear shot.
  - **Area damage:**
    - Grenade blasts, rocket splash and the Lead Storm strip hit only units with a clear `SHOT` line from the blast point (or from Beta).
    - Fire pools use `GROUND`.
    - A rocket that hits a wall bursts 1% of a tick's travel short of it, so units in front of the wall still take the splash. This replaces the D-056 interim, where the splash reached through sandbags.
    - Heat Wave is an aura, not a shot, so it ignores walls.
  - **Bullets** stop at raised ground as well as sandbags. A shot led around a bend can hit the bank.
  - **Not here:** bot vision and the 3 m Trench reveal ignore walls. Both come with fog of war.
  - **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, HQ cut off):
    - before: median about 5:18, range 3:33–9:18, four seeds past 8:00;
    - after: median about 5:09, range 3:32–14:23, one seed past 8:00 (seed 13, up from 8:49).
    - Inside the 4:30–5:30 target. The seed 1 guard still ends inside 6 minutes.
  - **Perf:** 109 draw calls and 0.9 ms sim at 0:42 of a seed 11 3v3, with a wave and a tank in view.
  - **The Bridgehead** (later): its river is unwalkable, so this rule would make it block sight. That map will need river cells that block movement but not shots.
- Why: the line-of-sight row of M3 (D-046). Lane bends and trench banks now break sightlines, as the map spec intends, and sandbags work as cover for grenades and rockets too (GDD §4).
- Alternatives:
  - Raised ground blocking flames as well as sandbags (no: GDD §4 says flames pass over sandbags).
  - Rays to the collider edge instead of the centre (more rays for little gain at 0.5 m cells).
  - Line of sight only at target selection, with bullets passing through (no: a led shot would then fly through the bank).

## D-058 — Fog of war
- Date: 2026-11-04
- Source: plan approved by the user (effects in fog hidden like LoL; only raised ground blocks vision); the rest made during development
- Decision:
  - **Vision grid:** each team has a 1 m grid over the map (`combat.fog.cellSize`; 68 × 164 on The Front), rebuilt every 0.1 s (`updateSeconds`, every 3 ticks).
    - Living champions (10 m), minions (6 m), standing Sub-bases (10 m) and HQs (12 m) see round themselves (`fog.radius`, the D-010 starting values).
    - Raised ground stops sight. A 1 m cell blocks it when at least half its 0.5 m grid cells are `GROUND`. Sandbags don't block sight.
    - The first blocking cell a ray reaches counts as seen, so bank edges are lit. A unit's own cell never blocks its view, so a unit at a lane edge isn't blind.
  - **How a view is found:** rays are cast round the circle from the centre of the source's 1 m cell, about two-thirds of a cell apart at the rim.
    - The map is static, so each (cell, radius) view is cast once and cached for the match: about 2,200 views, 0.7 MB after a full 3v3 on The Front.
    - Casting per cell per update cost about 1 ms; perimeter rays without the cache about 0.6–1 ms. With the cache an update costs about 0.1 ms.
  - **Who sees whom:** an enemy unit is seen by a team only where that team's vision covers it.
    - On a trench floor the Trench rules apply on top, inside vision only (same zone, within 3 m, fired or cast within 1 s). This closes the D-057 gap where the 3 m reveal worked through banks.
    - Structures are always seen and targetable.
    - Every existing reader (targeting, structures, minions, Ultimates, Charge, bots) already uses the same mask, so they all follow the fog.
  - **Toggle:** `fog.enabled` (live in the debug panel; `?nofog` turns it off). Off, both grids are all seen. The test fixture pins fog off, so earlier tests keep their meaning; `tests/fog.test.ts` turns it on.
  - **Render:**
    - The viewer team's grid is a 68 × 164 R8 texture. The terrain shader darkens fogged ground by `darkPct` (55%), and each cell eases over 0.25 s.
    - Only the ground darkens. Props share the baked material with units.
    - Enemies fade out at the fog edge (the Trench fade); one knocked out in the fog stays unseen.
    - Tracers, grenades (by landing spot), fire pools, explosions, death smoke, level-up and power text in the fog aren't drawn.
    - An enemy structure in the fog keeps its last seen HP on its bar.
  - **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, HQ cut off):
    - before (D-057): median about 5:09, range 3:32–14:23;
    - after: median about 5:12, range 3:21–8:25. Seed 13 drops from 14:23 to 6:15, three seeds run past 8:00, and the seed 1 guard ends at 5:08.
  - **Perf:** sim about 0.6 ms a tick with fog on or off over a full seed 11 3v3, about 0.1 ms more on update ticks. The fog is a texture, so draw calls don't change.
- Why: the fog of war row of M3 (D-046, D-010). Lanes and trenches now hide what the team can't see, for players and bots alike.
- Alternatives:
  - Vision as a per-unit radius check with no grid (no fogged ground to draw, and no bank occlusion).
  - Shadowcasting per update (more code than the cache, which already brings the cost near zero).
  - Darkening props too (they share the baked material with units).

## D-059 — Fog of war off by default
- Date: 2026-11-04
- Source: user instruction
- Decision: `combat.fog.enabled` defaults to `false`. `?fog` turns it on for a match, replacing `?nofog`; it can also be switched live in the debug panel (F1 → combat.json → fog → enabled). Everything else in D-058 is unchanged and stays covered by `tests/fog.test.ts`. With fog off, Trench concealment and line of sight still apply, and match pacing is the D-057 measurement (median about 5:09).
- Why: the user wants to play without fog by default while keeping it available to test.
- Alternatives: keep fog on and add `?nofog` (the D-058 default).

## D-060 — Power catalogue, part 1: Rares and signatures
- Date: 2026-11-04
- Source: user choices (split the catalogue into two commits; pull rarity odds forward); plan approved by the user; the rest made during development
- Decision:
  - **Split:** the catalogue row becomes two.
    - Part 1 (this): the 10 shared Rares and the 6 signature powers (Dead Eye, Cluster Grenade, Extended Mag, Adrenaline, Napalm Tank, Inferno Shell).
    - Part 2: the 8 shared Epics.
  - **Effect records** (`data/powers.json`), with the TDD §5 types:
    - `stat`: Demolition Expert, Bounty Hunter.
    - `weaponMod` with `shots`, `shotSpread`, `cone`, `burst`, `pierce`, `ricochet`, `critEvery`: Double Tap, Ricochet, Piercing Rounds, Dead Eye, Extended Mag.
    - `onHit` (burn and mark): Incendiary Rounds, Tracer Rounds.
    - `onNearbyMinionDeath`: Scavenger.
    - `onLowHp`: Second Wind.
    - `conditionalStat`: Dug In.
    - `onKill`: Adrenaline.
    - `flameGround`: Napalm Tank.
    - `ultMod`: Cluster Grenade, Inferno Shell.
  - **Folded mods:** when a champion takes a power, its owned stacks fold into one `PowerMods` record (`src/sim/powers.ts`), and stats and weapon are re-derived. Systems read numbers and never search the catalogue per tick. Amounts add up per stack; durations, radii and thresholds take the largest.
  - **Weapons:**
    - Double Tap fans one extra bullet per stack 4° apart.
    - A burst weapon gets it as one more bullet per burst instead. A cone weapon gets +10° and +0.5 m range instead (GDD §8 rule 8; the offer-side part of the rule stays in the draft rules row).
    - Dead Eye: every 6th trigger pull is a crit at `critMultiplier`.
    - Pierce and ricochet are counters on the projectile:
      - a piercing bullet flies on and never hits the same unit twice in a row;
      - a bullet with bounces left, when it stops in a unit, sends a homing bullet for 50% to the nearest other enemy within 4 m that it has a clear shot at.
  - **Statuses** (`Status` on champions and minions; `src/sim/systems/status.ts`, run after the death and reward stages):
    - **Burn:** keeps the stronger dps, and a new hit restarts its 2 s. It hits on a fixed 0.5 s beat as an exact amount, so refreshing adds no hits.
    - **Mark:** +10% damage taken from every source, applied in pipeline step 4.
    - **Timed shield:** what's left of it is taken back when it ends.
    - **Stat buff:** Adrenaline.
    - A knock-out clears all of them.
    - Only weapon hits (bullets, rockets, flames; a new flag on hits and damage events) apply burns and marks. Burns, pools and Ultimates don't.
    - Structures carry no statuses, so burns and marks don't affect towers.
  - **Triggers:**
    - **Scavenger:** a dead enemy minion within 10 m heals 3% max HP.
    - **Second Wind:** below 30%, a 20% max HP shield for 3 s, then a 30 s cooldown.
    - **Dug In:** −25% damage taken within 8 m of a standing allied structure or on a trench floor, applied as a stat delta like traits. The GDD gives no radius; 8 m is a Sub-base's range.
    - **Adrenaline:** fires on knocking out an enemy champion. Assists join when the respawn row adds takedown credit.
  - **Napalm Tank:** every 0.5 s while flaming, a 1.2 m burning patch at half the cone's range: 30 dps for 2 s, period 0.5 s, through the fire-pool zone (`GROUND` cover).
    - Fire-pool visuals now scale their flame count with area (minimum 2), so a patch is 3 meshes rather than 12, and a flaming Gamma adds about 12 draw calls instead of about 48.
  - **Cluster Grenade:** 3 bomblets 2 m round the impact, each its own 1.5 m blast for 100 with cover, skipping any that would land past a bank. Each makes an `explosion` event.
  - **Inferno Shell:** Heat Wave radius ×1.3 and +2 s, also in its damage aura and on screen (new snapshot field `auraRadius`).
  - **Rarity odds pulled forward** (GDD §8 rule 4, `draft.rarityOdds` 65/30/5):
    - Each card rolls its rarity on the seeded draft stream, then a power of it.
    - With none of that rarity left it falls back a tier (Epic → Rare → Common → any). Until part 2, Beta has no Epic, so her Epic rolls land on Rares.
    - Guaranteed Epics, the signature slot, the reroll and the offer-side Gamma rule stay in the draft rules row.
  - **Debug:** a "Grant power" picker in the Local champion folder adds one stack as if drafted, within the stack cap.
  - **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, fog off), with bots drafting by the recommendation:
    - median about 5:24 (before: about 5:09), range 3:31–19:18.
    - Two seeds now run long: seed 6 at 19:18 and seed 14 at 12:18. Before, the longest was 14:23.
    - The seed 1 guard ends at 3:31.
    - Most picked: Rapid Fire, Hollow Points, Field Medic, Long Barrel, Flak Vest, Ricochet.
- Why: the power catalogue row of M3 (D-046). Drafts now offer the Rare tier and each champion's signature, so builds diverge much more.
- Alternatives:
  - One commit for the whole catalogue (declined by the user).
  - Commons-only offers with a debug grant until the draft rules row (declined).
  - Burns and marks on structures too (the GDD is silent; kept to units so towers stay predictable).

## D-061 — No cover: sandbags removed
- Date: 2026-11-04
- Source: user instruction ("remove the sandbags entirely… I won't be needing any covers in this game")
- Decision:
  - **Gone from play:**
    - the 16 sandbag walls in the trench rooms (D-056);
    - the map's `obstacles` list and its schema (sandbags were its only kind);
    - the `COVER` shot flag and the `SHOT`/`GROUND` masks (D-057).
  - **What stops shots and sight now:** raised jungle ground only. The grid's `shotBlocked` flags become a single `ground` layer, and `rayBlocked` takes no mask.
  - **One rule for every weapon and blast:** with nothing low to fire over, the D-057 distinctions fall away (flames over sandbags, lobbed grenades over cover, fire pools past sandbags). Bullets, rockets, flak, flames, grenade blasts, Cluster Grenade bomblets, fire pools, napalm and Lead Storm all stop at raised ground.
  - **Render:** the arena's sandbag blocks are gone.
  - **Kept:** the sandbag rings and stacks modelled on the Sub-base and cave sheets. They are decoration from the concept art and never blocked anything.
  - **Tests:**
    - movement wall tests now use raised ground (the `raiseGround` helper);
    - the sight tests keep their raised-ground cases;
    - the sandbag-only tests are removed.
  - The GDD's sandbag cover rules (§4 Cover, §6 candidates, Gamma's "flames pass over sandbag walls") no longer apply. The GDD itself is left as written.
- Why: the user doesn't want cover in the game.
- Alternatives: keep the sandbags but stop them blocking shots (decorative walls). Not chosen: the user asked for them gone entirely.

## D-062 — First wave leaves the caves at 0:00
- Date: 2026-11-04
- Source: user change to `data/waves.json` (`firstSeconds` 5 → 0), committed on request
- Decision: the first wave leaves the caves on the first tick, then every 15 s as before (D-051).
  - The two Shock Troops tests in `tests/pacing.test.ts` kill a Sub-base on tick 0 and expect the next wave to be Shock Troops. With waves at 0:00, that wave leaves before the kill lands.
  - Those tests now pin their own 5 s first wave, so they test the Shock Troops rule and not the wave timing.
- Why: the user wants waves on the lanes from the start.

## D-063 — Power catalogue, part 2: the shared Epics
- Date: 2026-11-04
- Source: plan approved by the user (War Dog a sturdy, shootable pet; mines hidden from enemies); the rest made during development
- Decision:
  - **Records:** new effect types `periodic`, `whileMoving`, `oncePerLife` and `summon` (drone, dog), plus `onHit.chain`, `ultMod.charges` and `ultMod.bombs`. All of them fold into `PowerMods`.
  - **Shells:** `LobPool` lobs now carry their own kind, damage, radius and arc.
    - A shell is a single blast with line of sight; the Frag Grenade path is unchanged.
    - The landing disc doubles as the telegraph.
  - **Mortar Support:** while the champion has a living auto-target, a 150 shell (2.5 m blast, 1 s flight) lands on the target every 6 s.
  - **Airstrike Beacon:** every Ultimate cast also drops 3 bombs of 200 (2 m blasts, 1 s fall) in a line across the cast target, perpendicular to caster → target.
    - The bombs are 3 m apart, not the 2.5 m first planned, so the target takes one bomb rather than all three.
    - Heat Wave's "target" is Gamma himself.
  - **Tesla Rounds:** every 5th weapon hit chains to the 3 nearest other seen enemy units within 5 m of the struck one, with line of sight, for 120 each. These are effect hits, not weapon hits, and each link emits a `chain` event.
  - **Last Stand:** `lethalSaves` is set to 1 when picked (if alive) and on every respawn; the existing lethal save does the rest.
  - **Overcharge:** charge caps at 100 per stored charge, and a cast spends 100. The gauge shows a ×2 badge at 200.
  - **Minefield:**
    - A mine every 6 s while moving, at most 3 (the oldest goes).
    - It arms after 1 s and bursts (120 in 2 m, line of sight) when an enemy unit (not a structure) comes within 1 m.
    - Mines outlive their layer's knock-out.
    - The snapshot carries all mines; render draws only the viewer's team's.
  - **Attack Drone:** no entity. Each trigger pull fires one homing bullet from the orbit point (1.2 m, once round per 2 s, shared with render via `dronePosition`) at the owner's target, for 40% of everything that pull fires.
  - **War Dog:**
    - `Kind.Summon`, targeted with minions.
    - 600 HP, 4.5 m/s, a bite of 30 every 0.5 s within 1.2 m, credited to the owner as a fixed amount.
    - It bites the owner's target within 6 m of the owner, else the nearest seen enemy unit there; otherwise it heels within 2 m.
    - It vanishes on the owner's knock-out and returns with them, and comes back 20 s after its own death.
    - Its fall emits `summonDown`, not `death`, so no XP, kill or Adrenaline.
    - Towers shoot it.
- Why: the second half of the catalogue row (D-060, D-046).
- **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, fog off; bots draft by the recommendation):
  - median about 4:45, range 3:18–7:44 (part 1: about 5:24, 3:31–19:18);
  - all 8 Epics were drafted;
  - sim about 0.25 ms a tick on average.
- **Browser** (`?dummy=armed`, Epics granted from the debug picker):
  - the drone's 40% hits, the dog's 30 bites and armed mine markers all show;
  - 83–100 draw calls, 160 fps, no console errors;
  - not watched on screen: chain arcs, and the shell landing discs.

## D-064 — Full draft rules; offers every level; Sub-base 3,000 HP
- Date: 2026-11-05
- Source: user choices (keep the guaranteed Epic at levels 4, 8, 12; offers at every level again, configurable for testing; bullet-only powers never offered to the flamethrower; tune the game back under 6 minutes with Sub-base HP); the rest made during development
- Decision:
  - **Offers every level** (`draft.levelsPerOffer` 1), replacing D-051's every second level: up to 24 picks to level 25. Still live in the debug panel.
  - **Field Promotion:** at a level in `draft.guaranteedEpicLevels` (`[4, 8, 12]`, live), the first card is an Epic drawn from the eligible Epics, if any are left. The other cards roll the odds.
  - **Champion-relevant card** (GDD rule 5, TDD §6.10):
    - Each champion has `weaponTags`: Alpha `projectile`, `crit`; Beta `projectile`, `speed`; Gamma `burn`.
    - If no card is a signature power or shares one of those tags, the last card is swapped for an eligible one that does.
  - **Weapon filter:** a power may list the weapon kinds it can be offered to. Ricochet and Piercing Rounds are `bullet` only, so Gamma never sees them. Double Tap keeps its flamethrower conversion (D-060).
  - **Reroll:** one per match (`draft.rerolls`).
    - The `reroll` command (the R key, or the ⟳ icon in the tray head) redraws the live offer's cards for its level, under the same rules, and restarts its 10 s timer.
    - A pick sent in the same tick is ignored, because it was for the old cards.
    - The icon shows only while a reroll is left; bots never reroll.
  - **Recommendation tie-break:** most shared tags, then the higher rarity, then the earlier slot.
  - **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, fog off):
    - with offers every level, seed 1 ran 6:57 and broke the 6-minute guard (median 5:09, range 3:11–8:10);
    - candidates tried: waves +35%/min (seed 1 4:43, median 5:12, range 3:16–8:21); HQ 5,000 HP (no change); Sub-base 3,000 HP;
    - **shipped: Sub-base `maxHp` 3,500 → 3,000.** Seed 1 5:12, median about 5:24, range 3:12–9:10. The slowest seed grew from 8:10 to 9:10 (the user's choice over the wave lever).
- Why: the full draft rules row of M3 (D-046). Every match now has Field Promotions, a choice that fits the champion, a free reroll, and offers that never pitch a bullet power to a flamethrower.

## D-065 — Ultimate charge from fighting, and takedown assists
- Date: 2026-11-05
- Source: user choice (bring takedown assists forward for charge); plan approved by the user; the rest made during development
- Decision:
  - **Damage charge** (GDD §8), right after the damage stage (`damageChargeSystem` in `src/sim/systems/progression.ts`):
    - for every hit between champions of different teams, the attacker gains 1 point per `perDamageDealt` (100) and the victim 1 per `perDamageTaken` (150), through `addUltCharge` (Quick Charge scales it; the cap holds at 100, or 200 with Overcharge);
    - shield damage counts;
    - hits credited to a champion count however they were dealt (weapon, Ultimate, burn, War Dog, mine);
    - minions, towers and debug kills give none, either way.
  - **Takedown assists, pulled forward from the respawn row:**
    - every enemy champion that damaged the victim within `assistSeconds` (8 s), read from the damage log, gets the +25 takedown charge alongside the killer, once each;
    - the kill XP stays with the killer. Assist XP and the takedown counter stay in the respawn row, which reuses `assistSeconds`.
  - **Camps, mini-bosses and the Behemoth** (+5–8, +15, +25 in the GDD): they don't exist yet, so their charge moves to their M4 rows.
  - **Tests:** two older tests that check exact takedown and knocked-out charge now switch damage charge off (`perDamage*` = Infinity), so they keep testing what they were written for. A knocked-out champion's bullets still in flight may land and charge it.
  - **Measured:**
    - Alpha's gauge filled at about 4.1% a second while trading with an armed dummy, against 2.0% idle;
    - all-bot 3v3 on The Front, seeds 1–20: seed 1 ends at 4:11, median about 5:15, range 3:24–10:01 (D-064: median about 5:24, 3:12–9:10); about one Ultimate per champion per minute.
- Why: the Ultimate charge row of M3 (D-046). Fighting fills the gauge faster, and taking hits charges it too, a light comeback tool (GDD §8).

## D-066 — Offers every second level, on even levels; pacing guard 7 minutes
- Date: 2026-11-05
- Source: user change to `data/powers.json` (`levelsPerOffer` 1 → 2, exported from the debug panel and committed with abfbd4a by mistake), then user choices: keep every second level, offers on even levels, look at long matches later, relax the guard to 7 minutes
- Decision:
  - **Spacing:** `draft.levelsPerOffer` is 2 (supersedes D-064's every level). Offers come on levels that are multiples of `levelsPerOffer`: 2, 4 … 24, still 12 offers. The guaranteed Epic levels 4, 8 and 12 (D-064) get offers. With `levelsPerOffer` 1 nothing changes.
  - **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, fog off): seed 1 ends at 6:41, median about 5:40.
    - One seed didn't end within the 20-minute cap; others ran 15:13, 13:36 and 11:17.
    - Tried without effect on the tail: waves +35%/min (median about 7:10, two seeds uncapped) and Sub-base 2,700 HP (median about 5:21, one seed uncapped).
  - **Guard:** the seed 1 match-length test now allows 7 minutes.
  - **Open:** long and never-ending matches, to be investigated later (user).
- Why: the user prefers fewer, chunkier draft moments for now.

## D-067 — Redeploy sprint and takedown credit
- Date: 2026-11-05
- Source: user choices (each participant gets the full takedown XP; ship and loosen the pacing guard to 12 minutes); plan approved by the user; the rest made during development
- Decision:
  - **Takedown credit:**
    - the killer and every enemy champion that damaged the victim within `progression.assistSeconds` (8 s, moved up from `ultCharge` since XP and charge now share it) each get the full 120 + 25 × victim level XP and the +25 charge;
    - the killer also gets +30;
    - `assists` counts takedowns joined without the last hit; `kills` stays the killer's;
    - the end banner shows K/D/A.
  - **Redeploy sprint** (GDD §9, TDD §6.11):
    - on respawn, `match.respawn.sprintPct` (+50%) move speed, applied as a stat delta like traits, so it stacks with Light Feet, Adrenaline and Light Boots;
    - it ends once the champion has dealt or taken damage since respawning (`lastCombatTick`, so from the tick after the hit), crosses y = 0 towards the enemy, or is knocked out;
    - moving away from the enemy keeps it;
    - test fixtures pin it to 0, so older movement tests are unchanged.
  - **Render:** a sprinting champion kicks up a small dust puff every 0.25 s with the existing smoke effect. No new meshes.
  - **Sudden Death ×1.5 respawn** moves to the match phases row, where Sudden Death will exist.
  - **Pacing** (all-bot 3v3 on The Front, headless, seeds 1–20, fog off):
    - shipped: seed 1 10:16, median about 6:09, range 3:14–15:41;
    - sprint off: seed 1 6:41, median about 6:18;
    - assists off: seed 1 8:58, median about 5:44;
    - single seeds swing a lot, so the seed 1 test is now a smoke test that matches still end within 12 minutes;
    - long matches, and the median above the 4:30–5:30 target, stay open for the user to look at.
- Why: the respawn row of M3 (D-046). Players get back to the fight faster, and ganks pay everyone involved.

## D-068 — Match phases, time-out and surrender
- Date: 2026-11-05
- Source: user choices (the GDD's 10:00 and 13:00; a temporary HUD surrender button); plan approved by the user; the rest made during development
- Decision:
  - **Phases** (TDD §6.12):
    - `deploy` until the first wave (`waves.firstSeconds`; 0 today, D-062, so it's skipped);
    - `live`;
    - `suddenDeath` from `match.phases.suddenDeathSeconds` (600);
    - `ended`.
    - A `phaseChanged` event marks each change. The times are in `data/match.json`, live in the debug panel.
  - **Sudden Death:** structures take +50% (`suddenDeath.structureDamageTakenPct`), a new multiplier in damage pipeline step 4. Respawn timers run ×1.5 (`suddenDeath.respawnPct`, moved here from the respawn row, D-067).
  - **Time-out** at `timeoutSeconds` (780): the match ends with reason `timeout`. The winner is decided by:
    1. the higher HQ HP% (a fallen HQ counts 0);
    2. then more enemy Sub-bases destroyed;
    3. then more champion takedowns (kills);
    4. all equal is a draw (no winner).
  - **Surrender:**
    - an optional `surrender` command flag, accepted from `surrenderFromSeconds` (300); the other team wins, reason `surrender`;
    - bots never send it; offline, the one human is "unanimous" (GDD §2);
    - the snapshot's `match.canSurrender` drives the button.
  - **Match state** gains `reason` (`hq`, `timeout` or `surrender`) and `canSurrender`. `matchOver` carries the reason and an optional winner. Bots play in every phase but `ended`.
  - **HUD and render:**
    - a red "SUDDEN DEATH" badge under the clock;
    - the haze and sky light ease to red over about 2 s and stay red over the end banner;
    - a temporary "Surrender" button top right from 5:00: tap, then "Confirm?" within 3 s. It moves into the M4 pause menu.
    - The end banner shows VICTORY, DEFEAT or DRAW, with "Time-out" or "Surrendered".
    - The GDD's cosmetic biplanes wait for the M5 effects work.
  - **Tests:** two older match tests now start in Deploy, since the test fixture's first wave is at 0:15.
- Why: the match phases row of M3 (D-046). Every match now has a guaranteed end.
