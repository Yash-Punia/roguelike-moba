# Project Warfront — Technical Design Document (Web Prototype)

Oct 31, 2026 · @Yash Punia

## 1. Overview

This document specifies a browser-playable build of Project Warfront that implements the full Game Design Document (GDD) loop: a 3v3 match on the three-lane Front, with three champions, minions, structures, Trenches, mini-bosses, the power draft and Ultimates. It runs offline in a single browser tab against bots, with keyboard-and-mouse and touch controls, so the design can be playtested before committing to a native mobile engine.

### Goals

1. **Test the design, not the tech.** Answer the GDD's first gate: does movement alone feel skilful, and do matches land at 8 to 10 minutes?
2. **Play anywhere from a link.** One URL that works on a desktop browser and a phone browser, with no install.
3. **Tune without code.** Every number in the GDD lives in data files and can be changed live from a debug panel.
4. **Port-ready simulation.** The game logic is deterministic and separated from rendering, so it can later move to an authoritative server or be re-implemented in Unity or Godot from the same rules.

### Scope (in)

- The full arena from GDD Section 4: 3 lanes, 6 Sub-bases, 2 HQs, 4 Trench zones, 8 camps, Halftrack, Field Gun, Behemoth.
- Alpha, Beta and Gamma with weapons, traits and Ultimates (GDD Section 7).
- MG Soldier, Bazooka Tank and Shock Troops waves (GDD Section 5).
- Auto-targeting exactly as GDD Section 6, structure aggro rules, minion "call for help".
- Levels 1 to 12, XP sharing, the 3-card power draft with the v1 catalogue, Ultimate charge (GDD Section 8).
- Respawn, bounties, catch-up, Sudden Death and time-out (GDD Sections 2 and 9).
- Bots for the other 5 slots, with difficulty tiers.
- PC and mobile controls; portrait HUD.
- Low-poly placeholder art following GDD Section 11, built from primitives and a few simple models.
- Debug panel, match telemetry export, deterministic replays.

### Non-goals (for this build)

- Online multiplayer. The architecture allows it later (Section 3), but the test build is single-player with bots. Local same-device multiplayer is also out of scope.
- Accounts, meta progression, monetisation, matchmaking.
- Final art, final audio, localisation.
- App-store packaging (a Progressive Web App install is enough).

### Success criteria

| Criterion | Target |
| --- | --- |
| Runs on a mid-range phone browser | 60 fps typical, never below 30 fps in a full team fight |
| Runs on a desktop browser | 60 fps at 1080p on integrated graphics |
| Load time | Under 5 s on a 4G connection; initial download under 8 MB |
| Tuning turnaround | Any stat change visible in the running match without a reload |
| Determinism | Same seed and same input log produce the same match result, bit for bit, on the same browser |
| Playtest data | Every match exports a JSON log covering match length, structure fall times, power picks, deaths and Ultimate use |

## 2. Tech stack

The build is a TypeScript single-page app: Three.js renders the 3D world, a small custom entity-component-system (ECS) runs a deterministic simulation, and a Preact overlay draws the HUD. There is no physics engine; collisions and movement are simple 2D circles on the ground plane, which is all the GDD needs. Use the latest stable release of each library at project start and pin versions in the lockfile.

| Layer | Choice | Why | Alternative considered |
| --- | --- | --- | --- |
| Language | TypeScript, `strict` mode | Typed configs and systems catch tuning mistakes early | Plain JavaScript (rejected: data-heavy design) |
| Build and dev server | Vite | Instant hot reload, simple static output, good plugin ecosystem | webpack (slower iteration) |
| 3D rendering | Three.js (WebGL 2) | Small, flexible, huge community; perfect for low-poly flat shading and instancing | Babylon.js (heavier, more batteries included); PlayCanvas (editor-centric) |
| Simulation | Custom lightweight ECS with sparse-set component stores | Deterministic update order, easy to serialise for replays and a future server | bitECS or miniplex (fine, but less control over determinism) |
| Collision and movement | Custom 2D circle colliders + static obstacle grid | Top-down game needs no 3D physics; keeps the sim tiny and deterministic | Rapier or cannon-es (unneeded weight) |
| Pathfinding | A\* on a 0.5 m grid for champions and bots; precomputed lane splines for minions | Map is small and static | Navmesh libraries (overkill) |
| UI / HUD | Preact + CSS, rendered as an HTML overlay | Crisp text, accessible, easy responsive layout, tiny bundle | Drawing UI in WebGL (harder to iterate) |
| Audio | Howler.js over Web Audio | Sprite sheets, mobile unlock handling, pooling | Raw Web Audio API |
| Random numbers | Seeded PRNG (xoshiro128\*\* or mulberry32) | Same seed = same match; required for replays | `Math.random` (forbidden in sim code) |
| 3D assets | Blender → glTF binary (.glb), vertex colours, meshopt compression | Standard web format, small files, flat-shaded look | FBX (not web-native) |
| Debug UI | lil-gui + a custom performance overlay | Live tuning of every config value | Tweakpane (equally good) |
| Tests | Vitest (unit, simulation), Playwright (browser smoke tests) | Fast, Vite-native | Jest |
| Offline / install | vite-plugin-pwa (service worker + manifest) | Playtesters can "Add to Home Screen" and play full screen in portrait | None |
| Hosting | Any static host (Cloudflare Pages, Netlify, GitHub Pages) | No server needed for the offline build | Self-hosted |
| Future netcode | Node.js server running the same `sim` package over WebSockets (for example Colyseus) | Reuses the deterministic sim as the authority | Peer-to-peer lockstep |

## 3. Architecture

The code is split into a pure simulation that knows nothing about the browser, and a client that turns player input into commands and draws whatever the simulation reports. The simulation only ever receives **commands** and only ever produces **state snapshots** and **events**; that one boundary is what makes replays, bots, live tuning and a future server possible.

&#91;embedded content: Architecture · modules and data flow\]

Humans and bots both feed commands into `sim`; everything the player sees and hears is driven from its snapshots and events.

### Modules

