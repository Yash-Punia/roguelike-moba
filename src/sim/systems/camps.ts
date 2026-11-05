import type { CampKind, Config } from '../../data/schema';
import type { LanePath } from '../../data/map-geometry';
import type { DamageLog } from '../damage-log';
import type { Entity, Store, World } from '../ecs';
import type { SimEvent } from '../events';
import { atan2, cos, len, sin } from '../math';
import {
  Kind, TargetClass, Team,
  type Collider, type Concealment, type Health, type Motion, type Status, type Targeting, type Transform, type Weapon,
} from '../sim';

type Neutrals = Config['neutrals'];
type CampSpot = Config['map']['camps'][number];
const dead: Entity[] = [];

/** A camp's life (TDD §6.8). `Dead` passes straight to `Respawning` (its timer), so it isn't a state of its own. */
export enum CampState {
  Idle = 0,
  Engaged = 1,
  Leashing = 2,
  Respawning = 3,
}

/** One neutral camp (a `map.camps` entry) and where it is in its state machine. */
export interface Camp {
  spot: CampSpot;
  state: CampState;
  /** The unit the camp is fighting (0 = none). */
  aggro: Entity;
  /** Living members. */
  members: number;
  /** Last tick a member dealt or took damage. */
  lastCombatTick: number;
  /** Tick it started walking home (Leashing). */
  leashTick: number;
  /** Respawning: the tick the camp comes back. */
  respawnAt: number;
}

/** A camp unit (TDD §5 `Neutral`): its camp, and its own spot and facing at the camp. */
export interface Neutral {
  camp: number;
  homeX: number;
  homeY: number;
  homeFacing: number;
}

export interface CampContext {
  world: World;
  neutrals: Store<Neutral>;
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
  concealments: Store<Concealment>;
  statuses: Store<Status>;
  events: SimEvent[];
  camps: Camp[];
  lanes: () => readonly LanePath[];
  /** Is the line from a to b clear of raised ground (line of sight, D-018)? */
  clear(ax: number, ay: number, bx: number, by: number): boolean;
  /** Component objects of removed camp units, reused by the next spawns. */
  pool: CampBundle[];
}

export interface CampBundle {
  transform: Transform;
  motion: Motion;
  collider: Collider;
  health: Health;
  weapon: Weapon;
  targeting: Targeting;
  neutral: Neutral;
  concealment: Concealment;
  status: Status;
}

/** Every camp of the map, waiting for its first spawn. */
export function createCamps(map: Config['map'], n: Neutrals): Camp[] {
  return map.camps.map((spot) => ({
    spot, state: CampState.Respawning, aggro: 0, members: 0, lastCombatTick: 0, leashTick: 0, respawnAt: n.camps[spot.kind].firstSpawnSeconds,
  }));
}

/** Direction from (x, y) to the nearest lane point (a sniper watches the lane, map spec). */
function towardsLane(lanes: readonly LanePath[], x: number, y: number): number {
  let best = Infinity;
  let bx = x;
  let by = y + 1;
  for (const l of lanes) {
    for (const pts of l.branches) {
      for (let k = 0; k < pts.length; k += 2) {
        const d = len(pts[k]! - x, pts[k + 1]! - y);
        if (d < best) {
          best = d;
          bx = pts[k]!;
          by = pts[k + 1]!;
        }
      }
    }
  }
  return atan2(by - y, bx - x);
}

/**
 * The camp's units: a squad on a ring round the campfire, facing it; a lone unit (the sniper)
 * at the centre, facing the nearest lane. Deserter variants go by place in the ring (no RNG).
 */
