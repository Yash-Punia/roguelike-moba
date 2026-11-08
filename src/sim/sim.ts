import { TICK_HZ, type CampKind, type ChampionConfig, type Config, type StructureKind, type WeaponConfig } from '../data/schema';
import { World, type Entity } from './ecs';
import type { SimEvent } from './events';
import { buildGrid, rayBlocked, stampFootprint } from './grid';
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
import { traitSystem, type TraitContext } from './systems/traits';
import { deathSystem, medkitSystem, padHealSystem, respawnSystem, sprintSystem, supplySystem, type LifeContext } from './systems/life';
import { emptyMods, foldMods, type PowerMods } from './powers';
import { MinePool } from './mines';
import { epicSystem, type EpicContext } from './systems/epics';
import { summonDeathSystem, summonSystem, type SummonContext } from './systems/summons';
import { statusSystem, type StatusContext } from './systems/status';
import { createVision, SEEN_BY_ALL, visibilitySystem, visibleTo, type Vision, type VisibilityContext } from './systems/visibility';
import { damageChargeSystem, grantXp, progressionSystem, xpForLevel, type ProgressionContext } from './systems/progression';
import { applyPower, draftSystem, recommended, regenSystem, type DraftContext, type DraftOffer } from './systems/draft';
import {
  callForHelpSystem, minionDeathSystem, minionSystem, separationSystem, spawnFromCaves, spawnWave, waveDue, waveLength, type MinionContext,
} from './systems/minions';
import { buildLanes, type LanePath } from '../data/map-geometry';
import {
  backdoorSystem, baseAlertSystem, lastLineSystem, structureDeathSystem, structureRegenSystem, structureTargetingSystem, underdogCharge, updateHqGate, warmupShot,
  type StructureContext,
} from './systems/structures';
import { auraRadius, heatWaveMult, heatWaveSystem, leadStormSystem, lobSystem, ultimateSystem, zoneSystem, type UltimateContext } from './systems/ultimate';
import { ProjectilePool } from './projectiles';
import { BossAttack, campAggroSystem, campDeathSystem, campSystem, CampState, createCamps, type CampContext, type Neutral } from './systems/camps';
import { bossSystem } from './systems/bosses';

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
  Minion = 3,
  /** A champion's companion (War Dog, D-063). */
  Summon = 4,
  /** A neutral camp unit (Deserter, Sniper; D-073). */
  Neutral = 5,
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
  /** Concede the match (from `phases.surrenderFromSeconds`; humans only, bots abstain). */
  surrender?: boolean;
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
  /** Ticks left on a slow (Lead Storm), and its speed factor while it lasts. */
  slowTicks: number;
  slowMult: number;
  /** Speed factor while channelling (Lead Storm ×0.7); 1 otherwise. */
  channelMult: number;
}
export interface Collider {
  radius: number;
}
export interface Champion {
  championId: string;
  player: PlayerId;
  /** This champion's config (refreshed on live edits). */
  def: ChampionConfig;
  /** Level 1–12 (GDD §8), and the total XP earned. */
  level: number;
  xp: number;
  /** Ultimate charge, 0–100. */
  ultCharge: number;
  /** The Ultimate's automatic target right now, or 0 (greys the button). */
  ultTargetId: Entity;
  /** The Ultimate was pressed this tick. */
  castQueued: boolean;
  /** Ticks the stick has been at rest (Steady Hand). */
  stillTicks: number;
  /** The bonus its trait currently adds (Steady Hand fire rate, Light Feet move speed; 0 when inactive). */
  traitPct: number;
  /** Ticks left in a channelled Ultimate (Lead Storm, windup included); 0 when not channelling. */
  channelTicks: number;
  /** Where the channel's strip points (radians, like `facing`). */
  channelAngle: number;
  /** Ticks left on an aura Ultimate (Heat Wave); 0 when none. */
  auraTicks: number;
  /** Ticks until redeploying; 0 while alive. */
  respawnTicks: number;
  /** Owned powers: stacks per power id (read through the catalogue's order, never iterated). */
  powers: Record<string, number>;
  /** Draft offers: the front one is live, the rest wait (TDD §6.10). */
  draftQueue: DraftOffer[];
  /** A `draftPick` slot from this tick's command, or −1. */
  pickQueued: number;
  /** A reroll was sent this tick, and free rerolls left this match (GDD §8 rule 6). */
  rerollQueued: boolean;
  rerollsLeft: number;
  /** Last tick it dealt or took damage (Field Medic's out-of-combat clock). */
  lastCombatTick: number;
  /** Champion takedowns landed and times knocked out this match. */
  kills: number;
  deaths: number;
  /** Takedowns it assisted (damage on the victim within `assistSeconds`, not the last hit). */
  assists: number;
  /** Takedowns (kills and assists) since it was last knocked out: its bounty (GDD §9, D-084). */
  streak: number;
  /** Damage it has dealt this match (D-093). */
  damageDealt: number;
  /** Redeploy sprint: the move speed pct it has applied right now (0 = none), and the tick it last respawned. */
  sprintPct: number;
  respawnTick: number;
  /** Supply Drop (D-080): ticks left, and the damage and move speed pcts it has applied (0 = none). */
  supplyTicks: number;
  supplyDamagePct: number;
  supplySpeedPct: number;
  /** Debug/test spawn point to respawn at instead of the team's HQ pad. */
  spawnAt: { x: number; y: number } | undefined;
  /** Tick it last cast its Ultimate (reveals it in a Trench); −1 before the first. */
  lastCastTick: number;
  /** Owned powers folded into what the systems read (D-060). */
  mods: PowerMods;
  /** Second Wind is ready again from this tick. */
  lowHpReadyAt: number;
  /** The conditional stat pct it has applied right now (Dug In), removed as a delta. */
  dugInApplied: number;
  /** Epic power clocks (D-063): ticks to the next mortar shell and mine, weapon hits towards the next Tesla chain. */
  mortarWait: number;
  mineWait: number;
  teslaHits: number;
  /** Its War Dog (0 = none), and the tick the dog may come back from. */
  dogId: Entity;
  dogRespawnAt: number;
}
/** A War Dog (D-063): whose it is, and ticks until it can bite again. */
export interface Summon {
  owner: Entity;
  biteWait: number;
}
/** Timed effects on a champion or minion (TDD §5 statuses, D-060): a burn, a damage-taken mark, a timed shield and a stat buff. */
export interface Status {
  burnDps: number;
  burnTicks: number;
  burnSource: Entity;
  markPct: number;
  markTicks: number;
  /** What is left of a timed shield grant; removed from the unit's shield when it runs out. */
  shieldLeft: number;
  shieldTicks: number;
  buffStat: Stat;
  buffPct: number;
  buffTicks: number;
}
/** Trench concealment (TDD §5, §6.9): champions and minions. */
export interface Concealment {
  /** Trench zone it stands in (0 = none). */
  zone: number;
  /** Teams that can see it this tick, one bit per `Team`. */
  visible: number;
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
  /** Source of the hit that took the last HP (0 while alive or with no source). */
  killer: Entity;
}
/** A unit's weapon (TDD §5): config values plus the ticks left until it can fire again. */
export interface Weapon extends WeaponConfig {
  cooldown: number;
  /** Chance (0–1) that a shot is a critical hit for `combat.damage.critMultiplier` × damage. */
  critChance: number;
  /** Upper-body aim (radians, like `facing`); turns towards the target at the aim turn rate. */
  aim: number;
  /** Bullets of the current burst still to fire, ticks until the next, and the burst's target. */
  burstLeft: number;
  burstWait: number;
  burstTarget: Entity;
  /** Tick of the last shot or flame (render shows Gamma's flames from it); −1 before the first. */
  lastShotTick: number;
  /** Shots fired (Dead Eye's every Nth shot), and ticks until a cone may leave burning ground again (Napalm Tank). */
  shotCount: number;
  groundWait: number;
}
/** Auto-target state (TDD §6.2), filled by the targeting system. 0 = none. */
export interface Targeting {
  targetId: Entity;
  pendingSwitchId: Entity;
  pendingTicks: number;
  holdTicks: number;
}
/** A lane minion's march state (TDD §5 `LaneAgent`). */
export interface LaneAgent {
  unit: keyof Config['units'];
  /** Index into the built lanes, and which way through its branches. */
  lane: number;
  branch: number;
  /** Next waypoint along the route (counted from its own team's end). */
  waypoint: number;
  /** Place in the wave's row: metres to the right of the route. */
  offset: number;
  /** Call-for-help target and ticks left on it (GDD §5). */
  helpTarget: Entity;
  helpTicks: number;
}