| Module | Responsibility | May depend on |
| --- | --- | --- |
| `data` | JSON configs for champions, powers, units, structures, waves, map; TypeScript types and runtime validation | Nothing |
| `sim` | ECS world, all gameplay systems, seeded RNG, bot controllers, event emitter. No DOM, no Three.js, no timers. | `data` |
| `input` | Keyboard/mouse and touch adapters that produce one `Command` per local player per tick | `sim` types only |
| `render` | Three.js scene, camera, models, instancing, VFX; reads snapshots and interpolates between ticks | `sim` types, `data` |
| `ui` | Preact HUD and menus: joystick visuals, Ultimate button, draft cards, minimap, scoreboard | `sim` types, `data` |
| `audio` | Plays sounds in response to sim events | `sim` types |
| `tools` | Debug panel, telemetry recorder, replay recorder and player, performance overlay | Everything (dev builds only) |
| `app` | Boot, loading screen, match setup, main loop wiring | Everything |

### The boundary

```ts
// One command per player per tick (30 Hz). Bots produce the same type.
interface Command {
  tick: number;
  player: PlayerId;      // 0..5
  moveX: number;         // -127..127 (quantised joystick)
  moveY: number;         // -127..127
  ult: boolean;          // pressed this tick
  draftPick: -1 | 0 | 1 | 2;
  reroll: boolean;
}

interface Sim {
  step(commands: Command[]): StepResult;   // advances exactly one tick
  snapshot(): Snapshot;                    // read-only view for render/UI
  setConfig(patch: ConfigPatch): void;     // live tuning (dev only)
}

interface StepResult {
  tick: number;
  events: SimEvent[];   // shot fired, hit, death, level-up, draft offered, structure destroyed...
}
```

### Why this shape

- **Replays:** a match is fully described by its seed, its config and its command log, so a 10-minute replay file is a few hundred kilobytes.
- **Bots are just players:** bot controllers read the snapshot and emit `Command`s, so they exercise exactly the same code paths as humans.
- **Server-ready:** for online play, `sim` runs unchanged on a Node.js server; clients send commands and receive snapshots. Only `input` and `app` change.
- **Engine-portable:** if the production game moves to Unity or Godot, `sim` and `data` are the reference implementation and test oracle for the port.

## 4. Game loop and simulation

The simulation advances in fixed 30 Hz ticks (33.3 ms), while rendering runs at the display's refresh rate and interpolates between the last two ticks. Every system runs in a fixed order each tick, iterating entities by ascending id, so the same inputs always produce the same match.

### Main loop

```ts
const TICK_MS = 1000 / 30;
let acc = 0, last = performance.now();

function frame(now: number) {
  acc += Math.min(now - last, 250);       // clamp after tab switches
  last = now;
  let steps = 0;
  while (acc >= TICK_MS && steps < 5) {   // spiral-of-death guard
    const cmds = [...input.collect(sim.tick), ...bots.collect(sim.snapshot())];
    const { events } = sim.step(cmds);
    recorder.push(cmds, events);
    bus.emit(events);                     // audio, VFX, UI, telemetry
    acc -= TICK_MS; steps++;
  }
  renderer.draw(sim.snapshot(), acc / TICK_MS);   // alpha for interpolation
  requestAnimationFrame(frame);
}
```

- The match pauses automatically when the tab is hidden (offline build only).
- A debug time-scale (0.25× to 4×) changes how fast ticks are consumed, never the tick length.

### Units and coordinates

| Concept | Convention |
| --- | --- |
| Distance | Metres. The map spans x −18 to +18 and y −55 to +55 (GDD Section 4) |
| Sim axes | 2D: x = left/right, y = towards the Red HQ. Blue HQ at (0, −48), Red HQ at (0, +48) |
| Render axes | Three.js: sim x → world x, sim y → world −z, height on world y |
| Time | Ticks. Config values are written in seconds and converted to ticks at load (`round(s × 30)`) |
| Angles | Radians in code, degrees in config |
| Percentages | Written as numbers in config (`15` = 15%) and converted to fractions at load |

### Determinism rules

1. No `Math.random`, `Date`, `performance.now` or timers inside `sim`. All randomness comes from the match's seeded PRNG, split into named streams (`draft`, `ai`, `spread`) so adding one random call does not shift the others.
2. Iterate entities in ascending id order; never iterate an unordered `Set` or object keys whose order could change.
3. Never let `render`, `ui` or `audio` write to sim state.
4. Same-browser determinism is required for this build. Cross-browser determinism (needed only for lockstep netcode) would require replacing `Math.sin`, `Math.cos` and `Math.atan2` with table-based versions; keep all trig behind a `sim/math.ts` wrapper so this is a one-file change.

### Update order (one tick)

1. **Commands:** apply movement intents, Ultimate presses, draft picks and rerolls (bot commands were produced from the previous snapshot).
2. **Spawners and timers:** minion waves, camp and boss respawns, champion respawns, match phase (Sudden Death at 10:00, time-out at 13:00).
3. **Movement and collision:** champions, minions, neutrals, projectiles excluded.
4. **Spatial index:** rebuild the 4 m uniform grid used for all range queries.
5. **Visibility:** Trench concealment and reveal-on-fire.
6. **Targeting:** champions (GDD Section 6), structures (aggro rules), minions (call for help), neutrals (leash).
7. **Weapons:** fire when cooldown is ready: spawn projectiles, apply cone damage, start bursts.
8. **Abilities:** Ultimate casts, channels (Lead Storm), auras (Heat Wave), ground zones (fire pool), power procs (mortars, mines, drones).
9. **Projectiles:** advance, check hits, apply ricochet and pierce.
10. **Damage resolution:** apply modifiers in a fixed order (Section 6), shields, deaths.
11. **Status effects:** burns, slows, buffs, regeneration, expiry.
12. **Rewards:** XP sharing, Ultimate charge, level-ups, draft offers, bounties.
13. **Match state:** structure destruction, HQ vulnerability, lane upgrades to Shock Troops, win and time-out checks.
14. **Cleanup:** remove dead entities, finalise the event list.

## 5. Data model

Everything in a match is an entity made of plain-data components, and every number comes from JSON config files validated at load. Powers are not code: each is a list of small effect records that a handful of generic systems understand, so new powers can be added in data.

### Components

