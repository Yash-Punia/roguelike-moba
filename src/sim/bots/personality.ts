import type { Config } from '../../data/schema';
import type { Rng } from '../rng';

/** A bot's temperament for one match, rolled once from the seeded `ai` stream (D-043). */
export interface Personality {
  aggression: number;
  riskTolerance: number;
  /** HP shares: heads home below `retreatHp`, comes back at `returnHp`. */
  retreatHp: number;
  returnHp: number;
  /** Preferred share of weapon range to fight at. */
  spacing: number;
  /** Sideways weave while fighting: amplitude (m) and period (ticks). */
  weaveAmplitude: number;
  weavePeriod: number;
  /** Ticks it keeps a mode before re-choosing freely. */
  patience: number;
}

const roll = (rng: Rng, [a, b]: readonly [number, number]) => a + (b - a) * rng();

/** Rolls a personality inside the configured ranges (each trait independent). */
export function rollPersonality(cfg: Config['bots']['personality'], rng: Rng): Personality {
  return {
    aggression: roll(rng, cfg.aggression),
    riskTolerance: roll(rng, cfg.riskTolerance),
    retreatHp: roll(rng, cfg.retreatHpPct),
    returnHp: roll(rng, cfg.returnHpPct),
    spacing: roll(rng, cfg.spacingPct),
    weaveAmplitude: roll(rng, cfg.weaveAmplitude),
    weavePeriod: Math.max(6, Math.round(roll(rng, cfg.weavePeriodSeconds) * 30)),
    patience: Math.round(roll(rng, cfg.patienceSeconds) * 30),
  };
}