function spawnCamp(ctx: CampContext, n: Neutrals, index: number) {
  const camp = ctx.camps[index]!;
  const { spot } = camp;
  const def = n.camps[spot.kind].unit;
  const lone = spot.count === 1;
  const laneFacing = lone ? towardsLane(ctx.lanes(), spot.x, spot.y) : 0;
  for (let k = 0; k < spot.count; k++) {
    const a = (k * 2 * Math.PI) / spot.count;
    const x = lone ? spot.x : spot.x + cos(a) * n.ringRadius;
    const y = lone ? spot.y : spot.y + sin(a) * n.ringRadius;
    const facing = lone ? laneFacing : atan2(spot.y - y, spot.x - x);
    const e = ctx.world.create();
    const b: CampBundle = ctx.pool.pop() ?? {
      transform: { x: 0, y: 0, facing: 0 },
      motion: { vx: 0, vy: 0, speed: 0, intentX: 0, intentY: 0, slowTicks: 0, slowMult: 1, channelMult: 1 },
      collider: { radius: 0 },
      health: { hp: 0, maxHp: 0, shield: 0, invulnerable: false, invulnUntil: 0, lethalSaves: 0, killer: 0 },
      weapon: { ...def.weapon, cooldown: 0, aim: 0, critChance: 0, burstLeft: 0, burstWait: 0, burstTarget: 0, lastShotTick: -1, shotCount: 0, groundWait: 0 },
      targeting: { targetId: 0, pendingSwitchId: 0, pendingTicks: 0, holdTicks: 0 },
      neutral: { camp: 0, homeX: 0, homeY: 0, homeFacing: 0 },
      concealment: { zone: 0, visible: 0 },
      status: { burnDps: 0, burnTicks: 0, burnSource: 0, markPct: 0, markTicks: 0, shieldLeft: 0, shieldTicks: 0, buffStat: 0, buffPct: 0, buffTicks: 0 },
    };
    Object.assign(b.transform, { x, y, facing });
    Object.assign(b.motion, { vx: 0, vy: 0, speed: def.moveSpeed, intentX: 0, intentY: 0, slowTicks: 0, slowMult: 1, channelMult: 1 });
    b.collider.radius = def.radius;
    Object.assign(b.health, { hp: def.maxHp, maxHp: def.maxHp, shield: 0, invulnerable: false, invulnUntil: 0, lethalSaves: 0, killer: 0 });
    Object.assign(b.weapon, def.weapon, { cooldown: 0, aim: facing, critChance: 0, burstLeft: 0, burstWait: 0, burstTarget: 0, lastShotTick: -1, shotCount: 0, groundWait: 0 });
    Object.assign(b.targeting, { targetId: 0, pendingSwitchId: 0, pendingTicks: 0, holdTicks: 0 });
    Object.assign(b.neutral, { camp: index, homeX: x, homeY: y, homeFacing: facing });
    Object.assign(b.concealment, { zone: 0, visible: 0xff });
    Object.assign(b.status, { burnDps: 0, burnTicks: 0, burnSource: 0, markPct: 0, markTicks: 0, shieldLeft: 0, shieldTicks: 0, buffPct: 0, buffTicks: 0 });
    ctx.transforms.add(e, b.transform);
    ctx.motions.add(e, b.motion);
    ctx.colliders.add(e, b.collider);
    ctx.teams.add(e, Team.Neutral);
    ctx.healths.add(e, b.health);
    ctx.weapons.add(e, b.weapon);
    ctx.targetings.add(e, b.targeting);
    ctx.targetClasses.add(e, TargetClass.Neutral);
    ctx.kinds.add(e, Kind.Neutral);
    ctx.models.add(e, spot.kind === 'sniper' ? 'sniper' : `deserter${k % 4}`);
    ctx.neutrals.add(e, b.neutral);
    ctx.concealments.add(e, b.concealment);
    ctx.statuses.add(e, b.status);
  }
  camp.members = spot.count;
  camp.state = CampState.Idle;
  camp.aggro = 0;
}

/** A unit the camp can fight: alive, not neutral, not a structure. */
function fightable(ctx: CampContext, e: Entity): boolean {
  if (e === 0 || ctx.teams.get(e) === undefined || ctx.teams.get(e) === Team.Neutral) return false;
  const kind = ctx.kinds.get(e);
  if (kind === Kind.SubBase || kind === Kind.HQ) return false;
  const h = ctx.healths.get(e);
  return !!h && h.hp > 0;
}

/** The latest unit that hit a member of `camp` since `since` and can still be fought, or 0. */
function recentAttacker(ctx: CampContext, log: DamageLog, camp: number, since: number): Entity {
  for (let k = log.count - 1; k >= 0; k--) {
    const s = log.slot(k);
    if (log.tick[s]! < since) break;
    if (ctx.neutrals.get(log.target[s]!)?.camp !== camp) continue;
    const src = log.source[s]!;
    if (fightable(ctx, src)) return src;
  }
  return 0;
}