| Component | Fields | Used by |
| --- | --- | --- |
| `Transform` | x, y, facing, aimFacing | All units, projectiles, zones |
| `Motion` | vx, vy, baseSpeed, intentX, intentY | Champions, minions, neutrals |
| `Collider` | radius, solid (blocks movement), blocksShots | Units, structures, sandbag walls |
| `Team` | 0 = Blue, 1 = Red, 2 = Neutral | All |
| `Health` | hp, maxHp, shield, invulnerable | Units, structures |
| `TargetClass` | priority (Champion 5, HQ 4, Sub-base 3, Minion 2, Neutral 1) | Anything that can be shot |
| `Weapon` | kind (bullet, burst, cone, rocket), damage, interval, range, spread, projectileSpeed, cooldown | Champions, minions, structures, neutrals |
| `Targeting` | targetId, pendingSwitchId, pendingTicks | Anything with a `Weapon` |
| `Stats` | per-stat base, flat, pct, mult; dirty flag | Champions (and buffed minions) |
| `Champion` | championId, playerId, level, xp, ultCharge, ultStacks, powers\[\], draftQueue\[\], rerollsLeft, respawnTicks, streak | Champions |
| `Status` | list of {type, magnitude, ticksLeft, sourceId} | Anything that can be burned, slowed or buffed |
| `Projectile` | ownerId, damage, speed, pierceLeft, bouncesLeft, lifeTicks, onHit\[\] | Bullets, rockets, grenades, mortar shells |
| `Zone` | radius, ticksLeft, attachedTo?, effects\[\] | Fire pool, Heat Wave, Lead Storm line, mines |
| `LaneAgent` | lane, waypointIndex, aggroOverrideTicks | Minions, captured Behemoth |
| `Structure` | kind (SubBase, HQ), lane, warmupTargetId, warmupStacks | Structures |
| `Neutral` | campId, homeX, homeY, leashRadius, attackPattern | Camps, mini-bosses |
| `Concealment` | inTrenchZone, revealTicks | Champions, minions |
| `Controller` | human or bot, difficulty | Champions |

### Stat formula

Every champion stat (damage, fire rate, max HP, move speed, range, damage taken, Ultimate charge rate) is computed the same way and cached until a power or buff changes it:

```latex
\text{stat} = (\text{base}_{\text{level}} + \text{flat}) \times (1 + \textstyle\sum \text{pct}) \times \prod \text{mult}
```

Level growth (+5% HP, +4% damage per level) is part of `base`. Additive percentages stack additively (three Rapid Fire picks = +36%); multipliers come only from Epic powers and debuffs such as Heat Wave's −20% damage.

### Config files (`/data`)

| File | Contents |
| --- | --- |
| `match.json` | Tick rate, phase times, respawn formula, Sudden Death and time-out rules |
| `map.json` | Lane splines, structure positions, Trench polygons, obstacle grid, camp and pit positions |
| `champions.json` | Alpha, Beta, Gamma: stats, weapon, trait, Ultimate, signature powers |
| `units.json` | MG Soldier, Bazooka Tank, Shock Troops |
| `structures.json` | Sub-base and HQ stats, warm-up, backdoor protection, aggro rules |
| `neutrals.json` | Camps, Halftrack, Field Gun, Behemoth, rewards, respawn timers |
| `waves.json` | Interval, composition by time, per-minute scaling |
| `progression.json` | XP table, XP sources and sharing radius, Ultimate charge sources, bounties, catch-up |
| `powers.json` | The power catalogue, rarity odds, guaranteed Epic levels, stack caps |

All files are validated with a schema library (for example zod) at load; a bad value fails loudly in the debug console instead of silently breaking a match.

### Example: champion config

```json
{
  "id": "alpha",
  "name": "Alpha",
  "maxHp": 1000, "moveSpeed": 3.5, "radius": 0.5,
  "growth": { "hpPct": 5, "damagePct": 4 },
  "weapon": { "kind": "bullet", "damage": 95, "interval": 0.833, "range": 7, "projectileSpeed": 25 },
  "trait": { "id": "steadyHand", "stillSeconds": 0.5, "fireRatePct": 20 },
  "ultimate": {
    "id": "fragGrenade", "chargeSeconds": 50, "castRange": 9,
    "targetOrder": ["champion", "hq", "subBase", "minion", "neutral"],
    "flightSeconds": 0.6, "radius": 3, "damage": 250, "damagePerLevel": 20,
    "zone": { "radius": 3, "seconds": 4, "dps": 50, "dpsPerLevel": 5, "structurePct": 50 }
  },
  "signaturePowers": ["deadEye", "clusterGrenade"]
}
```

### Example: power configs (effect records)

```json
[
  { "id": "rapidFire", "rarity": "common", "pool": "all", "maxStacks": 3,
    "effects": [{ "type": "stat", "stat": "fireRate", "pct": 12 }] },

  { "id": "doubleTap", "rarity": "rare", "pool": "all", "maxStacks": 2,
    "effects": [{ "type": "weaponMod", "projectiles": 1,
                  "coneFallback": { "widthDeg": 10, "range": 0.5 } }] },

  { "id": "incendiaryRounds", "rarity": "rare", "pool": "all", "maxStacks": 2,
    "effects": [{ "type": "onHit", "apply": { "status": "burn", "dps": 20, "seconds": 2 } }] },

  { "id": "mortarSupport", "rarity": "epic", "pool": "all", "maxStacks": 1,
    "effects": [{ "type": "periodic", "seconds": 6,
                  "action": { "kind": "mortar", "at": "currentTarget", "damage": 150, "radius": 2.5 } }] }
]
```

**Effect types the systems support:** `stat`, `weaponMod`, `onHit`, `onKill`, `onNearbyMinionDeath`, `onLowHp`, `periodic`, `summon` (drone, war dog), `whileMoving` (mines), `conditionalStat` (near structure, in Trench, still), `ultMod` (extra charges, extra bombs, bigger radius), `oncePerLife` (Last Stand). Any v1 power from GDD Section 8 is a combination of these.

## 6. Gameplay systems

Each GDD rule maps to one `sim` system. This section gives the implementation detail a programmer needs; the numbers themselves stay in config (Section 5) and the GDD.

### 6.1 Movement and collision

