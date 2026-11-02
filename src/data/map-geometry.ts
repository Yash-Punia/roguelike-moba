import type { MapConfig, Vec2, WalkShape } from './schema';

/**
 * Map shapes → grid (D-018). Pure arithmetic (no trig, no wall clock), so the sim's walkability
 * grid and render's terrain come out identical on every machine.
 */

/** Rasterised walkable shapes. `owner[row * cols + col]` is the index into `map.walkable` of the shape painted last over that cell, or -1 (raised jungle: blocked). */
export interface Raster {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  owner: Int16Array;
  /** Sampled centre line of each `path` shape as flat [x0, y0, x1, y1, …]; null for other shapes. */
  samples: (Float64Array | null)[];
}

/** Uniform Catmull-Rom through `points` with clamped ends; returns flat [x, y, …] including both ends. */
export function sampleSpline(points: readonly Vec2[], perSegment: number): Float64Array {
  const n = points.length;
  const out = new Float64Array(((n - 1) * perSegment + 1) * 2);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2 < n ? i + 2 : n - 1]!;
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      out[k++] = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      out[k++] = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
    }
  }
  const last = points[n - 1]!;
  out[k++] = last.x;
  out[k] = last.y;
  return out;
}

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t2 * t);
}

/** Squared distance from (px, py) to segment ab, and the 0..1 position of the nearest point. */
export function segmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return { distSq: ex * ex + ey * ey, t };
}

function contains(s: Exclude<WalkShape, { shape: 'path' }>, x: number, y: number): boolean {
  const dx = x - s.x;
  const dy = y - s.y;
  switch (s.shape) {
    case 'circle':
      return dx * dx + dy * dy <= s.r * s.r;
    case 'ellipse': {
      const u = dx / (s.w / 2);
      const v = dy / (s.h / 2);
      return u * u + v * v <= 1;
    }
    case 'rect':
      return Math.abs(dx) <= s.w / 2 && Math.abs(dy) <= s.h / 2;
  }
}

function extent(s: Exclude<WalkShape, { shape: 'path' }>) {
  const hw = s.shape === 'circle' ? s.r : s.w / 2;
  const hh = s.shape === 'circle' ? s.r : s.h / 2;
  return { x0: s.x - hw, x1: s.x + hw, y0: s.y - hh, y1: s.y + hh };
}

/** Paints every walkable shape, in order, into a grid of `map.gridCell` cells over `map.bounds`. */
export function rasterise(map: MapConfig): Raster {
  const { bounds, gridCell: cell } = map;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cell);
  const owner = new Int16Array(cols * rows).fill(-1);
  const samples: (Float64Array | null)[] = [];

  // Cells whose centres fall inside [x0, x1] × [y0, y1].
  const colOf = (x: number, up: boolean) => {
    const c = (x - bounds.minX) / cell - 0.5;
    return up ? Math.max(0, Math.ceil(c)) : Math.min(cols - 1, Math.floor(c));
  };
  const rowOf = (y: number, up: boolean) => {
    const r = (y - bounds.minY) / cell - 0.5;
    return up ? Math.max(0, Math.ceil(r)) : Math.min(rows - 1, Math.floor(r));
  };

  map.walkable.forEach((s, i) => {
    if (s.shape !== 'path') {
      samples.push(null);
      const e = extent(s);
      for (let r = rowOf(e.y0, true), r1 = rowOf(e.y1, false); r <= r1; r++) {
        const y = bounds.minY + (r + 0.5) * cell;
        for (let c = colOf(e.x0, true), c1 = colOf(e.x1, false); c <= c1; c++) {
          if (contains(s, bounds.minX + (c + 0.5) * cell, y)) owner[r * cols + c] = i;
        }
      }
      return;
    }
    const pts = sampleSpline(s.points, map.splineSamples);
    samples.push(pts);
    const half = s.width / 2;
    const halfSq = half * half;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k]!;
      const ay = pts[k + 1]!;
      const bx = pts[k + 2]!;
      const by = pts[k + 3]!;
      const r1 = rowOf(Math.max(ay, by) + half, false);
      const c1 = colOf(Math.max(ax, bx) + half, false);
      for (let r = rowOf(Math.min(ay, by) - half, true); r <= r1; r++) {
        const y = bounds.minY + (r + 0.5) * cell;
        for (let c = colOf(Math.min(ax, bx) - half, true); c <= c1; c++) {
          if (segmentDistSq(bounds.minX + (c + 0.5) * cell, y, ax, ay, bx, by).distSq <= halfSq) owner[r * cols + c] = i;
        }
      }
    }
  });

  return { minX: bounds.minX, minY: bounds.minY, cell, cols, rows, owner, samples };
}

