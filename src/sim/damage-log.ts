import type { Entity } from './ecs';

/** Hit flags in the damage log and on `damage` events. */
export enum HitFlag {
  Critical = 1,
  /** The hit took the target's last HP. */
  Lethal = 2,
  /** A lethal hit that a lethal save turned into 1 HP. */
  Saved = 4,
}

/**
 * Every hit that went through the damage pipeline (TDD §6.4 step 7), for assists, structure
 * aggro, minion call-for-help, Ult charge and telemetry. A ring of struct-of-arrays entries
 * in tick order: it always keeps at least the last `windowTicks`, overwriting older entries,
 * and doubles in size when a burst of hits would push in-window entries out. Nothing
 * allocates once it has grown to the match's peak.
 */
export class DamageLog {
  /** Number of entries held (≤ capacity). */
  count = 0;
  private head = 0; // next write slot
  private capacity: number;
  tick: Int32Array;
  source: Int32Array;
  target: Int32Array;
  /** HP plus shield lost, after every modifier. */
  amount: Float64Array;
  /** The part of `amount` the shield absorbed. */
  absorbed: Float64Array;
  flags: Uint8Array;

  windowTicks: number;

  constructor(windowTicks: number, initial = 256) {
    this.windowTicks = windowTicks;
    this.capacity = initial;
    this.tick = new Int32Array(initial);
    this.source = new Int32Array(initial);
    this.target = new Int32Array(initial);
    this.amount = new Float64Array(initial);
    this.absorbed = new Float64Array(initial);
    this.flags = new Uint8Array(initial);
  }

  push(tick: number, source: Entity, target: Entity, amount: number, absorbed: number, flags: number) {
    if (this.count === this.capacity) {
      // Full: overwrite the oldest entry unless it is still inside the window.
      if (this.tick[this.head]! > tick - this.windowTicks) this.grow();
      else this.count--;
    }
    const i = this.head;
    this.tick[i] = tick;
    this.source[i] = source;
    this.target[i] = target;
    this.amount[i] = amount;
    this.absorbed[i] = absorbed;
    this.flags[i] = flags;
    this.head = (this.head + 1) % this.capacity;
    this.count++;
  }

  /** Slot of the k-th entry, oldest first (k in 0..count-1). */
  slot(k: number): number {
    return (this.head - this.count + k + this.capacity) % this.capacity;
  }

  /** Calls `fn` with the slot of every entry at or after `tick`, oldest first. */
  forEachSince(tick: number, fn: (slot: number) => void) {
    for (let k = 0; k < this.count; k++) {
      const i = this.slot(k);
      if (this.tick[i]! >= tick) fn(i);
    }
  }

  /** Tick of the latest hit by `source` on `target` still held, or −1. */
  lastHitBy(source: Entity, target: Entity): number {
    for (let k = this.count - 1; k >= 0; k--) {
      const i = this.slot(k);
      if (this.source[i] === source && this.target[i] === target) return this.tick[i]!;
    }
    return -1;
  }

  private grow() {
    const size = this.capacity * 2;
    const order = <T extends Int32Array | Float64Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(size);
      for (let k = 0; k < this.count; k++) b[k] = a[this.slot(k)]!;
      return b;
    };
    this.tick = order(this.tick, (n) => new Int32Array(n));
    this.source = order(this.source, (n) => new Int32Array(n));
    this.target = order(this.target, (n) => new Int32Array(n));
    this.amount = order(this.amount, (n) => new Float64Array(n));
    this.absorbed = order(this.absorbed, (n) => new Float64Array(n));
    this.flags = order(this.flags, (n) => new Uint8Array(n));
    this.head = this.count;
    this.capacity = size;
  }
}