- **Champions:** velocity = intent direction × move speed × intent magnitude. Intent magnitude is already shaped by the input layer (dead zone, full speed at 60% of the stick).
- **Collision:** circle colliders. Units push each other apart softly (minions yield to champions); structures, sandbag walls and map edges are hard. Static obstacles live in a 0.5 m grid; circles slide along blocked cells.
- **Traits:** Gamma's Charge applies +30% speed when the intent direction is within 45° of the direction to the nearest visible enemy champion within 8 m. Alpha's Steady Hand starts its 0.5 s timer when intent magnitude is zero. Beta's Light Feet checks a "last combat tick" stamp.
- **Minions:** follow the lane's waypoint spline; stop when their target is in range; may leave the lane by up to 6 m to chase, then return. At the Crater, even-numbered spawns take the left branch, odd-numbered the right.
- **Champions and bots off-lane:** A\* on the obstacle grid, used only by bots (humans steer directly).

### 6.2 Targeting

Implements GDD Section 6 exactly.

- Candidates come from the 4 m spatial grid, filtered by alive, enemy team, not invulnerable, visible to the shooter's team (6.9), within range, and line of sight (a grid ray march against `blocksShots` cells).
- Highest priority class wins; nearest within class (distance to collider edge); ties within 0.5 m go to lowest HP%.
- Stickiness: keep the current target while valid and within range + 0.5 m; switch within a class only if the new unit is 1.5 m nearer; a higher class overrides after 5 ticks (≈0.15 s).
- After a kill, re-select immediately but hold fire for 6 ticks (0.2 s).
- **Structures** use the aggro rules from GDD Section 5. "Enemy champion damaged an allied champion in range" is detected from the previous tick's damage log.
- **Minions** target nearest enemy minion, then structure, then champion; a damage-log entry of an enemy champion hitting an allied champion within 6 m sets `aggroOverrideTicks = 90` on nearby minions.

### 6.3 Weapons and projectiles

| Weapon kind | Behaviour |
| --- | --- |
| `bullet` (Alpha, MG Soldier, Sub-base) | One projectile per shot at `projectileSpeed` |
| `burst` (Beta) | Queues N bullets 2 ticks apart, each with random spread from the `spread` stream |
| `cone` (Gamma) | Every 6 ticks, damages every valid enemy inside the cone; ignores `blocksShots` (flames pass over sandbags) |
| `rocket` (Bazooka Tank, Field Gun) | Slower projectile with splash radius |
| `flak` (HQ) | Hits the 2 highest-priority targets in range |

- The weapon's aim turns towards the target at up to 720° per second and fires only when within 10° of it; this reads as the upper body tracking the target.
- Champions fire while moving at full rate.
- Projectile hits use a swept segment-vs-circle test each tick, so fast bullets never pass through targets. Pierce and ricochet are handled at hit time from the projectile's counters.

### 6.4 Damage pipeline

Every hit goes through the same fixed order so powers combine predictably:

1. Base damage from the weapon or effect.
2. Attacker modifiers: damage stat, Bounty Hunter (vs champions), Demolition Expert and Bazooka bonus (vs structures), Heat Wave ±20%, Supply Drop buff.
3. Critical hits (Dead Eye).
4. Target modifiers: damage-taken stat (Flak Vest), Dug In, backdoor protection (−50% on structures without nearby enemy minions), structure resistance of Bazooka Tanks, Tracer Rounds mark (+10%).
5. Shield absorbs first, then HP.
6. Lethal check: Last Stand converts a lethal hit to 1 HP and 45 ticks of invulnerability, once per life.
7. Log the hit (attacker, target, amount, tick) for assists, aggro and telemetry.

### 6.5 Ultimates

- **Charge:** passive gain per tick = 100 / (chargeSeconds × 30), × (1 + Quick Charge and underdog bonuses); event-based gains from `progression.json`. Charge caps at 100, or 200 with Overcharge.
- **Cast check:** an Ultimate with a target order (Alpha, Beta) is castable only when its own target query finds something; the snapshot exposes `ultTargetable` so the UI can grey the button.
- **Frag Grenade:** a ballistic projectile to the target's position at cast time (not homing), 18-tick flight, explodes, spawns a fire-pool `Zone`. Cluster Grenade adds three bomblet sub-projectiles.
- **Lead Storm:** a 90-tick channelled rectangular `Zone` (10 m × 4 m) anchored on Beta, rotating towards her current target at up to 90°/s. Each tick it deals (12 × 20 / 30) = 8 damage to every enemy inside and refreshes a 35% slow for 45 ticks. Beta's move speed is ×0.7 while channelling.
- **Heat Wave:** a 180-tick `Zone` with radius 7 m attached to Gamma; per tick it applies regen and +20% damage to allies inside, burn and −20% damage to enemies inside; structures are excluded.

### 6.6 Minions and waves

- One spawner per lane per team. First wave at tick 450 (0:15), then every 750 ticks (25 s).
- Composition from `waves.json`: 3 MG Soldiers; +1 Bazooka Tank every third wave, every second wave from 5:00; Shock Troops rules when the opposing Sub-base in that lane is down; Artillery Support adds a Bazooka Tank to the next 2 waves.
- Stats scale by +6% HP and damage per elapsed minute at spawn time.

### 6.7 Structures

- Warm-up stacks (+25% per consecutive hit on the same champion, max +100%) reset on target change or after 90 ticks without firing.
- The HQ is `invulnerable` until its team has lost at least one Sub-base. It regenerates 1% max HP per second when no enemy is within 12 m, and gains +50% fire rate below 30% HP.
- On destruction: emit `StructureDestroyed`, leave a rubble collider, update lane spawns, grant 150 XP to the attacking team.

### 6.8 Neutrals and bosses

- Camp state machine: `Idle` → `Engaged` (on first damage) → `Leashing` (if pulled beyond 10 m from home: walk home, invulnerable, heal to full) → `Dead` → `Respawning` (timer) → `Idle`.
- Boss attacks are data-driven patterns: each emits a `Telegraph` event (shape, position, delay ticks) and applies damage when the delay ends, so render can draw the red marker and dodging works.
- Rewards go to the team that lands the killing blow. The captured Behemoth becomes a `LaneAgent` for that team on the centre lane for 1,800 ticks.

### 6.9 Visibility (Trench concealment)

