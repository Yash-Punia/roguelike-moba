import type { Entity } from './ecs';

/**
 * Lobbed grenades and shells in flight (TDD §6.5): a fixed arc from where they were thrown to
 * the target's position at launch; they don't home. Pooled struct-of-arrays like bullets,
 * processed in slot order. Each carries its own blast (D-063).
 */
export enum LobKind {
  /** Alpha's Frag Grenade: its blast, bomblets and fire pool come from the owner's Ultimate. */
  Grenade = 0,
  /** A mortar shell or airstrike bomb: one blast of `damage` in `radius`. */
  Shell = 1,
}

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
  kind = new Uint8Array(0);
  /** Blast damage (shells) and radius, and the arc's apex height (render). */
  damage = new Float64Array(0);
  radius = new Float64Array(0);
  arcHeight = new Float64Array(0);
  private free: number[] = [];
  private nextId = 1;

  constructor(initial = 8) {
    this.grow(initial);
  }

  spawn(owner: Entity, team: number, x0: number, y0: number, x1: number, y1: number, total: number, kind = LobKind.Grenade, damage = 0, radius = 0, arcHeight = 0): number {
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
    this.kind[i] = kind;
    this.damage[i] = damage;
    this.radius[i] = radius;
    this.arcHeight[i] = arcHeight;
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
    this.kind = copy(this.kind, (n) => new Uint8Array(n));
    this.damage = copy(this.damage, (n) => new Float64Array(n));
    this.radius = copy(this.radius, (n) => new Float64Array(n));
    this.arcHeight = copy(this.arcHeight, (n) => new Float64Array(n));
    for (let i = size - 1; i >= old; i--) this.free.push(i);
    this.capacity = size;
  }
}
