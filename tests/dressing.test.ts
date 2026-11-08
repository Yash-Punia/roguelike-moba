import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import type { MapConfig } from '../src/data/schema';
import { rasterise } from '../src/data/map-geometry';
import { planDressing, propKinds, propTemplate } from '../src/render/dressing';
import { Team } from '../src/sim/sim';

const load = (lanes: 2 | 3) => parseConfig({ ...rawConfig, map: maps[lanes] }).map;

/** Over 1.2 m, so it must stay off the lanes (EN-01). Flags are bare poles and stand by the pad as EN-01 draws them. */
const TALL: readonly string[] = ['tent', 'searchlight', 'pole', 'tree', 'biplane'];

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
    for (const p of plan) {
      if (p.kind === 'wire' || p.kind === 'traps' || p.kind === 'scorch') expect(Math.abs(p.y)).toBeLessThanOrEqual(map.dressing.middleBandY);
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

describe('prop templates', () => {
  it('stay within the SG-01 prop budget', () => {
    for (const kind of propKinds) {
      expect(propTemplate(kind, Team.Blue).attributes.position!.count / 3, kind).toBeLessThanOrEqual(500);
    }
  });
});