- Trench zones are polygons in `map.json`. Each tick, for each unit, store which zone it is in.
- A unit inside a zone is visible to the enemy team only if an enemy unit is within 3 m, or the unit fired in the last 30 ticks.
- Visibility is a per-team bitset on each entity. Targeting and bots use it; render fades out enemy units not visible to the local player's team.

### 6.10 XP, levels and the draft

- XP from a minion or camp death is split evenly between allied champions within 10 m; boss and structure XP goes to the whole team.
- Level-up pushes a draft onto `draftQueue` and emits `DraftOffered`.
- **Offer generation** (seeded `draft` stream): for each of 3 slots, roll rarity (65/30/5), or force Epic in one slot at levels 4, 8 and 12; draw a power of that rarity not yet at its stack cap and not already in this offer; if no slot is champion-relevant (signature pool or matching weapon tags), replace the last slot with one that is.
- A draft resolves on a `draftPick` command, or after 300 ticks (10 s) with the recommended card: the one with the highest tag overlap with owned powers, ties broken by rarity. If a third draft arrives while two are queued, the oldest is auto-picked.
- Reroll redraws all three cards once per match.

### 6.11 Death, respawn and rewards

- On a champion's death: credit the killer and every champion that damaged it in the last 240 ticks; apply bounty and level catch-up; start the respawn timer (4 s + 1.2 s × level, cap 18 s, ×1.5 in Sudden Death).
- On respawn: place on the HQ pad with the Redeploy sprint status (+50% speed until combat or crossing y = 0 towards the enemy).

### 6.12 Match flow

A single state machine: `Loading` → `Deploy` (0:00 to 0:15) → `Live` → `SuddenDeath` (from 10:00: structures take +50% damage) → `Ended`. At 13:00 the time-out rule decides the winner (higher HQ HP%, then Sub-bases destroyed, then takedowns). In the offline build, Surrender is a single button available from 5:00.

## 7. Bot AI

Bots fill the other five champion slots and must play well enough that a playtest feels like a real 3v3. Because combat is automatic, a bot only decides where to move, when to press the Ultimate and which card to draft; it outputs the same `Command` a human does.

### Decision model

A utility-based selector runs every 6 ticks (0.2 s) per bot, scores each goal from the snapshot, and commits to the best one for at least 1 s unless an emergency (HP below the retreat threshold) fires.

| Goal | Scored higher when | Movement |
| --- | --- | --- |
| Farm lane | Own wave present in assigned lane; no stronger enemy nearby | Stand behind the wave at \~85% of weapon range from the enemy front |
| Trade with champion | Enemy champion in lane; own HP% > enemy HP%; not under enemy structure | Kite: stay at max range (ranged), close in (Gamma) |
| Retreat | HP below threshold, or outnumbered 2v1 | Path to own Sub-base, then HQ |
| Push structure | Allied minions within 10 m of an enemy structure; no defenders | Follow the wave into range |
| Defend | Enemy wave or champion attacking an allied structure | Path to that structure |
| Take camp | Lane cleared; camp alive in an adjacent Trench | Path into Trench, fight camp |
| Contest boss | Boss spawned or below 50% HP; 2+ allies nearby | Group, then attack |
| Gank | Bot is Beta, Light Feet active, an enemy champion below 50% HP in an adjacent lane | Path through a Trench to flank |

### Dodging

Bots read `Telegraph` events (grenade circles, boss markers, Lead Storm lines) and steer out of the shape if they can leave it before it resolves. The dodge chance per difficulty keeps easy bots beatable.

### Ultimate and draft

- **Ultimate:** Alpha and Beta cast when `ultTargetable` and the target is a champion, or when 3+ minions are in the area; Gamma casts when 2+ allied units and 1+ enemy champion are within 7 m, or when his HP is below 40% in a fight.
- **Draft:** score each card by per-champion tag weights (Alpha: damage and crits; Beta: speed, fire rate, on-hit; Gamma: HP, damage reduction, aura and cone) plus synergy with owned powers; pick the best after a random 1 to 3 s delay to mimic a human.

### Lane assignment

At match start, bots take the lanes humans did not choose: Gamma prefers centre, Beta prefers a side lane, Alpha takes what is left. After the first Sub-base falls, bots regroup around the lane with the most allies.

### Difficulty tiers

| Setting | Easy | Normal | Hard |
| --- | --- | --- | --- |
| Decision interval | 12 ticks | 6 ticks | 3 ticks |
| Reaction delay to new threats | 0.6 s | 0.35 s | 0.2 s |
| Retreat threshold | 20% HP | 30% HP | 40% HP |
| Dodge chance | 25% | 60% | 90% |
| Uses Trenches to gank | No | Sometimes | Yes |
| Draft quality | Random among top 2 | Best card | Best card + plans for Epic levels |

## 8. Input: PC and mobile controls

Both control schemes produce the same per-tick `Command` (Section 3), so they can be mixed at any time on any device. The HUD shows touch controls when the last input was a touch, and keyboard hints when it was a key or mouse.

### Control map

| Action | PC (keyboard and mouse) | Mobile (touch) | Gamepad (stretch goal) |
| --- | --- | --- | --- |
| Move | WASD or arrow keys (8 directions, full speed); or drag with the left mouse button anywhere in the game view to use the on-screen joystick | Floating joystick: touch anywhere on the screen that isn't a control | Left stick |
| Ultimate | Space or Q; or click the Ultimate button | Tap the Ultimate button (bottom right) | A or right trigger |
| Pick power card | 1, 2, 3; or click a card | Tap a card | X, Y, B |
| Reroll draft | R | Tap the reroll icon | Left bumper |
| Ping | Alt + click on the minimap (Attack); Alt + Shift + click (Danger) | Long-press the minimap | D-pad |
| Scoreboard | Hold Tab | Tap the timer | View button |
| Pause / menu | Esc | Tap the pause icon | Menu button |
| Debug panel (dev builds) | F1 | Three-finger tap | — |

The mouse-drag joystick lets designers feel the mobile control scheme while testing on a desktop.

### From device input to `Command`

