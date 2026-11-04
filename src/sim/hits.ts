import type { Entity } from './ecs';

/**
 * Hits waiting for the damage stage this tick, in the order they happened (TDD §6.4). Each
 * carries the weapon's or effect's base damage and a crit multiplier (1 = no crit); every
 * other modifier is applied by the pipeline. Preallocated, reused every tick.
 */
export class HitQueue {
  count = 0;
  source = new Int32Array(64);
  target = new Int32Array(64);
  base = new Float64Array(64);
  critMult = new Float64Array(64);
  /** Share of the damage structures take (fire pool: 0.5); 1 for most hits. */
  structureMult = new Float64Array(64);
  /** 1: a fixed amount (a burn of the target's max HP) that skips the attacker's modifiers. */
  exact = new Int32Array(64);
  /** 1: a weapon hit (bullet, rocket, flame), which on-hit powers react to (D-060). */
  weapon = new Int32Array(64);

  push(source: Entity, target: Entity, base: number, critMult = 1, structureMult = 1, exact = false, weapon = false) {
    if (this.count === this.source.length) {
      const grow = <T extends Int32Array | Float64Array>(a: T, make: (n: number) => T) => {
        const b = make(a.length * 2);
        b.set(a);
        return b;
      };
      this.source = grow(this.source, (n) => new Int32Array(n));
      this.target = grow(this.target, (n) => new Int32Array(n));
      this.base = grow(this.base, (n) => new Float64Array(n));
      this.critMult = grow(this.critMult, (n) => new Float64Array(n));
      this.structureMult = grow(this.structureMult, (n) => new Float64Array(n));
      this.exact = grow(this.exact, (n) => new Int32Array(n));
      this.weapon = grow(this.weapon, (n) => new Int32Array(n));
    }
    this.source[this.count] = source;
    this.target[this.count] = target;
    this.base[this.count] = base;
    this.critMult[this.count] = critMult;
    this.structureMult[this.count] = structureMult;
    this.exact[this.count] = exact ? 1 : 0;
    this.weapon[this.count] = weapon ? 1 : 0;
    this.count++;
  }
}
