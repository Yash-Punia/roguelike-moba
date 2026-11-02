/**
 * Champion stats (TDD §5): value = (base + flat) × (1 + Σpct) × Πmult, cached until a power
 * or buff changes an input. Percentages stack additively; multipliers come only from Epic
 * powers and debuffs. Stored in small typed arrays so nothing allocates per tick.
 */
export enum Stat {
  /** Multiplier on base damage (base 1 plus level growth): Hollow Points, Heat Wave, Supply Drop. */
  Damage = 0,
  FireRate = 1,
  MaxHp = 2,
  MoveSpeed = 3,
  Range = 4,
  /** Multiplier on damage taken (base 1): Flak Vest, Dug In, Tracer mark. */
  DamageTaken = 5,
  UltCharge = 6,
  /** Multiplier on damage vs enemy champions (base 1): Bounty Hunter. */
  DamageVsChampions = 7,
  /** Multiplier on damage vs structures (base 1): Demolition Expert, Bazooka Tank. */
  DamageVsStructures = 8,
}
const COUNT = 9;

export interface Stats {
  base: Float64Array;
  flat: Float64Array;
  pct: Float64Array;
  mult: Float64Array;
  value: Float64Array;
  dirty: boolean;
}

export function createStats(): Stats {
  return {
    base: new Float64Array(COUNT),
    flat: new Float64Array(COUNT),
    pct: new Float64Array(COUNT),
    mult: new Float64Array(COUNT).fill(1),
    value: new Float64Array(COUNT),
    dirty: true,
  };
}

/** Current value of a stat, recomputing every cached value first if any input changed. */
export function stat(s: Stats, which: Stat): number {
  if (s.dirty) {
    for (let i = 0; i < COUNT; i++) s.value[i] = (s.base[i]! + s.flat[i]!) * (1 + s.pct[i]!) * s.mult[i]!;
    s.dirty = false;
  }
  return s.value[which]!;
}

/**
 * Adds `delta` to a stat's additive percentage. Every source (traits, buffs, powers, debug)
 * adds its share on gain and removes the same amount on loss, so sources never clobber
 * each other.
 */
export function addPct(s: Stats, which: Stat, delta: number): void {
  if (delta === 0) return;
  s.pct[which] = s.pct[which]! + delta;
  s.dirty = true;
}
