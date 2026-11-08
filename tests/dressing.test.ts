import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import type { MapConfig } from '../src/data/schema';
import { rasterise } from '../src/data/map-geometry';
import { planDressing, propKinds, propTemplate } from '../src/render/dressing';
import { Team } from '../src/sim/sim';

const load = (lanes: 2 | 3) => parseConfig({ ...rawConfig, map: maps[lanes] }).map;

/** Over 1.2 m, so it must stay off the lanes (EN-01). Flags are bare poles and stand by the pad as EN-01 draws them. */
const TALL: readonly string[] = ['tent', 'searchlight', 'pole', 'tree', 'biplane', 'ruinWall'];

function ownerAt(map: MapConfig, x: number, y: number) {
  const r = rasterise(map);
  const c = Math.floor((x - r.minX) / r.cell);
  const row = Math.floor((y - r.minY) / r.cell);
  return { r, shape: map.walkable[r.owner[row * r.cols + c]!] };
}

describe.each([3, 2] as const)('dressing on the %i-lane map', (lanes) => {
  const map = load(lanes);
  const plan = planDressing(map);

  it('keeps tall props off the lane paths', () => {
    for (const p of plan) {
      if (!TALL.includes(p.kind)) continue;
      const { shape } = ownerAt(map, p.x, p.y);
      expect(shape?.shape === 'path' && shape.surface === 'dirt', `${p.kind} at ${p.x}, ${p.y} on ${shape?.id}`).toBe(false);
    }
  });

  it('lines the outer lanes with poles and revetments on raised ground', () => {
    const line = plan.filter((p) => p.kind === 'pole' || p.kind === 'revetment');
    expect(line.length).toBeGreaterThan(16);
    expect(line.some((p) => p.kind === 'revetment')).toBe(true);
    for (const p of line) expect(ownerAt(map, p.x, p.y).shape, `${p.kind} at ${p.x}, ${p.y}`).toBeUndefined();
  });

  it('scatters craters and scenery only on the raised ground', () => {
    const scatter = plan.filter((p) => ['crater', 'scorch', 'wire', 'traps', 'tree', 'stump', 'rubble'].includes(p.kind));
    for (const p of scatter) expect(ownerAt(map, p.x, p.y).shape, `${p.kind} at ${p.x}, ${p.y}`).toBeUndefined();
    // "About" 60 / 48 (map spec): a piece with no free spot is dropped.
    const craters = plan.filter((p) => p.kind === 'crater').length;
    expect(craters).toBeGreaterThanOrEqual(map.dressing.craters * 0.9);
    expect(craters).toBeLessThanOrEqual(map.dressing.craters);
  });

  it('keeps wire, traps and scorch in the middle band', () => {
    const { minX, maxX, minY, maxY } = map.bounds;
    for (const p of plan) {
      const atEdge = Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) < 2; // the edge has its own tank traps
      if (p.kind === 'wire' || (p.kind === 'traps' && !atEdge) || p.kind === 'scorch') expect(Math.abs(p.y)).toBeLessThanOrEqual(map.dressing.middleBandY);
    }
  });

  it('rings the map edge with ruins on raised ground, clear of the caves', () => {
    const { minX, maxX, minY, maxY } = map.bounds;
    const edge = plan.filter((p) => Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y) < 2 && ['ruinWall', 'sandbagWall', 'tree', 'traps'].includes(p.kind));
    expect(edge.length).toBeGreaterThan(((maxX - minX + maxY - minY) * 2 * 0.6) / map.dressing.edgeSpacing);
    for (const p of edge) {
      expect(ownerAt(map, p.x, p.y).shape, `${p.kind} at ${p.x}, ${p.y}`).toBeUndefined();
      for (const c of map.caves) expect(Math.hypot(c.x - p.x, c.y - p.y)).toBeGreaterThanOrEqual(5);
    }
  });

  it('gives every prop a twin at (−x, −y)', () => {
    const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
    const seen = new Set(plan.map((p) => `${p.kind}@${key(p.x, p.y)}`));
    for (const p of plan) expect(seen.has(`${p.kind}@${key(-p.x, -p.y)}`), `${p.kind} at ${p.x}, ${p.y}`).toBe(true);
  });

  it('comes out the same every time', () => {
    expect(planDressing(map)).toEqual(plan);
  });
});

describe('river reeds', () => {
  it('line the banks of The Bridgehead on raised ground only', () => {
    const map = load(2);
    const reeds = planDressing(map).filter((p) => p.kind === 'reeds');
    expect(reeds.length).toBeGreaterThan(30);
    for (const p of reeds) expect(ownerAt(map, p.x, p.y).shape, `reeds at ${p.x}, ${p.y}`).toBeUndefined();
  });

  it('stay off The Front, which has no river', () => {
    expect(planDressing(load(3)).some((p) => p.kind === 'reeds')).toBe(false);
  });
});

describe('prop templates', () => {
  it('stay within the SG-01 prop budget', () => {
    for (const kind of propKinds) {
      expect(propTemplate(kind, Team.Blue).attributes.position!.count / 3, kind).toBeLessThanOrEqual(500);
    }
  });
});
