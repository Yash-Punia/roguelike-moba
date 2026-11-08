import type { ObstacleGrid } from '../grid';
import { len } from '../math';

/** Unreached cell in a flow field. */
export const FAR = 0xffff;
/** Step costs: 2 straight, 3 diagonal (≈ 1 : 1.5, close enough to √2 for steering). */
const STRAIGHT = 2;
const DIAGONAL = 3;
const DC = [1, -1, 0, 0, 1, 1, -1, -1];
const DR = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Bot navigation over the obstacle grid (TDD §7 pathing, D-075): flow fields. A field holds,
 * for every open cell, the walking cost to the nearest goal cell; a bot anywhere follows it
 * downhill. Fields are built once per goal (a camp, a lane, a spawn pad) and shared by every
 * bot, so a bot never searches a path per tick. Walls are inflated by `clearance` so the
 * paths keep a champion's body off them. Steps through an avoid disc (round a boss, D-079, D-081)
 * cost `avoidCost` more, so every path goes round an arena where another way exists.
 */
export class Nav {
  /** Cells a champion's centre should keep out of (walls grown by the clearance). */
  readonly closed: Uint8Array;
  /** Extra cost of stepping onto each cell. */
  private readonly penalty: Uint16Array;
  private readonly fields = new Map<string, Uint16Array>();
  private readonly heap: number[] = [];