/** A Sub-base or HQ. `placement` is its id in `map.structures`. */
export interface Structure {
  kind: StructureKind;
  placement: string;
  lane: string | undefined;
  /** Warm-up (GDD §5): stacks against `warmupTarget`, reset after a pause in firing. */
  warmupStacks: number;
  warmupTarget: Entity;
  ticksSinceShot: number;
  /** No enemy minion near this tick: takes the backdoor reduction. */
  backdoor: boolean;
  /** Second target of a two-target weapon (HQ flak), or 0. */
  secondaryId: Entity;
  /** Fell this match: rubble from now on. */
  destroyed: boolean;
  /** HQ last line (GDD §9, D-084): fell below its threshold once, so it fires faster for the rest of the match. */
  lastLine: boolean;
  /** The last tick an enemy hit it, and the first tick it may raise the alert again (D-089). */
  lastHitTick: number;
  nextAlertTick: number;
}

export interface EntitySnapshot {
  id: Entity;
  kind: Kind;
  /** Which model to draw: the champion id, or the structure kind. */
  modelId: string;
  team: Team;
  /** Minions and Sub-bases: the `map.lanes` id they belong to; '' for everything else. */
  lane: string;
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
  /** Structures: fell this match (rubble). */
  destroyed: boolean;
  /** Structures: an enemy hit it within `underAttackSeconds` (D-089). */
  underAttack: boolean;
  /** Current auto-target, or 0. */
  targetId: Entity;
  /** Upper-body aim (radians); equals `facing` for units without a weapon. */
  aim: number;
  /** Champions: level, total XP, and the XP totals where this level starts and the next begins. */
  level: number;
  xp: number;
  xpLevelStart: number;
  xpLevelEnd: number;
  /** Champions: ticks until redeploying (0 = alive) and who landed the knock-out (0 = none). */
  respawnTicks: number;
  killer: Entity;
  /** Champions: the live draft offer (empty when none), its timer, the highlighted slot and offers waiting behind it. */
  draftCards: readonly string[];
  draftTicksLeft: number;
  draftRecommended: number;
  draftQueued: number;
  /** Champions: free draft rerolls left this match. */
  draftRerolls: number;
  /** Champions: owned power stacks by id (read-only). */
  powers: Readonly<Record<string, number>>;
  /** Champions: takedowns landed and times knocked out. */
  kills: number;
  deaths: number;
  /** Champions: takedowns since it was last knocked out (its bounty, D-084). */
  streak: number;
  /** Champions: damage dealt this match (D-093). */
  damageDealt: number;
  /** Champions: takedowns assisted, and whether the Redeploy sprint is on. */
  assists: number;
  sprinting: boolean;
  /** Champions: Supply Drop is on (D-080). */
  supply: boolean;
  /** Champions: Ultimate charge 0–100, whether it has a target now, and its trait active (Steady Hand, Light Feet). */
  ultCharge: number;
  ultTargetable: boolean;
  /** What the Ultimate would hit right now (0 = nothing in range). */
  ultTargetId: Entity;
  traitActive: boolean;
  /** Lead Storm: 0 none, 1 windup (strip shown, no damage), 2 firing; and where the strip points. */
  channel: 0 | 1 | 2;
  channelAngle: number;
  /** Moving slower from a slow (Lead Storm). */
  slowed: boolean;
  /** Heat Wave ticks left (0 = none), and whether its weapon fired within its interval (Gamma's flames). */
  aura: number;
  firing: boolean;
  /** Heat Wave's radius (Inferno Shell widens it); 0 for other Ultimates. */
  auraRadius: number;
  /** Teams that can see it, one bit per `Team` (Trench concealment); every bit for structures. */
  visibleMask: number;
}

/** A Minefield mine. */
export interface MineSnapshot {
  team: Team;
  x: number;
  y: number;
  armed: boolean;
}

/** A Trench medkit crate (`map.medkits` order). */
export interface MedkitSnapshot {
  x: number;
  y: number;
  ready: boolean;
}

/** A neutral camp (`map.camps` order): its living units' HP and what it is doing (bots, D-075). */
export interface CampSnapshot {
  x: number;
  y: number;
  kind: CampKind;
  /** Living units; 0 while it waits to respawn. */
  members: number;
  hp: number;
  maxHp: number;
  /** Fighting someone, or walking home invulnerable. */
  engaged: boolean;
  leashing: boolean;
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
  /** Apex height of the arc (render). */
  arcHeight: number;
}

/**
 * A red ground marker before a big hit (GDD §10, D-078): a circle (grenade, shell and bomb
 * landings), a strip (Lead Storm, the Halftrack's charge) or a cone (its spray, D-080). Derived
 * from sim state every tick, so render and bots always read the current shape.
 */
