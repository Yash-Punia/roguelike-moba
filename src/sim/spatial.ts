import type { Entity, Store } from './ecs';
import type { Transform } from './sim';

/**
 * Uniform bucket grid over the map (TDD §4 "spatial index", 4 m cells), rebuilt each tick.
 * Buckets are singly linked lists in preallocated typed arrays, so a rebuild allocates
 * nothing unless the entity count outgrows the arrays. Queries return ids sorted ascending,
 * so callers iterate in id order (determinism rule 2).
 */
export class SpatialIndex {
  private readonly cols: number;
  private readonly rows: number;
  private readonly head: Int32Array;
  private next = new Int32Array(64);
  private ids = new Int32Array(64);
  private xs = new Float64Array(64);
  private ys = new Float64Array(64);
  private count = 0;

  constructor(
    private readonly minX: number,
    private readonly minY: number,
    maxX: number,
    maxY: number,
    private readonly cell = 4,
  ) {
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    this.rows = Math.max(1, Math.ceil((maxY - minY) / cell));
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
  }

  /** Re-buckets every entity in `members` (ascending ids) at its current position. */
  rebuild(members: readonly Entity[], transforms: Store<Transform>): void {
    this.head.fill(-1);
    this.count = 0;
    if (members.length > this.ids.length) this.grow(members.length);
    // Walk backwards so each bucket's list comes out in ascending id order.
    for (let i = members.length - 1; i >= 0; i--) {
      const e = members[i]!;
      const t = transforms.get(e);
      if (!t) continue;
      const k = this.count++;
      const b = this.bucket(t.x, t.y);
      this.ids[k] = e;
      this.xs[k] = t.x;
      this.ys[k] = t.y;
      this.next[k] = this.head[b]!;
      this.head[b] = k;
    }
  }

  /** Fills `out` with the ids of indexed entities whose centre is within `r` of (x, y), ascending. */
  query(x: number, y: number, r: number, out: Entity[]): Entity[] {
    out.length = 0;
    const c0 = this.clampCol(Math.floor((x - r - this.minX) / this.cell));
    const c1 = this.clampCol(Math.floor((x + r - this.minX) / this.cell));
    const r0 = this.clampRow(Math.floor((y - r - this.minY) / this.cell));
    const r1 = this.clampRow(Math.floor((y + r - this.minY) / this.cell));
    const rSq = r * r;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let k = this.head[row * this.cols + col]!; k >= 0; k = this.next[k]!) {
          const dx = this.xs[k]! - x;
          const dy = this.ys[k]! - y;
          if (dx * dx + dy * dy <= rSq) out.push(this.ids[k]!);
        }
      }
    }
    return out.sort(ascending);
  }

  private bucket(x: number, y: number): number {
    return (
      this.clampRow(Math.floor((y - this.minY) / this.cell)) * this.cols + this.clampCol(Math.floor((x - this.minX) / this.cell))
    );
  }

  private clampCol(c: number) {
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private clampRow(r: number) {
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  private grow(n: number) {
    const size = Math.max(n, this.ids.length * 2);
    this.next = new Int32Array(size);
    this.ids = new Int32Array(size);
    this.xs = new Float64Array(size);
    this.ys = new Float64Array(size);
  }
}

const ascending = (a: number, b: number) => a - b;
