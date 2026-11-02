import { TICK_HZ, type ChampionConfig, type Config, type StructureKind, type WeaponConfig } from '../data/schema';
import { World, type Entity } from './ecs';
import type { SimEvent } from './events';
import { buildGrid, stampFootprint } from './grid';
import { createStreams, type Streams } from './rng';
import { SpatialIndex } from './spatial';
import { addPct, createStats, Stat, stat, type Stats } from './stats';
import { movementSystem } from './systems/movement';
import { targetingSystem, type TargetingContext } from './systems/targeting';
import { projectileSystem } from './systems/projectiles';
import { weaponsSystem, type WeaponsContext } from './systems/weapons';
import { HitQueue } from './hits';
import { damageSystem, isInvulnerable, type DamageContext } from './damage';
import { DamageLog } from './damage-log';
import { LobPool } from './lobs';
import { ZonePool } from './zones';
import { steadyHandSystem } from './systems/traits';
import { lobSystem, ultimateSystem, zoneSystem, type UltimateContext } from './systems/ultimate';
import { ProjectilePool } from './projectiles';

export type PlayerId = number;
export enum Team {
  Blue = 0,
  Red = 1,
  Neutral = 2,
}

/** What an entity is, so render, UI and bots can tell units apart in snapshots. */
export enum Kind {
  Champion = 0,
  SubBase = 1,
  HQ = 2,
}

/** Auto-target priority class (GDD §6): higher wins. */
export enum TargetClass {
  Neutral = 1,
  Minion = 2,
  SubBase = 3,
  HQ = 4,
  Champion = 5,
}

/** One per player per tick. Move is in world space (D-014), quantised to -127..127. */
export interface Command {
  tick: number;
  player: PlayerId;
  moveX: number;
  moveY: number;
  ult: boolean;
  draftPick: -1 | 0 | 1 | 2;
  reroll: boolean;
}

export interface PlayerSetup {
  team: Team.Blue | Team.Red;
  championId: string;
  /** Spawn here instead of the team's spawn pad (debug/test setups). */
  spawnAt?: { x: number; y: number };
  /** No weapon: never fires (debug dummies, tests). */
  unarmed?: boolean;
}

/** facing: radians, atan2(dy, dx) in sim space (0 = +x, PI/2 = towards Red). */
export interface Transform {
  x: number;
  y: number;
  facing: number;
}
export interface Motion {
  vx: number;
  vy: number;
  speed: number;
  intentX: number;
  intentY: number;
}
export interface Collider {
  radius: number;
}
export interface Champion {
  championId: string;
  player: PlayerId;
  /** This champion's config (refreshed on live edits). */
  def: ChampionConfig;
  /** Level 1–12; 1 until XP arrives (M2 feature 11). */
  level: number;
  /** Ultimate charge, 0–100. */
  ultCharge: number;
  /** The Ultimate's automatic target right now, or 0 (greys the button). */
  ultTargetId: Entity;
  /** The Ultimate was pressed this tick. */
  castQueued: boolean;
  /** Ticks the stick has been at rest (Steady Hand). */
  stillTicks: number;
  /** Fire-rate bonus Steady Hand currently adds (0 when inactive). */
  steadyPct: number;
}
export interface Health {
  hp: number;
  maxHp: number;
  shield: number;
  /** Permanent invulnerability (an HQ until a Sub-base falls). */
  invulnerable: boolean;
  /** Also invulnerable while the tick is below this (after a lethal save). */
  invulnUntil: number;
  /** Lethal hits this unit will survive on 1 HP (Last Stand: once per life). */
  lethalSaves: number;
}
/** A unit's weapon (TDD §5): config values plus the ticks left until it can fire again. */
export interface Weapon extends WeaponConfig {
  cooldown: number;
  /** Chance (0–1) that a shot is a critical hit for `combat.damage.critMultiplier` × damage. */
  critChance: number;
  /** Upper-body aim (radians, like `facing`); turns towards the target at the aim turn rate. */
  aim: number;
}
/** Auto-target state (TDD §6.2), filled by the targeting system. 0 = none. */
export interface Targeting {
  targetId: Entity;
  pendingSwitchId: Entity;
  pendingTicks: number;
  holdTicks: number;
}
/** A Sub-base or HQ. `placement` is its id in `map.structures`. */
export interface Structure {
  kind: StructureKind;
  placement: string;
  lane: string | undefined;
}