export interface TelegraphSnapshot {
  team: Team;
  shape: 'circle' | 'strip' | 'cone';
  /** The circle's centre, or where the strip or cone starts. */
  x: number;
  y: number;
  /** The strip's or cone's direction (radians). */
  angle: number;
  /** The circle's radius, or the cone's length. */
  radius: number;
  /** The cone's full width (radians). */
  arc: number;
  length: number;
  width: number;
  /** The entity the shape moves with (the Lead Storm caster), 0 if fixed. */
  anchor: number;
  /** Ticks since it appeared, out of `total` to impact; `elapsed >= total` is a live damage area. */
  elapsed: number;
  total: number;
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
  /** What fired it (minion bullets draw smaller). */
  ownerKind: Kind;
  /** Damage multiplier added at fire time (structure warm-up, 1–2): drawn brighter and bigger. */
  boost: number;
  /** A rocket (it splashes): drawn as a heavier round. */
  rocket: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Match state (TDD §6.12, D-068): `deploy` until the first wave, `live`, `suddenDeath` from
 * `phases.suddenDeathSeconds`, then `ended` with the winner (undefined: a draw, or still playing)
 * and why.
 */
export interface MatchState {
  phase: 'deploy' | 'live' | 'suddenDeath' | 'ended';
  winner: Team | undefined;
  reason: 'hq' | 'timeout' | 'surrender' | undefined;
  /** Tick the match ended on (0 while playing). */
  endTick: number;
  /** A surrender would be accepted now. */
  canSurrender: boolean;
}

export interface Snapshot {
  tick: number;
  match: MatchState;
  entities: EntitySnapshot[];
  projectiles: ProjectileSnapshot[];
  lobs: LobSnapshot[];
  /** Ground telegraphs: lob landings in slot order, Lead Storm strips in champion order, then mini-boss windups in map order. */
  telegraphs: TelegraphSnapshot[];
  zones: ZoneSnapshot[];
  medkits: MedkitSnapshot[];
  camps: CampSnapshot[];
  /** Minefield mines (render shows only the viewer's team's, D-063). */
  mines: MineSnapshot[];
  /** Each team's fog of war grid (D-010); reused between steps. */
  vision: Vision;
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
  const laneAgents = world.store<LaneAgent>();
  const concealments = world.store<Concealment>();
  const statuses = world.store<Status>();
  const summons = world.store<Summon>();
  const neutrals = world.store<Neutral>();
  const mines = new MinePool();
  const seen = (e: Entity, team: Team) => visibleTo(concealments, e, team);
  /** Line of sight (D-018): no raised ground between a and b. */
  const clear = (ax: number, ay: number, bx: number, by: number) => rayBlocked(grid, ax, ay, bx, by) < 0;
  /** Tick each medkit is ready from. */
  const medkitReadyAt: number[] = [];
  let lanes: LanePath[] = laneRoutes(config);
  /** Waves spawned so far, scheduled or debug: wave n takes branch n mod branches (D-035). */
  let waveCount = 0;
  /** The current wave's next unit to leave the cave (D-051; past its length: all out), and the tick it steps out. */
  let waveSlot = Infinity;
  let nextSoldierTick = 0;
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

  /**
   * (Re)applies a champion's config: stat bases (level growth included, TDD §5), then the
   * values derived from them. `gainHp` (level-up): a living champion gains the max HP it just
   * got; otherwise HP keeps its fraction.
   */
  function applyChampion(e: Entity, def: ChampionConfig, gainHp = false) {
    const st = stats.get(e)!;
    const up = (champions.get(e)?.level ?? 1) - 1;
    st.base[Stat.Damage] = 1 + def.growth.damagePct * up;
    st.base[Stat.FireRate] = 1;
    st.base[Stat.MaxHp] = def.maxHp * (1 + def.growth.hpPct * up);
    st.base[Stat.MoveSpeed] = def.moveSpeed;
    const mods = champions.get(e)?.mods;
    // Weapon powers (D-060): a cone weapon converts extra projectiles into a wider, longer cone (GDD §8 rule 8).
    st.base[Stat.Range] = def.weapon.range + (mods && def.weapon.kind === 'cone' ? mods.coneRange : 0);
    st.base[Stat.DamageTaken] = 1;
    st.base[Stat.UltCharge] = 1;
    st.base[Stat.DamageVsChampions] = 1;
    st.base[Stat.DamageVsStructures] = 1;
    st.dirty = true;
    motions.get(e)!.speed = stat(st, Stat.MoveSpeed);
    colliders.get(e)!.radius = def.radius;
    const h = healths.get(e)!;
    const maxHp = stat(st, Stat.MaxHp);
    if (gainHp) {
      if (h.hp > 0) h.hp += maxHp - h.maxHp;
      h.maxHp = maxHp;
    } else {
      setMaxHp(h, maxHp);
    }
    const w = weapons.get(e);
    if (w) {
      Object.assign(w, def.weapon);
      if (mods) {
        if (w.kind === 'cone') w.coneAngle += mods.coneAngle;
        else w.burstCount += mods.shots; // Double Tap: extra bullets join the burst, straight at the target (D-072)
        w.burstCount += mods.burst;
      }
    }
  }

  const newStatus = (): Status => ({ burnDps: 0, burnTicks: 0, burnSource: 0, markPct: 0, markTicks: 0, shieldLeft: 0, shieldTicks: 0, buffStat: Stat.MoveSpeed, buffPct: 0, buffTicks: 0 });
  const newHealth = (maxHp: number): Health => ({ hp: maxHp, maxHp, shield: 0, invulnerable: false, invulnUntil: 0, lethalSaves: 0, killer: 0 });
  const newWeapon = (def: WeaponConfig, aim: number): Weapon => ({ ...def, cooldown: 0, aim, critChance: 0, burstLeft: 0, burstWait: 0, burstTarget: 0, lastShotTick: -1, shotCount: 0, groundWait: 0 });
  const noTarget = (): Targeting => ({ targetId: 0, pendingSwitchId: 0, pendingTicks: 0, holdTicks: 0 });

