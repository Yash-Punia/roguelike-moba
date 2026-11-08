# Milestones

Progress tracker for the Warfront web prototype (see [docs/TDD.md](docs/TDD.md)).

> **Reconstructed plan.** The milestone diagrams in the GDD (§13 "Prototype roadmap") and TDD (§13 "Milestones") did not survive export. This breakdown is rebuilt from the surrounding text: 5 milestones over about 12 weeks, the end of M2 is the GDD's first gate (movement feels skilful in a single lane), the end of M5 is the playtest build. See [DECISIONS.md](DECISIONS.md) D-006. Correct it here if the original diagrams differ.

## Status legend

| Mark | Meaning |
| --- | --- |
| `[ ]` | Not started |
| `[~]` | In progress |
| `[c]` | Committed locally (hash recorded) |
| `[t]` | Tested and accepted by the user |
| `[p]` | Pushed to `origin/main` |

A feature's own commit marks it `[c]`; the hash is filled in by the next commit that touches this file (a commit cannot contain its own hash). `[t]` and `[p]` are set only after the user confirms.

From M3 on, features are committed on `main` and pushed straight away (D-045), so a row goes `[c]` → `[p]` (the next commit backfills the hash and marks it pushed) → `[t]` once the user has tested it. `[t]` is the final state.

---

## M1 — Foundation (~weeks 1–2)

Goal: an empty arena you can walk around in, on desktop and phone, driven by a deterministic sim.

| Status | Feature | Hash |
| --- | --- | --- |
| `[p]` | Vite + TypeScript strict scaffold, lint, Vitest wired, npm scripts | cdcd569 |
| `[p]` | `data` module: config loaders, zod schemas, seconds→ticks and %→fraction conversion | af81c9e |
| `[p]` | `sim` core: sparse-set ECS, seeded PRNG with named streams, `math.ts` trig wrapper, event emitter | 6fe7991 |
| `[p]` | Fixed 30 Hz main loop with interpolation alpha, tab-hidden pause, debug time scale | 9c068f0 |
| `[p]` | Three.js scene: flat-shaded Lambert, sun + hemisphere light, greybox ground | d7ebdae |
| `[p]` | Camera: 35° FOV, 60° pitch, 16 m wide view, 40% framing, smooth follow + look-ahead, own HQ at bottom | 09da5f3 |
| `[p]` | Portrait game frame (9:21–9:16) with letterbox side panels | e03e36c |
| `[p]` | Input: keyboard (WASD/arrows), mouse-drag and touch floating joystick → quantised `Command` | 62db699 |
| `[p]` | Movement + circle collision against map edges and static obstacle grid | 9c1a8c6 |
| `[p]` | Debug panel skeleton (lil-gui, F1) with live config edits and FPS overlay | bcd174c |
| `[p]` | Determinism test: same seed + commands → same state hash | eef056a |

**Exit criteria:** a primitive champion moves smoothly with keyboard and touch on a desktop and a phone browser; determinism test passes.

---

## M2 — Single-lane feel (~weeks 3–4) → **GATE 1**

Goal: one lane, Alpha vs a bot, to answer *does movement alone feel skilful?* (GDD §13).

Build order (D-024), so each commit is playable: map v2 → centre lane and structures → Health/TargetClass/Weapon/Targeting → auto-targeting → projectiles → damage pipeline → Alpha → death and respawn → MG Soldier waves → structure rules → XP and levels → win/lose → minimal HUD → Ultimate charge → basic draft → bot. Pulled in from M3 in minimal form: respawn formula, solo champion-kill XP and charge, spawn-pad heal. Work happened on `wip/m2` (D-021), merged to `main` in PR #1 (`aff2505`).