function goHome(ctx: CampContext, camp: Camp, index: number, tick: number) {
  camp.state = CampState.Leashing;
  camp.aggro = 0;
  camp.leashTick = tick;
  const { neutrals } = ctx;
  for (let i = 0; i < neutrals.ids.length; i++) {
    if (neutrals.data[i]!.camp === index) ctx.healths.get(neutrals.ids[i]!)!.invulnerable = true;
  }
}

/**
 * Camp aggro (TDD §6.8), right after the damage stage like call for help: a hit on a member
 * engages an idle camp on the attacker; an engaged camp keeps its target while it stands and
 * otherwise takes the latest attacker. Hits
 * dealt or taken keep the camp in combat. A leashing camp is invulnerable, so takes none.
 */
export function campAggroSystem(ctx: CampContext, log: DamageLog, tick: number) {
  const { neutrals, camps } = ctx;
  for (let k = log.count - 1; k >= 0; k--) {
    const s = log.slot(k);
    if (log.tick[s] !== tick) break;
    const src = log.source[s]!;
    const hit = neutrals.get(log.target[s]!);
    const shooter = neutrals.get(src);
    if (shooter) camps[shooter.camp]!.lastCombatTick = tick;
    if (!hit) continue;
    const camp = camps[hit.camp]!;
    if (camp.state !== CampState.Idle && camp.state !== CampState.Engaged) continue;
    camp.lastCombatTick = tick;
    if (!fightable(ctx, src)) continue;
    if (camp.state === CampState.Idle || !fightable(ctx, camp.aggro)) camp.aggro = src;
    camp.state = CampState.Engaged;
  }
}

/**
 * Neutral camps (GDD §4, TDD §6.8, D-073), before movement:
 * - `Respawning` → spawn at `respawnAt` → `Idle`: units hold their spot and fire at nothing.
 * - `Engaged` (on first damage, `campAggroSystem`): every member fights the aggro target, the
 *   latest attacker still standing; members walk to it until it is in range and in sight. A
 *   chase step that would take a member past `leashRadius` from its spot, no attacker left, or
 *   `resetSeconds` without a hit dealt or taken sends the camp home.
 * - `Leashing`: invulnerable, no shooting, everyone walks to their spot `returnSpeedPct` faster.
 *   When all are home (or after `resetSeconds`, snapping stragglers stuck on walls) they heal to
 *   full and the camp is `Idle` again.
 * Camps ignore Trench concealment and fog: they only ever fight whoever hit them.
 */