  players.forEach((p, player) => {
    const def = config.champions.find((c) => c.id === p.championId);
    if (!def) throw new Error(`Unknown champion "${p.championId}"`);
    const spawn = p.spawnAt ?? (p.team === Team.Blue ? config.map.spawn.blue : config.map.spawn.red);
    const e = world.create();
    transforms.add(e, { x: spawn.x, y: spawn.y, facing: p.team === Team.Blue ? Math.PI / 2 : -Math.PI / 2 });
    motions.add(e, { vx: 0, vy: 0, speed: 0, intentX: 0, intentY: 0, slowTicks: 0, slowMult: 1, channelMult: 1 });
    colliders.add(e, { radius: 0 });
    teams.add(e, p.team);
    healths.add(e, newHealth(0));
    stats.add(e, createStats());
    if (!p.unarmed) weapons.add(e, newWeapon(def.weapon, transforms.get(e)!.facing));
    targetings.add(e, noTarget());
    targetClasses.add(e, TargetClass.Champion);
    applyChampion(e, def);
    champions.add(e, { championId: def.id, player, def, level: 1, xp: 0, ultCharge: 0, ultTargetId: 0, castQueued: false, stillTicks: 0, traitPct: 0, channelTicks: 0, channelAngle: 0, auraTicks: 0, respawnTicks: 0, kills: 0, deaths: 0, assists: 0, streak: 0, damageDealt: 0, sprintPct: 0, respawnTick: 0, supplyTicks: 0, supplyDamagePct: 0, supplySpeedPct: 0, powers: {}, draftQueue: [], pickQueued: -1, rerollQueued: false, rerollsLeft: config.powers.draft.rerolls, lastCombatTick: 0, spawnAt: p.spawnAt ? { ...p.spawnAt } : undefined, lastCastTick: -1, mods: emptyMods(), lowHpReadyAt: 0, dugInApplied: 0, mortarWait: 0, mineWait: 0, teslaHits: 0, dogId: 0, dogRespawnAt: 0 });
    concealments.add(e, { zone: 0, visible: SEEN_BY_ALL });
    statuses.add(e, newStatus());
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
    structures.add(e, { kind: p.kind, placement: p.id, lane: p.lane, warmupStacks: 0, warmupTarget: 0, ticksSinceShot: 0, backdoor: true, secondaryId: 0, destroyed: false, lastLine: false, lastHitTick: -1e9, nextAlertTick: 0 });
    const def = config.structures[p.kind];
    healths.add(e, newHealth(def.maxHp));
    weapons.add(e, newWeapon(def.weapon, transforms.get(e)!.facing));
    targetings.add(e, noTarget());
    targetClasses.add(e, p.kind === 'hq' ? TargetClass.HQ : TargetClass.SubBase);
  }
  rebuildGrid();
  spatial.rebuild(healths.ids, transforms);

  const pool = new ProjectilePool();
  const lobs = new LobPool();
  const zones = new ZonePool();
  const hits = new HitQueue();
  const weaponsContext: WeaponsContext = {
    transforms, motions, colliders, teams, healths, weapons, targetings, stats, pool, hits, spatial, events, crit: rng.crit, spread: rng.spread,
    holdFire: (e) => (champions.get(e)?.channelTicks ?? 0) > 0,
    shotMultiplier: (e, target) => {
      const st = structures.get(e);
      return st ? warmupShot(st, target, kinds.get(target), config.structures.rules) : 1;
    },
    secondaryOf: (e) => structures.get(e)?.secondaryId ?? 0,
    rangeOf: (e) => targetingContext.rangeOf(e),
    clear,
    modsOf: (e) => champions.get(e)?.mods,
    zones,
  };
  const projectileContext = { pool, transforms, colliders, teams, healths, spatial, hits, grid: () => grid };

  const traitContext: TraitContext = { champions, motions, stats, healths, transforms, teams, seen };
  const ultimateContext: UltimateContext = {
    champions, transforms, colliders, teams, healths, motions, stats, targetClasses, spatial, lobs, zones, hits, events, seen, clear,
    passiveMult: [1, 1],
  };
  const minionContext: MinionContext = {
    world, laneAgents, transforms, motions, colliders, teams, healths, weapons, targetings, targetClasses, kinds, models, spatial, events, concealments, statuses, seen, clear,
    lanes: () => lanes,
    grid: () => grid,
    laneBroken: (team, laneId) => {
      for (let i = 0; i < structures.ids.length; i++) {
        const st = structures.data[i]!;
        if (st.kind === 'subBase' && st.lane === laneId && st.destroyed && teams.get(structures.ids[i]!) !== team) return true;
      }
      return false;
    },
    pool: [],
    artilleryLeft: [0, 0],
    artilleryWave: [false, false],
    structureIds: () => structures.ids,
    footprintRadius: (e) => {
      const f = config.structures[structures.get(e)!.kind].footprint;
      return f.shape === 'circle' ? f.r : Math.max(f.w, f.h) / 2;
    },
  };
  const campContext: CampContext = {
    world, neutrals, transforms, motions, colliders, teams, healths, weapons, targetings, targetClasses, kinds, models, statuses, events, clear,
    camps: createCamps(config.map, config.neutrals),
    lanes: () => lanes,
    grid: () => grid,
    pool: [],
  };
  const damageLog = new DamageLog(config.combat.damage.logSeconds);
  const progressionContext: ProgressionContext = {
    champions, transforms, healths, teams, spatial, stats, events, log: damageLog,
    onLevelUp: (e) => applyChampion(e, champions.get(e)!.def, true),
  };
  const draftContext: DraftContext = {
    champions, healths, stats, kinds, events, rng: rng.draft,
    onStatsChanged: (e) => applyChampion(e, champions.get(e)!.def, true),
  };
  const lifeContext: LifeContext = { champions, transforms, motions, healths, weapons, targetings, teams, events, stats };
  const damageContext: DamageContext = { champions, hits, log: damageLog, healths, stats, kinds, events, structures,
    structureTakenMult: () => (match.phase === 'suddenDeath' ? 1 + config.match.suddenDeath.structureDamageTakenPct : 1),
    markOf: (t) => {
    const s = statuses.get(t);
    return s && s.markTicks > 0 ? s.markPct : 0;
  }, dealtMult: (s) => heatWaveMult(ultimateContext, s), structureResist: (t) => {
    const a = laneAgents.get(t);
    return a ? config.units[a.unit].structureResistPct : 0;
  } };
  const structureContext: StructureContext = { structures, transforms, colliders, teams, healths, weapons, targetings, kinds, spatial, events, seen, clear, defs: () => config.structures };
  const statusContext: StatusContext = { champions, statuses, healths, stats, motions, transforms, teams, structures, hits, events, grid: () => grid, spatial, colliders, seen, clear };
  const epicContext: EpicContext = { champions, transforms, motions, healths, teams, kinds, colliders, targetings, lobs, mines, hits, events, spatial, clear };
  const summonContext: SummonContext = {
    world, summons, champions, transforms, motions, colliders, teams, healths, kinds, models, targetClasses, targetings, concealments, statuses, spatial, hits, events, seen,
  };
  const visibilityContext: VisibilityContext = {
    concealments, transforms, teams, healths, weapons, champions, kinds, grid: () => grid, vision: createVision(config.map, config.combat.fog.cellSize),
  };
  updateHqGate(structureContext);

  const targetingContext: TargetingContext = {
    transforms, colliders, teams, healths, targetClasses, targetings, spatial, seen,
    lineClear: (a, b) => {
      const ta = transforms.get(a)!;
      const tb = transforms.get(b)!;
      return clear(ta.x, ta.y, tb.x, tb.y);
    },
    rangeOf: (e) => {
      const st = stats.get(e);
      return st ? stat(st, Stat.Range) : (weapons.get(e)?.range ?? 0);
    },
  };

  /** Percentages set through `debug.setStatPct`, per entity × stat, so they apply as deltas. */
  const debugPct = new Map<number, number>();
  /** Debug XP grants as [entity, amount (−1 = to the next level)] pairs. */
  const pendingXp: number[] = [];


  const noCards: readonly string[] = [];
  const noPowers: Readonly<Record<string, number>> = {};
  const match: MatchState = { phase: 'deploy', winner: undefined, reason: undefined, endTick: 0, canSurrender: false };

  function endMatch(winner: Team | undefined, reason: NonNullable<MatchState['reason']>) {
    match.phase = 'ended';
    match.winner = winner;
    match.reason = reason;
    match.endTick = tick;
    match.canSurrender = false;
  }

  /** The phase the clock says it is (Deploy lasts until the first wave). */
  function phaseNow(): 'deploy' | 'live' | 'suddenDeath' {
    if (tick >= config.match.phases.suddenDeathSeconds) return 'suddenDeath';
    return tick >= config.waves.firstSeconds ? 'live' : 'deploy';
  }

  /**
   * The time-out (GDD §2): the higher HQ HP% wins; then more enemy Sub-bases destroyed; then more
   * champion takedowns; all equal is a draw.
   */
  function timeoutWinner(): Team | undefined {
    const hqPct = [0, 0];
    const fallen = [0, 0]; // enemy Sub-bases each team destroyed
    for (let i = 0; i < structures.ids.length; i++) {
      const e = structures.ids[i]!;
      const st = structures.data[i]!;
      const team = teams.get(e)!;
      if (st.kind === 'hq') {
        const h = healths.get(e)!;
        hqPct[team] = st.destroyed ? 0 : h.hp / h.maxHp;
      } else if (st.destroyed) {
        fallen[team === Team.Blue ? Team.Red : Team.Blue]!++;
      }
    }
    const takedowns = [0, 0];
    for (let i = 0; i < champions.ids.length; i++) takedowns[teams.get(champions.ids[i]!)!]! += champions.data[i]!.kills;
    for (const score of [hqPct, fallen, takedowns]) {
      if (score[0]! > score[1]!) return Team.Blue;
      if (score[1]! > score[0]!) return Team.Red;
    }
    return undefined;
  }
  const snap: Snapshot = { tick: 0, match, entities: [], projectiles: [], lobs: [], telegraphs: [], zones: [], medkits: [], camps: [], mines: [], vision: visibilityContext.vision };
  /** The pooled telegraph entry `i`, reset to a fixed shape with no size. */
  function telegraph(i: number, team: Team, shape: TelegraphSnapshot['shape'], x: number, y: number, elapsed: number, total: number): TelegraphSnapshot {
    const t = (snap.telegraphs[i] ??= { team, shape, x, y, angle: 0, radius: 0, arc: 0, length: 0, width: 0, anchor: 0, elapsed, total });
    t.team = team;
    t.shape = shape;
    t.x = x;
    t.y = y;
    t.angle = t.radius = t.arc = t.length = t.width = t.anchor = 0;
    t.elapsed = elapsed;
    t.total = total;
    return t;
  }

  return {
    world,
    rng,
    get tick() {
      return tick;
    },

    /** Advances exactly one tick. Returned events are valid until the next step. */
    step(commands: readonly Command[]): StepResult {
      if (tick > 0) events.length = 0;
      if (match.phase === 'ended') return { tick, events }; // frozen once the match is over
      if (tick >= config.match.phases.timeoutSeconds) {
        endMatch(timeoutWinner(), 'timeout');
        events.push({ type: 'matchOver', winner: match.winner, reason: 'timeout', tick });
        tick++;
        return { tick, events };
      }
      const phase = phaseNow();
      if (phase !== match.phase) {
        match.phase = phase;
        events.push({ type: 'phaseChanged', phase });
      }
      match.canSurrender = tick >= config.match.phases.surrenderFromSeconds;
      respawnSystem(lifeContext, config.map, config.match.respawn, tick);
      for (let i = 0; i < pendingXp.length; i += 2) {
        const e = pendingXp[i]!;
        const c = champions.get(e);
        const amount = pendingXp[i + 1]! < 0 && c ? xpForLevel(config.progression, c.level + 1) - c.xp : pendingXp[i + 1]!;
        grantXp(progressionContext, config.progression, e, amount);
      }
      pendingXp.length = 0;
      for (const c of commands) {
        const e = playerEntity[c.player];
        const m = e === undefined ? undefined : motions.get(e);
        if (m && c.draftPick >= 0) champions.get(e!)!.pickQueued = c.draftPick; // drafting works while down too
        if (m && c.reroll) champions.get(e!)!.rerollQueued = true;
        if (m && c.surrender && match.canSurrender && (match.phase as MatchState['phase']) !== 'ended') {
          const team = teams.get(e!)!;
          endMatch(team === Team.Blue ? Team.Red : Team.Blue, 'surrender');
          events.push({ type: 'matchOver', winner: match.winner, reason: 'surrender', tick });
        }
        if (!m || healths.get(e!)!.hp <= 0) continue; // knocked out: input is ignored
        m.intentX = c.moveX / 127;
        m.intentY = c.moveY / 127;
        if (c.ult) champions.get(e!)!.castQueued = true;
      }
      if (waveDue(config.waves, tick)) {
        events.push({ type: 'waveSpawned', wave: waveCount++ });
        waveSlot = 0;
        for (const team of [Team.Blue, Team.Red]) {
          minionContext.artilleryWave[team] = minionContext.artilleryLeft[team]! > 0;
          if (minionContext.artilleryWave[team]) minionContext.artilleryLeft[team]!--;
        }
        nextSoldierTick = tick;
      }
      if (waveSlot < waveLength(config.waves, waveCount - 1) && tick >= nextSoldierTick) {
        spawnFromCaves(minionContext, config, waveCount - 1, tick, waveSlot++);
        nextSoldierTick += config.waves.spawnGapSeconds;
      }
      spatial.rebuild(healths.ids, transforms);
      minionSystem(minionContext, config.units, tick);
      campSystem(campContext, config.neutrals, tick);
      summonSystem(summonContext, tick);
      movementSystem(motions, transforms, colliders, healths, grid, config.map, 1 / TICK_HZ);
      spatial.rebuild(healths.ids, transforms);
      separationSystem(minionContext);
      spatial.rebuild(healths.ids, transforms);
      visibilitySystem(visibilityContext, config.combat.trench, config.combat.fog, tick);
      // Structures (aggro rules) and minions get their own targeting with their features.
      traitSystem(traitContext, tick);
      targetingSystem(champions.ids, targetingContext, config.combat.targeting, tick);
      backdoorSystem(structureContext, config.structures.rules);
      structureTargetingSystem(structureContext, config.structures.rules, damageLog, tick);
      weaponsSystem(champions.ids, weaponsContext, config.combat.weapons, config.combat.damage.critMultiplier, tick);
      weaponsSystem(laneAgents.ids, weaponsContext, config.combat.weapons, config.combat.damage.critMultiplier, tick);
      weaponsSystem(structures.ids, weaponsContext, config.combat.weapons, config.combat.damage.critMultiplier, tick);
      weaponsSystem(neutrals.ids, weaponsContext, config.combat.weapons, config.combat.damage.critMultiplier, tick);
      epicSystem(epicContext, tick);
      projectileSystem(projectileContext, config.combat.weapons);
      // Existing zones and lobs advance before new casts, so a grenade thrown this tick lands
      // exactly its flight time later and a new fire pool first burns a full period after landing.
      zoneSystem(ultimateContext);
      lobSystem(ultimateContext);
      bossSystem(campContext, ultimateContext, config.neutrals, tick); // after lobs advance, like casts: a shell's full flight is telegraphed
      leadStormSystem(ultimateContext);
      heatWaveSystem(ultimateContext);
      underdogCharge(structureContext, ultimateContext.passiveMult, config.progression.underdogChargePct);
      ultimateSystem(ultimateContext, tick);
      const damageFrom = events.length;
      damageSystem(damageContext, config.combat.damage, tick, config.structures.rules.backdoorPct);
      baseAlertSystem(structureContext, config.structures.rules, damageFrom, tick);
      damageChargeSystem(progressionContext, config.progression, events);
      const progressionFrom = events.length; // deaths and structure falls from here on pay XP
      deathSystem(lifeContext, config.match.respawn, match.phase === 'suddenDeath' ? 1 + config.match.suddenDeath.respawnPct : 1);
      campDeathSystem(campContext, config.neutrals, tick); // before minions go, so a minion's killing blow still has a team
      for (let i = progressionFrom; i < events.length; i++) {
        const ev = events[i]!;
        // Artillery Support (D-079): the Field Gun's killers get extra tanks in their next waves.
        if (ev.type === 'campCleared' && ev.team !== undefined) {
          const waves = config.neutrals.camps[ev.kind].boss?.artilleryWaves ?? 0;
          if (waves > 0) minionContext.artilleryLeft[ev.team] = waves;
        }
      }
      minionDeathSystem(minionContext);
      summonDeathSystem(summonContext, tick);
      callForHelpSystem(minionContext, damageLog, config.units, tick);
      campAggroSystem(campContext, damageLog, tick);
      padHealSystem(lifeContext, config.map, config.match.spawnPad);
      medkitSystem(lifeContext, config.map, config.combat.medkit, medkitReadyAt, tick);
      structureDeathSystem(structureContext);
      lastLineSystem(structureContext, config.structures);
      statusSystem(statusContext, events, tick);
      // Win and lose (GDD §2): the first HQ to fall this tick ends the match.
      let hqFell = false;
      for (let i = progressionFrom; i < events.length && (match.phase as MatchState['phase']) !== 'ended'; i++) {
        const ev = events[i]!;
        if (ev.type !== 'structureDestroyed' || ev.kind !== 'hq') continue;
        endMatch(ev.team === Team.Blue ? Team.Red : Team.Blue, 'hq');
        hqFell = true;
      }
      progressionSystem(progressionContext, config.progression, config.neutrals, events, progressionFrom, tick);
      draftSystem(draftContext, config.powers, events);
      regenSystem(draftContext, config.powers, events, tick);
      sprintSystem(lifeContext);
      supplySystem(lifeContext, config.neutrals, events, progressionFrom, tick);
      structureRegenSystem(structureContext, config.structures);
      if (hqFell) events.push({ type: 'matchOver', winner: match.winner, reason: 'hq', tick });
      tick++;
      return { tick, events };
    },

    /** Read-only view for render/UI/bots. Objects are reused between calls; copy what you keep. */
    snapshot(): Snapshot {
      snap.tick = tick;
      snap.vision = visibilityContext.vision;
      const ids = transforms.ids;
      snap.entities.length = ids.length;
      for (let i = 0; i < ids.length; i++) {
        const e = ids[i]!;
        const t = transforms.data[i]!;
        const m = motions.get(e);
        const s = (snap.entities[i] ??= {
          id: 0, kind: Kind.Champion, modelId: '', team: Team.Neutral, lane: '', x: 0, y: 0, facing: 0, vx: 0, vy: 0, radius: 0, hp: 0, maxHp: 0, shield: 0, invulnerable: false, destroyed: false, underAttack: false, targetId: 0, aim: 0, level: 0, xp: 0, xpLevelStart: 0, xpLevelEnd: 0, respawnTicks: 0, killer: 0, kills: 0, deaths: 0, streak: 0, damageDealt: 0, assists: 0, sprinting: false, supply: false, draftCards: noCards, draftTicksLeft: 0, draftRecommended: 0, draftQueued: 0, draftRerolls: 0, powers: noPowers, ultCharge: 0, ultTargetable: false, ultTargetId: 0, traitActive: false, channel: 0, channelAngle: 0, slowed: false, aura: 0, firing: false, auraRadius: 0, visibleMask: SEEN_BY_ALL,
        });
        s.id = e;
        s.kind = kinds.get(e) ?? Kind.Champion;
        s.modelId = models.get(e) ?? '';
        s.team = teams.get(e) ?? Team.Neutral;
        const agent = laneAgents.get(e);
        s.lane = agent ? (lanes[agent.lane]?.id ?? '') : (structures.get(e)?.lane ?? '');
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
        s.destroyed = structures.get(e)?.destroyed ?? false;
        s.underAttack = !s.destroyed && tick - (structures.get(e)?.lastHitTick ?? -1e9) <= config.structures.rules.underAttackSeconds;
        s.targetId = targetings.get(e)?.targetId ?? 0;
        s.aim = weapons.get(e)?.aim ?? t.facing;
        const c = champions.get(e);
        s.level = c?.level ?? 0;
        s.xp = c?.xp ?? 0;
        s.xpLevelStart = c ? xpForLevel(config.progression, c.level) : 0;
        s.xpLevelEnd = c ? xpForLevel(config.progression, c.level + 1) : 0;
        s.respawnTicks = c?.respawnTicks ?? 0;
        const offer = c?.draftQueue[0];
        s.draftCards = offer ? offer.cards : noCards;
        s.draftTicksLeft = offer ? offer.ticksLeft : 0;
        s.draftRecommended = offer && c ? recommended(config.powers, c, offer.cards) : 0;
        s.draftQueued = c ? Math.max(0, c.draftQueue.length - 1) : 0;
        s.draftRerolls = c?.rerollsLeft ?? 0;
        s.powers = c ? c.powers : noPowers;
        s.kills = c?.kills ?? 0;
        s.deaths = c?.deaths ?? 0;
        s.streak = c?.streak ?? 0;
        s.damageDealt = c?.damageDealt ?? 0;
        s.assists = c?.assists ?? 0;
        s.sprinting = (c?.sprintPct ?? 0) > 0;
        s.supply = (c?.supplyTicks ?? 0) > 0;
        s.killer = h && h.hp <= 0 ? h.killer : 0;
        s.ultCharge = c?.ultCharge ?? 0;
        s.ultTargetable = (c?.ultTargetId ?? 0) !== 0;
        s.ultTargetId = c?.ultTargetId ?? 0;
        s.traitActive = (c?.traitPct ?? 0) > 0;
        const ult = c?.def.ultimate;
        s.channel = !c || c.channelTicks === 0 ? 0 : ult?.id === 'leadStorm' && c.channelTicks > ult.seconds ? 1 : 2;
        s.channelAngle = c?.channelAngle ?? 0;
        s.slowed = (m?.slowTicks ?? 0) > 0;
        s.aura = c?.auraTicks ?? 0;
        s.auraRadius = c && ult?.id === 'heatWave' ? auraRadius(c, ult.radius) : 0;
        const w = weapons.get(e);
        s.firing = !!w && w.lastShotTick >= 0 && tick - w.lastShotTick <= w.interval;
        s.visibleMask = concealments.get(e)?.visible ?? SEEN_BY_ALL;
      }
      let laid = 0;
      for (let i = 0; i < mines.capacity; i++) {
        if (!mines.active[i]) continue;
        const mm = (snap.mines[laid++] ??= { team: Team.Neutral, x: 0, y: 0, armed: false });
        mm.team = mines.team[i]! as Team;
        mm.x = mines.x[i]!;
        mm.y = mines.y[i]!;
        mm.armed = tick >= mines.armAt[i]!;
      }
      snap.mines.length = laid;
      const kits = config.map.medkits;
      snap.medkits.length = kits.length;
      for (let i = 0; i < kits.length; i++) {
        const k = (snap.medkits[i] ??= { x: 0, y: 0, ready: true });
        k.x = kits[i]!.x;
        k.y = kits[i]!.y;
        k.ready = (medkitReadyAt[i] ?? 0) <= tick;
      }
      const camps = campContext.camps;
      snap.camps.length = camps.length;
      for (let i = 0; i < camps.length; i++) {
        const c = camps[i]!;
        const cs = (snap.camps[i] ??= { x: 0, y: 0, kind: 'deserter', members: 0, hp: 0, maxHp: 0, engaged: false, leashing: false });
        cs.x = c.spot.x;
        cs.y = c.spot.y;
        cs.kind = c.spot.kind;
        cs.members = c.members;
        cs.engaged = c.state === CampState.Engaged;
        cs.leashing = c.state === CampState.Leashing;
        cs.hp = cs.maxHp = 0;
      }
      for (let i = 0; i < neutrals.ids.length; i++) {
        const cs = snap.camps[neutrals.data[i]!.camp]!;
        const h = healths.get(neutrals.ids[i]!)!;
        cs.hp += Math.max(0, h.hp);
        cs.maxHp += h.maxHp;
      }
      let n = 0;
      for (let i = 0; i < pool.capacity; i++) {
        if (!pool.active[i]) continue;
        const p = (snap.projectiles[n++] ??= { id: 0, team: Team.Neutral, ownerKind: Kind.Champion, boost: 1, rocket: false, x: 0, y: 0, vx: 0, vy: 0 });
        p.id = pool.id[i]!;
        p.team = pool.team[i]! as Team;
        p.ownerKind = kinds.get(pool.owner[i]!) ?? Kind.Minion;
        p.boost = pool.boost[i]!;
        p.rocket = pool.splash[i]! > 0;
        p.x = pool.x[i]!;
        p.y = pool.y[i]!;
        p.vx = pool.vx[i]! * TICK_HZ;
        p.vy = pool.vy[i]! * TICK_HZ;
      }
      snap.projectiles.length = n;
      n = 0;
      let tn = 0;
      for (let i = 0; i < lobs.capacity; i++) {
        if (!lobs.active[i]) continue;
        const l = (snap.lobs[n++] ??= { id: 0, team: Team.Neutral, x0: 0, y0: 0, x1: 0, y1: 0, elapsed: 0, total: 1, arcHeight: 0 });
        l.id = lobs.id[i]!;
        l.team = lobs.team[i]! as Team;
        l.x0 = lobs.x0[i]!;
        l.y0 = lobs.y0[i]!;
        l.x1 = lobs.x1[i]!;
        l.y1 = lobs.y1[i]!;
        l.elapsed = lobs.elapsed[i]!;
        l.total = lobs.total[i]!;
        l.arcHeight = lobs.arcHeight[i]!;
        const t = telegraph(tn++, l.team, 'circle', l.x1, l.y1, l.elapsed, l.total);
        t.radius = lobs.radius[i]!;
      }
      snap.lobs.length = n;
      for (let i = 0; i < champions.ids.length; i++) {
        const c = champions.data[i]!;
        const ult = c.def.ultimate;
        if (c.channelTicks === 0 || ult.id !== 'leadStorm') continue;
        const e = champions.ids[i]!;
        const tr = transforms.get(e)!;
        const total = ult.windupSeconds;
        const t = telegraph(tn++, teams.get(e)! as Team, 'strip', tr.x, tr.y, Math.min(total, total - (c.channelTicks - ult.seconds)), total);
        t.angle = c.channelAngle;
        t.length = ult.length;
        t.width = ult.width;
        t.anchor = e;
      }
      for (let c = 0; c < campContext.camps.length; c++) {
        const camp = campContext.camps[c]!;
        const p = config.neutrals.camps[camp.spot.kind].boss?.pattern;
        if (camp.attack === BossAttack.None || !p) continue;
        if (p.kind === 'shells') {
          // The Behemoth's steam blast (D-082): a circle round it.
          if (!p.blast) continue;
          const t = telegraph(tn++, Team.Neutral, 'circle', camp.attackX, camp.attackY, tick - 1 - camp.attackStart, p.blast.windupSeconds);
          t.radius = p.blast.radius;
          continue;
        }
        const spray = camp.attack === BossAttack.Spray;
        const t = telegraph(tn++, Team.Neutral, spray ? 'cone' : 'strip', camp.attackX, camp.attackY, tick - 1 - camp.attackStart, p.windupSeconds);
        t.angle = camp.attackAngle;
        if (spray) {
          t.radius = p.range;
          t.arc = p.spray.angle;
        } else {
          t.length = p.charge.length;
          t.width = p.charge.width;
        }
      }
      snap.telegraphs.length = tn;
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
        foldMods(champions.data[i]!.mods, next.powers, champions.data[i]!.powers);
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
        if (st.lastLine) weapons.get(e)!.interval = def.weapon.interval / (1 + next.structures.rules.lastLineFireRatePct);
      }
      updateHqGate(structureContext); // re-cut HQ max HP for fallen Sub-bases (D-051)
      for (let i = 0; i < laneAgents.ids.length; i++) {
        const e = laneAgents.ids[i]!;
        const def = next.units[laneAgents.data[i]!.unit];
        motions.get(e)!.speed = def.moveSpeed;
        colliders.get(e)!.radius = def.radius;
        setMaxHp(healths.get(e)!, def.maxHp);
        Object.assign(weapons.get(e)!, def.weapon);
      }
      for (let i = 0; i < neutrals.ids.length; i++) {
        const e = neutrals.ids[i]!;
        const def = next.neutrals.camps[campContext.camps[neutrals.data[i]!.camp]!.spot.kind].unit;
        motions.get(e)!.speed = def.moveSpeed;
        colliders.get(e)!.radius = def.radius;
        setMaxHp(healths.get(e)!, def.maxHp);
        const w = weapons.get(e);
        if (w) Object.assign(w, def.weapon);
      }
      lanes = laneRoutes(next);
      rebuildGrid();
      const v = visibilityContext.vision;
      if (v.cell !== next.combat.fog.cellSize || v.minX !== next.map.bounds.minX || v.minY !== next.map.bounds.minY) {
        visibilityContext.vision = createVision(next.map, next.combat.fog.cellSize); // filled on the next vision update
      }
    },

    /** Match state: live, or ended with a winner (read-only). */
    match: match as Readonly<MatchState>,

    /** Spatial index of every unit with health, as of the last step (read-only). */
    spatial,

    /** Bullets in flight (read-only). */
    projectiles: pool,

    /** Grenades and shells in flight, ground zones and mines (read-only). */
    lobs,
    zones,
    mines,

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
      /** Drops a team's HQ gate and lands a lethal hit on it through the normal pipeline (next step). */
      destroyHq(team: Team) {
        for (let i = 0; i < structures.ids.length; i++) {
          const e = structures.ids[i]!;
          if (structures.data[i]!.kind !== 'hq' || teams.get(e) !== team) continue;
          healths.get(e)!.invulnerable = false;
          hits.push(0, e, 1e12);
        }
      },
      /** Forces every HQ's invulnerability on or off (the gate re-applies when a Sub-base falls). */
      setHqShields(on: boolean) {
        for (let i = 0; i < structures.ids.length; i++) {
          if (structures.data[i]!.kind === 'hq') healths.get(structures.ids[i]!)!.invulnerable = on;
        }
      },
      /** Spawns the next wave now on every wave lane. */
      spawnWave() {
        spawnWave(minionContext, config, waveCount++, tick);
      },
      /** A lethal hit through the normal damage pipeline (a lethal save still applies). */
      kill(e: Entity) {
        hits.push(0, e, 1e12);
      },
      /** Queued for the start of the next step, so its `levelUp` events reach that step's listeners. */
      giveXp(e: Entity, amount: number) {
        pendingXp.push(e, amount);
      },
      /** Grants exactly the XP to the next level (next step). */
      levelUp(e: Entity) {
        pendingXp.push(e, -1);
      },
      fillUltimate(e: Entity) {
        const c = champions.get(e);
        if (c) c.ultCharge = 100;
      },
      armLethalSave(e: Entity) {
        const h = healths.get(e);
        if (h) h.lethalSaves = 1;
      },
      /** One stack of a power, as if drafted, within its stack cap (debug panel). */
      grantPower(e: Entity, id: string) {
        const c = champions.get(e);
        const def = config.powers.powers.find((x) => x.id === id);
        if (!c || !def || (c.powers[id] ?? 0) >= config.powers.draft.stackCaps[def.rarity]) return;
        applyPower(draftContext, config.powers, e, id, false);
      },
      /** Chance (0–1) that each shot is a critical hit. */
      setCritChance(e: Entity, chance: number) {
        const w = weapons.get(e);
        if (w) w.critChance = chance;
      },
    },