| Status | Feature | Hash |
| --- | --- | --- |
| `[p]` | Map v2: The Front from the concept map spec (D-017, D-018): spline lanes, aprons and bases, trench/room/arena walkability rasterised to the grid, SG-01 palette, terrain heights in render; M1 tests move to a fixture map | 280dada |
| `[p]` | Centre lane (Blue and Red trunks + both branches round the Crater), centre Sub-bases at (1, −40) and (−1, 40), both HQs at (0, ∓72), with primitive models per the structures sheet (D-020) | f346375 |
| `[p]` | Health, `TargetClass`, `Weapon`, `Targeting` components | 7637ac4 |
| `[p]` | Auto-targeting exactly per GDD §6 (class order, nearest, tie-break, stickiness, 0.15 s override, 0.2 s retarget pause) + unit tests | 9ce051b |
| `[p]` | Bullet projectiles with swept hit test; aim turn rate and 10° fire cone | 3955850 |
| `[p]` | Damage pipeline in fixed order (TDD §6.4) + unit tests; damage numbers and debug modifiers pulled forward (D-031); random crits (D-032) | b617616, 20f8df9 |
| `[p]` | Alpha: Service Revolver, Steady Hand, Frag Grenade + fire pool; primitive chibi model per the Alpha sheet (D-033) | 64691d5 |
| `[p]` | MG Soldier waves (0:15, every 25 s), lane following, minion targeting, call-for-help; model per the minions sheet (D-035) | f2f9bb3 |
| `[p]` | Structures: aggro rules, warm-up, backdoor protection, HQ invulnerable until a Sub-base falls, regen (D-036) | 0d4a1ea |
| `[p]` | XP sharing (10 m), level table 1–12, stat growth, stat formula + cache; champion-kill XP to the killer (D-037) | 2bee6ad |
| `[p]` | Basic draft: 3-card tray, non-blocking, 10 s auto-pick, Common powers only; stack caps and the 2-offer queue pulled forward (D-041) | 5c157f5 |
| `[p]` | Ultimate charge (passive + kills), `ultTargetable`, Ultimate button: kill charge and the brass gauge (D-040; passive and `ultTargetable` came with Alpha, D-033) | 1f0b4ec |
| `[p]` | Death and respawn at HQ, with the respawn timer formula and spawn-pad heal (D-034) | 496a2d1 |
| `[p]` | One simple bot opponent (farm / trade / retreat), with a simple Ultimate; the default match is you vs the bot (D-042); v2 after playtest: utility modes, wave play and pushes, per-match personality and confidence, random seed per load (D-043) | 5b1b973 |
| `[p]` | Minimal HUD: HP/XP/level, timer, target line, world HP bars; structure icons and score; your team drawn Blue (D-039) | ceaa529 |
| `[p]` | Win/lose on HQ destruction, with a minimal end banner (D-038) | c3445b9 |

**Gate 1 performance pass (D-044, `62aceed`, pushed `[p]`):** busy single-lane scene (seed 11, 15 units) went from 444 draw calls / 201k triangles to 91 / 76k (mobile budget ≤ 120 / ≤ 150k); sim 0.06 ms average, 0.23 ms p99 per tick. The dev perf overlay (`?debug`) shows fps, frame times, draw calls and triangles for the on-device check.

**Gate 1: passed** (user, 2026-11-02).

**Gate 1 exit criteria:** the user plays the single lane and confirms positioning decides trades; holds 60 fps on desktop and a mid-range phone. If the gate fails, fix the core before M3.

---

## M3 — Full map and roster (~weeks 5–7)

Build order (D-046), so each commit is playable: The Front complete → match config and bot slots (default 3v3) → Beta → Gamma → Bazooka Tank and wave composition → Shock Troops → Trenches → line of sight → fog of war → power catalogue → full draft rules → Ultimate charge sources → respawn rest → match phases → The Bridgehead. Work happens directly on `main` (D-045).

