import type { Config, MinionDef } from '../../data/schema';
import type { LanePath } from '../../data/map-geometry';
import { segmentDistSq } from '../../data/map-geometry';
import { isInvulnerable } from '../damage';
import type { DamageLog } from '../damage-log';
import type { Entity, Store, World } from '../ecs';
import type { SimEvent } from '../events';
import type { ObstacleGrid } from '../grid';
import { isBlocked } from '../grid';
import { len } from '../math';
import {
  Kind, TargetClass, Team,
  type Collider, type Health, type LaneAgent, type Motion, type Targeting, type Transform, type Weapon,
} from '../sim';
import type { SpatialIndex } from '../spatial';

export interface MinionContext {
  world: World;
  laneAgents: Store<LaneAgent>;
  transforms: Store<Transform>;
  motions: Store<Motion>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  weapons: Store<Weapon>;
  targetings: Store<Targeting>;
  targetClasses: Store<TargetClass>;
  kinds: Store<Kind>;
  models: Store<string>;
  spatial: SpatialIndex;
  events: SimEvent[];
  lanes: () => readonly LanePath[];
  grid: () => ObstacleGrid;
  /** Component objects of removed minions, reused by the next spawns (per sim). */
  pool: MinionBundle[];
  /** Structures (ascending ids), and the radius to steer around each one's footprint. */
  structureIds: () => readonly Entity[];
  footprintRadius: (e: Entity) => number;
}

/** Component objects of a removed minion, reused by the next spawn (no per-wave allocation). */
export interface MinionBundle {
  transform: Transform;
  motion: Motion;
  collider: Collider;
  health: Health;
  weapon: Weapon;
  targeting: Targeting;
  agent: LaneAgent;
}
const nearby: Entity[] = [];
const dead: Entity[] = [];

/** Waypoint `i` of an agent's route, walking the Blue→Red polyline forwards (Blue) or backwards (Red). */
function waypoint(pts: Float64Array, team: Team, i: number, out: { x: number; y: number }) {
  const n = pts.length / 2;
  const k = team === Team.Blue ? i : n - 1 - i;
  out.x = pts[k * 2]!;
  out.y = pts[k * 2 + 1]!;
}
const wa = { x: 0, y: 0 };
const wb = { x: 0, y: 0 };
const side = { x: 0, y: 0 };

/** Sets `side` to the sideways unit vector (right of travel) of the route segment ending at waypoint `i`. */
function sideways(pts: Float64Array, team: Team, i: number) {
  waypoint(pts, team, Math.max(0, i - 1), wa);
  waypoint(pts, team, Math.max(1, i), wb);
  const d = len(wb.x - wa.x, wb.y - wa.y) || 1;
  side.x = (wb.y - wa.y) / d;
  side.y = -(wb.x - wa.x) / d;
}

/** Distance from (x, y) to the polyline. */
export function distToLane(pts: Float64Array, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const { distSq } = segmentDistSq(x, y, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!);
    if (distSq < best) best = distSq;
  }
  return Math.sqrt(best);
}

/** Spawns one wave on every configured lane for both teams (GDD §5): a row of soldiers at each lane's start. */
export function spawnWave(ctx: MinionContext, cfg: Config, wave: number) {
  const lanes = ctx.lanes();
  const def = cfg.units.mgSoldier;
  for (const laneId of cfg.waves.lanes) {
    const lane = lanes.findIndex((l) => l.id === laneId);
    if (lane < 0) continue;
    const branch = wave % lanes[lane]!.branches.length;
    const pts = lanes[lane]!.branches[branch]!;
    for (const team of [Team.Blue, Team.Red]) {
      sideways(pts, team, 1);
      waypoint(pts, team, 0, wa);
      const sx = wa.x;
      const sy = wa.y;
      const px = side.x;
      const py = side.y;
      for (let s = 0; s < cfg.waves.soldiers; s++) {
        const offset = (s - (cfg.waves.soldiers - 1) / 2) * cfg.waves.spacing;
        spawnMinion(ctx, def, team, lane, branch, offset, sx + px * offset, sy + py * offset);
      }
    }
  }
  ctx.events.push({ type: 'waveSpawned', wave });
}

