import type { Entity } from './ecs';

/**
 * Lobbed grenades in flight (TDD §6.5): a fixed arc from where they were thrown to the
 * target's position at cast time; they don't home. Pooled struct-of-arrays like bullets,
 * processed in slot order.
 */
export class LobPool {
  capacity = 0;
  live = 0;
  active = new Uint8Array(0);
  /** Unique per throw, for render; never reused. */
  id = new Int32Array(0);
  owner = new Int32Array(0);
  team = new Int8Array(0);
  x0 = new Float64Array(0);
  y0 = new Float64Array(0);
  x1 = new Float64Array(0);
  y1 = new Float64Array(0);
  /** Ticks flown so far, out of `total`. */
  elapsed = new Int32Array(0);
  total = new Int32Array(0);
  private free: number[] = [];
  private nextId = 1;

  constructor(initial = 8) {
    this.grow(initial);
  }

  spawn(owner: Entity, team: number, x0: number, y0: number, x1: number, y1: number, total: number): number {
    if (this.free.length === 0) this.grow(this.capacity * 2);
    const i = this.free.pop()!;
    this.active[i] = 1;
    this.id[i] = this.nextId++;
    this.owner[i] = owner;
    this.team[i] = team;
    this.x0[i] = x0;
    this.y0[i] = y0;
    this.x1[i] = x1;
    this.y1[i] = y1;
    this.elapsed[i] = 0;
    this.total[i] = total;
    this.live++;
    return i;
  }

  release(i: number): void {
    if (!this.active[i]) return;
    this.active[i] = 0;
    this.free.push(i);
    this.live--;
  }

  private grow(size: number) {
    const old = this.capacity;
    const copy = <T extends Uint8Array | Int8Array | Int32Array | Float64Array>(a: T, make: (n: number) => T): T => {
      const b = make(size);
      b.set(a);
      return b;
    };
    this.active = copy(this.active, (n) => new Uint8Array(n));
    this.id = copy(this.id, (n) => new Int32Array(n));
    this.owner = copy(this.owner, (n) => new Int32Array(n));
    this.team = copy(this.team, (n) => new Int8Array(n));
    this.x0 = copy(this.x0, (n) => new Float64Array(n));
    this.y0 = copy(this.y0, (n) => new Float64Array(n));
    this.x1 = copy(this.x1, (n) => new Float64Array(n));
    this.y1 = copy(this.y1, (n) => new Float64Array(n));
    this.elapsed = copy(this.elapsed, (n) => new Int32Array(n));
    this.total = copy(this.total, (n) => new Int32Array(n));
    for (let i = size - 1; i >= old; i--) this.free.push(i);
    this.capacity = size;
  }
}
