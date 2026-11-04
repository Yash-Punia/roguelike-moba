import type { Entity } from './ecs';

/**
 * Minefield mines (D-063), pooled struct-of-arrays like bullets and processed in slot order.
 * Each carries its blast and trigger, fixed when it was laid.
 */
export class MinePool {
  capacity = 0;
  active = new Uint8Array(0);
  owner = new Int32Array(0);
  team = new Int8Array(0);
  x = new Float64Array(0);
  y = new Float64Array(0);
  /** Tick it was laid (the oldest goes first) and the tick it arms on. */
  laid = new Int32Array(0);
  armAt = new Int32Array(0);
  damage = new Float64Array(0);
  radius = new Float64Array(0);
  trigger = new Float64Array(0);
  private free: number[] = [];

  constructor(initial = 8) {
    this.grow(initial);
  }

  spawn(owner: Entity, team: number, x: number, y: number, laid: number, armAt: number, damage: number, radius: number, trigger: number): number {
    if (this.free.length === 0) this.grow(this.capacity * 2);
    const i = this.free.pop()!;
    this.active[i] = 1;
    this.owner[i] = owner;
    this.team[i] = team;
    this.x[i] = x;
    this.y[i] = y;
    this.laid[i] = laid;
    this.armAt[i] = armAt;
    this.damage[i] = damage;
    this.radius[i] = radius;
    this.trigger[i] = trigger;
    return i;
  }

  release(i: number): void {
    if (!this.active[i]) return;
    this.active[i] = 0;
    this.free.push(i);
  }

  private grow(size: number) {
    const old = this.capacity;
    const copy = <T extends Uint8Array | Int8Array | Int32Array | Float64Array>(a: T, make: (n: number) => T): T => {
      const b = make(size);
      b.set(a);
      return b;
    };
    this.active = copy(this.active, (n) => new Uint8Array(n));
    this.owner = copy(this.owner, (n) => new Int32Array(n));
    this.team = copy(this.team, (n) => new Int8Array(n));
    this.x = copy(this.x, (n) => new Float64Array(n));
    this.y = copy(this.y, (n) => new Float64Array(n));
    this.laid = copy(this.laid, (n) => new Int32Array(n));
    this.armAt = copy(this.armAt, (n) => new Int32Array(n));
    this.damage = copy(this.damage, (n) => new Float64Array(n));
    this.radius = copy(this.radius, (n) => new Float64Array(n));
    this.trigger = copy(this.trigger, (n) => new Float64Array(n));
    for (let i = size - 1; i >= old; i--) this.free.push(i);
    this.capacity = size;
  }
}