function spawnMinion(ctx: MinionContext, def: MinionDef, team: Team, lane: number, branch: number, offset: number, x: number, y: number) {
  const e = ctx.world.create();
  const facing = team === Team.Blue ? Math.PI / 2 : -Math.PI / 2;
  const b: MinionBundle = ctx.pool.pop() ?? {
    transform: { x: 0, y: 0, facing: 0 },
    motion: { vx: 0, vy: 0, speed: 0, intentX: 0, intentY: 0, slowTicks: 0, slowMult: 1, channelMult: 1 },
    collider: { radius: 0 },
    health: { hp: 0, maxHp: 0, shield: 0, invulnerable: false, invulnUntil: 0, lethalSaves: 0, killer: 0 },
    weapon: { ...def.weapon, cooldown: 0, aim: 0, critChance: 0, burstLeft: 0, burstWait: 0, burstTarget: 0, lastShotTick: -1 },
    targeting: { targetId: 0, pendingSwitchId: 0, pendingTicks: 0, holdTicks: 0 },
    agent: { unit: 'mgSoldier', lane: 0, branch: 0, waypoint: 0, offset: 0, helpTarget: 0, helpTicks: 0 },
  };
  Object.assign(b.transform, { x, y, facing });
  Object.assign(b.motion, { vx: 0, vy: 0, speed: def.moveSpeed, intentX: 0, intentY: 0, slowTicks: 0, slowMult: 1, channelMult: 1 });
  b.collider.radius = def.radius;
  Object.assign(b.health, { hp: def.maxHp, maxHp: def.maxHp, shield: 0, invulnerable: false, invulnUntil: 0, lethalSaves: 0, killer: 0 });
  Object.assign(b.weapon, def.weapon, { cooldown: 0, aim: facing, critChance: 0, burstLeft: 0, burstWait: 0, burstTarget: 0, lastShotTick: -1 });
  Object.assign(b.targeting, { targetId: 0, pendingSwitchId: 0, pendingTicks: 0, holdTicks: 0 });
  Object.assign(b.agent, { unit: 'mgSoldier', lane, branch, waypoint: 1, offset, helpTarget: 0, helpTicks: 0 });
  ctx.transforms.add(e, b.transform);
  ctx.motions.add(e, b.motion);
  ctx.colliders.add(e, b.collider);
  ctx.teams.add(e, team);
  ctx.healths.add(e, b.health);
  ctx.weapons.add(e, b.weapon);
  ctx.targetings.add(e, b.targeting);
  ctx.targetClasses.add(e, TargetClass.Minion);
  ctx.kinds.add(e, Kind.Minion);
  ctx.models.add(e, 'mgSoldier');
  ctx.laneAgents.add(e, b.agent);
}

function edgeDist(ctx: MinionContext, t: Transform, o: Entity): number {
  const ot = ctx.transforms.get(o)!;
  return len(ot.x - t.x, ot.y - t.y) - (ctx.colliders.get(o)?.radius ?? 0);
}

/** A living, targetable enemy the minion could shoot without straying more than `reach` (leash + range) from its lane. */
function isValid(ctx: MinionContext, o: Entity, team: Team, pts: Float64Array, reach: number, tick: number): boolean {
  if (o === 0 || ctx.teams.get(o) === team) return false;
  const h = ctx.healths.get(o);
  if (!h || h.hp <= 0 || isInvulnerable(h, tick)) return false;
  const ot = ctx.transforms.get(o)!;
  return distToLane(pts, ot.x, ot.y) <= reach + (ctx.colliders.get(o)?.radius ?? 0);
}

