import { cos, len, sin } from '../math';
import type { TelegraphSnapshot } from '../sim';

/**
 * The two ways out of telegraph `t` for a body at (x, y) needing `clear` metres past the edge
 * (TDD §7, D-085): the near side first, then the far side. A circle's ways out are along the
 * line from its centre; a strip's and a cone's are square to its axis (a cone's edge measured
 * at the body's distance along it). Writes the exit points and returns the near side's walk.
 */
export function exits(t: TelegraphSnapshot, x: number, y: number, clear: number, near: { x: number; y: number }, far: { x: number; y: number }): number {
  if (t.shape === 'circle') {
    let dx = x - t.x;
    let dy = y - t.y;
    const r = len(dx, dy);
    let d = r;
    if (d < 1e-3) {
      dx = 1; // dead centre: any way works, this one is fixed so it stays deterministic
      dy = 0;
      d = 1;
    }
    const out = t.radius + clear;
    near.x = t.x + (dx / d) * out;
    near.y = t.y + (dy / d) * out;
    far.x = t.x - (dx / d) * out;
    far.y = t.y - (dy / d) * out;
    return out - r;
  }
  const ux = cos(t.angle);
  const uy = sin(t.angle);
  const along = (x - t.x) * ux + (y - t.y) * uy;
  const across = (y - t.y) * ux - (x - t.x) * uy;
  const half = t.shape === 'strip' ? t.width / 2 : (Math.max(0, along) * sin(t.arc / 2)) / cos(t.arc / 2);
  const side = across >= 0 ? 1 : -1;
  // The normal on the body's side is (−uy, ux) × side.
  const nx = -uy * side;
  const ny = ux * side;
  const walkNear = half + clear - Math.abs(across);
  const walkFar = half + clear + Math.abs(across);
  near.x = x + nx * walkNear;
  near.y = y + ny * walkNear;
  far.x = x - nx * walkFar;
  far.y = y - ny * walkFar;
  return walkNear;
}
