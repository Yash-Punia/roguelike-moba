import { floorHeight, rasterise, segmentDistSq, signedDistance } from '../data/map-geometry';
import type { MapConfig, WalkShape } from '../data/schema';

/**
 * Render-only terrain geometry (D-018, D-026), with no Three.js so it can be unit tested.
 *
 * Cells far from any edge become two flat triangles, all floor or all jungle. Cells near an
 * edge are cut along the shapes' true boundaries: first by each walkable shape in paint
 * order (the inside piece takes that shape), then the remaining jungle by the union
 * distance at WALL_SLOPE (slope vs top). Edges therefore follow the curves (or straight
 * segments) instead of the 0.5 m grid. Every vertex height comes from one function of
 * (x, y), so neighbouring pieces always meet without cracks.
 */

/** Triangle tags besides a walkable shape index (≥ 0). */
export const TAG_TOP = -1;
export const TAG_SLOPE = -2;

/** Height of the raised embankment along the map edge, and how far in it starts rising. */
export const EDGE_HEIGHT = 2.2;
const EDGE_RISE = 4;
/** Horizontal run (m) of the slope from a walkable edge up to the jungle top. */
export const WALL_SLOPE = 0.6;
/** A cell with a differently owned cell within this many cells is cut along true edges. */
const EDGE_BAND = 2;
/** Shapes further than this from a cell can't cut it or shape its slope. */
const SHAPE_REACH = 3;
/** Points this close to a shape's edge count as inside it (crossing points land on edges). */
const ON_EDGE = 1e-6;

export interface TerrainGeometry {
  /** Sim-space triangles: x, y, height per vertex, three vertices per triangle. */
  triangles: Float32Array;
  /** Per triangle: walkable shape index, TAG_TOP or TAG_SLOPE. */
  tags: Int16Array;
  /** Ground height at sim (x, y), bilinear between grid corners: for standing units on the floor. */
  heightAt(x: number, y: number): number;
}

interface Pt {
  x: number;
  y: number;
  /** Preset height (grid corners), else computed from the ground function on output. */
  h?: number;
}