/** Minion target rank (GDD §5 "Minion targeting"): minions first, then structures, then champions; −1 = never. */
function rank(cls: TargetClass | undefined): number {
  switch (cls) {
    case TargetClass.Minion:
      return 0;
    case TargetClass.SubBase:
    case TargetClass.HQ:
      return 1;
    case TargetClass.Champion:
      return 2;
    default:
      return -1;
  }
}

/**
 * Minion decisions (GDD §5, TDD §6.1–6.2), before the weapons fire:
 * - Target: a live call-for-help champion first; otherwise the nearest enemy minion, then
 *   structure, then champion within `acquireRange` (to the collider edge). The current
 *   target is kept while it is still the best class and within range + 0.5 m. Only targets
 *   it could shoot without leaving the lane by more than `leash` count.
 * - Move: walk to the target until it is in weapon range, never further than `leash` from
 *   the lane; with no target, march to the next waypoint (plus its place in the row).
 */
export function minionSystem(ctx: MinionContext, units: Config['units'], tick: number) {
  const { laneAgents, transforms, motions, teams, weapons, targetings, targetClasses, spatial, colliders } = ctx;
  const lanes = ctx.lanes();
  for (let i = 0; i < laneAgents.ids.length; i++) {
    const e = laneAgents.ids[i]!;
    const a = laneAgents.data[i]!;
    const def = units[a.unit];
    const t = transforms.get(e)!;
    const m = motions.get(e)!;
    const tg = targetings.get(e)!;
    const team = teams.get(e)!;
    const range = weapons.get(e)!.range;
    const pts = lanes[a.lane]?.branches[a.branch];
    if (!pts) continue;
    const reach = def.leash + range;

    // Target.
    if (a.helpTicks > 0) a.helpTicks--;
    if (a.helpTicks === 0 || !isValid(ctx, a.helpTarget, team, pts, reach, tick)) a.helpTarget = 0;
    let target: Entity = a.helpTarget;
    if (target === 0) {
      spatial.query(t.x, t.y, def.acquireRange + 3, nearby);
      let bestRank = 99;
      let bestDist = Infinity;
      for (let k = 0; k < nearby.length; k++) {
        const o = nearby[k]!;
        const r = rank(targetClasses.get(o));
        if (r < 0 || r > bestRank || !isValid(ctx, o, team, pts, reach, tick)) continue;
        const d = edgeDist(ctx, t, o);
        if (d > def.acquireRange) continue;
        if (r < bestRank || d < bestDist) {
          bestRank = r;
          bestDist = d;
          target = o;
        }
      }
      const cur = tg.targetId;
      if (cur !== 0 && cur !== target && isValid(ctx, cur, team, pts, reach, tick) && rank(targetClasses.get(cur)) === bestRank && edgeDist(ctx, t, cur) <= def.acquireRange + 0.5) target = cur;
    }
    tg.targetId = target;

    // Move.
    let gx: number;
    let gy: number;
    if (target !== 0) {
      if (edgeDist(ctx, t, target) <= range) {
        m.intentX = m.intentY = 0;
        continue;
      }
      const ot = transforms.get(target)!;
      gx = ot.x;
      gy = ot.y;
    } else {
      const n = pts.length / 2;
      for (;;) {
        sideways(pts, team, a.waypoint);
        waypoint(pts, team, a.waypoint, wa);
        gx = wa.x + side.x * a.offset;
        gy = wa.y + side.y * a.offset;
        if (len(gx - t.x, gy - t.y) > 1 || a.waypoint >= n - 1) break;
        a.waypoint++;
      }
      if (len(gx - t.x, gy - t.y) <= 0.3) {
        m.intentX = m.intentY = 0; // end of the lane: hold
        continue;
      }
    }
    const dx = gx - t.x;
    const dy = gy - t.y;
    const d = len(dx, dy);
    m.intentX = dx / d;
    m.intentY = dy / d;
    avoidStructures(ctx, t, m, colliders.get(e)!.radius, d);
    // Don't step past the leash while chasing.
    if (target !== 0) {
      const step = m.speed / 30;
      if (distToLane(pts, t.x + m.intentX * step, t.y + m.intentY * step) > def.leash) m.intentX = m.intentY = 0;
    }
  }
}

