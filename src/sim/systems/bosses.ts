import { TICK_HZ, type Config } from '../../data/schema';
import type { Entity } from '../ecs';
import { LobKind } from '../lobs';
import { atan2, len } from '../math';
import { Team } from '../sim';
import { BossAttack, CampState, type Camp, type CampContext } from './camps';
import { enemiesIn, enemiesInCone, enemiesInStrip, maxRadius, type UltimateContext } from './ultimate';

const picked: Entity[] = [];

/**
 * Mini-boss attack patterns (GDD §4, TDD §6.8), after `lobSystem` like casts, so a new shell's
 * whole flight is telegraphed. A mini-boss fights only while its camp is `Engaged`, at the camp's
 * attackers in reach and in sight, nearest first (ties by id); every attack is telegraphed.
 * - `shells` (Field Gun, D-079): every `intervalSeconds`, one shell at each of up to `targets`
 *   attackers within `range`, landing where they stood `flightSeconds` later. The shell is a lob,
 *   so its landing circle is the telegraph (D-078) and `lobSystem` deals the blast. With a `blast`
 *   (Behemoth, D-082), every `blast.every`th attack is a steam blast round itself instead, if an
 *   attacker is within `blast.radius`: a windup locked on its spot, then everyone inside is hit.
 *   The attack count advances either way, so a skipped blast waits for the next turn.
 * - `halftrack` (D-080): every `intervalSeconds`, a windup locked on the nearest attacker: a spray
 *   cone, or every `chargeEvery`th time a charge strip. `windupSeconds` later everyone inside is
 *   hit; after a charge the Halftrack drives down the strip (`campSystem`). It holds still in the
 *   windup, and a leash calls the windup off.
 */
export function bossSystem(ctx: CampContext, u: UltimateContext, n: Config['neutrals'], tick: number) {
  const { camps, neutrals, transforms } = ctx;
  for (let i = 0; i < neutrals.ids.length; i++) {
    const camp = camps[neutrals.data[i]!.camp]!;
    const p = n.camps[camp.spot.kind].boss?.pattern;
    if (!p) continue;
    if (camp.state !== CampState.Engaged) {
      camp.attackWait = 0;
      continue;
    }
    if (camp.attackWait > 0) camp.attackWait--;
    const e = neutrals.ids[i]!;
    const t = transforms.get(e)!;

    if (p.kind === 'halftrack') {
      if (camp.attack !== BossAttack.None) {
        if (tick - camp.attackStart >= p.windupSeconds) resolve(u, camp, e, p);
        continue;
      }
      if (camp.attackWait > 0 || camp.driveTicks > 0) continue;
      const charge = (camp.attacks + 1) % p.chargeEvery === 0;
      if (pick(ctx, camp, t.x, t.y, charge ? p.charge.length : p.range, 1) === 0) continue;
      const tt = transforms.get(picked[0]!)!;
      camp.attack = charge ? BossAttack.Charge : BossAttack.Spray;
      camp.attackX = t.x;
      camp.attackY = t.y;
      camp.attackAngle = t.facing = atan2(tt.y - t.y, tt.x - t.x);
      camp.attackStart = tick;
      camp.attacks++;
      camp.attackWait = p.intervalSeconds;
      continue;
    }

    const b = p.blast;
    if (b && camp.attack === BossAttack.Blast) {
      if (tick - camp.attackStart < b.windupSeconds) continue;
      const list = enemiesIn(u, camp.attackX, camp.attackY, b.radius, Team.Neutral, maxRadius(u.colliders));
      for (let k = 0; k < list.length; k++) u.hits.push(e, list[k]!, b.damage);
      camp.attack = BossAttack.None;
      continue;
    }
    if (camp.attackWait > 0) continue;
    if (b && (camp.attacks + 1) % b.every === 0 && pick(ctx, camp, t.x, t.y, b.radius, 1) > 0) {
      camp.attack = BossAttack.Blast;
      camp.attackX = t.x;
      camp.attackY = t.y;
      camp.attackStart = tick;
      camp.attacks++;
      camp.attackWait = p.intervalSeconds;
      continue;
    }
    if (pick(ctx, camp, t.x, t.y, p.range, p.targets) === 0) continue; // fires as soon as someone is in reach
    camp.attacks++;
    for (let k = 0; k < picked.length; k++) {
      const ot = transforms.get(picked[k]!)!;
      u.lobs.spawn(e, Team.Neutral, t.x, t.y, ot.x, ot.y, p.flightSeconds, LobKind.Shell, p.damage, p.radius, p.arcHeight);
    }
    const first = transforms.get(picked[0]!)!;
    t.facing = atan2(first.y - t.y, first.x - t.x); // the barrel follows the first target
    camp.attackWait = p.intervalSeconds;
  }
}

/** Fills `picked` with up to `count` of the camp's attackers within `reach` of (x, y) and in sight, nearest first (ties by id); a selection pass per pick, no sort or allocation. */
function pick(ctx: CampContext, camp: Camp, x: number, y: number, reach: number, count: number): number {
  picked.length = 0;
  while (picked.length < count) {
    let best: Entity = 0;
    let bestD = Infinity;
    for (let k = 0; k < camp.attackers.length; k++) {
      const o = camp.attackers[k]!;
      if (picked.includes(o)) continue;
      const ot = ctx.transforms.get(o)!;
      const d = len(ot.x - x, ot.y - y);
      if (d - (ctx.colliders.get(o)?.radius ?? 0) > reach || !ctx.clear(x, y, ot.x, ot.y)) continue;
      if (d < bestD || (d === bestD && o < best)) {
        best = o;
        bestD = d;
      }
    }
    if (best === 0) break;
    picked.push(best);
  }
  return picked.length;
}

type HalftrackPattern = Extract<NonNullable<Config['neutrals']['camps']['halftrack']['boss']>['pattern'], { kind: 'halftrack' }>;

/** The Halftrack's windup ends: everyone in the locked shape is hit; a charge then drives down its strip. */
function resolve(u: UltimateContext, camp: Camp, e: Entity, p: HalftrackPattern) {
  const spray = camp.attack === BossAttack.Spray;
  const list = spray
    ? enemiesInCone(u, camp.attackX, camp.attackY, camp.attackAngle, p.range, p.spray.angle, Team.Neutral)
    : enemiesInStrip(u, camp.attackX, camp.attackY, camp.attackAngle, p.charge.length, p.charge.width, Team.Neutral, maxRadius(u.colliders));
  const damage = spray ? p.spray.damage : p.charge.damage;
  for (let k = 0; k < list.length; k++) u.hits.push(e, list[k]!, damage);
  if (!spray) camp.driveTicks = Math.ceil(p.charge.length / (p.charge.speed / TICK_HZ));
  camp.attack = BossAttack.None;
}
