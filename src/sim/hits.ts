import type { Entity } from './ecs';

/** Hits waiting for the damage stage this tick, in the order they happened. Preallocated, reused every tick. */
export class HitQueue {
  count = 0;
  source = new Int32Array(64);
  target = new Int32Array(64);
  amount = new Float64Array(64);

  push(source: Entity, target: Entity, amount: number) {
    if (this.count === this.source.length) {
      const grow = <T extends Int32Array | Float64Array>(a: T, make: (n: number) => T) => {
        const b = make(a.length * 2);
        b.set(a);
        return b;
      };
      this.source = grow(this.source, (n) => new Int32Array(n));
      this.target = grow(this.target, (n) => new Int32Array(n));
      this.amount = grow(this.amount, (n) => new Float64Array(n));
    }
    this.source[this.count] = source;
    this.target[this.count] = target;
    this.amount[this.count] = amount;
    this.count++;
  }
}
