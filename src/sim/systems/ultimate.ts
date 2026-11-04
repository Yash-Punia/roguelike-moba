import { TICK_HZ, type UltTargetClass } from '../../data/schema';
import { isInvulnerable } from '../damage';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import { GROUND, SHOT } from '../grid';
import type { HitQueue } from '../hits';
import type { LobPool } from '../lobs';
import { atan2, cos, len, sin, turnTowards } from '../math';
import { TargetClass, type Champion, type Collider, type Health, type Motion, type Team, type Transform } from '../sim';
import type { SpatialIndex } from '../spatial';
import type { Stats } from '../stats';
import type { ZonePool } from '../zones';
import { addUltCharge } from './charge';

export interface UltimateContext {
  champions: Store<Champion>;
  transforms: Store<Transform>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  motions: Store<Motion>;
  stats: Store<Stats>;
  targetClasses: Store<TargetClass>;
  spatial: SpatialIndex;
  lobs: LobPool;
  zones: ZonePool;
  hits: HitQueue;
  events: SimEvent[];
  /** Can `team` see `e` (Trench concealment, TDD §6.9)? */
  seen(e: Entity, team: Team): boolean;
  /** Is the line from a to b free of cells with any of `mask`'s flags (`COVER`, `GROUND`; line of sight, D-018)? */
  clear(ax: number, ay: number, bx: number, by: number, mask: number): boolean;
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
  if (ult.id === 'heatWave') return e; // needs no target: usable whenever charged (GDD §7)
  const team = ctx.teams.get(e);
  // A lobbed grenade clears sandbags but needs sight past raised ground; Lead Storm's bullets need a clear shot.
  const mask = ult.id === 'fragGrenade' ? GROUND : SHOT;
  ctx.spatial.query(t.x, t.y, ult.castRange + reach, nearby);
  for (let n = 0; n < ult.targetOrder.length; n++) {
    const cls = classOf(ult.targetOrder[n]!);
    let best: Entity = 0;
    let bestDist = Infinity;
    for (let k = 0; k < nearby.length; k++) {
      const o = nearby[k]!;
      if (o === e || ctx.targetClasses.get(o) !== cls || ctx.teams.get(o) === team || !ctx.seen(o, team!)) continue;
      const h = ctx.healths.get(o);
      if (!h || h.hp <= 0 || isInvulnerable(h, tick)) continue;
      const ot = ctx.transforms.get(o)!;
      const d = len(ot.x - t.x, ot.y - t.y) - (ctx.colliders.get(o)?.radius ?? 0);
      if (d <= ult.castRange && d < bestDist && ctx.clear(t.x, t.y, ot.x, ot.y, mask)) {
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
 * needs a press this tick, a living champion, full charge, a target and no channel or aura
 * already running: the charge empties, then a Frag Grenade is lobbed at where the target is
 * now, Lead Storm starts its channel aimed at the target, or Heat Wave starts its aura.
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
    addUltCharge(c, stats.get(e), 100 / Math.max(1, c.def.ultChargeSeconds));
    c.ultTargetId = ultTarget(e, ctx, tick, reach);
    if (!pressed || c.ultCharge < 100 || c.ultTargetId === 0 || c.channelTicks > 0 || c.auraTicks > 0) continue;

    const t = transforms.get(e)!;
    const tt = transforms.get(c.ultTargetId)!;
    const ult = c.def.ultimate;
    c.ultCharge = 0;
    if (ult.id === 'fragGrenade') {
      lobs.spawn(e, teams.get(e)!, t.x, t.y, tt.x, tt.y, ult.flightSeconds);
    } else if (ult.id === 'heatWave') {
      c.auraTicks = ult.seconds;
    } else {
      c.channelTicks = ult.windupSeconds + ult.seconds;
      c.channelAngle = atan2(tt.y - t.y, tt.x - t.x);
      ctx.motions.get(e)!.channelMult = ult.moveSpeedPct;
    }
    c.lastCastTick = tick; // casting reveals it in a Trench, like a shot
    events.push({ type: 'ultCast', id: e, target: c.ultTargetId, x: tt.x, y: tt.y });
  }
}

/** Fills `inside` with living enemies (not on `team`) whose collider overlaps the circle (x, y, r) and that nothing in `mask` shields from its centre, ascending ids. */
function enemiesIn(ctx: UltimateContext, x: number, y: number, r: number, team: number, reach: number, mask: number): Entity[] {
  inside.length = 0;
  ctx.spatial.query(x, y, r + reach, nearby);
  for (let k = 0; k < nearby.length; k++) {
    const o = nearby[k]!;
    if (ctx.teams.get(o) === team) continue;
    const h = ctx.healths.get(o);
    if (!h || h.hp <= 0) continue;
    const ot = ctx.transforms.get(o)!;
    if (len(ot.x - x, ot.y - y) <= r + (ctx.colliders.get(o)?.radius ?? 0) && ctx.clear(x, y, ot.x, ot.y, mask)) inside.push(o);
  }
  return inside;
}

/**
 * Grenades in flight land after their flight time: the blast hits every enemy it overlaps
 * that no sandbag or raised ground shields, through the damage pipeline, then leaves a fire pool. Level scaling uses the owner's
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
    const ult = c?.def.ultimate;
    if (!c || ult?.id !== 'fragGrenade') continue;
    const up = c.level - 1;
    const damage = ult.damage + ult.damagePerLevel * up;
    const hitList = enemiesIn(ctx, x, y, ult.radius, team, reach, SHOT);
    for (let k = 0; k < hitList.length; k++) hits.push(owner, hitList[k]!, damage);
    events.push({ type: 'explosion', owner, team, x, y, radius: ult.radius });
    const z = ult.zone;
    const perHit = (z.dps + z.dpsPerLevel * up) * (z.tickSeconds / TICK_HZ);
    zones.spawn(owner, team, x, y, z.radius, z.seconds, z.tickSeconds, perHit, z.structurePct);
  }
}

/**
 * Fills `inside` with living enemies whose collider overlaps the strip starting at (x, y) and
 * running `length` along `angle`, `width` wide, with a clear shot from (x, y); ascending ids.
 */
function enemiesInStrip(ctx: UltimateContext, x: number, y: number, angle: number, length: number, width: number, team: number, reach: number): Entity[] {
  inside.length = 0;
  const dx = cos(angle);
  const dy = sin(angle);
  ctx.spatial.query(x + (dx * length) / 2, y + (dy * length) / 2, len(length / 2, width / 2) + reach, nearby);
  for (let k = 0; k < nearby.length; k++) {
    const o = nearby[k]!;
    if (ctx.teams.get(o) === team) continue;
    const h = ctx.healths.get(o);
    if (!h || h.hp <= 0) continue;
    const ot = ctx.transforms.get(o)!;
    const r = ctx.colliders.get(o)?.radius ?? 0;
    const along = (ot.x - x) * dx + (ot.y - y) * dy;
    const across = (ot.y - y) * dx - (ot.x - x) * dy;
    if (along >= -r && along <= length + r && Math.abs(across) <= width / 2 + r && ctx.clear(x, y, ot.x, ot.y, SHOT)) inside.push(o);
  }
  return inside;
}

/**
 * Lead Storm channels (TDD §6.5), before new casts. The strip turns towards the caster's
 * Ultimate target (else her facing) at `turnRate`. After the windup, every `tickSeconds` it
 * hits every enemy in the strip for the bullets that landed meanwhile and refreshes their
 * slow. The channel ends when its time runs out or the caster is knocked out.
 */
export function leadStormSystem(ctx: UltimateContext) {
  const { champions, transforms, healths, motions, hits, events } = ctx;
  const reach = maxRadius(ctx.colliders);
  for (let i = 0; i < champions.ids.length; i++) {
    const c = champions.data[i]!;
    if (c.channelTicks === 0) continue;
    const e = champions.ids[i]!;
    const ult = c.def.ultimate;
    const m = motions.get(e)!;
    if (ult.id !== 'leadStorm' || healths.get(e)!.hp <= 0) {
      endChannel(c, m, e, events);
      continue;
    }
    const t = transforms.get(e)!;
    const tt = c.ultTargetId !== 0 ? transforms.get(c.ultTargetId) : undefined;
    c.channelAngle = turnTowards(c.channelAngle, tt ? atan2(tt.y - t.y, tt.x - t.x) : t.facing, ult.turnRate / TICK_HZ);
    const fired = ult.seconds - c.channelTicks + 1; // ticks of fire so far, this one included (≤ 0 in the windup)
    if (fired > 0 && fired % ult.tickSeconds === 0) {
      const team = ctx.teams.get(e)!;
      const damage = (ult.damage + ult.damagePerLevel * (c.level - 1)) * ult.bulletsPerSecond * (ult.tickSeconds / TICK_HZ);
      const hitList = enemiesInStrip(ctx, t.x, t.y, c.channelAngle, ult.length, ult.width, team, reach);
      for (let k = 0; k < hitList.length; k++) {
        const o = hitList[k]!;
        hits.push(e, o, damage, 1, ult.structurePct);
        const om = motions.get(o);
        if (om) {
          om.slowTicks = ult.slowSeconds;
          om.slowMult = 1 - ult.slowPct;
        }
      }
    }
    if (--c.channelTicks === 0) endChannel(c, m, e, events);
  }
}

/**
 * Heat Wave auras (TDD §6.5), moving with Gamma. Every `tickSeconds`, allied champions and
 * minions inside heal a share of their max HP (capped at full) and enemy ones take a burn hit
 * of a share of theirs, through the damage pipeline; structures are left alone. The aura ends
 * when its time runs out or Gamma is knocked out.
 */
export function heatWaveSystem(ctx: UltimateContext) {
  const { champions, transforms, healths, teams, targetClasses, hits } = ctx;
  const reach = maxRadius(ctx.colliders);
  for (let i = 0; i < champions.ids.length; i++) {
    const c = champions.data[i]!;
    if (c.auraTicks === 0) continue;
    const e = champions.ids[i]!;
    const ult = c.def.ultimate;
    if (ult.id !== 'heatWave' || healths.get(e)!.hp <= 0) {
      c.auraTicks = 0;
      continue;
    }
    const elapsed = ult.seconds - c.auraTicks + 1;
    if (elapsed % ult.tickSeconds === 0) {
      const t = transforms.get(e)!;
      const team = teams.get(e);
      const per = ult.tickSeconds / TICK_HZ;
      ctx.spatial.query(t.x, t.y, ult.radius + reach, nearby);
      for (let k = 0; k < nearby.length; k++) {
        const o = nearby[k]!;
        const cls = targetClasses.get(o);
        if (cls !== TargetClass.Champion && cls !== TargetClass.Minion) continue;
        const h = healths.get(o);
        if (!h || h.hp <= 0) continue;
        const ot = transforms.get(o)!;
        if (len(ot.x - t.x, ot.y - t.y) > ult.radius + (ctx.colliders.get(o)?.radius ?? 0)) continue;
        if (teams.get(o) === team) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * ult.healPctPerSecond * per);
        else hits.push(e, o, h.maxHp * ult.burnPctPerSecond * per, 1, 1, true);
      }
    }
    c.auraTicks--;
  }
}

/**
 * Heat Wave's effect on damage dealt (TDD §6.4 step 2): ×(1 + pct) if `source` stands inside an
 * allied Heat Wave, ×(1 − pct) inside an enemy one. Each side counts once, however many overlap.
 */
export function heatWaveMult(ctx: UltimateContext, source: Entity): number {
  const st = ctx.transforms.get(source);
  if (!st) return 1;
  const team = ctx.teams.get(source);
  let up = 0;
  let down = 0;
  const { champions } = ctx;
  for (let i = 0; i < champions.ids.length; i++) {
    const c = champions.data[i]!;
    const ult = c.def.ultimate;
    if (c.auraTicks === 0 || ult.id !== 'heatWave') continue;
    const t = ctx.transforms.get(champions.ids[i]!)!;
    if (len(st.x - t.x, st.y - t.y) > ult.radius) continue;
    if (ctx.teams.get(champions.ids[i]!) === team) up = Math.max(up, ult.damageDealtPct);
    else down = Math.max(down, ult.damageDealtPct);
  }
  return (1 + up) * (1 - down);
}

function endChannel(c: Champion, m: Motion, e: Entity, events: SimEvent[]) {
  c.channelTicks = 0;
  m.channelMult = 1;
  events.push({ type: 'channelEnd', id: e });
}

/** Zones hit every enemy inside once per period (fire passes over sandbags, not raised ground), the last time on their final tick, then vanish. */
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
      const hitList = enemiesIn(ctx, zones.x[i]!, zones.y[i]!, zones.radius[i]!, zones.team[i]!, reach, GROUND);
      for (let k = 0; k < hitList.length; k++) hits.push(owner, hitList[k]!, damage, 1, share);
    }
    if (elapsed >= zones.total[i]!) zones.release(i);
  }
}
