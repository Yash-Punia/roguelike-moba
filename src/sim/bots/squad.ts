import type { Entity } from '../ecs';

/** Two bots taking one camp together (D-075). */
export interface FarmPlan {
  /** Index into `map.camps` / `snapshot.camps`. */
  camp: number;
  a: Entity;
  b: Entity;
  started: number;
  /** Last tick each was in the farm mode. */
  seenA: number;
  seenB: number;
}

/**
 * A team's shared farming board (D-075). Bots of one team are asked for commands in ascending
 * player order every tick, so reading and writing it is deterministic. Each bot reports whether
 * it is free; a free bot with no plan pairs itself with another free one for a camp.
 */
export class Squad {
  readonly plans: FarmPlan[] = [];
  /** Registered bots (ascending, as they report), the last tick each was free, and where it stood. */
  readonly ids: Entity[] = [];
  private readonly freeAt: number[] = [];
  private readonly cooldownUntil: number[] = [];
  readonly xs: number[] = [];
  readonly ys: number[] = [];

  private slot(e: Entity): number {
    let i = this.ids.indexOf(e);
    if (i < 0) {
      i = this.ids.length;
      this.ids.push(e);
      this.freeAt.push(-1);
      this.cooldownUntil.push(0);
      this.xs.push(0);
      this.ys.push(0);
    }
    return i;
  }

  report(e: Entity, free: boolean, x: number, y: number, tick: number) {
    const i = this.slot(e);
    if (free && tick >= this.cooldownUntil[i]!) this.freeAt[i] = tick;
    this.xs[i] = x;
    this.ys[i] = y;
  }

  /** Free this tick or the last (a partner later in the order hasn't reported this tick yet). */
  isFree(e: Entity, tick: number): boolean {
    const i = this.ids.indexOf(e);
    return i >= 0 && this.freeAt[i]! >= tick - 1 && !this.planOf(e);
  }

  planOf(e: Entity): FarmPlan | undefined {
    for (const p of this.plans) if (p.a === e || p.b === e) return p;
    return undefined;
  }

  campTaken(camp: number): boolean {
    for (const p of this.plans) if (p.camp === camp) return true;
    return false;
  }

  form(camp: number, a: Entity, b: Entity, tick: number) {
    this.plans.push({ camp, a, b, started: tick, seenA: tick, seenB: tick });
  }

  /** It is farming this tick. */
  seen(p: FarmPlan, e: Entity, tick: number) {
    if (p.a === e) p.seenA = tick;
    else p.seenB = tick;
  }

  /** Ends a plan; both stay in lane for `cooldown` ticks. */
  end(p: FarmPlan, tick: number, cooldown: number) {
    const k = this.plans.indexOf(p);
    if (k < 0) return;
    this.plans.splice(k, 1);
    for (const e of [p.a, p.b]) this.cooldownUntil[this.slot(e)] = tick + cooldown;
  }
}
