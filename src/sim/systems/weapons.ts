import { TICK_HZ, type Config } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import { atan2, cos, sin, turnTowards, wrapAngle } from '../math';
import type { ProjectilePool } from '../projectiles';
import type { Rng } from '../rng';
import type { Collider, Health, Motion, Targeting, Team, Transform, Weapon } from '../sim';
import { Stat, stat, type Stats } from '../stats';

export interface WeaponsContext {
  transforms: Store<Transform>;
  motions: Store<Motion>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  weapons: Store<Weapon>;
  targetings: Store<Targeting>;
  stats: Store<Stats>;
  pool: ProjectilePool;
  events: SimEvent[];
  /** Seeded stream for critical-hit rolls. */
  crit: Rng;
  /** Damage multiplier for a shot fired now (structure warm-up); 1 for most shooters. */
  shotMultiplier(e: Entity, target: Entity): number;
  /** A second target for weapons that hit two (HQ flak), or 0. */
  secondaryOf(e: Entity): Entity;
  rangeOf(e: Entity): number;
}

/**
 * Aims and fires (TDD §6.3). The aim (upper body) turns towards the target at `aimTurnRate`
 * and the weapon fires only within `fireCone` of it, once the cooldown is ready and any
 * retarget pause is over. Bullets fly straight at where the target will be (lead), where it
 * is (direct), or home onto it, per `bulletAim`. The cooldown counts down by the fire-rate
 * stat each tick and carries the remainder, so +20% fire rate gives exactly 1.2× the shots.
 * Bullets carry the weapon's base damage; every modifier is applied when they hit (TDD §6.4).
 * Each shot rolls `critChance` on the seeded `crit` stream (only when the chance is above 0);
 * a crit carries `critMultiplier` into the damage pipeline.
 */
export function weaponsSystem(shooters: readonly Entity[], ctx: WeaponsContext, cfg: Config['combat']['weapons'], critMultiplier: number) {
  const { transforms, motions, colliders, teams, healths, weapons, targetings, stats, pool, events } = ctx;
  const turnPerTick = cfg.aimTurnRate / TICK_HZ;

  for (let i = 0; i < shooters.length; i++) {
    const e = shooters[i]!;
    const w = weapons.get(e);
    const tg = targetings.get(e);
    const t = transforms.get(e);
    const self = healths.get(e);
    if (!w || !tg || !t || !self || self.hp <= 0) continue;

    const st = stats.get(e);
    if (w.cooldown > 0) w.cooldown -= st ? stat(st, Stat.FireRate) : 1;

    const target = tg.targetId;
    const tt = target !== 0 ? transforms.get(target) : undefined;
    const th = target !== 0 ? healths.get(target) : undefined;
    if (!tt || !th || th.hp <= 0) {
      w.aim = turnTowards(w.aim, t.facing, turnPerTick); // no target: the upper body follows the legs
      continue;
    }

    // Where to shoot.
    let ax = tt.x;
    let ay = tt.y;
    if (cfg.bulletAim === 'lead') {
      const m = motions.get(target);
      if (m) {
        const lead = interceptTime(tt.x - t.x, tt.y - t.y, m.vx, m.vy, w.projectileSpeed);
        ax += m.vx * lead;
        ay += m.vy * lead;
      }
    }
    const desired = atan2(ay - t.y, ax - t.x);
    w.aim = turnTowards(w.aim, desired, turnPerTick);

    if (tg.holdTicks > 0 || w.cooldown > 0 || Math.abs(wrapAngle(desired - w.aim)) > cfg.fireCone) continue;

    const perTick = w.projectileSpeed / TICK_HZ;
    const dx = cos(desired);
    const dy = sin(desired);
    const muzzle = colliders.get(e)?.radius ?? 0;
    const life = Math.ceil((ctx.rangeOf(e) + cfg.bulletOvershoot) / perTick);
    const critMult = w.critChance > 0 && ctx.crit() < w.critChance ? critMultiplier : 1;
    const boost = ctx.shotMultiplier(e, target);
    const team = teams.get(e)!;
    pool.spawn(e, team, target, cfg.bulletAim === 'homing', t.x + dx * muzzle, t.y + dy * muzzle, dx * perTick, dy * perTick, w.damage * boost, critMult, life, boost);
    w.cooldown += w.interval;
    events.push({ type: 'shot', id: e, target });

    // A second bullet at the second target (HQ flak hits two, TDD §6.3), aimed straight at it.
    const second = w.targets >= 2 ? ctx.secondaryOf(e) : 0;
    const st2 = second !== 0 ? transforms.get(second) : undefined;
    if (st2) {
      let bx = st2.x;
      let by = st2.y;
      const m2 = cfg.bulletAim === 'lead' ? motions.get(second) : undefined;
      if (m2) {
        const lead = interceptTime(st2.x - t.x, st2.y - t.y, m2.vx, m2.vy, w.projectileSpeed);
        bx += m2.vx * lead;
        by += m2.vy * lead;
      }
      const dir2 = atan2(by - t.y, bx - t.x);
      const ux = cos(dir2);
      const uy = sin(dir2);
      pool.spawn(e, team, second, cfg.bulletAim === 'homing', t.x + ux * muzzle, t.y + uy * muzzle, ux * perTick, uy * perTick, w.damage, critMult, life, 1);
      events.push({ type: 'shot', id: e, target: second });
    }
  }
}

/**
 * Earliest time (s) at which a bullet of speed `s` fired now from the origin meets a target
 * at (px, py) moving at (vx, vy); 0 if it can't (fire straight at it instead).
 */
export function interceptTime(px: number, py: number, vx: number, vy: number, s: number): number {
  const a = vx * vx + vy * vy - s * s;
  const b = 2 * (px * vx + py * vy);
  const c = px * px + py * py;
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  const t = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  return t > 0 ? t : 0;
}
