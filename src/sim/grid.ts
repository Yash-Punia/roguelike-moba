import { rasterise } from '../data/map-geometry';
import type { Footprint, MapConfig } from '../data/schema';

/** Static obstacle grid (TDD §6.1, D-018). A cell is open only if a walkable shape covers its centre and nothing stamped since blocks it. */
export interface ObstacleGrid {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

/** Walkable shapes carved out of solid jungle, then the map's obstacle rects stamped on top. */
export function buildGrid(map: MapConfig): ObstacleGrid {
  const { minX, minY, cell, cols, rows, owner } = rasterise(map);
  const blocked = new Uint8Array(cols * rows);
  for (let i = 0; i < blocked.length; i++) blocked[i] = owner[i]! < 0 ? 1 : 0;
  const g = { minX, minY, cell, cols, rows, blocked };
  for (const o of map.obstacles) stampFootprint(g, o.x, o.y, { shape: 'rect', w: o.w, h: o.h });
  return g;
}

/** Blocks every cell whose centre lies inside the footprint centred at (x, y). */
export function stampFootprint(g: ObstacleGrid, x: number, y: number, f: Footprint): void {
  const hw = f.shape === 'circle' ? f.r : f.w / 2;
  const hh = f.shape === 'circle' ? f.r : f.h / 2;
  const c0 = Math.max(0, Math.ceil((x - hw - g.minX) / g.cell - 0.5));
  const c1 = Math.min(g.cols - 1, Math.floor((x + hw - g.minX) / g.cell - 0.5));
  const r0 = Math.max(0, Math.ceil((y - hh - g.minY) / g.cell - 0.5));
  const r1 = Math.min(g.rows - 1, Math.floor((y + hh - g.minY) / g.cell - 0.5));
  const rSq = hw * hw;
  for (let r = r0; r <= r1; r++) {
    const dy = g.minY + (r + 0.5) * g.cell - y;
    for (let c = c0; c <= c1; c++) {
      const dx = g.minX + (c + 0.5) * g.cell - x;
      if (f.shape === 'rect' || dx * dx + dy * dy <= rSq) g.blocked[r * g.cols + c] = 1;
    }
  }
}

export function isBlocked(g: ObstacleGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return false;
  return g.blocked[row * g.cols + col] === 1;
}
