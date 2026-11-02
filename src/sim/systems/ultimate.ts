import { TICK_HZ, type UltTargetClass } from '../../data/schema';
import { isInvulnerable } from '../damage';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import type { HitQueue } from '../hits';
import type { LobPool } from '../lobs';
import { len } from '../math';
import { TargetClass, type Champion, type Collider, type Health, type Team, type Transform } from '../sim';
import type { SpatialIndex } from '../spatial';
import { Stat, stat, type Stats } from '../stats';
import type { ZonePool } from '../zones';

export interface UltimateContext {
  champions: Store<Champion>;
  transforms: Store<Transform>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  stats: Store<Stats>;
  targetClasses: Store<TargetClass>;
  spatial: SpatialIndex;
  lobs: LobPool;
  zones: ZonePool;
  hits: HitQueue;
  events: SimEvent[];
}

// A function, not a table: sim.ts imports this module, so its enums aren't ready at load time.
function classOf(name: UltTargetClass): TargetClass {
  switch (name) {
    case 'champion':
      return TargetClass.Champion;
    case 'hq':
      return TargetClass.HQ;
    case 'subBase':
      return TargetClass.SubBase;
    case 'minion':
      return TargetClass.Minion;
    case 'neutral':
      return TargetClass.Neutral;
  }
}

const nearby: Entity[] = [];
const inside: Entity[] = [];

function maxRadius(colliders: Store<Collider>) {
  let r = 0;
  for (let i = 0; i < colliders.data.length; i++) r = Math.max(r, colliders.data[i]!.radius);
  return r;
}

/**
 * The Ultimate's automatic target (GDD §6–7): within cast range (to the collider edge), the
 * first class in the champion's target order that has a living, targetable enemy, nearest
 * within it (lower id on a tie). An invulnerable HQ is skipped. 0 if none.
 */
export function ultTarget(e: Entity, ctx: UltimateContext, tick: number, reach = maxRadius(ctx.colliders)): Entity {
  const c = ctx.champions.get(e);
  const t = ctx.transforms.get(e);
  if (!c || !t) return 0;
  const ult = c.def.ultimate;
  const team = ctx.teams.get(e);
  ctx.spatial.query(t.x, t.y, ult.castRange + reach, nearby);
  for (let n = 0; n < ult.targetOrder.length; n++) {
    const cls = classOf(ult.targetOrder[n]!);
    let best: Entity = 0;
    let bestDist = Infinity;
    for (let k = 0; k < nearby.length; k++) {
      const o = nearby[k]!;
      if (o === e || ctx.targetClasses.get(o) !== cls || ctx.teams.get(o) === team) continue;
      const h = ctx.healths.get(o);
      if (!h || h.hp <= 0 || isInvulnerable(h, tick)) continue;
      const ot = ctx.transforms.get(o)!;
      const d = len(ot.x - t.x, ot.y - t.y) - (ctx.colliders.get(o)?.radius ?? 0);
      if (d <= ult.castRange && d < bestDist) {
        best = o;
        bestDist = d;
      }
    }
    if (best !== 0) return best;
  }
  return 0;
}

/**
 * Ultimate charge and casting (TDD §6.5). Passive charge fills 0 → 100 over the champion's
 * charge time, scaled by the Ult-charge stat (kill and damage charge arrive in M2 feature 13).
 * Each champion's target is refreshed every tick (`ultTargetId`, for the button). A cast
 * needs a press this tick, a living champion, full charge and a target: the charge empties
 * and a Frag Grenade is lobbed at where the target is now.
 */
