import { TICK_HZ, type Config } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import type { HitQueue } from '../hits';
import { asin, atan2, cos, len, sin, turnTowards, wrapAngle } from '../math';
import type { ProjectilePool } from '../projectiles';
import type { Rng } from '../rng';
import type { Collider, Health, Motion, Targeting, Team, Transform, Weapon } from '../sim';
import type { SpatialIndex } from '../spatial';
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
  /** Cone weapons hit directly, through the hit queue. */
  hits: HitQueue;
  spatial: SpatialIndex;
  events: SimEvent[];
  /** Seeded stream for critical-hit rolls. */
  crit: Rng;
  /** Seeded stream for bullet spread. */
  spread: Rng;
  /** True while the unit can't use its weapon (channelling an Ultimate). */
  holdFire(e: Entity): boolean;
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
 * a crit carries `critMultiplier` into the damage pipeline. A cone weapon (Gamma) aims the
 * same way but fires no projectile: each flame hits every enemy in its sector at once.
 */
export function weaponsSystem(shooters: readonly Entity[], ctx: WeaponsContext, cfg: Config['combat']['weapons'], critMultiplier: number, tick: number) {
  const { transforms, motions, healths, weapons, targetings, stats } = ctx;
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
    if (ctx.holdFire(e)) {
      w.burstLeft = 0;
      continue;
    }

    const target = tg.targetId;
    const tt = target !== 0 ? transforms.get(target) : undefined;
    const th = target !== 0 ? healths.get(target) : undefined;
    if (!tt || !th || th.hp <= 0) {
      w.aim = turnTowards(w.aim, t.facing, turnPerTick); // no target: the upper body follows the legs
      burst(e, w, t, ctx, cfg, critMultiplier);
      continue;
    }

    // Where to shoot.
    let ax = tt.x;
    let ay = tt.y;
    if (cfg.bulletAim === 'lead' && w.kind !== 'cone') {
      const m = motions.get(target);
      if (m) {
        const lead = interceptTime(tt.x - t.x, tt.y - t.y, m.vx, m.vy, w.projectileSpeed);
        ax += m.vx * lead;
        ay += m.vy * lead;
      }
    }
    const desired = atan2(ay - t.y, ax - t.x);
    w.aim = turnTowards(w.aim, desired, turnPerTick);
    if (burst(e, w, t, ctx, cfg, critMultiplier)) continue; // a burst in flight finishes first

    if (tg.holdTicks > 0 || w.cooldown > 0 || Math.abs(wrapAngle(desired - w.aim)) > cfg.fireCone) continue;

    const critMult = critRoll(w, ctx, critMultiplier);
    w.lastShotTick = tick;
    if (w.kind === 'cone') {
      flame(e, w, t, ctx, critMult);
      w.cooldown += w.interval;
      continue;
    }
    const boost = ctx.shotMultiplier(e, target);
    fire(e, w, t, ctx, cfg, target, desired, w.damage * boost, critMult, boost);
    w.cooldown += w.interval;
    // A burst weapon (Beta's SMG) queues the rest along its aim, `burstGapSeconds` apart (TDD §6.3).
    w.burstLeft = w.burstCount - 1;
    w.burstWait = w.burstGapSeconds;
    w.burstTarget = target;

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
      fire(e, w, t, ctx, cfg, second, atan2(by - t.y, bx - t.x), w.damage, critMult, 1);
    }
  }
}

const nearby: Entity[] = [];
/** Largest collider radius a cone can reach past its range for (an HQ's footprint). */
const CONE_REACH = 4;

/**
 * One flame (TDD §6.3 `cone`): every living enemy whose collider overlaps the sector `range`
 * long and `coneAngle` wide along the aim takes the weapon's damage, in ascending ids. Flames
 * pass over sandbag walls, so nothing blocks them.
 */
function flame(e: Entity, w: Weapon, t: Transform, ctx: WeaponsContext, critMult: number) {
  const range = ctx.rangeOf(e);
  const half = w.coneAngle / 2;
  const team = ctx.teams.get(e);
  ctx.spatial.query(t.x, t.y, range + CONE_REACH, nearby);
  for (let k = 0; k < nearby.length; k++) {
    const o = nearby[k]!;
    if (o === e || ctx.teams.get(o) === team) continue;
    const h = ctx.healths.get(o);
    if (!h || h.hp <= 0) continue;
    const ot = ctx.transforms.get(o)!;
    const r = ctx.colliders.get(o)?.radius ?? 0;
    const d = len(ot.x - t.x, ot.y - t.y);
    if (d - r > range) continue;
    // Within the half-angle, widened by the angle the collider covers at its distance.
    if (d > r && Math.abs(wrapAngle(atan2(ot.y - t.y, ot.x - t.x) - w.aim)) > half + asin(r / d)) continue;
    ctx.hits.push(e, o, w.damage, critMult);
  }
  ctx.events.push({ type: 'shot', id: e, target: 0 });
}

const critRoll = (w: Weapon, ctx: WeaponsContext, mult: number) => (w.critChance > 0 && ctx.crit() < w.critChance ? mult : 1);

/** One bullet towards `dir`, turned by up to ± the weapon's spread (rolled on the seeded `spread` stream). */
function fire(e: Entity, w: Weapon, t: Transform, ctx: WeaponsContext, cfg: Config['combat']['weapons'], target: Entity, dir: number, damage: number, critMult: number, boost: number) {
  if (w.spread > 0) dir += (ctx.spread() * 2 - 1) * w.spread;
  const perTick = w.projectileSpeed / TICK_HZ;
  const dx = cos(dir);
  const dy = sin(dir);
  const muzzle = ctx.colliders.get(e)?.radius ?? 0;
  const life = Math.ceil((ctx.rangeOf(e) + cfg.bulletOvershoot) / perTick);
  ctx.pool.spawn(e, ctx.teams.get(e)!, target, cfg.bulletAim === 'homing', t.x + dx * muzzle, t.y + dy * muzzle, dx * perTick, dy * perTick, damage, critMult, life, boost);
  ctx.events.push({ type: 'shot', id: e, target });
}

/**
 * The rest of a burst: the next bullet flies along the current aim once its gap has passed,
 * whether or not the target still stands (a burst is a trigger pull, not a lock). True while
 * bullets are still to come.
 */
function burst(e: Entity, w: Weapon, t: Transform, ctx: WeaponsContext, cfg: Config['combat']['weapons'], critMultiplier: number): boolean {
  if (w.burstLeft <= 0) return false;
  if (--w.burstWait <= 0) {
    const boost = ctx.shotMultiplier(e, w.burstTarget);
    fire(e, w, t, ctx, cfg, w.burstTarget, w.aim, w.damage * boost, critRoll(w, ctx, critMultiplier), boost);
    w.burstLeft--;
    w.burstWait = w.burstGapSeconds;
  }
  return w.burstLeft > 0;
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