1. Adapters listen to `keydown`/`keyup`, Pointer Events (one API for mouse, pen and touch) and, later, the Gamepad API.
2. Every tick, the input module samples the current state: the move vector is normalised, shaped (dead zone, full speed at 60% of the joystick radius) and quantised to −127..127 per axis.
3. Button presses (Ultimate, card picks, reroll) are latched between ticks, so a press shorter than one 33 ms tick is never lost, then cleared once consumed.
4. Keyboard diagonal movement is normalised so it is not faster than straight movement.

### Touch implementation details

- **Multi-touch:** each control tracks its own `pointerId`. The joystick keeps the pointer that started in its zone, so the other thumb can tap the Ultimate button or a card at the same time.
- **Sizes:** joystick ring radius 60 CSS px, dead zone 8 mm, Ultimate button 22 mm, cards at least 44 × 64 CSS px. Millimetre sizes are converted with a configurable CSS-px-per-mm value (default 3.8) because browsers do not report physical screen size.
- **Browser behaviour to suppress:** `touch-action: none` on the game view, `overscroll-behavior: none` (no pull-to-refresh), `user-select: none`, `-webkit-touch-callout: none`, and a viewport meta tag with `user-scalable=no` and `viewport-fit=cover`. Respect safe-area insets (notches, home bar) with `env(safe-area-inset-*)`.
- **Fullscreen and orientation:** on the first tap, request fullscreen where supported and try `screen.orientation.lock('portrait')` (works on Android in fullscreen, not on iOS Safari). If the phone is held in landscape, show a "Rotate to portrait" overlay and pause. Installed as a PWA, the manifest's `"orientation": "portrait"` handles this.
- **Haptics:** `navigator.vibrate` on Android for level-up, Ultimate ready and big hits; silently unavailable on iOS.
- **Audio unlock:** start the audio context on the first user gesture (browsers block audio before that).
- **Options:** left-handed layout (mirror joystick zone and Ultimate button), hold-to-cast Ultimate (300 ms hold), joystick opacity.

## 9. Rendering, camera, assets, VFX and audio

Rendering follows the low-poly art direction in GDD Section 11 with the cheapest techniques that achieve it: flat-shaded vertex-coloured meshes, one sun light, instanced minions and pooled GPU particles. The renderer only reads snapshots and events; it never changes the game.

### Renderer setup

| Setting | Desktop | Mobile |
| --- | --- | --- |
| Renderer | `WebGLRenderer`, sRGB output | Same |
| Pixel ratio | min(devicePixelRatio, 2) | Starts at min(devicePixelRatio, 1.5); adaptive down to 1.0 if frame time stays above 20 ms |
| Anti-aliasing | MSAA on | Off when pixel ratio ≥ 1.5 |
| Materials | `MeshLambertMaterial` with `flatShading` and vertex colours (or the palette atlas) | Same |
| Lights | 1 directional sun + hemisphere ambient | Same |
| Shadows | Shadow map 2048, cast by champions, structures, bosses and vehicles | Shadow map 1024; minions use blob shadows |
| Post-processing | Optional bloom on emissive fire only; colour grade baked into palette | None (grade baked into palette) |

### Camera

- `PerspectiveCamera`, 35° vertical field of view, pitched 60° down, never rotates or zooms in play (GDD Section 3).
- **Fair framing:** the camera distance is solved each resize so the view is always 16 m wide at the player's position. The game view's aspect ratio is clamped between 9:21 and 9:16; on wider screens (desktops, tablets) the view is letterboxed with side panels (Section 10), so no device sees more of the battlefield.
- Follows the local champion with critically damped smoothing (\~0.15 s) and a 2 m look-ahead in the movement direction; the champion sits 40% up from the bottom of the view.
- If the local player is on Red, the camera is placed on the Red side, looking towards −y, so the player's own HQ is always at the bottom of the screen.
- Camera shake is an additive offset driven by explosion events, disabled by "Reduced effects".

### Models and animation

| Asset | Technique |
| --- | --- |
| Champions | Skinned glTF with `AnimationMixer`: idle, run, fire, Ultimate, hit, knock-out, victory. Upper-body aim by overriding the spine bone's yaw after the mixer update |
| MG Soldiers, Shock Troops | Rigid low-poly meshes in an `InstancedMesh` per team; walking is a procedural bob and sway in the vertex shader; firing is a recoil offset. No skinning, so \~50 soldiers cost a few draw calls |
| Bazooka Tanks, Halftrack, Field Gun | Rigid meshes with separately rotating turret nodes; tread scroll by UV offset |
| Structures | Static meshes with 3 swappable damage-state meshes and a rubble mesh |
| Environment | Modular kit pieces merged into a few static batches at load; repeated props instanced |
| Team colour | A per-instance or per-material colour attribute that replaces a reserved palette slot, so one model serves both teams |

**Placeholder plan:** start with primitives (capsules, boxes, cylinders) in team colours to unblock gameplay in week 1; swap in Blender-made low-poly glTF models, or CC0-licensed low-poly packs as stand-ins, without code changes because models are looked up by id in `assets.json`. Check every third-party pack's licence before use.

### Interpolation and visibility

- Each rendered entity keeps the previous and current tick transforms; positions are lerped and angles slerped by the loop's alpha.
- Enemy units hidden by Trench concealment fade out over 0.2 s and fade back in when revealed.
- Entity create and destroy events map to object pools; nothing is allocated mid-match.

### VFX

- **Particle system:** a custom GPU particle pool built on `InstancedMesh`. Each instance stores spawn time, velocity, colour, size curve and lifetime as attributes; the vertex shader animates it from a global time uniform, so the CPU only writes data at spawn.
- **Data-driven:** `vfx.json` maps sim events (`ShotFired`, `Hit`, `Explosion`, `ZoneStarted`, `LevelUp`, `StructureDestroyed`...) to emitter presets: mesh (star, cube, icosphere, flame cone), count, colours, curves.
- **Tracers:** instanced stretched quads in team colour, one per projectile.
- **Telegraphs:** flat ground meshes in danger red with a fill animation showing time to impact, rendered after the ground and before units, always on top of other ground effects.
- **Decals:** pooled scorch marks and craters (max 64, oldest recycled).
- **HP bars and damage numbers:** WebGL billboards (instanced bars; damage digits from a small bitmap-font atlas), not DOM elements, so 60+ bars cost one or two draw calls.
- **Budget:** at most 2,000 live particles on mobile (4,000 desktop); "Reduced effects" halves counts.