export function ultimateSystem(ctx: UltimateContext, tick: number) {
  const { champions, transforms, healths, stats, lobs, teams, events } = ctx;
  const reach = maxRadius(ctx.colliders);
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const h = healths.get(e);
    const pressed = c.castQueued;
    c.castQueued = false;
    if (!h || h.hp <= 0) {
      c.ultTargetId = 0;
      continue;
    }
    if (c.ultCharge < 100) {
      const st = stats.get(e);
      c.ultCharge += (100 / Math.max(1, c.def.ultChargeSeconds)) * (st ? stat(st, Stat.UltCharge) : 1);
      if (c.ultCharge > 100 - 1e-9) c.ultCharge = 100; // float sums land a hair short
    }
    c.ultTargetId = ultTarget(e, ctx, tick, reach);
    if (!pressed || c.ultCharge < 100 || c.ultTargetId === 0) continue;

    const t = transforms.get(e)!;
    const tt = transforms.get(c.ultTargetId)!;
    c.ultCharge = 0;
    lobs.spawn(e, teams.get(e)!, t.x, t.y, tt.x, tt.y, c.def.ultimate.flightSeconds);
    events.push({ type: 'ultCast', id: e, target: c.ultTargetId, x: tt.x, y: tt.y });
  }
}

/** Fills `inside` with living enemies (not on `team`) whose collider overlaps the circle (x, y, r), ascending ids. */
function enemiesIn(ctx: UltimateContext, x: number, y: number, r: number, team: number, reach: number): Entity[] {
  inside.length = 0;
  ctx.spatial.query(x, y, r + reach, nearby);
  for (let k = 0; k < nearby.length; k++) {
    const o = nearby[k]!;
    if (ctx.teams.get(o) === team) continue;
    const h = ctx.healths.get(o);
    if (!h || h.hp <= 0) continue;
    const ot = ctx.transforms.get(o)!;
    if (len(ot.x - x, ot.y - y) <= r + (ctx.colliders.get(o)?.radius ?? 0)) inside.push(o);
  }
  return inside;
}

/**
 * Grenades in flight land after their flight time: the blast hits every enemy it overlaps
 * through the damage pipeline, then leaves a fire pool. Level scaling uses the owner's
 * level (1 until XP arrives in M2 feature 11).
 */
export function lobSystem(ctx: UltimateContext) {
  const { lobs, zones, champions, hits, events } = ctx;
  const reach = maxRadius(ctx.colliders);
  for (let i = 0; i < lobs.capacity; i++) {
    if (!lobs.active[i]) continue;
    if (++lobs.elapsed[i]! < lobs.total[i]!) continue;
    const owner = lobs.owner[i]!;
    const team = lobs.team[i]!;
    const x = lobs.x1[i]!;
    const y = lobs.y1[i]!;
    lobs.release(i);
    const c = champions.get(owner);
    if (!c) continue;
    const ult = c.def.ultimate;
    const up = c.level - 1;
    const damage = ult.damage + ult.damagePerLevel * up;
    const hitList = enemiesIn(ctx, x, y, ult.radius, team, reach);
    for (let k = 0; k < hitList.length; k++) hits.push(owner, hitList[k]!, damage);
    events.push({ type: 'explosion', owner, team, x, y, radius: ult.radius });
    const z = ult.zone;
    const perHit = (z.dps + z.dpsPerLevel * up) * (z.tickSeconds / TICK_HZ);
    zones.spawn(owner, team, x, y, z.radius, z.seconds, z.tickSeconds, perHit, z.structurePct);
  }
}

/** Zones hit every enemy inside once per period, the last time on their final tick, then vanish. */
export function zoneSystem(ctx: UltimateContext) {
  const { zones, hits } = ctx;
  const reach = maxRadius(ctx.colliders);
  for (let i = 0; i < zones.capacity; i++) {
    if (!zones.active[i]) continue;
    const elapsed = ++zones.elapsed[i]!;
    if (elapsed % zones.period[i]! === 0) {
      const owner = zones.owner[i]!;
      const damage = zones.damage[i]!;
      const share = zones.structureMult[i]!;
      const hitList = enemiesIn(ctx, zones.x[i]!, zones.y[i]!, zones.radius[i]!, zones.team[i]!, reach);
      for (let k = 0; k < hitList.length; k++) hits.push(owner, hitList[k]!, damage, 1, share);
    }
    if (elapsed >= zones.total[i]!) zones.release(i);
  }
}
