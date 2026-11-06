import { cos, len, sin } from './math';
import type { TelegraphSnapshot } from './sim';

/**
 * Is a unit of radius `margin` at (x, y) inside telegraph `t` (D-078)? Used by scripted dodges
 * and, later, by bots dodging (TDD §7).
 */
export function inTelegraph(t: TelegraphSnapshot, x: number, y: number, margin = 0): boolean {
  if (t.shape === 'circle') return len(x - t.x, y - t.y) <= t.radius + margin;
  const dx = cos(t.angle);
  const dy = sin(t.angle);
  const along = (x - t.x) * dx + (y - t.y) * dy;
  const across = (y - t.y) * dx - (x - t.x) * dy;
  return along >= -margin && along <= t.length + margin && Math.abs(across) <= t.width / 2 + margin;
}
