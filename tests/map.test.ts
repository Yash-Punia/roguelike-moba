import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { buildLanes, rasterise, sampleSpline, segmentDistSq } from '../src/data/map-geometry';
import { buildGrid, type ObstacleGrid } from '../src/sim/grid';
import { fnv1a } from '../src/sim/rng';
import { reachable } from './helpers';

const map = parseConfig(rawConfig).map;

const blockedAt = (g: ObstacleGrid, x: number, y: number) =>
  g.blocked[Math.floor((y - g.minY) / g.cell) * g.cols + Math.floor((x - g.minX) / g.cell)] === 1;

describe('map v2: The Front', () => {
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
    ['left lane mid', -25, -4],
    ['right lane mid', 25, 4],
    ['Blue left Sub-base lane', -27.5, -44],
    ['Red right Sub-base lane', 27.5, 44],
    ['Field Gun arena', 14.5, -35],
    ['Halftrack arena', -14.5, 35],
    ['deserter camp C1', -14, -44],
    ['medkit room M4', 9, 56],
    ['sniper nest S3', -18, 17],
    ['trench S4 → C4', 14.5, 35],
    ['branch → right lane trench', 18.5, 2.5],
  ])('%s at (%d, %d) is walkable', (_, x, y) => {
    expect(blockedAt(grid, x, y)).toBe(false);
  });

  it.each([
    ['jungle beside the trunk', 8, -48],
    ['jungle between left lane and the S1–C1 trench', -19, -35],
    ['jungle between Halftrack and centre', -8, 38],
    ['rock rim between Crater and branch', 10, 6],
    ['jungle outside the branch', -22, 0],
    ['map corner', -33, 80],
  ])('%s at (%d, %d) is blocked', (_, x, y) => {
    expect(blockedAt(grid, x, y)).toBe(true);
  });

  it('connects Blue spawn to Red spawn along the lane', () => {
    expect(reachable(grid, map.spawn.blue, map.spawn.red)).toBe(true);
  });

  it('has the spec layout: 3 lanes, 6 Sub-bases, 12 rooms, 2 mini-boss arenas', () => {
    expect(map.lanes.map((l) => l.id)).toEqual(['left', 'centre', 'right']);
    expect(map.structures.filter((p) => p.kind === 'subBase').map((p) => p.lane)).toEqual(['left', 'centre', 'right', 'left', 'centre', 'right']);
    expect(map.walkable.filter((w) => w.id.startsWith('room-'))).toHaveLength(12);
    expect(map.walkable.filter((w) => w.id.startsWith('arena-'))).toHaveLength(2);
  });

  it('mirrors every trench to a twin at (−x, −y)', () => {
    const key = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
    const trenches = map.walkable.filter((w) => w.shape === 'path' && w.surface === 'trench');
    const all = new Set(trenches.map((w) => (w.shape === 'path' ? key(w.points) : '')));
    for (const w of trenches) if (w.shape === 'path') expect(all.has(key(w.points.map((p) => ({ x: -p.x || 0, y: -p.y || 0 }))))).toBe(true);
    // 375 m of trench in the spec.
    let length = 0;
    for (const w of trenches) if (w.shape === 'path') for (let i = 1; i < w.points.length; i++) length += Math.hypot(w.points[i]!.x - w.points[i - 1]!.x, w.points[i]!.y - w.points[i - 1]!.y);
    expect(length).toBeGreaterThan(370);
    expect(length).toBeLessThan(380);
  });

  it('reaches every room and arena from the Blue spawn', () => {
    for (const w of map.walkable) {
      if (w.shape !== 'circle') continue;
      expect(reachable(grid, map.spawn.blue, { x: w.x, y: w.y }), w.id).toBe(true);
    }
  });

  it('puts every Sub-base on its lane centre line', () => {
    const lanes = buildLanes(map);
    for (const p of map.structures) {
      if (p.kind !== 'subBase') continue;
      const pts = lanes.find((l) => l.id === p.lane)!.branches[0]!;
      let best = Infinity;
      for (let k = 0; k + 3 < pts.length; k += 2) best = Math.min(best, segmentDistSq(p.x, p.y, pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!).distSq);
      expect(Math.sqrt(best), p.id).toBeLessThan(0.5);
    }
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
