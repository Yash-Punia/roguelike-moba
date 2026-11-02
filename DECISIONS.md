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