export function buildTerrainGeometry(map: MapConfig): TerrainGeometry {
  const raster = rasterise(map);
  const { minX, minY, cell, cols, rows, owner, samples } = raster;
  const shapes = map.walkable;
  const vcols = cols + 1;

  const boxes = shapes.map((s, k) => shapeBox(s, samples[k]!));
  const sd = (k: number, x: number, y: number) => shapeDistance(shapes[k]!, samples[k]!, x, y);
  const near = (x0: number, y0: number, x1: number, y1: number, pad: number) => {
    const out: number[] = [];
    boxes.forEach((b, k) => {
      if (b.x0 - pad <= x1 && b.x1 + pad >= x0 && b.y0 - pad <= y1 && b.y1 + pad >= y0) out.push(k);
    });
    return out;
  };

  /** The one height function: floor of the last-painted shape containing the point, else a slope up to the jungle. */
  function ground(x: number, y: number, candidates: readonly number[]): number {
    let inside = -1;
    let nearest = -1;
    let nearestD = Infinity;
    for (const k of candidates) {
      const d = sd(k, x, y);
      if (d <= ON_EDGE) inside = k;
      if (d < nearestD) {
        nearestD = d;
        nearest = k;
      }
    }
    const top = jungleHeight(x, y, map.bounds);
    if (inside >= 0) return floorHeight(shapes[inside]!, samples[inside]!, x, y);
    if (nearest < 0) return top;
    const floor = floorHeight(shapes[nearest]!, samples[nearest]!, x, y);
    return floor + (top - floor) * smoothstep(nearestD / WALL_SLOPE);
  }

  // Which cells get cut along true edges.
  const band = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const o = owner[r * cols + c]!;
      search: for (let rr = Math.max(0, r - EDGE_BAND); rr <= Math.min(rows - 1, r + EDGE_BAND); rr++) {
        for (let cc = Math.max(0, c - EDGE_BAND); cc <= Math.min(cols - 1, c + EDGE_BAND); cc++) {
          if (owner[rr * cols + cc] !== o) {
            band[r * cols + c] = 1;
            break search;
          }
        }
      }
    }
  }

  // Grid corner heights. Corners of cut cells use the ground function; the rest use their
  // uniform owner, which gives the same value there.
  const corner = new Float32Array(vcols * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = minX + i * cell;
      const y = minY + j * cell;
      let cut = false;
      let o = -1;
      for (let r = j - 1; r <= j; r++) {
        for (let c = i - 1; c <= i; c++) {
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          if (band[r * cols + c]) cut = true;
          o = owner[r * cols + c]!;
        }
      }
      corner[j * vcols + i] = cut
        ? ground(x, y, near(x, y, x, y, SHAPE_REACH))
        : o >= 0
          ? floorHeight(shapes[o]!, samples[o]!, x, y)
          : jungleHeight(x, y, map.bounds);
    }
  }

  const tris: number[] = [];
  const tags: number[] = [];
  const emit = (a: Pt, b: Pt, c: Pt, tag: number, candidates: readonly number[]) => {
    for (const p of [a, b, c]) tris.push(p.x, p.y, p.h ?? (p.h = ground(p.x, p.y, candidates)));
    tags.push(tag);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = minX + c * cell;
      const y0 = minY + r * cell;
      const x1 = x0 + cell;
      const y1 = y0 + cell;
      // Counter-clockwise in sim space, which faces +y in render (sim y → world −z).
      const square: Pt[] = [
        { x: x0, y: y0, h: corner[r * vcols + c]! },
        { x: x1, y: y0, h: corner[r * vcols + c + 1]! },
        { x: x1, y: y1, h: corner[(r + 1) * vcols + c + 1]! },
        { x: x0, y: y1, h: corner[(r + 1) * vcols + c]! },
      ];
      const o = owner[r * cols + c]!;
      if (!band[r * cols + c]) {
        const tag = o >= 0 ? o : TAG_TOP;
        emit(square[0]!, square[1]!, square[2]!, tag, []);
        emit(square[0]!, square[2]!, square[3]!, tag, []);
        continue;
      }

      const candidates = near(x0, y0, x1, y1, SHAPE_REACH);
      let pieces: { pts: Pt[]; tag: number }[] = [{ pts: square, tag: TAG_TOP }];
      for (const k of candidates) {
        const b = boxes[k]!;
        if (b.x0 > x1 || b.x1 < x0 || b.y0 > y1 || b.y1 < y0) continue; // can't contain any of this cell
        const f = (x: number, y: number) => sd(k, x, y);
        const next: typeof pieces = [];
        for (const piece of pieces) {
          const [inside, outside] = split(piece.pts, f, 0);
          if (inside.length >= 3) next.push({ pts: inside, tag: k });
          if (outside.length >= 3) next.push({ pts: outside, tag: piece.tag });
        }
        pieces = next;
      }
      const union = (x: number, y: number) => {
        let d = Infinity;
        for (const k of candidates) d = Math.min(d, sd(k, x, y));
        return d;
      };
      for (const piece of pieces) {
        if (piece.tag !== TAG_TOP) {
          fan(piece.pts, piece.tag);
          continue;
        }
        const [slope, top] = split(piece.pts, union, WALL_SLOPE);
        if (slope.length >= 3) fan(slope, TAG_SLOPE);
        if (top.length >= 3) fan(top, TAG_TOP);
      }

      function fan(pts: Pt[], tag: number) {
        for (let i = 1; i + 1 < pts.length; i++) emit(pts[0]!, pts[i]!, pts[i + 1]!, tag, candidates);
      }
    }
  }

  function heightAt(x: number, y: number): number {
    const fx = Math.min(cols - 1e-6, Math.max(0, (x - minX) / cell));
    const fy = Math.min(rows - 1e-6, Math.max(0, (y - minY) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const h = (a: number, b: number) => corner[(j + b) * vcols + i + a]!;
    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
  }

  return { triangles: new Float32Array(tris), tags: new Int16Array(tags), heightAt };
}

/**
 * Splits a convex polygon into the parts where f ≤ level and f > level (both convex, same
 * winding). Crossing points are refined onto the contour and computed from the edge's
 * endpoints in a fixed order, so the cell on the other side of an edge gets the same point.
 */
export function split(poly: readonly Pt[], f: (x: number, y: number) => number, level: number): [Pt[], Pt[]] {
  const inside: Pt[] = [];
  const outside: Pt[] = [];
  const values = poly.map((p) => f(p.x, p.y) - level);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const fa = values[i]!;
    const fb = values[(i + 1) % poly.length]!;
    (fa <= 0 ? inside : outside).push(a);
    if (fa <= 0 !== fb <= 0) {
      const p = crossing(a, b, fa, fb, f, level);
      inside.push(p);
      outside.push(p);
    }
  }
  return [inside, outside];
}

