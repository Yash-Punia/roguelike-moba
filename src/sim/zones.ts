import type { Entity } from './ecs';

/**
 * Ground zones (TDD §5 `Zone`): circles that hit every enemy inside once per `period`
 * ticks for `damage`, until `total` ticks have passed. Fire pool for now; Heat Wave, Lead
 * Storm and mines join later. Pooled struct-of-arrays, processed in slot order.
 */
export class ZonePool {
  capacity = 0;
  live = 0;
  active = new Uint8Array(0);
  /** Unique per zone, for render; never reused. */
  id = new Int32Array(0);
  owner = new Int32Array(0);
  team = new Int8Array(0);
  x = new Float64Array(0);
  y = new Float64Array(0);
  radius = new Float64Array(0);
  /** Ticks since it appeared, out of `total`. */
  elapsed = new Int32Array(0);
  total = new Int32Array(0);
  period = new Int32Array(0);
  /** Base damage per hit, and the share structures take. */
  damage = new Float64Array(0);
  structureMult = new Float64Array(0);
  private free: number[] = [];
  private nextId = 1;

  constructor(initial = 8) {
    this.grow(initial);
  }

  spawn(owner: Entity, team: number, x: number, y: number, radius: number, total: number, period: number, damage: number, structureMult: number): number {
    if (this.free.length === 0) this.grow(this.capacity * 2);
    const i = this.free.pop()!;
    this.active[i] = 1;
    this.id[i] = this.nextId++;
    this.owner[i] = owner;
    this.team[i] = team;
    this.x[i] = x;
    this.y[i] = y;
    this.radius[i] = radius;
    this.elapsed[i] = 0;
    this.total[i] = total;
    this.period[i] = period;
    this.damage[i] = damage;
    this.structureMult[i] = structureMult;
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
    this.x = copy(this.x, (n) => new Float64Array(n));
    this.y = copy(this.y, (n) => new Float64Array(n));
    this.radius = copy(this.radius, (n) => new Float64Array(n));
    this.elapsed = copy(this.elapsed, (n) => new Int32Array(n));
    this.total = copy(this.total, (n) => new Int32Array(n));
    this.period = copy(this.period, (n) => new Int32Array(n));
    this.damage = copy(this.damage, (n) => new Float64Array(n));
    this.structureMult = copy(this.structureMult, (n) => new Float64Array(n));
    for (let i = size - 1; i >= old; i--) this.free.push(i);
    this.capacity = size;
  }
}
