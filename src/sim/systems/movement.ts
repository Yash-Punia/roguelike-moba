import type { MapConfig } from '../../data/schema';
import type { Store } from '../ecs';
import { isBlocked, type ObstacleGrid } from '../grid';
import { atan2, len } from '../math';
import type { Collider, Health, Motion, Transform } from '../sim';

const RESOLVE_PASSES = 3;

/**
 * Moves every unit by intent × speed, then pushes its circle out of blocked cells so it
 * slides along walls, and clamps it inside the map (TDD §6.1).
 * ponytail: no swept test; fine while a tick's step (≤0.2 m) is well under a radius.
 */
export function movementSystem(
  motions: Store<Motion>,
  transforms: Store<Transform>,
  colliders: Store<Collider>,
  healths: Store<Health>,
  grid: ObstacleGrid,
  bounds: MapConfig['bounds'],
  dt: number,
) {
  for (let i = 0; i < motions.ids.length; i++) {
    const e = motions.ids[i]!;
    const m = motions.data[i]!;
    const t = transforms.get(e);
    if (!t) continue;
    const h = healths.get(e);
    if (h && h.hp <= 0) {
      m.vx = m.vy = 0; // knocked out: stays where it fell
      continue;
    }
    const r = colliders.get(e)?.radius ?? 0;

    let ix = m.intentX;
    let iy = m.intentY;
    const mag = len(ix, iy);
    if (mag > 1) {
      ix /= mag;
      iy /= mag;
    }
    m.vx = ix * m.speed;
    m.vy = iy * m.speed;
    if (m.vx === 0 && m.vy === 0) continue;

    let x = t.x + m.vx * dt;
    let y = t.y + m.vy * dt;
    for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
      const pushed = resolve(grid, x, y, r);
      if (!pushed) break;
      x = pushed.x;
      y = pushed.y;
    }
    x = Math.min(bounds.maxX - r, Math.max(bounds.minX + r, x));
    y = Math.min(bounds.maxY - r, Math.max(bounds.minY + r, y));

    // Actual velocity after collision, so render look-ahead and interpolation stay honest.
    m.vx = (x - t.x) / dt;
    m.vy = (y - t.y) / dt;
    t.x = x;
    t.y = y;
    t.facing = atan2(iy, ix);
  }
}

/** Pushes a circle out of the most-penetrating blocked cell, or returns null if clear. */
function resolve(g: ObstacleGrid, x: number, y: number, r: number): { x: number; y: number } | null {
  const c0 = Math.floor((x - r - g.minX) / g.cell);
  const c1 = Math.floor((x + r - g.minX) / g.cell);
  const r0 = Math.floor((y - r - g.minY) / g.cell);
  const r1 = Math.floor((y + r - g.minY) / g.cell);
  let best = 0;
  let px = 0;
  let py = 0;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!isBlocked(g, col, row)) continue;
      const left = g.minX + col * g.cell;
      const bottom = g.minY + row * g.cell;
      const cx = Math.min(Math.max(x, left), left + g.cell);
      const cy = Math.min(Math.max(y, bottom), bottom + g.cell);
      const dx = x - cx;
      const dy = y - cy;
      const d = len(dx, dy);
      if (d >= r) continue;
      let nx: number;
      let ny: number;
      let depth: number;
      if (d > 1e-9) {
        nx = dx / d;
        ny = dy / d;
        depth = r - d;
      } else {
        // Centre inside the cell: push out along the shallowest axis.
        const toL = x - left + r;
        const toR = left + g.cell - x + r;
        const toB = y - bottom + r;
        const toT = bottom + g.cell - y + r;
        depth = Math.min(toL, toR, toB, toT);
        nx = depth === toL ? -1 : depth === toR ? 1 : 0;
        ny = nx !== 0 ? 0 : depth === toB ? -1 : 1;
      }
      if (depth > best) {
        best = depth;
        px = nx * depth;
        py = ny * depth;
      }
    }
  }
  return best > 0 ? { x: x + px, y: y + py } : null;
}