    /** Component stores (read-only outside the sim; for tests, bots-in-sim and debug views). */
    stores: { transforms, colliders, healths, weapons, targetings, targetClasses, stats, teams, kinds, champions, motions, laneAgents, structures, concealments, statuses, summons, neutrals },

    /** Neutral camps, in `map.camps` order (read-only). */
    camps: campContext.camps as readonly Readonly<CampContext['camps'][number]>[],

    /** Built lane polylines (read-only). */
    get lanes() {
      return lanes;
    },

    /** Each team's fog of war grid (read-only). */
    get vision() {
      return visibilityContext.vision;
    },

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

/** Waypoints this close to a structure's footprint edge (m) are dropped from the lane routes. */
const WAYPOINT_CLEARANCE = 1.5;

/**
 * The map's lane polylines minus waypoints inside or near a structure footprint (D-069): a
 * minion can't reach one, so a Sub-base on a lane control point (The Bridgehead) would stall
 * every wave at it. The route then cuts past the structure and minions steer round it as usual.
 * The ends of a lane are always kept.
 */
function laneRoutes(cfg: Config): LanePath[] {
  return buildLanes(cfg.map).map((l) => ({
    id: l.id,
    branches: l.branches.map((pts) => {
      const out: number[] = [];
      for (let k = 0; k < pts.length; k += 2) {
        const x = pts[k]!;
        const y = pts[k + 1]!;
        let near = false;
        for (const s of cfg.map.structures) {
          const f = cfg.structures[s.kind].footprint;
          const r = (f.shape === 'circle' ? f.r : Math.max(f.w, f.h) / 2) + WAYPOINT_CLEARANCE;
          if ((x - s.x) * (x - s.x) + (y - s.y) * (y - s.y) < r * r) near = true;
        }
        if (!near || k === 0 || k === pts.length - 2) out.push(x, y);
      }
      return Float64Array.from(out);
    }),
  }));
}
