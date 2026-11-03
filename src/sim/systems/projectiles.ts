import type { Config } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { ProjectilePool } from '../projectiles';
import type { Collider, Health, Team, Transform } from '../sim';
import type { SpatialIndex } from '../spatial';
import type { HitQueue } from '../hits';

export interface ProjectileContext {
  pool: ProjectilePool;
  transforms: Store<Transform>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  spatial: SpatialIndex;
  hits: HitQueue;
}

const nearby: Entity[] = [];

/**
 * Advances every bullet one tick with a swept segment-vs-circle test (TDD §6.3), so fast
 * bullets never tunnel. A straight bullet hits the first living enemy unit along its path
 * (allies don't block); a homing bullet steers onto its target and hits only that. Hits are
 * queued for the damage stage. A rocket also hits every other enemy in its splash. Bullets
 * that fly their full distance expire.
 */
export function projectileSystem(ctx: ProjectileContext, cfg: Config['combat']['weapons']) {
  const { pool, transforms, colliders, teams, healths, spatial, hits } = ctx;
  let maxRadius = 0;
  for (let i = 0; i < colliders.data.length; i++) maxRadius = Math.max(maxRadius, colliders.data[i]!.radius);

  for (let i = 0; i < pool.capacity; i++) {
    if (!pool.active[i]) continue;
    const target = pool.target[i]!;
    const homing = pool.homing[i] === 1;
    if (homing) {
      const tt = transforms.get(target);
      const th = healths.get(target);
      if (tt && th && th.hp > 0) {
        const dx = tt.x - pool.x[i]!;
        const dy = tt.y - pool.y[i]!;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1e-9) {
          pool.vx[i] = (dx / d) * pool.speed[i]!;
          pool.vy[i] = (dy / d) * pool.speed[i]!;
        }
      }
    }
    const ax = pool.x[i]!;
    const ay = pool.y[i]!;
    const bx = ax + pool.vx[i]!;
    const by = ay + pool.vy[i]!;
    const team = pool.team[i]!;

    spatial.query((ax + bx) / 2, (ay + by) / 2, pool.speed[i]! / 2 + maxRadius + cfg.bulletRadius, nearby);
    let hit: Entity = 0;
    let hitAt = Infinity;
    for (let k = 0; k < nearby.length; k++) {
      const c = nearby[k]!;
      if (homing ? c !== target : teams.get(c) === team) continue;
      const h = healths.get(c);
      if (!h || h.hp <= 0) continue;
      const ct = transforms.get(c)!;
      const at = segmentCircle(ax, ay, bx, by, ct.x, ct.y, (colliders.get(c)?.radius ?? 0) + cfg.bulletRadius);
      if (at >= 0 && at < hitAt) {
        hit = c;
        hitAt = at;
      }
    }
    if (hit !== 0) {
      const owner = pool.owner[i]!;
      const sm = pool.structureMult[i]!;
      hits.push(owner, hit, pool.damage[i]!, pool.critMult[i]!, sm);
      // A rocket bursts where it hits: every other living enemy within the splash takes the same hit (ascending id, from the spatial query).
      const splash = pool.splash[i]!;
      if (splash > 0) {
        const ix = ax + (bx - ax) * hitAt;
        const iy = ay + (by - ay) * hitAt;
        spatial.query(ix, iy, splash + maxRadius, nearby);
        for (let k = 0; k < nearby.length; k++) {
          const c = nearby[k]!;
          if (c === hit || teams.get(c) === team) continue;
          const h = healths.get(c);
          if (!h || h.hp <= 0) continue;
          const ct = transforms.get(c)!;
          const dx = ct.x - ix;
          const dy = ct.y - iy;
          if (Math.sqrt(dx * dx + dy * dy) - (colliders.get(c)?.radius ?? 0) <= splash) hits.push(owner, c, pool.damage[i]!, pool.critMult[i]!, sm);
        }
      }
      pool.release(i);
      continue;
    }
    pool.x[i] = bx;
    pool.y[i] = by;
    if (--pool.life[i]! <= 0) pool.release(i);
  }
}

/** First 0..1 position along segment ab inside the circle (c, r); 0 if a starts inside; −1 if it misses. */
export function segmentCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const fx = ax - cx;
  const fy = ay - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a === 0) return -1;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
