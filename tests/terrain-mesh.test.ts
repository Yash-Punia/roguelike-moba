import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { rasterise, signedDistance } from '../src/data/map-geometry';
import type { MapConfig } from '../src/data/schema';
import { buildTerrainGeometry, TAG_SLOPE, TAG_TOP } from '../src/render/terrain-mesh';

const straight = parseConfig(rawConfig).map;
const curved: MapConfig = { ...straight, splineSamples: 16 };

function areaOf(t: Float32Array, i: number) {
  const o = i * 9;
  const ax = t[o]!, ay = t[o + 1]!, bx = t[o + 3]!, by = t[o + 4]!, cx = t[o + 6]!, cy = t[o + 7]!;
  return ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}

describe.each([
  ['curved lanes', curved],
  ['straight lanes', straight],
])('terrain contour mesh (%s)', (_, map) => {
  const t0 = performance.now();
  const geo = buildTerrainGeometry(map);
  const ms = performance.now() - t0;
  const { triangles: tri, tags } = geo;
  const raster = rasterise(map);
  const lane = map.walkable.findIndex((s) => s.id === 'centre-blue');

  it(`builds in reasonable time (${ms.toFixed(0)} ms)`, () => {
    // A smoke budget: under 3 s alone, but about 4 s while the whole suite runs in parallel (D-082).
    expect(ms).toBeLessThan(6000);
  });

  it('keeps every vertex inside the map bounds', () => {
    const b = map.bounds;
    // One expect for the lot: an expect per vertex took about 5 s, past the default timeout.
    let outside = 0;
    for (let v = 0; v < tri.length; v += 3) {
      if (!(tri[v]! >= b.minX - 1e-9 && tri[v]! <= b.maxX + 1e-9)) outside++;
      if (!(tri[v + 1]! >= b.minY - 1e-9 && tri[v + 1]! <= b.maxY + 1e-9)) outside++;
    }
    expect(outside).toBe(0);
  });

  it('winds every triangle counter-clockwise (faces up) and covers the map exactly', () => {
    let total = 0;
    for (let i = 0; i < tags.length; i++) {
      const a = areaOf(tri, i);
      expect(a).toBeGreaterThanOrEqual(-1e-9);
      total += a;
    }
    const b = map.bounds;
    expect(total).toBeCloseTo((b.maxX - b.minX) * (b.maxY - b.minY), 1);
  });

  it('floor area matches the walkable grid cells within 2%', () => {
    let floor = 0;
    for (let i = 0; i < tags.length; i++) if (tags[i]! >= 0) floor += areaOf(tri, i);
    let cells = 0;
    for (const o of raster.owner) if (o >= 0) cells++;
    const gridArea = cells * raster.cell * raster.cell;
    expect(Math.abs(floor - gridArea) / gridArea).toBeLessThan(0.02);
  });

  it('cuts near the lane edge land exactly on a shape contour, not the grid', () => {
    const shape = map.walkable[lane]!;
    const onGrid = (v: number, min: number) => Math.abs(((v - min) / raster.cell) % 1) < 1e-4;
    let onEdge = 0;
    for (let i = 0; i < tags.length; i++) {
      if (tags[i] !== TAG_SLOPE) continue;
      for (let v = 0; v < 3; v++) {
        const x = tri[i * 9 + v * 3]!;
        const y = tri[i * 9 + v * 3 + 1]!;
        if (onGrid(x, raster.minX) && onGrid(y, raster.minY)) continue; // fixed grid corner, not a cut
        if (Math.abs(signedDistance(shape, raster.samples[lane]!, x, y)) > 0.01) continue;
        // On the lane's edge, or on a branch edge running within a millimetre of it at a junction.
        const nearest = Math.min(...map.walkable.map((s, k) => Math.abs(signedDistance(s, raster.samples[k]!, x, y))));
        expect(nearest).toBeLessThan(1e-4); // 0.1 mm, against up to 0.25 m on the old grid mesh
        onEdge++;
      }
    }
    expect(onEdge).toBeGreaterThan(100);
  });

  it('gives shared vertices one height (no cracks)', () => {
    const seen = new Map<string, number>();
    for (let v = 0; v < tri.length; v += 3) {
      const key = `${tri[v]},${tri[v + 1]}`;
      const h = tri[v + 2]!;
      const prev = seen.get(key);
      if (prev === undefined) seen.set(key, h);
      else expect(h).toBe(prev);
    }
  });

  it('has jungle top, slopes and floor', () => {
    const kinds = new Set(Array.from(tags, (t) => (t >= 0 ? 'floor' : t === TAG_TOP ? 'top' : 'slope')));
    expect([...kinds].sort()).toEqual(['floor', 'slope', 'top']);
  });
});