export interface EntitySnapshot {
  id: Entity;
  kind: Kind;
  /** Which model to draw: the champion id, or the structure kind. */
  modelId: string;
  team: Team;
  x: number;
  y: number;
  facing: number;
  vx: number;
  vy: number;
  radius: number;
  /** 0 / 0 for entities without health. */
  hp: number;
  maxHp: number;
  shield: number;
  /** Takes no damage right now (permanent or timed). */
  invulnerable: boolean;
  /** Current auto-target, or 0. */
  targetId: Entity;
  /** Upper-body aim (radians); equals `facing` for units without a weapon. */
  aim: number;
  /** Champions: Ultimate charge 0–100, whether it has a target now, and Steady Hand active. */
  ultCharge: number;
  ultTargetable: boolean;
  steady: boolean;
}

/** A grenade in flight: thrown from (x0, y0), lands at (x1, y1) after `total` ticks. */
export interface LobSnapshot {
  id: number;
  team: Team;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  elapsed: number;
  total: number;
  /** Blast radius, for the landing telegraph. */
  radius: number;
  /** Apex height of the arc (render). */
  arcHeight: number;
}

/** A ground zone (fire pool). */
export interface ZoneSnapshot {
  id: number;
  team: Team;
  x: number;
  y: number;
  radius: number;
  elapsed: number;
  total: number;
}