### Audio

- Howler.js with audio sprites per category (weapons, impacts, voice lines, UI); Opus-in-WebM files with MP3 fallback.
- Simple 2D spatialisation: pan by horizontal offset from the camera and attenuate with distance; sounds more than 20 m away are culled.
- Voice limits: max 24 simultaneous sounds; per-sound rate limits (for example, at most 6 MG shots per 100 ms) to avoid noise walls in team fights.
- Music: looping march track with a crossfade to a Sudden Death variant.

### Loading

All assets load behind a loading screen using `GLTFLoader` with the meshopt decoder and are cached by the service worker; target under 8 MB total for the first match.

## 10. UI and HUD

The UI is a Preact overlay on top of the WebGL canvas, laid out inside a portrait game frame that is the same shape on every device. On a phone the frame fills the screen; on a desktop it sits in the centre with a controls panel on the left and, in dev builds, the tuning panel on the right.

### Screens

| Screen | Contents |
| --- | --- |
| Title | Play, Settings, How to play |
| Match setup | Pick champion (Alpha, Beta, Gamma), team (Blue/Red), preferred lane, bot difficulty, optional seed; "Quick match" uses defaults |
| Loading | Progress bar, tips, controls reminder for the detected device |
| Match | HUD (below) |
| Pause | Resume, Settings, Surrender (from 5:00), Quit |
| Results | Win or loss, match length, per-champion stats (takedowns, damage, XP, powers picked), "Export telemetry", "Save replay", "Play again" |
| Settings | Left-handed layout, hold-to-cast, joystick opacity, reduced effects, colour-blind mode, volume sliders, show FPS |

### HUD components (match screen)

| Component | Implementation |
| --- | --- |
| Top bar | Timer, each team's structure icons with HP pips, takedown score. Re-rendered at 10 Hz from the snapshot |
| Minimap | A `<canvas>` 2D strip, top right, redrawn at 10 Hz: lanes, structures, champions visible to your team, bosses, pings |
| Joystick | Two absolutely positioned circles; position updated directly through refs every frame (no Preact re-render) |
| Ultimate button | Brass-gauge SVG with a `stroke-dashoffset` charge ring; greyed with a "no target" icon when `ultTargetable` is false |
| HP and XP | Own HP bar, level badge with rank chevrons, XP bar along the bottom |
| Draft tray | Three cards slide up above the joystick on `DraftOffered`; 10 s timer bar; queue badge ("+1"); reroll icon. Never blocks input to the game |
| Notifications | Short banner for events: "Sub-base destroyed", "Behemoth has awoken", "Sudden Death" |
| Respawn overlay | Countdown and the killer's portrait |
| Scoreboard | All six champions: level, takedowns, deaths, powers (icons) |
| Keyboard hints | Small key labels on the Ultimate button and cards ("Space", "1/2/3") when the last input was a keyboard |

World-space elements (HP bars over units, damage numbers, target line, telegraphs) are drawn in WebGL (Section 9), not in the DOM.

### Layout rules

- The game frame is a CSS grid cell with `aspect-ratio` clamped between 9/21 and 9/16. HUD sizes use container query units (`cqw`, `cqh`) so the HUD scales with the frame, not the window.
- Safe-area insets pad the top bar and the bottom controls on notched phones.
- Touch targets are at least 44 × 44 CSS px; text at least 14 CSS px at the smallest frame size.
- The desktop side panels show: controls legend and match info (left); debug and tuning panel (right, dev builds only).

### State flow

`app` subscribes to the sim's event bus and copies the few values the HUD needs into a small reactive store (Preact signals). Fast-changing visuals (joystick, Ultimate ring) bypass the store and update DOM styles directly to avoid re-render cost on mobile.

## 11. Debug tools, telemetry and testing

This build exists to answer design questions, so tuning and measurement tools are first-class features, not afterthoughts. Dev builds include everything below; the playtest build keeps telemetry and a reduced debug panel behind a URL flag (`?debug=1`).

### Debug panel (lil-gui)

- **Live tuning:** every value in `/data` exposed as sliders and fields, grouped by file; changes apply through `sim.setConfig` on the next tick. "Export config" downloads the edited JSON to commit back to the repo.
- **Match control:** pause, step one tick, time scale 0.25× to 4×, restart with the same seed, jump to minute N (fast-forward with bots).
- **Cheats:** set level, grant a specific power, fill Ultimate, god mode, kill all minions, spawn any unit or boss at the cursor, destroy a structure.
- **Overlays:** weapon ranges, current target lines for all units, target priority labels, Trench zones and visibility, lane splines, A\* paths, bot goal labels, spatial grid, collider circles.
- **Performance overlay:** FPS, frame time, sim time per tick, draw calls, triangles, live particles, JS heap.

### Telemetry

The `tools/telemetry` module listens to sim events and builds one JSON record per match, downloadable from the Results screen and optionally POSTed to a configurable endpoint (for example a simple serverless function or form backend) when playtesters opt in.

| Field | Purpose (GDD target it checks) |
| --- | --- |
| Match length, winner, end reason | 8 to 10 minute median; under 10% time-outs |
| Structure destruction times by lane | Pacing of the laning and push phases |
| Level by minute per champion | XP curve: level 12 at about 7 to 8 minutes |
| Every draft offer and pick (with timeouts) | No power picked in over 40% of offers it appears in; how often the timer auto-picks |
| Deaths with position, killer and cause | Hot spots, unfair deaths, Trench ambushes |
| Ultimate casts, targets hit, charge sources | Ultimate frequency and impact |
| Distance moved and time standing still | Whether movement is actually the skill |
| Device, input scheme, average FPS | Performance and control-scheme comparisons |

### Replays

A replay file stores the build version, config hash, seed and the command log. Loading it re-runs the sim from tick 0 with free camera and timeline scrubbing (scrubbing re-simulates from the nearest stored keyframe snapshot, saved every 10 s). Replays are only valid for the same build and config, which the file checks.

### Automated tests

