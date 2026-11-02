import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { rasterise, sampleSpline } from '../src/data/map-geometry';
import { buildGrid, type ObstacleGrid } from '../src/sim/grid';
import { fnv1a } from '../src/sim/rng';

const map = parseConfig(rawConfig).map;

const blockedAt = (g: ObstacleGrid, x: number, y: number) =>
  g.blocked[Math.floor((y - g.minY) / g.cell) * g.cols + Math.floor((x - g.minX) / g.cell)] === 1;

/** 4-connected flood fill over open cells; returns whether `to` is reachable from `from`. */
function reachable(g: ObstacleGrid, from: { x: number; y: number }, to: { x: number; y: number }) {
  const idx = (p: { x: number; y: number }) => Math.floor((p.y - g.minY) / g.cell) * g.cols + Math.floor((p.x - g.minX) / g.cell);
  const seen = new Uint8Array(g.blocked.length);
  const stack = [idx(from)];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    if (i === idx(to)) return true;
    const c = i % g.cols;
    for (const n of [i - 1, i + 1, i - g.cols, i + g.cols]) {
      if (n < 0 || n >= g.blocked.length || seen[n] || g.blocked[n]) continue;
      if ((n === i - 1 && c === 0) || (n === i + 1 && c === g.cols - 1)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return false;
}

describe('map v2: The Front (centre lane)', () => {
  const grid = buildGrid(map);

  it('rasterises 68 × 164 m at 0.5 m into 136 × 328 cells', () => {
    expect(grid.cols).toBe(136);
    expect(grid.rows).toBe(328);
  });

  it('builds the same grid every time', () => {
    const hash = (g: ObstacleGrid) => fnv1a(Array.from(g.blocked).join(''));
    expect(hash(buildGrid(map))).toBe(hash(grid));
  });

  it('passes through every control point at the ends of a spline', () => {
    const pts = sampleSpline([{ x: 0, y: 0 }, { x: 3, y: 5 }, { x: -1, y: 9 }], 4);
    expect(pts.length).toBe((2 * 4 + 1) * 2);
    expect([pts[0], pts[1]]).toEqual([0, 0]);
    expect([pts[8], pts[9]]).toEqual([3, 5]);
    expect([pts[16], pts[17]]).toEqual([-1, 9]);
  });

  it.each([
    ['Blue spawn pad', 0, -66.5],
    ['Red spawn pad', 0, 66.5],
    ['Blue centre Sub-base', 1, -40],
    ['Red centre Sub-base', -1, 40],
    ['Crater floor', 0, 0],
    ['west branch', -15, 0],
    ['east branch', 15, 0],
    ['Blue base edge', 20, -71],
  ])('%s at (%d, %d) is walkable', (_, x, y) => {
    expect(blockedAt(grid, x, y)).toBe(false);
  });

  it.each([
    ['jungle beside the trunk', 12, -40],
    ['rock rim between Crater and branch', 10, 6],
    ['jungle outside the branch', -22, 0],
    ['map corner', -33, 80],
    ['Blue HQ footprint', 0, -72],
  ])('%s at (%d, %d) is blocked', (_, x, y) => {
    expect(blockedAt(grid, x, y)).toBe(true);
  });

  it('connects Blue spawn to Red spawn along the lane', () => {
    expect(reachable(grid, map.spawn.blue, map.spawn.red)).toBe(true);
  });

  it('later shapes paint over earlier ones', () => {
    const r = rasterise(map);
    const at = (x: number, y: number) => r.owner[Math.floor((y - r.minY) / r.cell) * r.cols + Math.floor((x - r.minX) / r.cell)];
    const ids = map.walkable.map((s) => s.id);
    expect(ids[at(0, -66)!]).toBe('centre-blue'); // lane over apron
    expect(ids[at(0, 0)!]).toBe('crater');
    expect(ids[at(0, 12)!]).toBe('crater-ramp-n');
  });
});