| Status | Feature | Hash |
| --- | --- | --- |
| `[p]` | The Front complete: left and right lanes, all 6 Sub-bases, full trench network with every room and arena from MP-01; waves in all three lanes; rooms and arenas are empty walkable shells (D-047) | b317a2d |
| `[p]` | `map-2lane.json`: The Bridgehead from MP-02: river (blocked), two plank bridges, fords (−20% move speed), Behemoth island, trench lattice; lane count 2/3 via `?lanes=` + debug panel, map chosen by lane count (moved here from match config, D-048); lane waypoints skip structure footprints (D-069); medkit trenches end in a lane (D-070), 380e91a; default map since D-071 | 3e50e0a |
| `[p]` | Match config: team size 2v2–5v5 via `?size=` + debug panel, default 3v3 (`match.json`), your lane via `?lane=`; duplicate champions allowed (D-009, D-048) | 9cd0505 |
| `[p]` | Trenches: zones, entries, sandbag walls (`blocksShots`), concealment and reveal-on-fire, medkit rooms; hidden enemies fade out (D-056); sandbag walls later removed (D-061) | 6ed7a33 |
| `[p]` | Line-of-sight ray march for shots; raised jungle ground blocks sight (D-018); blasts and splash get cover (D-057) | 7c0643c |
| `[p]` | Fog of war: per-team vision grid from unit and structure vision radii, Trench brush rules on top, targeting uses team vision, fogged ground darkened, hidden enemies fade out (D-010, D-058); off by default, `?fog` turns it on (D-059) | 13ce21f |
| `[p]` | Beta: Burst SMG, Light Feet, Lead Storm channel + slow; model per the Beta sheet; `?champ=` and a debug picker; bots mix the roster, Beta prefers a side lane (D-049) | eccbf39 |
| `[p]` | Gamma: Flamethrower cone, Charge, Heat Wave aura; model per the Gamma sheet; Gamma bots prefer the centre and cast Heat Wave by the TDD §7 rule (D-050) | a4c14ef |
| `[p]` | Pacing pass (user feedback: matches by about 5 minutes): level cap 25, HQ max HP −25% per lost Sub-base, waves +25%/min, minimal Shock Troops (×3), lighter structures, draft every 2nd level; waves leave a cave behind each HQ single file (D-051) | 4f3b5fc |
| `[p]` | HQ max HP cut is a toggle (`hqHpCutEnabled`), off by default, so it can be tested on and off (D-052) | 22b2f19 |
| `[p]` | Bazooka Tank (rocket splash, structure bonuses), a tank at the back of every second wave; model per the minions sheet (per-minute scaling already in, D-051); GDD 1,100 HP (D-053, D-055) | 550b92a |
| `[p]` | Shock Troops lane upgrade when a Sub-base falls: Shock Troopers, +1 per wave and a tank every wave, all ×3 (D-051); model per the minions sheet (D-054) | 476323b |
| `[p]` | Power catalogue, part 1: the 10 shared Rares and the 6 signature powers as effect records + generic effect systems (weapon mods, statuses, triggers, Ultimate mods); rarity odds pulled forward; debug grant (D-060) | 8e24484 |
| `[p]` | Power catalogue, part 2: the 8 shared Epics (Mortar Support, Attack Drone, War Dog, Tesla Rounds, Minefield, Last Stand, Overcharge, Airstrike Beacon) (D-063) | 3c91a3a |
| `[p]` | Full draft rules: rarity odds, guaranteed Epic at 4/8/12, stack caps, signature slot, queue, reroll, recommendation, Gamma weapon adaptation; offers every level again; Sub-base 3,000 HP (D-064) | 5fd4f4a |
| `[p]` | All Ultimate charge sources: damage dealt/taken vs enemy champions, takedowns with 8 s assists; camp, mini-boss and Behemoth charge come with them in M4 (D-065) | abfbd4a |
| `[p]` | Respawn formula, Redeploy sprint, takedown credit (8 s assists): formula and pad heal (D-034), sprint and assist XP (D-067); Sudden Death ×1.5 moved to match phases | 6a9cc12 |
| `[p]` | Match phases: Deploy, Live, Sudden Death (10:00) with ×1.5 respawn timers (moved here, D-067), time-out rules (13:00), Surrender from 5:00 (D-068) | 7b5a01c |
| `[p]` | All champion slots filled by basic bots, lane assignment spread for any team size and lane count; bots read the nearest enemy champion (D-048) | 9cd0505 |

**Exit criteria:** full matches run start to finish without errors for every team size (2v2 to 5v5) on both maps.

---

## M4 — Neutrals, bots and comeback (~weeks 8–10)

