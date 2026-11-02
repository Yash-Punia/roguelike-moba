import { rasterise } from '../data/map-geometry';
import type { MapConfig } from '../data/schema';

/** Static obstacle grid (TDD §6.1, D-018). A cell is open only if a walkable shape covers its centre and no obstacle rect does. */
export interface ObstacleGrid {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

export function buildGrid(map: MapConfig): ObstacleGrid {
  const { minX, minY, cell, cols, rows, owner } = rasterise(map);
  const blocked = new Uint8Array(cols * rows);
  for (let i = 0; i < blocked.length; i++) blocked[i] = owner[i]! < 0 ? 1 : 0;
  for (const o of map.obstacles) {
    const c0 = Math.max(0, Math.ceil((o.x - o.w / 2 - minX) / cell - 0.5));
    const c1 = Math.min(cols - 1, Math.floor((o.x + o.w / 2 - minX) / cell - 0.5));
    const r0 = Math.max(0, Math.ceil((o.y - o.h / 2 - minY) / cell - 0.5));
    const r1 = Math.min(rows - 1, Math.floor((o.y + o.h / 2 - minY) / cell - 0.5));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
  }
  return { minX, minY, cell, cols, rows, blocked };
}

export function isBlocked(g: ObstacleGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return false;
  return g.blocked[row * g.cols + col] === 1;
}