/** Render-only floor height of a walkable shape at (x, y): flat, a sloped path (ramp) or a bowl. */
export function floorHeight(s: WalkShape, samples: Float64Array | null, x: number, y: number): number {
  if (s.shape === 'circle' && s.centreHeight !== undefined) {
    const d = Math.min(1, Math.hypot(x - s.x, y - s.y) / s.r);
    return s.centreHeight + (s.height - s.centreHeight) * d;
  }
  if (s.shape === 'path' && s.endHeight !== undefined && samples) {
    return s.height + (s.endHeight - s.height) * alongPath(samples, x, y);
  }
  return s.height;
}

/** Signed distance (m) from (x, y) to a walkable shape's edge: negative inside. Ellipses are approximate. */
export function signedDistance(s: WalkShape, samples: Float64Array | null, x: number, y: number): number {
  switch (s.shape) {
    case 'path': {
      let best = Infinity;
      const pts = samples!;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const d = segmentDistSq(x, y, pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!).distSq;
        if (d < best) best = d;
      }
      return Math.sqrt(best) - s.width / 2;
    }
    case 'circle':
      return Math.hypot(x - s.x, y - s.y) - s.r;
    case 'ellipse': {
      const a = s.w / 2;
      const b = s.h / 2;
      return (Math.hypot((x - s.x) / a, (y - s.y) / b) - 1) * Math.min(a, b);
    }
    case 'rect': {
      const qx = Math.abs(x - s.x) - s.w / 2;
      const qy = Math.abs(y - s.y) - s.h / 2;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    }
  }
}

/** 0..1 arc-length position along a sampled path of the point nearest to (x, y). */
export function alongPath(pts: Float64Array, x: number, y: number): number {
  let total = 0;
  let best = Infinity;
  let bestAt = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k]!;
    const ay = pts[k + 1]!;
    const segLen = Math.hypot(pts[k + 2]! - ax, pts[k + 3]! - ay);
    const { distSq, t } = segmentDistSq(x, y, ax, ay, pts[k + 2]!, pts[k + 3]!);
    if (distSq < best) {
      best = distSq;
      bestAt = total + t * segLen;
    }
    total += segLen;
  }
  return total > 0 ? bestAt / total : 0;
}

/** A minion lane: one Blue→Red centre-line polyline (flat [x0, y0, x1, y1, …]) per way through its branches. */
export interface LanePath {
  id: string;
  branches: Float64Array[];
}

/**
 * Joins each lane's route into polylines (D-035): every combination of branch choices gives one
 * polyline, sampled like the terrain (`splineSamples`) so minions follow the visible lane.
 * Branch k picks option (k mod options) at a branching step. Throws on an unknown path id.
 */
export function buildLanes(map: MapConfig): LanePath[] {
  const paths = new Map<string, readonly Vec2[]>();
  for (const s of map.walkable) if (s.shape === 'path') paths.set(s.id, s.points);
  return map.lanes.map((lane) => {
    let combos = 1;
    for (const step of lane.route) combos *= step.length;
    const branches: Float64Array[] = [];
    for (let k = 0; k < combos; k++) {
      const pts: number[] = [];
      let rest = k;
      for (const step of lane.route) {
        const id = step[rest % step.length]!;
        rest = Math.floor(rest / step.length);
        const points = paths.get(id);
        if (!points) throw new Error(`Lane "${lane.id}" uses unknown path "${id}"`);
        const sampled = sampleSpline(points, map.splineSamples);
        // Skip a first point that repeats the previous step's last point.
        const n = pts.length;
        const start = n >= 2 && pts[n - 2] === sampled[0] && pts[n - 1] === sampled[1] ? 2 : 0;
        for (let i = start; i < sampled.length; i++) pts.push(sampled[i]!);
      }
      branches.push(Float64Array.from(pts));
    }
    return { id: lane.id, branches };
  });
}