export function campSystem(ctx: CampContext, n: Neutrals, log: DamageLog, tick: number) {
  const { camps, neutrals, transforms, motions, weapons, targetings, colliders } = ctx;
  for (let c = 0; c < camps.length; c++) {
    const camp = camps[c]!;
    if (camp.state === CampState.Respawning) {
      if (tick >= camp.respawnAt) spawnCamp(ctx, n, c);
      continue;
    }
    if (camp.state !== CampState.Engaged) continue;
    if (!fightable(ctx, camp.aggro)) camp.aggro = recentAttacker(ctx, log, c, tick - n.resetSeconds);
    if (camp.aggro === 0 || tick - camp.lastCombatTick > n.resetSeconds) goHome(ctx, camp, c, tick);
  }

  for (let i = 0; i < neutrals.ids.length; i++) {
    const e = neutrals.ids[i]!;
    const u = neutrals.data[i]!;
    const camp = camps[u.camp]!;
    const def = n.camps[camp.spot.kind].unit;
    const t = transforms.get(e)!;
    const m = motions.get(e)!;
    const tg = targetings.get(e)!;
    tg.targetId = 0;
    m.intentX = m.intentY = 0;
    m.speed = def.moveSpeed;
    if (camp.state === CampState.Engaged) {
      const target = camp.aggro;
      const ot = transforms.get(target)!;
      const dx = ot.x - t.x;
      const dy = ot.y - t.y;
      const d = len(dx, dy);
      if (d - (colliders.get(target)?.radius ?? 0) <= weapons.get(e)!.range && ctx.clear(t.x, t.y, ot.x, ot.y)) {
        tg.targetId = target;
        continue;
      }
      if (def.moveSpeed === 0 || d < 1e-6) continue;
      const step = def.moveSpeed / 30;
      const nx = t.x + (dx / d) * step;
      const ny = t.y + (dy / d) * step;
      if (len(nx - u.homeX, ny - u.homeY) > n.leashRadius) {
        goHome(ctx, camp, u.camp, tick); // pulled too far: the rest of the camp goes from the next tick
        continue;
      }
      m.intentX = dx / d;
      m.intentY = dy / d;
    } else if (camp.state === CampState.Leashing) {
      const dx = u.homeX - t.x;
      const dy = u.homeY - t.y;
      const d = len(dx, dy);
      const speed = def.moveSpeed * (1 + n.returnSpeedPct);
      if (d <= speed / 30) {
        t.x = u.homeX;
        t.y = u.homeY;
        t.facing = u.homeFacing;
        continue;
      }
      m.speed = speed;
      m.intentX = dx / d;
      m.intentY = dy / d;
    }
  }

  // A leashing camp settles once everyone is home, or after `resetSeconds` (stragglers snap home).
  for (let c = 0; c < camps.length; c++) {
    const camp = camps[c]!;
    if (camp.state !== CampState.Leashing) continue;
    const late = tick - camp.leashTick >= n.resetSeconds;
    let home = true;
    for (let i = 0; i < neutrals.ids.length && home; i++) {
      const u = neutrals.data[i]!;
      const t = transforms.get(neutrals.ids[i]!)!;
      if (u.camp === c && !late && (t.x !== u.homeX || t.y !== u.homeY)) home = false;
    }
    if (!home) continue;
    for (let i = 0; i < neutrals.ids.length; i++) {
      const u = neutrals.data[i]!;
      if (u.camp !== c) continue;
      const e = neutrals.ids[i]!;
      const t = transforms.get(e)!;
      Object.assign(t, { x: u.homeX, y: u.homeY, facing: u.homeFacing });
      const h = ctx.healths.get(e)!;
      h.hp = h.maxHp;
      h.invulnerable = false;
      ctx.statuses.get(e)!.burnTicks = 0;
      motions.get(e)!.intentX = motions.get(e)!.intentY = 0;
    }
    camp.state = CampState.Idle;
  }
}

/**
 * Removes camp units knocked out this tick (a `death` event carrying the camp kind). The last
 * one clears the camp: `campCleared` names the team that landed the killing blow (GDD §4: it
 * takes the reward; none for a debug kill) and the camp starts its respawn timer.
 */
export function campDeathSystem(ctx: CampContext, n: Neutrals, tick: number) {
  const { neutrals, healths, transforms, events, camps } = ctx;
  dead.length = 0;
  for (let i = 0; i < neutrals.ids.length; i++) if (healths.get(neutrals.ids[i]!)!.hp <= 0) dead.push(neutrals.ids[i]!);
  for (const e of dead) {
    const h = healths.get(e)!;
    const u = neutrals.get(e)!;
    const camp = camps[u.camp]!;
    const t = transforms.get(e)!;
    const kind: CampKind = camp.spot.kind;
    events.push({ type: 'death', id: e, team: Team.Neutral, killer: h.killer, x: t.x, y: t.y, unit: kind });
    if (--camp.members === 0) {
      const team = h.killer === 0 ? undefined : ctx.teams.get(h.killer);
      events.push({ type: 'campCleared', camp: camp.spot.id, kind, team: team === Team.Neutral ? undefined : team, x: t.x, y: t.y });
      camp.state = CampState.Respawning;
      camp.aggro = 0;
      camp.respawnAt = tick + n.camps[kind].respawnSeconds;
    }
    ctx.pool.push({
      transform: t,
      motion: ctx.motions.get(e)!,
      collider: ctx.colliders.get(e)!,
      health: h,
      weapon: ctx.weapons.get(e)!,
      targeting: ctx.targetings.get(e)!,
      neutral: u,
      concealment: ctx.concealments.get(e)!,
      status: ctx.statuses.get(e)!,
    });
    ctx.world.destroy(e);
  }
}