  constructor(readonly grid: ObstacleGrid, clearance: number, avoid: readonly { x: number; y: number }[] = [], avoidRadius = 0, avoidCost = 0) {
    const { cols, rows, blocked } = grid;
    const r = Math.ceil(clearance / grid.cell);
    this.closed = new Uint8Array(cols * rows);
    this.penalty = new Uint16Array(cols * rows);
    for (const a of avoid) for (const i of this.disc(a.x, a.y, avoidRadius)) this.penalty[i] = avoidCost;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!blocked[row * cols + col]) continue;
        for (let dr = -r; dr <= r; dr++) {
          for (let dc = -r; dc <= r; dc++) {
            const rr = row + dr;
            const cc = col + dc;
            if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && dr * dr + dc * dc <= r * r) this.closed[rr * cols + cc] = 1;
          }
        }
      }
    }
  }

  cellOf(x: number, y: number): number {
    const g = this.grid;
    const c = Math.min(g.cols - 1, Math.max(0, Math.floor((x - g.minX) / g.cell)));
    const r = Math.min(g.rows - 1, Math.max(0, Math.floor((y - g.minY) / g.cell)));
    return r * g.cols + c;
  }

  /**
   * The field towards `key`'s goal, built on first use by Dijkstra from `goals` (cell indices,
   * called only then). Open goal cells only; a goal with none falls back to the raw grid.
   */
  field(key: string, goals: () => readonly number[], free?: { x: number; y: number; r: number }): Uint16Array {
    let f = this.fields.get(key);
    if (f) return f;
    const { cols, rows } = this.grid;
    f = new Uint16Array(cols * rows).fill(FAR);
    const heap = this.heap;
    heap.length = 0;
    // `free`: no avoid cost inside this disc, for a field that goes to a boss on purpose (D-095).
    let penalty = this.penalty;
    if (free) {
      penalty = penalty.slice();
      for (const i of this.disc(free.x, free.y, free.r)) penalty[i] = 0;
    }
    const cells = goals();
    let open = false;
    for (const g of cells) open ||= !this.closed[g];
    const shut = open ? this.closed : this.grid.blocked;
    for (const g of cells) {
      if (shut[g] || f[g] === 0) continue;
      f[g] = 0;
      push(heap, g);
    }
    while (heap.length) {
      const top = pop(heap);
      const i = top % 0x100000;
      const d = Math.floor(top / 0x100000);
      if (d !== f[i]) continue;
      const col = i % cols;
      const row = (i - col) / cols;
      for (let k = 0; k < 8; k++) {
        const c = col + DC[k]!;
        const r = row + DR[k]!;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const n = r * cols + c;
        if (shut[n]) continue;
        // No corner cutting: a diagonal step needs both straight neighbours open.
        if (k >= 4 && (shut[row * cols + c] || shut[r * cols + col])) continue;
        const nd = d + (k < 4 ? STRAIGHT : DIAGONAL) + penalty[n]!;
        if (nd < f[n]! && nd < FAR) {
          f[n] = nd;
          push(heap, nd * 0x100000 + n);
        }
      }
    }
    this.fields.set(key, f);
    return f;
  }

  /** Walking cost from (x, y) to the field's goal (in cost units, 2 per cell), or FAR. */
  cost(f: Uint16Array, x: number, y: number): number {
    return f[this.start(f, x, y)]!;
  }

  /**
   * Writes into `out` the way to walk from (x, y): the farthest of the next `look` cells down
   * the field that it can walk to in a straight line without touching a wall, so it never cuts
   * a corner. Returns false when (x, y) can't reach the goal or is already on it.
   */
  towards(f: Uint16Array, x: number, y: number, look: number, out: { x: number; y: number }): boolean {
    const { cols, rows, cell, minX, minY } = this.grid;
    let i = this.start(f, x, y);
    if (f[i] === FAR || f[i] === 0) return false;
    let pick = i; // the start cell: always reachable (it is next to the body)
    for (let s = 0; s < look && f[i]! > 0; s++) {
      const col = i % cols;
      const row = (i - col) / cols;
      let best = i;
      for (let k = 0; k < 8; k++) {
        const c = col + DC[k]!;
        const r = row + DR[k]!;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const n = r * cols + c;
        if (f[n]! < f[best]!) best = n;
      }
      if (best === i) break;
      i = best;
      if (!this.walkable(x, y, minX + ((i % cols) + 0.5) * cell, minY + (Math.floor(i / cols) + 0.5) * cell)) break;
      pick = i;
    }
    out.x = minX + ((pick % cols) + 0.5) * cell;
    out.y = minY + (Math.floor(pick / cols) + 0.5) * cell;
    return true;
  }

  /** No wall cell under the segment: every cell it crosses, walked exactly (Amanatides–Woo). */
  private walkable(ax: number, ay: number, bx: number, by: number): boolean {
    const { cols, rows, cell, minX, minY, blocked } = this.grid;
    const fx = (ax - minX) / cell;
    const fy = (ay - minY) / cell;
    const dx = (bx - ax) / cell;
    const dy = (by - ay) / cell;
    let c = Math.floor(fx);
    let r = Math.floor(fy);
    const ce = Math.floor(fx + dx);
    const re = Math.floor(fy + dy);
    const sc = dx > 0 ? 1 : -1;
    const sr = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tx = dx !== 0 ? (dx > 0 ? c + 1 - fx : fx - c) * tdx : Infinity;
    let ty = dy !== 0 ? (dy > 0 ? r + 1 - fy : fy - r) * tdy : Infinity;
    for (let guard = 0; guard < 4 * (cols + rows); guard++) {
      if (c < 0 || r < 0 || c >= cols || r >= rows || blocked[r * cols + c]) return false;
      if (c === ce && r === re) return true;
      if (tx < ty) {
        c += sc;
        tx += tdx;
      } else {
        r += sr;
        ty += tdy;
      }
    }
    return true;
  }

  /**
   * Where (x, y) joins the field: its own cell if the field reaches it, else (a body inside the
   * wall margin) the best reached cell within 3 cells that it can walk to in a straight line.
   */
  private start(f: Uint16Array, x: number, y: number): number {
    const i = this.cellOf(x, y);
    if (f[i] !== FAR) return i;
    const { cols, rows, cell, minX, minY } = this.grid;
    const col = i % cols;
    const row = (i - col) / cols;
    let best = i;
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
        const n = r * cols + c;
        if (f[n]! >= f[best]! || !this.walkable(x, y, minX + (c + 0.5) * cell, minY + (r + 0.5) * cell)) continue;
        best = n;
      }
    }
    return best;
  }

  /** Open cells within `radius` of (x, y), for a round goal. */
  disc(x: number, y: number, radius: number): number[] {
    const g = this.grid;
    const out: number[] = [];
    const r = Math.ceil(radius / g.cell);
    const c0 = this.cellOf(x, y);
    const col = c0 % g.cols;
    const row = (c0 - col) / g.cols;
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        const rr = row + dr;
        const cc = col + dc;
        if (rr >= 0 && cc >= 0 && rr < g.rows && cc < g.cols && dr * dr + dc * dc <= r * r) out.push(rr * g.cols + cc);
      }
    }
    return out;
  }

  /** Cells under a polyline (x, y pairs), sampled every half cell. */
  polyline(pts: Float64Array): number[] {
    const out: number[] = [];
    const step = this.grid.cell / 2;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const dx = pts[k + 2]! - pts[k]!;
      const dy = pts[k + 3]! - pts[k + 1]!;
      const n = Math.max(1, Math.ceil(len(dx, dy) / step));
      for (let s = 0; s <= n; s++) out.push(this.cellOf(pts[k]! + (dx * s) / n, pts[k + 1]! + (dy * s) / n));
    }
    return out;
  }
}

// Binary min-heap of packed (cost × 2^20 + cell) numbers: deterministic order, no objects.
function push(h: number[], v: number) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p]! <= v) break;
    h[i] = h[p]!;
    i = p;
  }
  h[i] = v;
}
function pop(h: number[]): number {
  const top = h[0]!;
  const last = h.pop()!;
  if (h.length === 0) return top;
  let i = 0;
  for (;;) {
    const l = i * 2 + 1;
    if (l >= h.length) break;
    const r = l + 1;
    const c = r < h.length && h[r]! < h[l]! ? r : l;
    if (h[c]! >= last) break;
    h[i] = h[c]!;
    i = c;
  }
  h[i] = last;
  return top;
}

const navs = new WeakMap<ObstacleGrid, Nav>();
/** The shared navigation for a grid (rebuilt when the sim rebuilds its grid); `avoid` is read only then. */
export function navFor(grid: ObstacleGrid, clearance: number, avoid: () => readonly { x: number; y: number }[] = () => [], avoidRadius = 0, avoidCost = 0): Nav {
  let n = navs.get(grid);
  if (!n) navs.set(grid, (n = new Nav(grid, clearance, avoid(), avoidRadius, avoidCost)));
  return n;
}
