import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import type { MapConfig, PropKind } from '../src/data/schema';
import { rasterise } from '../src/data/map-geometry';
import { planDressing, propTemplate } from '../src/render/dressing';
import { Team } from '../src/sim/sim';

const load = (lanes: 2 | 3) => parseConfig({ ...rawConfig, map: maps[lanes] }).map;

/** Over 1.2 m, so it must stay off the lanes (EN-01). Flags are bare poles and stand by the pad as EN-01 draws them. */
const TALL: readonly PropKind[] = ['tent', 'searchlight'];

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
    for (const kind of ['tent', 'flag', 'searchlight', 'crates', 'drums', 'sandbagWall'] as const) {
      expect(propTemplate(kind, Team.Blue).attributes.position!.count / 3, kind).toBeLessThanOrEqual(500);
    }
  });
});
