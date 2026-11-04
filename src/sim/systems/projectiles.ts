import type { Config } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { ProjectilePool } from '../projectiles';
import type { Collider, Health, Team, Transform } from '../sim';
import type { SpatialIndex } from '../spatial';
import type { HitQueue } from '../hits';
import { rayBlocked, SHOT, type ObstacleGrid } from '../grid';

export interface ProjectileContext {
  pool: ProjectilePool;
  transforms: Store<Transform>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  spatial: SpatialIndex;
  hits: HitQueue;
  grid: () => ObstacleGrid;
}

const nearby: Entity[] = [];

/**
 * Advances every bullet one tick with a swept segment-vs-circle test (TDD §6.3), so fast
 * bullets never tunnel. A straight bullet hits the first living enemy unit along its path
 * (allies don't block); a homing bullet steers onto its target and hits only that. Hits are
 * queued for the damage stage. A rocket also hits every other enemy in its splash that the burst
 * has a clear line to. A sandbag or raised ground (GDD §4, D-018) stops any bullet before a unit
 * behind it; a rocket bursts there.
 * Bullets that fly their full distance expire. Powers (D-060): a bullet with pierce left flies
 * on through the unit it hits (never hitting it twice in a row); one with bounces left, when it
 * stops in a unit, sends a homing bullet for its share of the damage to the nearest other enemy
 * within reach that it has a clear shot at. Every hit here is a weapon hit.
 */
export function projectileSystem(ctx: ProjectileContext, cfg: Config['combat']['weapons']) {
  const { pool, transforms, colliders, teams, healths, spatial, hits } = ctx;
  const grid = ctx.grid();
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
      if (c === pool.lastHit[i] || (homing ? c !== target : teams.get(c) === team)) continue;
      const h = healths.get(c);
      if (!h || h.hp <= 0) continue;
      const ct = transforms.get(c)!;
      const at = segmentCircle(ax, ay, bx, by, ct.x, ct.y, (colliders.get(c)?.radius ?? 0) + cfg.bulletRadius);
      if (at >= 0 && at < hitAt) {
        hit = c;
        hitAt = at;
      }
    }
    const wall = rayBlocked(grid, ax, ay, bx, by, SHOT);
    if (wall >= 0 && wall <= hitAt) {
      hit = 0; // a wall is in the way first
      hitAt = Math.max(0, wall - 0.01); // burst just in front of it, not inside its cell
    }
    if (hitAt <= 1) {
      const owner = pool.owner[i]!;
      const sm = pool.structureMult[i]!;
      if (hit !== 0) hits.push(owner, hit, pool.damage[i]!, pool.critMult[i]!, sm, false, true);
      if (hit !== 0 && pool.pierce[i]! > 0) {
        pool.pierce[i]!--; // Piercing Rounds: on through it
        pool.lastHit[i] = hit;
        pool.x[i] = bx;
        pool.y[i] = by;
        if (--pool.life[i]! <= 0) pool.release(i);
        continue;
      }
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
          if (Math.sqrt(dx * dx + dy * dy) - (colliders.get(c)?.radius ?? 0) > splash || rayBlocked(grid, ix, iy, ct.x, ct.y, SHOT) >= 0) continue; // blast cover
          hits.push(owner, c, pool.damage[i]!, pool.critMult[i]!, sm, false, true);
        }
      }
      if (hit !== 0 && pool.bounces[i]! > 0) ricochet(ctx, i, hit, maxRadius, grid);
      pool.release(i);
      continue;
    }
    pool.x[i] = bx;
    pool.y[i] = by;
    if (--pool.life[i]! <= 0) pool.release(i);
  }
}

/** Ricochet: a homing bullet from the unit just hit to the nearest other living enemy within reach, with one bounce fewer. */
function ricochet(ctx: ProjectileContext, i: number, hit: Entity, maxRadius: number, grid: ObstacleGrid) {
  const { pool, transforms, teams, healths, colliders, spatial } = ctx;
  const from = transforms.get(hit)!;
  const reach = pool.bounceRadius[i]!;
  const team = pool.team[i]!;
  spatial.query(from.x, from.y, reach + maxRadius, nearby);
  let next: Entity = 0;
  let best = Infinity;
  for (let k = 0; k < nearby.length; k++) {
    const c = nearby[k]!;
    if (c === hit || teams.get(c) === team) continue;
    const h = healths.get(c);
    if (!h || h.hp <= 0) continue;
    const ct = transforms.get(c)!;
    const d = Math.sqrt((ct.x - from.x) ** 2 + (ct.y - from.y) ** 2) - (colliders.get(c)?.radius ?? 0);
    if (d <= reach && d < best && rayBlocked(grid, from.x, from.y, ct.x, ct.y, SHOT) < 0) {
      next = c;
      best = d;
    }
  }
  if (next === 0) return;
  const to = transforms.get(next)!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const speed = pool.speed[i]!;
  const j = pool.spawn(pool.owner[i]!, team, next, true, from.x, from.y, (dx / d) * speed, (dy / d) * speed, pool.damage[i]! * pool.bouncePct[i]!, 1, Math.ceil((reach * 2) / speed) + 2, 1, 0, pool.structureMult[i]!);
  pool.bounces[j] = pool.bounces[i]! - 1;
  pool.bounceRadius[j] = reach;
  pool.bouncePct[j] = pool.bouncePct[i]!;
  pool.lastHit[j] = hit;
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