/** Extra clearance kept from a structure's footprint while steering round it (m). */
const AVOID_MARGIN = 0.2;

/**
 * Lanes run straight through their Sub-bases (MP-01), and a circle walking head-on into a
 * round footprint doesn't slide off it. If the straight line to the goal (within `goalDist`)
 * passes through a structure's footprint, steer along the tangent round its nearer side.
 * Full pathfinding (A*) arrives with the bots in M4.
 */
function avoidStructures(ctx: MinionContext, t: Transform, m: Motion, radius: number, goalDist: number) {
  const ids = ctx.structureIds();
  for (let k = 0; k < ids.length; k++) {
    const s = ids[k]!;
    const st = ctx.transforms.get(s)!;
    if (steerAround(t.x, t.y, m.intentX, m.intentY, goalDist, st.x, st.y, ctx.footprintRadius(s) + radius + AVOID_MARGIN, steer)) {
      m.intentX = steer.x;
      m.intentY = steer.y;
      return;
    }
  }
}

const steer = { x: 0, y: 0 };

/**
 * Steering round one circle (shared by minions and bots): if the straight line from (x, y)
 * along unit (dx, dy), up to `goalDist`, passes within `clear` of (cx, cy), writes into `out`
 * the tangent direction round its nearer side and returns true. The tangent is the centre
 * direction turned by ±asin(clear / dist), with no trig; inside the clearance it slides
 * perpendicular.
 */
export function steerAround(x: number, y: number, dx: number, dy: number, goalDist: number, cx: number, cy: number, clear: number, out: { x: number; y: number }): boolean {
  const ox = cx - x;
  const oy = cy - y;
  const along = ox * dx + oy * dy;
  if (along <= 0) return false; // behind
  const dist = len(ox, oy);
  if (dist - clear > goalDist) return false; // the goal comes first
  const perpX = ox - dx * along;
  const perpY = oy - dy * along;
  if (len(perpX, perpY) >= clear) return false; // the path misses it
  const ux = ox / dist;
  const uy = oy / dist;
  const sin = dist > clear ? clear / dist : 1;
  const cos = Math.sqrt(1 - sin * sin);
  const ax = ux * cos - uy * sin; // turned left
  const ay = uy * cos + ux * sin;
  const bx = ux * cos + uy * sin; // turned right
  const by = uy * cos - ux * sin;
  const left = ax * dx + ay * dy >= bx * dx + by * dy;
  out.x = left ? ax : bx;
  out.y = left ? ay : by;
  return true;
}

/**
 * Call for help (GDD §5, TDD §6.2): this tick's damage log, read after the damage stage, so
 * minions react next tick. An enemy champion hitting an allied champion pulls that ally's
 * minions within `radius` of it onto the attacker for `seconds`.
 */
export function callForHelpSystem(ctx: MinionContext, log: DamageLog, units: Config['units'], tick: number) {
  const { laneAgents, transforms, teams, kinds, spatial } = ctx;
  for (let k = log.count - 1; k >= 0; k--) {
    const s = log.slot(k);
    if (log.tick[s] !== tick) break;
    const src = log.source[s]!;
    const victim = log.target[s]!;
    if (kinds.get(src) !== Kind.Champion || kinds.get(victim) !== Kind.Champion) continue;
    const team = teams.get(victim);
    if (team === undefined || teams.get(src) === team) continue;
    const vt = transforms.get(victim)!;
    spatial.query(vt.x, vt.y, units.mgSoldier.callForHelp.radius, nearby);
    for (let n = 0; n < nearby.length; n++) {
      const o = nearby[n]!;
      const a = laneAgents.get(o);
      if (!a || teams.get(o) !== team) continue;
      const ot = transforms.get(o)!;
      if (len(ot.x - vt.x, ot.y - vt.y) > units[a.unit].callForHelp.radius) continue;
      a.helpTarget = src;
      a.helpTicks = units[a.unit].callForHelp.seconds;
    }
  }
}