/** Point on segment ab where f = level (Illinois regula falsi), endpoints in canonical order. */
function crossing(a: Pt, b: Pt, fa: number, fb: number, f: (x: number, y: number) => number, level: number): Pt {
  if (a.x > b.x || (a.x === b.x && a.y > b.y)) [a, b, fa, fb] = [b, a, fb, fa];
  let lo = 0;
  let hi = 1;
  let flo = fa;
  let fhi = fb;
  let t = flo / (flo - fhi);
  for (let iter = 0; iter < 8; iter++) {
    const ft = f(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) - level;
    if (Math.abs(ft) < 1e-9) break;
    if (ft > 0 === flo > 0) {
      lo = t;
      flo = ft;
      fhi /= 2;
    } else {
      hi = t;
      fhi = ft;
      flo /= 2;
    }
    t = lo + ((hi - lo) * flo) / (flo - fhi);
  }
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function shapeBox(s: WalkShape, pts: Float64Array | null) {
  if (s.shape === 'path') {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < pts!.length; k += 2) {
      x0 = Math.min(x0, pts![k]!);
      x1 = Math.max(x1, pts![k]!);
      y0 = Math.min(y0, pts![k + 1]!);
      y1 = Math.max(y1, pts![k + 1]!);
    }
    const h = s.width / 2;
    return { x0: x0 - h, y0: y0 - h, x1: x1 + h, y1: y1 + h };
  }
  const hw = s.shape === 'circle' ? s.r : s.w / 2;
  const hh = s.shape === 'circle' ? s.r : s.h / 2;
  return { x0: s.x - hw, y0: s.y - hh, x1: s.x + hw, y1: s.y + hh };
}

/** `signedDistance`, with paths skipping segments whose bounding box is already further than the best hit. */
function shapeDistance(s: WalkShape, pts: Float64Array | null, x: number, y: number): number {
  if (s.shape !== 'path') return signedDistance(s, pts, x, y);
  let best = Infinity;
  for (let k = 0; k + 3 < pts!.length; k += 2) {
    const ax = pts![k]!;
    const ay = pts![k + 1]!;
    const bx = pts![k + 2]!;
    const by = pts![k + 3]!;
    const gx = Math.max(Math.min(ax, bx) - x, x - Math.max(ax, bx), 0);
    const gy = Math.max(Math.min(ay, by) - y, y - Math.max(ay, by), 0);
    if (gx * gx + gy * gy >= best) continue;
    const d = segmentDistSq(x, y, ax, ay, bx, by).distSq;
    if (d < best) best = d;
  }
  return Math.sqrt(best) - s.width / 2;
}

/** Raised jungle ground: +0.3 to +1.4 m of gentle rolling noise, rising to the edge embankment. */
function jungleHeight(x: number, y: number, b: MapConfig['bounds']): number {
  const n = 0.5 + 0.25 * Math.sin(x * 0.35 + Math.sin(y * 0.21) * 2) + 0.25 * Math.sin(y * 0.29 + x * 0.13);
  const h = 0.3 + 1.1 * n;
  const edge = Math.min(x - b.minX, b.maxX - x, y - b.minY, b.maxY - y);
  if (edge >= EDGE_RISE) return h;
  const t = 1 - Math.max(0, edge) / EDGE_RISE;
  return h + (EDGE_HEIGHT - h) * t;
}

function smoothstep(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}
