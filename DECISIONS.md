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
  - **Noted for later:** GDD §11 shows the local player's team in Blue and the enemy in Red, whatever the true side (the Brawl Stars convention). Render still uses true team colours.
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