| Status | Feature | Hash |
| --- | --- | --- |
| `[p]` | Neutral camp state machine (Idle/Engaged/Leashing/Dead/Respawning): Deserter Squads (3 or 4 per camp), Sniper Nests, in the spec's dugout rooms; models per the neutrals sheet; camp Ultimate charge +5–8% (moved here, D-065); `neutrals.json`, `map.camps`, reward on clear, sniper aim line (D-073); always visible, spawn at 0:00, retuned so it takes two champions (D-074); HP halved, so only a squad of 4 still takes two (D-077) | b26e4d1, 3c83e66, bb3859c |
| `[p]` | Telegraph events and ground markers (danger red #FF3B30 only): `snap.telegraphs` (circles for grenade, shell and bomb landings, Lead Storm's strip) with a time-to-impact fill; a snapshot list, not an event (D-078) | f27e580, c0eb4fd |
| `[p]` | Halftrack (Supply Drop) and Field Gun (Artillery Support) in their 13 m sunken arenas; models per the bosses sheet: mini-bosses as one-unit camps, the Field Gun (shells at up to 2 attackers), Artillery Support, the whole-team reward, arena dressing, bots path round bosses (D-079); the Halftrack (spray cone, charge strip), cone telegraphs, Supply Drop (D-080); an idle boss wakes only when a champion steps onto its arena floor (D-081) | b2f5959, b13bbb4, 270f3fe |
| `[p]` | Behemoth: spawn at 6:00, in The Crater (Front) and on the river island (Bridgehead); model per the bosses sheet; turret volleys at up to 4 attackers and a steam blast every 3rd attack; capture and the lane push dropped for 15 s invincibility for the killing team (user, D-082) | 5e3d269 |
| `[c]` | Environment dressing per the props and environment sheets: base tents, flags, searchlights, telegraph poles, sandbag revetments, barbed wire, tank traps, craters, wrecked biplanes, edge ruins, river reeds; within SG-01 tri budgets; all merged into the terrain tiles, so no new draw calls; trench walls and duckboards not included (D-097) | 9f8f8d5, 0038aa1, 7e46de3, 8f6858f |
| `[p]` | Utility bot AI: all goals in TDD §7, A* on obstacle grid; done so far: "take camp" in pairs from 0:00 and when the lane is quiet, trench navigation by flow fields on the obstacle grid (D-075); defending another lane's Sub-base or the HQ through a squad board, and backing off when outnumbered (D-083); regrouping after the first Sub-base falls (D-094); contesting bosses (D-095); Beta ganking (D-096) | aec2e81, f601b3a, b5dc074, 279a605, b302bfa |
| `[p]` | Bot dodging, Ultimate and draft logic, difficulty tiers (Easy/Normal/Hard): dodging and draft picks (D-085), the Ultimate rules were already in place; tiers, hesitation per second, one retreat range (D-086); Hard only clearly ahead of Easy on The Bridgehead | e7d99f9, c5bd862 |
| `[p]` | Bounties, level catch-up, underdog charge, HQ last line (D-084) | feee8ce |
| `[p]` | Minimap (LoL style): lanes, structures, allied units, visible enemies only, fogged areas dimmed, pings (D-090) | fd15f8b |
| `[p]` | HUD: top bar structures (D-039), scoreboard, notifications, respawn overlay (D-087) | 4f66ba4 |
| `[p]` | Kill announcements: who killed whom, First Blood, multi-kills, sprees, Shutdown, Ace (user, D-088) | fc78ed0 |
| `[p]` | Base under attack: a sim event for the later voice line, a banner for your side, a pulsing top-bar icon (user, D-089) | 56bda99 |
| `[p]` | Menus: title, match setup (champion, team, lane, team size, lane count, difficulty, seed) (D-091), pause (D-092), results (D-093) | fc83002, c2f041b, 09ce0c5 |

**Exit criteria:** bot matches land near 5 minutes (D-051, user); Normal bots feel like a real 3v3.

---

## M5 — Playtest build (~weeks 11–12) → **GATE 2**

| Status | Feature | Hash |
| --- | --- | --- |
| `[ ]` | GPU particle pool, `vfx.json`, tracers, explosions, smoke, fire, decals | |
| `[ ]` | `assets.json` model registry (primitive models → optional glTF swap, D-020), damage states | |
| `[ ]` | Audio: Howler sprites, event mapping, voice limits, music + Sudden Death crossfade | |
| `[ ]` | Settings: left-handed, hold-to-cast, joystick opacity, reduced effects, colour-blind, volume, show FPS | |
| `[ ]` | Debug panel full: match control, cheats, overlays, perf overlay (perf overlay with draw calls and triangles pulled into Gate 1, D-044) | |
| `[ ]` | Telemetry recorder + JSON export from Results screen | |
| `[ ]` | Replays: command log, keyframes, scrubbing | |
| `[ ]` | `npm run soak` headless bot matches with report | |
| `[ ]` | Playwright smoke test | |
| `[ ]` | Mobile polish: fullscreen, orientation lock / rotate overlay, haptics, audio unlock, safe areas, adaptive pixel ratio | |
| `[ ]` | PWA manifest + service worker | |
| `[ ]` | CI (lint, type-check, tests, 50-match soak) and static deploy | |

**Gate 2 exit criteria (TDD §1 success criteria):**
- 60 fps typical on a mid-range phone browser, never below 30 fps in a full team fight.
- 60 fps at 1080p on desktop integrated graphics.
- Under 5 s load on 4G; initial download under 8 MB.
- Stat changes visible in a running match without reload.
- Same seed + input log → bit-identical result on the same browser.
- Every match exports a telemetry JSON.

---

## Out of scope for this build

Online multiplayer, accounts and meta progression, monetisation, matchmaking, final art and audio, localisation, app-store packaging, native engine port, soft launch (later GDD roadmap phases).
