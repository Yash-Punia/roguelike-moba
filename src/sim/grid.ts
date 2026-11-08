import { rasterise } from '../data/map-geometry';
import type { Footprint, MapConfig } from '../data/schema';

/** Static obstacle grid (TDD §6.1, D-018). A cell is open only if a walkable shape covers its centre and no structure footprint stamped since blocks it. */
export interface ObstacleGrid {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
  /** Raised jungle ground (no walkable shape): stops shots and blocks sight (D-018). Structure footprints aren't in it. */
  ground: Uint8Array;
  /** Trench zone of each cell (GDD §4): 0 = none, 1–4 = the quadrant of a trench or room floor. */
  zone: Uint8Array;
  /** Ford cells (D-069): units wading here move `map.fordSlowPct` slower. */
  water: Uint8Array;
  /** The `map.walkable` shape that owns each cell (the last painted over it), −1 for jungle: a boss's arena floor (D-081). */
  owner: Int16Array;
}

/** Walkable shapes carved out of solid jungle. River cells block movement but not shots or sight (D-069). */
export function buildGrid(map: MapConfig): ObstacleGrid {
  const { minX, minY, cell, cols, rows, owner } = rasterise(map);
  const blocked = new Uint8Array(cols * rows);
  const zone = new Uint8Array(cols * rows);
  const ground = new Uint8Array(cols * rows);
  const water = new Uint8Array(cols * rows);
  for (let i = 0; i < blocked.length; i++) {
    const o = owner[i]!;
    const surface = o >= 0 ? map.walkable[o]!.surface : undefined;
    blocked[i] = o < 0 || surface === 'river' ? 1 : 0;
    ground[i] = o < 0 ? 1 : 0;
    water[i] = surface === 'ford' ? 1 : 0;
    // Trench and room floors conceal; arenas, the Crater and lanes painted over trench mouths don't.
    if (o >= 0 && map.walkable[o]!.surface === 'trench') {
      const x = minX + ((i % cols) + 0.5) * cell;
      const y = minY + (Math.floor(i / cols) + 0.5) * cell;
      zone[i] = 1 + (x > 0 ? 1 : 0) + (y > 0 ? 2 : 0);
    }
  }
  return { minX, minY, cell, cols, rows, blocked, ground, zone, water, owner };
}

/** The walkable shape owning the cell under (x, y), −1 for jungle or off the map. */
export function ownerAt(g: ObstacleGrid, x: number, y: number): number {
  const c = Math.floor((x - g.minX) / g.cell);
  const r = Math.floor((y - g.minY) / g.cell);
  return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? -1 : g.owner[r * g.cols + c]!;
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

/** Trench zone at a point (0 = not in a Trench). */
export function zoneAt(g: ObstacleGrid, x: number, y: number): number {
  const col = Math.floor((x - g.minX) / g.cell);
  const row = Math.floor((y - g.minY) / g.cell);
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return 0;
  return g.zone[row * g.cols + col]!;
}

/**
 * Grid ray march (DDA) from a to b against raised ground (or `cells`, e.g. `blocked` for walking): the 0..1 position along ab where it
 * first enters a ground cell (0 if a is inside one), or −1 if clear.
 */
export function rayBlocked(g: ObstacleGrid, ax: number, ay: number, bx: number, by: number, cells: Uint8Array = g.ground): number {
  const fx = (ax - g.minX) / g.cell;
  const fy = (ay - g.minY) / g.cell;
  const dx = (bx - ax) / g.cell;
  const dy = (by - ay) / g.cell;
  let col = Math.floor(fx);
  let row = Math.floor(fy);
  const stepC = dx > 0 ? 1 : -1;
  const stepR = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? col + 1 - fx : fx - col) * tdx : Infinity;
  let ty = dy !== 0 ? (dy > 0 ? row + 1 - fy : fy - row) * tdy : Infinity;
  let t = 0;
  while (t <= 1) {
    if (col >= 0 && row >= 0 && col < g.cols && row < g.rows && cells[row * g.cols + col] === 1) return t;
    if (tx < ty) {
      t = tx;
      tx += tdx;
      col += stepC;
    } else {
      t = ty;
      ty += tdy;
      row += stepR;
    }
  }
  return -1;
}