| Level | Tool | Examples |
| --- | --- | --- |
| Unit | Vitest | Target selection order and stickiness; damage pipeline order; stat formula; draft offer rules (guaranteed Epic, stack caps, champion-relevant slot); XP sharing; respawn formula |
| Simulation | Vitest, headless `sim` | Scripted scenarios: "Alpha in range of a champion and a minion shoots the champion"; "HQ is invulnerable until a Sub-base falls"; "Lead Storm slows everything in its line" |
| Determinism | Vitest | Run the same seed and commands twice and compare state hashes every 300 ticks |
| Soak | Node script | 1,000 bot-vs-bot matches headless at full speed; report match length distribution, champion win rates, crash count |
| Browser smoke | Playwright | Load the build, start a quick match, simulate touch and keyboard input, assert no console errors and a minimum FPS on CI hardware |

The headless soak run is also the fastest balancing tool: it estimates champion win rates and match length after every config change, before any human playtest.

## 12. Performance, build and deployment

The build must hold 60 fps on a mid-range phone, so every system has a budget, and the deployment is a static site anyone can open from a link.

### Frame budget (mobile, 16.7 ms frame)

| Area | Budget |
| --- | --- |
| Simulation (amortised; 30 Hz ticks) | ≤ 2 ms per frame (≤ 4 ms per tick) |
| Render submission (CPU) | ≤ 4 ms |
| GPU | ≤ 9 ms |
| UI, input, audio | ≤ 1 ms |
| Garbage collection | No allocations in the per-tick and per-frame paths; pools for entities, projectiles, particles, events |

### Scene budget

| Item | Mobile | Desktop |
| --- | --- | --- |
| Draw calls | ≤ 120 | ≤ 250 |
| Triangles on screen | ≤ 150,000 | ≤ 400,000 |
| Live units | \~70 (6 champions, \~50 minions, camps, bosses) | Same |
| Live particles | ≤ 2,000 | ≤ 4,000 |
| Texture memory | ≤ 32 MB | ≤ 64 MB |

### Build

- `npm run dev`: Vite dev server with hot reload; config JSON hot-reloads into a running match.
- `npm run build`: production bundle with code splitting (`tools` excluded unless `--mode playtest`), meshopt-compressed models, hashed filenames.
- `npm run test`, `npm run soak`, `npm run e2e`: unit and simulation tests, headless bot soak, Playwright smoke tests.
- CI (for example GitHub Actions): lint, type-check, tests and a 50-match soak on every push; deploy a preview URL for every branch so designers can test changes from a phone.

### Deployment

- Static hosting on any CDN-backed host; each build gets its own preview URL, and `main` deploys to the playtest URL.
- PWA manifest (`display: fullscreen`, `orientation: portrait`, icons) and a service worker that caches the build for offline play.
- The build version and config hash appear on the title screen and in every telemetry record and replay.

### Browser and device support

| Platform | Browsers | Notes |
| --- | --- | --- |
| Android 10+ | Chrome, Samsung Internet, Firefox | Full: fullscreen, orientation lock, vibration |
| iOS / iPadOS 16+ | Safari (all iOS browsers use WebKit) | No orientation lock or vibration; recommend "Add to Home Screen" for full-screen play |
| Windows, macOS, Linux | Chrome, Edge, Firefox, Safari (latest two versions) | Keyboard and mouse; touchscreen laptops get touch controls too |
| Minimum | WebGL 2 | Show a clear message on devices without it |

Reference test devices: one recent flagship, one 3 to 4 year-old mid-range Android, one older iPhone, and a laptop with integrated graphics.

## 13. Project structure, milestones, risks and open questions

### Repository layout

```
warfront-web/
├─ data/                  # JSON configs (Section 5), the single source of numbers
├─ assets/                # .glb models, audio sprites, fonts, icons
├─ src/
│  ├─ sim/                # pure TS: ecs/, systems/, bots/, rng.ts, math.ts, events.ts
│  ├─ data/               # config types, zod schemas, loaders, unit conversion
│  ├─ input/              # keyboard.ts, pointer-joystick.ts, gamepad.ts, command-builder.ts
│  ├─ render/             # scene.ts, camera.ts, models.ts, instancing.ts, vfx/, telegraphs.ts
│  ├─ ui/                 # Preact components: hud/, draft/, menus/, minimap.ts
│  ├─ audio/              # sound bank, event → sound mapping
│  ├─ tools/              # debug panel, overlays, telemetry, replay
│  └─ app/                # boot, loop, match setup
├─ tests/                 # unit, scenario, determinism tests
├─ scripts/               # soak.ts (headless bot matches), asset pipeline
└─ e2e/                   # Playwright smoke tests
```

### Milestones

Five milestones over about 12 weeks for a team of one to two programmers and one artist; the end of milestone 2 is the GDD's first gate (movement feels skilful), the end of milestone 5 is the playtest build.

&#91;embedded content: Milestones · 5 milestones, 2 gates\]

Milestone 2 is deliberately small: it proves the single-lane feel before the full map, other champions and bosses are built.

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Mobile browser performance varies widely | Low FPS ruins the feel test | Budgets from day one; adaptive pixel ratio; instanced minions; test weekly on the old mid-range reference phone |
| iOS Safari limits (no orientation lock, no vibration, audio unlock, address bar resizing) | Awkward first impression on iPhones | PWA install prompt; rotate overlay; `dvh` units; unlock audio on first tap |
| Touch input conflicts with browser gestures | Accidental zoom, scroll or back-swipe | `touch-action`, `overscroll-behavior`, margins away from screen edges |
| Determinism breaks silently | Replays and soak results become unreliable | Determinism test in CI; lint rule banning `Math.random` and `Date` in `sim/` |
| Bots too weak or too strong | Playtest data reflects bots, not design | Difficulty tiers; soak reports; let testers pick difficulty and record it in telemetry |
| Web build diverges from the future native game | Lessons do not transfer | Keep all rules in `data` and `sim`; treat them as the spec and test oracle for the port |

### Open questions

- Should a minimal online 1v1 or 3v3 test (Node server running `sim`) be added after milestone 5, or is bot play enough for the first rounds of testing?
- Do we capture playtest telemetry automatically (needs a small backend and a consent screen) or rely on manual JSON export?
- Which engine will the production mobile game use? It affects whether `sim` math should move to fixed-point now.
- Who produces the low-poly models: in-house in Blender, or CC0 stand-ins first?
