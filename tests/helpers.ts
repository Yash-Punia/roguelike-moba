import { parseConfig, rawConfig } from '../src/data/load';
import type { Config, RawConfig } from '../src/data/schema';
import type { ObstacleGrid } from '../src/sim/grid';
import openMap from './fixtures/map-open.json';

/** Shipped config on a fixed open test map (36 × 110 m, all walkable), so tests don't move when the real map does. */
export function fixtureConfig(): Config {
  return parseConfig({ ...rawConfig, map: openMap as RawConfig['map'] });
}

type Point = { x: number; y: number };

/** 4-connected flood fill over open grid cells: can a unit get from `from` to `to` at all? */
export function reachable(g: ObstacleGrid, from: Point, to: Point): boolean {
  const idx = (p: Point) => Math.floor((p.y - g.minY) / g.cell) * g.cols + Math.floor((p.x - g.minX) / g.cell);
  const goal = idx(to);
  const seen = new Uint8Array(g.blocked.length);
  const stack = [idx(from)];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    if (i === goal) return true;
    const c = i % g.cols;
    const next = [c > 0 ? i - 1 : -1, c < g.cols - 1 ? i + 1 : -1, i - g.cols, i + g.cols];
    for (const n of next) {
      if (n < 0 || n >= g.blocked.length || seen[n] || g.blocked[n]) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return false;
}
