export type Entity = number;

/**
 * Sparse-set component store. `ids` is kept sorted ascending so every system
 * iterates entities in id order (determinism rule 2).
 * ponytail: sorted insert/remove are O(n) splices; fine at ~100 entities, swap for
 * a dirty-flag sort if profiling shows it.
 */
export class Store<T> {
  readonly ids: Entity[] = [];
  readonly data: T[] = [];
  private readonly sparse: (number | undefined)[] = [];

  has(e: Entity): boolean {
    return this.sparse[e] !== undefined;
  }

  get(e: Entity): T | undefined {
    const i = this.sparse[e];
    return i === undefined ? undefined : this.data[i];
  }

  add(e: Entity, value: T): T {
    const existing = this.sparse[e];
    if (existing !== undefined) {
      this.data[existing] = value;
      return value;
    }
    let i = this.ids.length;
    while (i > 0 && this.ids[i - 1]! > e) i--;
    this.ids.splice(i, 0, e);
    this.data.splice(i, 0, value);
    this.reindex(i);
    return value;
  }

  remove(e: Entity): void {
    const i = this.sparse[e];
    if (i === undefined) return;
    this.ids.splice(i, 1);
    this.data.splice(i, 1);
    this.sparse[e] = undefined;
    this.reindex(i);
  }

  private reindex(from: number): void {
    for (let i = from; i < this.ids.length; i++) this.sparse[this.ids[i]!] = i;
  }
}

export class World {
  private nextId = 1;
  private readonly stores: Store<unknown>[] = [];

  store<T>(): Store<T> {
    const s = new Store<T>();
    this.stores.push(s as Store<unknown>);
    return s;
  }

  /** Ids are never reused, so a stale id can never alias a new entity. */
  create(): Entity {
    return this.nextId++;
  }

  destroy(e: Entity): void {
    for (const s of this.stores) s.remove(e);
  }
}
