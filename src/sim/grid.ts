import type { MapConfig } from '../data/schema';

/** Static obstacle grid (TDD §6.1). A cell is blocked if its centre lies inside an obstacle rect. */
export interface ObstacleGrid {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

export function buildGrid(map: MapConfig): ObstacleGrid {
  const { bounds, gridCell: cell } = map;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / cell);
  const blocked = new Uint8Array(cols * rows);
  for (const o of map.obstacles) {
    const c0 = Math.max(0, Math.ceil((o.x - o.w / 2 - bounds.minX) / cell - 0.5));
    const c1 = Math.min(cols - 1, Math.floor((o.x + o.w / 2 - bounds.minX) / cell - 0.5));
    const r0 = Math.max(0, Math.ceil((o.y - o.h / 2 - bounds.minY) / cell - 0.5));
    const r1 = Math.min(rows - 1, Math.floor((o.y + o.h / 2 - bounds.minY) / cell - 0.5));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
  }
  return { minX: bounds.minX, minY: bounds.minY, cell, cols, rows, blocked };
}

export function isBlocked(g: ObstacleGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return false;
  return g.blocked[row * g.cols + col] === 1;
}
