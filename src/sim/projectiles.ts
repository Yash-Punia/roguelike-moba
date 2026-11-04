import type { Entity } from './ecs';

/**
 * Pooled projectiles (TDD §5 `Projectile`, §12 no allocations). Struct-of-arrays slots,
 * reused through a free list, so firing allocates nothing once the pool has grown to the
 * match's peak. Slots are processed in index order and freed slots are reused LIFO, both
 * fixed by the order of play, so the pool is deterministic.
 */
export class ProjectilePool {
  capacity = 0;
  /** Number of live projectiles. */
  live = 0;
  active = new Uint8Array(0);
  /** Unique per shot, for render interpolation; never reused. */
  id = new Int32Array(0);
  owner = new Int32Array(0);
  team = new Int8Array(0);
  target = new Int32Array(0);
  homing = new Uint8Array(0);
  x = new Float64Array(0);
  y = new Float64Array(0);
  /** Velocity in metres per tick. */
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  speed = new Float64Array(0);
  /** Base damage (before the pipeline's modifiers) and crit multiplier (1 = none). */
  damage = new Float64Array(0);
  critMult = new Float64Array(0);
  /** Damage multiplier the shooter added at fire time (structure warm-up), for render. */
  boost = new Float64Array(0);
  /** Rockets: splash radius (0 = a plain bullet) and damage multiplier vs structures, both fixed at fire time (the shooter may be gone when it lands). */
  splash = new Float64Array(0);
  structureMult = new Float64Array(0);
  life = new Int32Array(0);
  /** Powers (D-060): enemies it may still pass through, bounces left with their reach and damage share, and the unit it last hit (never hit twice in a row). */
  pierce = new Int32Array(0);
  bounces = new Int32Array(0);
  bounceRadius = new Float64Array(0);
  bouncePct = new Float64Array(0);
  lastHit = new Int32Array(0);
  private free: number[] = [];
  private nextId = 1;

  constructor(initial = 128) {
    this.grow(initial);
  }

  spawn(owner: Entity, team: number, target: Entity, homing: boolean, x: number, y: number, vx: number, vy: number, damage: number, critMult: number, life: number, boost = 1, splash = 0, structureMult = 1): number {
    if (this.free.length === 0) this.grow(this.capacity * 2);
    const i = this.free.pop()!;
    this.active[i] = 1;
    this.id[i] = this.nextId++;
    this.owner[i] = owner;
    this.team[i] = team;
    this.target[i] = target;
    this.homing[i] = homing ? 1 : 0;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.speed[i] = Math.sqrt(vx * vx + vy * vy);
    this.damage[i] = damage;
    this.critMult[i] = critMult;
    this.boost[i] = boost;
    this.splash[i] = splash;
    this.structureMult[i] = structureMult;
    this.life[i] = life;
    this.pierce[i] = 0;
    this.bounces[i] = 0;
    this.bounceRadius[i] = 0;
    this.bouncePct[i] = 0;
    this.lastHit[i] = 0;
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
    this.target = copy(this.target, (n) => new Int32Array(n));
    this.homing = copy(this.homing, (n) => new Uint8Array(n));
    this.x = copy(this.x, (n) => new Float64Array(n));
    this.y = copy(this.y, (n) => new Float64Array(n));
    this.vx = copy(this.vx, (n) => new Float64Array(n));
    this.vy = copy(this.vy, (n) => new Float64Array(n));
    this.speed = copy(this.speed, (n) => new Float64Array(n));
    this.damage = copy(this.damage, (n) => new Float64Array(n));
    this.critMult = copy(this.critMult, (n) => new Float64Array(n));
    this.boost = copy(this.boost, (n) => new Float64Array(n));
    this.splash = copy(this.splash, (n) => new Float64Array(n));
    this.structureMult = copy(this.structureMult, (n) => new Float64Array(n));
    this.life = copy(this.life, (n) => new Int32Array(n));
    this.pierce = copy(this.pierce, (n) => new Int32Array(n));
    this.bounces = copy(this.bounces, (n) => new Int32Array(n));
    this.bounceRadius = copy(this.bounceRadius, (n) => new Float64Array(n));
    this.bouncePct = copy(this.bouncePct, (n) => new Float64Array(n));
    this.lastHit = copy(this.lastHit, (n) => new Int32Array(n));
    // Push new slots highest first so the lowest index is handed out first.
    for (let i = size - 1; i >= old; i--) this.free.push(i);
    this.capacity = size;
  }
}
