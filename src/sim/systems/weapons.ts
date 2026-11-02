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
    pool.spawn(e, teams.get(e)!, target, cfg.bulletAim === 'homing', t.x + dx * muzzle, t.y + dy * muzzle, dx * perTick, dy * perTick, w.damage, critMult, life);
    w.cooldown += w.interval;
    events.push({ type: 'shot', id: e, target });
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