/**
 * Soft unit separation (TDD §6.1), after movement: overlapping minions push each other apart
 * (half the overlap each, so a crowd settles over a few ticks); a minion overlapping a
 * champion moves aside on its own; champions are never pushed. A push into a blocked cell
 * is dropped. Pairs in ascending id order.
 */
export function separationSystem(ctx: MinionContext) {
  const { laneAgents, transforms, colliders, healths, kinds, spatial } = ctx;
  const grid = ctx.grid();
  for (let i = 0; i < laneAgents.ids.length; i++) {
    const e = laneAgents.ids[i]!;
    const t = transforms.get(e)!;
    const r = colliders.get(e)!.radius;
    spatial.query(t.x, t.y, r + 1.5, nearby);
    for (let k = 0; k < nearby.length; k++) {
      const o = nearby[k]!;
      if (o === e) continue;
      const kind = kinds.get(o);
      const champion = kind === Kind.Champion;
      if (!champion && (kind !== Kind.Minion || o < e)) continue; // each minion pair once
      const oh = healths.get(o);
      if (!oh || oh.hp <= 0) continue;
      const ot = transforms.get(o)!;
      let dx = t.x - ot.x;
      let dy = t.y - ot.y;
      let d = len(dx, dy);
      const overlap = r + colliders.get(o)!.radius - d;
      if (overlap <= 0) continue;
      if (d < 1e-6) {
        dx = e < o ? 1 : -1; // exactly stacked: split along x, by id
        dy = 0;
        d = 1;
      }
      const nx = dx / d;
      const ny = dy / d;
      const push = champion ? overlap * 0.5 : overlap * 0.25;
      nudge(grid, t, nx * push, ny * push);
      if (!champion) nudge(grid, ot, -nx * push, -ny * push);
    }
  }
}

function nudge(g: ObstacleGrid, t: Transform, dx: number, dy: number) {
  const x = t.x + dx;
  const y = t.y + dy;
  if (isBlocked(g, Math.floor((x - g.minX) / g.cell), Math.floor((y - g.minY) / g.cell))) return;
  t.x = x;
  t.y = y;
}

/** Removes minions knocked out this tick (after a `death` event), returning their components to the pool. */
export function minionDeathSystem(ctx: MinionContext) {
  const { laneAgents, healths, transforms, events } = ctx;
  dead.length = 0;
  for (let i = 0; i < laneAgents.ids.length; i++) {
    const e = laneAgents.ids[i]!;
    const h = healths.get(e)!;
    if (h.hp > 0) continue;
    const t = transforms.get(e)!;
    events.push({ type: 'death', id: e, team: ctx.teams.get(e)!, killer: h.killer, x: t.x, y: t.y });
    dead.push(e);
  }
  for (const e of dead) {
    ctx.pool.push({
      transform: ctx.transforms.get(e)!,
      motion: ctx.motions.get(e)!,
      collider: ctx.colliders.get(e)!,
      health: ctx.healths.get(e)!,
      weapon: ctx.weapons.get(e)!,
      targeting: ctx.targetings.get(e)!,
      agent: ctx.laneAgents.get(e)!,
    });
    ctx.world.destroy(e);
  }
}

/** Is a wave due this tick (TDD §6.6)? The first at `firstSeconds`, then every `intervalSeconds`. */
export function waveDue(w: Config['waves'], tick: number): boolean {
  return w.enabled && tick >= w.firstSeconds && (tick - w.firstSeconds) % w.intervalSeconds === 0;
}