/** A bullet in flight. Velocity is in metres per second. */
export interface ProjectileSnapshot {
  id: number;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Snapshot {
  tick: number;
  entities: EntitySnapshot[];
  projectiles: ProjectileSnapshot[];
  lobs: LobSnapshot[];
  zones: ZoneSnapshot[];
}

export interface StepResult {
  tick: number;
  events: readonly SimEvent[];
}

export function createSim(initialConfig: Config, seed: number, players: PlayerSetup[]) {
  let config = initialConfig;
  const world = new World();
  const transforms = world.store<Transform>();
  const motions = world.store<Motion>();
  const colliders = world.store<Collider>();
  const teams = world.store<Team>();
  const champions = world.store<Champion>();
  const kinds = world.store<Kind>();
  const models = world.store<string>();
  const structures = world.store<Structure>();
  const healths = world.store<Health>();
  const targetClasses = world.store<TargetClass>();
  const weapons = world.store<Weapon>();
  const targetings = world.store<Targeting>();
  const stats = world.store<Stats>();
  const { bounds } = config.map;
  const spatial = new SpatialIndex(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  const rng: Streams = createStreams(seed);
  const events: SimEvent[] = [];
  const playerEntity: Entity[] = [];
  let grid = buildGrid(config.map);
  let tick = 0;

  /** Walkable map plus every structure's footprint (structures never move). */
  function rebuildGrid() {
    grid = buildGrid(config.map);
    for (let i = 0; i < structures.ids.length; i++) {
      const t = transforms.get(structures.ids[i]!)!;
      stampFootprint(grid, t.x, t.y, config.structures[structures.data[i]!.kind].footprint);
    }
  }

  /** Keeps a unit's HP fraction when its max HP changes. */
  function setMaxHp(h: Health, maxHp: number) {
    h.hp = h.maxHp > 0 ? (h.hp / h.maxHp) * maxHp : maxHp;
    h.maxHp = maxHp;
  }

  /** (Re)applies a champion's config: stat bases, then the values derived from them. */
  function applyChampion(e: Entity, def: ChampionConfig) {
    const st = stats.get(e)!;
    st.base[Stat.Damage] = 1;
    st.base[Stat.FireRate] = 1;
    st.base[Stat.MaxHp] = def.maxHp;
    st.base[Stat.MoveSpeed] = def.moveSpeed;
    st.base[Stat.Range] = def.weapon.range;
    st.base[Stat.DamageTaken] = 1;
    st.base[Stat.UltCharge] = 1;
    st.base[Stat.DamageVsChampions] = 1;
    st.base[Stat.DamageVsStructures] = 1;
    st.dirty = true;
    motions.get(e)!.speed = stat(st, Stat.MoveSpeed);
    colliders.get(e)!.radius = def.radius;
    setMaxHp(healths.get(e)!, stat(st, Stat.MaxHp));
    const w = weapons.get(e);
    if (w) Object.assign(w, def.weapon);
  }

  const newHealth = (maxHp: number): Health => ({ hp: maxHp, maxHp, shield: 0, invulnerable: false, invulnUntil: 0, lethalSaves: 0 });
  const newWeapon = (def: WeaponConfig, aim: number): Weapon => ({ ...def, cooldown: 0, aim, critChance: 0 });
  const noTarget = (): Targeting => ({ targetId: 0, pendingSwitchId: 0, pendingTicks: 0, holdTicks: 0 });

  players.forEach((p, player) => {
    const def = config.champions.find((c) => c.id === p.championId);
    if (!def) throw new Error(`Unknown champion "${p.championId}"`);
    const spawn = p.spawnAt ?? (p.team === Team.Blue ? config.map.spawn.blue : config.map.spawn.red);
    const e = world.create();
    transforms.add(e, { x: spawn.x, y: spawn.y, facing: p.team === Team.Blue ? Math.PI / 2 : -Math.PI / 2 });
    motions.add(e, { vx: 0, vy: 0, speed: 0, intentX: 0, intentY: 0 });
    colliders.add(e, { radius: 0 });
    teams.add(e, p.team);
    healths.add(e, newHealth(0));
    stats.add(e, createStats());
    if (!p.unarmed) weapons.add(e, newWeapon(def.weapon, transforms.get(e)!.facing));
    targetings.add(e, noTarget());
    targetClasses.add(e, TargetClass.Champion);
    applyChampion(e, def);
    champions.add(e, { championId: def.id, player, def, level: 1, ultCharge: 0, ultTargetId: 0, castQueued: false, stillTicks: 0, steadyPct: 0 });
    kinds.add(e, Kind.Champion);
    models.add(e, def.id);
    playerEntity[player] = e;
    events.push({ type: 'championSpawned', id: e, player });
  });

  for (const p of config.map.structures) {
    const e = world.create();
    const team = p.team === 'blue' ? Team.Blue : Team.Red;
    transforms.add(e, { x: p.x, y: p.y, facing: team === Team.Blue ? Math.PI / 2 : -Math.PI / 2 });
    colliders.add(e, { radius: config.structures[p.kind].radius });
    teams.add(e, team);
    kinds.add(e, p.kind === 'hq' ? Kind.HQ : Kind.SubBase);
    models.add(e, p.kind);
    structures.add(e, { kind: p.kind, placement: p.id, lane: p.lane });
    const def = config.structures[p.kind];
    healths.add(e, newHealth(def.maxHp));
    weapons.add(e, newWeapon(def.weapon, transforms.get(e)!.facing));
    targetings.add(e, noTarget());
    targetClasses.add(e, p.kind === 'hq' ? TargetClass.HQ : TargetClass.SubBase);
  }
  rebuildGrid();
  spatial.rebuild(healths.ids, transforms);

  const pool = new ProjectilePool();
  const hits = new HitQueue();
  const weaponsContext: WeaponsContext = {
    transforms, motions, colliders, teams, healths, weapons, targetings, stats, pool, events, crit: rng.crit,
    rangeOf: (e) => targetingContext.rangeOf(e),
  };
  const projectileContext = { pool, transforms, colliders, teams, healths, spatial, hits };

  const lobs = new LobPool();
  const zones = new ZonePool();
  const ultimateContext: UltimateContext = {
    champions, transforms, colliders, teams, healths, stats, targetClasses, spatial, lobs, zones, hits, events,
  };
  const damageLog = new DamageLog(config.combat.damage.logSeconds);
  const damageContext: DamageContext = { hits, log: damageLog, healths, stats, kinds, events };

  const targetingContext: TargetingContext = {
    transforms, colliders, teams, healths, targetClasses, targetings, spatial,
    rangeOf: (e) => {
      const st = stats.get(e);
      return st ? stat(st, Stat.Range) : (weapons.get(e)?.range ?? 0);
    },
  };

  /** Percentages set through `debug.setStatPct`, per entity × stat, so they apply as deltas. */
  const debugPct = new Map<number, number>();

  const snap: Snapshot = { tick: 0, entities: [], projectiles: [], lobs: [], zones: [] };

  return {
    world,
    rng,
    get tick() {
      return tick;
    },

    /** Advances exactly one tick. Returned events are valid until the next step. */
    step(commands: readonly Command[]): StepResult {
      if (tick > 0) events.length = 0;
      for (const c of commands) {
        const e = playerEntity[c.player];
        const m = e === undefined ? undefined : motions.get(e);
        if (!m) continue;
        m.intentX = c.moveX / 127;
        m.intentY = c.moveY / 127;
        if (c.ult) champions.get(e!)!.castQueued = true;
      }
      movementSystem(motions, transforms, colliders, grid, config.map.bounds, 1 / TICK_HZ);
      spatial.rebuild(healths.ids, transforms);
      // Structures (aggro rules) and minions get their own targeting with their features.
      steadyHandSystem(champions, motions, stats, healths);
      targetingSystem(champions.ids, targetingContext, config.combat.targeting, tick);
      weaponsSystem(champions.ids, weaponsContext, config.combat.weapons, config.combat.damage.critMultiplier);
      projectileSystem(projectileContext, config.combat.weapons);
      // Existing zones and lobs advance before new casts, so a grenade thrown this tick lands
      // exactly its flight time later and a new fire pool first burns a full period after landing.
      zoneSystem(ultimateContext);
      lobSystem(ultimateContext);
      ultimateSystem(ultimateContext, tick);
      damageSystem(damageContext, config.combat.damage, tick);
      tick++;
      return { tick, events };
    },

    /** Read-only view for render/UI/bots. Objects are reused between calls; copy what you keep. */
    snapshot(): Snapshot {
      snap.tick = tick;
      const ids = transforms.ids;
      snap.entities.length = ids.length;
      for (let i = 0; i < ids.length; i++) {
        const e = ids[i]!;
        const t = transforms.data[i]!;
        const m = motions.get(e);
        const s = (snap.entities[i] ??= {
          id: 0, kind: Kind.Champion, modelId: '', team: Team.Neutral, x: 0, y: 0, facing: 0, vx: 0, vy: 0, radius: 0, hp: 0, maxHp: 0, shield: 0, invulnerable: false, targetId: 0, aim: 0, ultCharge: 0, ultTargetable: false, steady: false,
        });
        s.id = e;
        s.kind = kinds.get(e) ?? Kind.Champion;
        s.modelId = models.get(e) ?? '';
        s.team = teams.get(e) ?? Team.Neutral;
        s.x = t.x;
        s.y = t.y;
        s.facing = t.facing;
        s.vx = m?.vx ?? 0;
        s.vy = m?.vy ?? 0;
        s.radius = colliders.get(e)?.radius ?? 0;
        const h = healths.get(e);
        s.hp = h?.hp ?? 0;
        s.maxHp = h?.maxHp ?? 0;
        s.shield = h?.shield ?? 0;
        s.invulnerable = h ? isInvulnerable(h, tick) : false;
        s.targetId = targetings.get(e)?.targetId ?? 0;
        s.aim = weapons.get(e)?.aim ?? t.facing;
        const c = champions.get(e);
        s.ultCharge = c?.ultCharge ?? 0;
        s.ultTargetable = (c?.ultTargetId ?? 0) !== 0;
        s.steady = (c?.steadyPct ?? 0) > 0;
      }
      let n = 0;
      for (let i = 0; i < pool.capacity; i++) {
        if (!pool.active[i]) continue;
        const p = (snap.projectiles[n++] ??= { id: 0, team: Team.Neutral, x: 0, y: 0, vx: 0, vy: 0 });
        p.id = pool.id[i]!;
        p.team = pool.team[i]! as Team;
        p.x = pool.x[i]!;
        p.y = pool.y[i]!;
        p.vx = pool.vx[i]! * TICK_HZ;
        p.vy = pool.vy[i]! * TICK_HZ;
      }
      snap.projectiles.length = n;
      n = 0;
      for (let i = 0; i < lobs.capacity; i++) {
        if (!lobs.active[i]) continue;
        const l = (snap.lobs[n++] ??= { id: 0, team: Team.Neutral, x0: 0, y0: 0, x1: 0, y1: 0, elapsed: 0, total: 1, radius: 0, arcHeight: 0 });
        const ult = champions.get(lobs.owner[i]!)?.def.ultimate;
        l.id = lobs.id[i]!;
        l.team = lobs.team[i]! as Team;
        l.x0 = lobs.x0[i]!;
        l.y0 = lobs.y0[i]!;
        l.x1 = lobs.x1[i]!;
        l.y1 = lobs.y1[i]!;
        l.elapsed = lobs.elapsed[i]!;
        l.total = lobs.total[i]!;
        l.radius = ult?.radius ?? 0;
        l.arcHeight = ult?.arcHeight ?? 0;
      }
      snap.lobs.length = n;
      n = 0;
      for (let i = 0; i < zones.capacity; i++) {
        if (!zones.active[i]) continue;
        const z = (snap.zones[n++] ??= { id: 0, team: Team.Neutral, x: 0, y: 0, radius: 0, elapsed: 0, total: 1 });
        z.id = zones.id[i]!;
        z.team = zones.team[i]! as Team;
        z.x = zones.x[i]!;
        z.y = zones.y[i]!;
        z.radius = zones.radius[i]!;
        z.elapsed = zones.elapsed[i]!;
        z.total = zones.total[i]!;
      }
      snap.zones.length = n;
      return snap;
    },

    /** Live tuning (dev only): swaps config and re-derives cached values from it. */
    setConfig(next: Config) {
      config = next;
      for (let i = 0; i < champions.ids.length; i++) {
        const e = champions.ids[i]!;
        const def = next.champions.find((c) => c.id === champions.data[i]!.championId);
        if (!def) continue;
        champions.data[i]!.def = def;
        applyChampion(e, def);
      }
      for (let i = 0; i < structures.ids.length; i++) {
        const e = structures.ids[i]!;
        const st = structures.data[i]!;
        const p = next.map.structures.find((m) => m.id === st.placement);
        if (!p) continue;
        const t = transforms.get(e)!;
        t.x = p.x;
        t.y = p.y;
        const def = next.structures[st.kind];
        colliders.get(e)!.radius = def.radius;
        setMaxHp(healths.get(e)!, def.maxHp);
        Object.assign(weapons.get(e)!, def.weapon);
      }
      rebuildGrid();
    },

    /** Spatial index of every unit with health, as of the last step (read-only). */
    spatial,

    /** Bullets in flight (read-only). */
    projectiles: pool,

    /** Grenades in flight and ground zones (read-only). */
    lobs,
    zones,

    /** Every hit through the damage pipeline, at least the last `combat.damage.logSeconds` (read-only). */
    damageLog,

    /**
     * Dev-only cheats for the debug panel, applied between steps. They bypass commands, so a
     * match using them won't replay; replays (M5) will record them as debug commands.
     */
    debug: {
      /** Sets a stat's additive percentage (0.2 = +20%) on a unit with stats. */
      setStatPct(e: Entity, which: Stat, pct: number) {
        const st = stats.get(e);
        if (!st) return;
        const key = e * 64 + which;
        addPct(st, which, pct - (debugPct.get(key) ?? 0)); // a delta, so traits and powers keep theirs
        debugPct.set(key, pct);
        const m = motions.get(e);
        if (m) m.speed = stat(st, Stat.MoveSpeed);
        const h = healths.get(e);
        if (h) setMaxHp(h, stat(st, Stat.MaxHp));
      },
      addShield(e: Entity, amount: number) {
        const h = healths.get(e);
        if (h) h.shield += amount;
      },
      fillUltimate(e: Entity) {
        const c = champions.get(e);
        if (c) c.ultCharge = 100;
      },
      armLethalSave(e: Entity) {
        const h = healths.get(e);
        if (h) h.lethalSaves = 1;
      },
      /** Chance (0–1) that each shot is a critical hit. */
      setCritChance(e: Entity, chance: number) {
        const w = weapons.get(e);
        if (w) w.critChance = chance;
      },
    },

    /** Component stores (read-only outside the sim; for tests, bots-in-sim and debug views). */
    stores: { transforms, colliders, healths, weapons, targetings, targetClasses, stats, teams, kinds, champions, motions },

    /** Current obstacle grid (read-only; for tests and debug overlays). */
    get grid() {
      return grid;
    },

    entityOf(player: PlayerId): Entity | undefined {
      return playerEntity[player];
    },
  };
}

export type Sim = ReturnType<typeof createSim>;
