import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../src/data/schema';
import { parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import { mulberry32 } from '../src/sim/rng';
import { createSim, Team, type TelegraphSnapshot } from '../src/sim/sim';
import { fixtureConfig } from './helpers';

const { Blue, Red } = Team;
const TIERS: Difficulty[] = ['easy', 'normal', 'hard'];

/** One sim to read snapshots from; bots are made per case, each with its own random stream. */
function setup() {
  const config = fixtureConfig();
  config.waves.enabled = false;
  config.bots.hesitation.chancePerSecond = 0;
  const sim = createSim(config, 1, [
    { team: Blue, championId: 'alpha', spawnAt: { x: 0, y: -30 } },
    { team: Red, championId: 'alpha', spawnAt: { x: 0, y: 40 } },
  ]);
  const e = sim.entityOf(0)!;
  const make = (d: Difficulty, seed = 1) => createBot(0, Blue, () => config, () => sim.lanes, mulberry32(seed), 'centre', undefined, undefined, d);
  return { config, sim, e, make };
}

const marker: TelegraphSnapshot = { team: Red, shape: 'circle', x: 0.8, y: -30, angle: 0, radius: 2, arc: 0, length: 0, width: 0, anchor: 0, elapsed: 0, total: 1000 };

describe('difficulty tiers (TDD §7, D-086)', () => {
  it('ship the TDD table, with one retreat range for all (D-086)', () => {
    const d = parseConfig(rawConfig).bots.difficulty;
    expect(TIERS.map((t) => d[t].decisionSeconds)).toEqual([12, 6, 3]);
    expect(TIERS.map((t) => d[t].dodgeChancePct)).toEqual([0.25, 0.6, 0.9]);
    expect(TIERS.map((t) => d[t].retreatHpPct)).toEqual([[0.18, 0.3], [0.18, 0.3], [0.18, 0.3]]);
    expect(TIERS.map((t) => d[t].draftTop)).toEqual([2, 1, 1]);
    expect(d.easy.reactionSeconds).toBe(18);
    expect(d.hard.reactionSeconds).toBe(6);
  });

  it('every tier hesitates as often per second, whatever its decision pace', () => {
    const rate = (t: Difficulty) => {
      const f = setup();
      f.config.bots.hesitation.chancePerSecond = 0.5; // often enough to count
      const bot = f.make(t, 3);
      const snap = f.sim.snapshot();
      const seconds = 400;
      let pauses = 0;
      let last = 0;
      for (let tick = 100; tick < 100 + seconds * 30; tick++) {
        bot.command(snap, tick, f.e);
        if (bot.pauseUntil !== last) {
          pauses++;
          last = bot.pauseUntil;
        }
      }
      return pauses / seconds;
    };
    for (const t of TIERS) expect(Math.abs(rate(t) - 0.5)).toBeLessThan(0.1);
  });

  it.each(TIERS)('%s rolls its retreat threshold in its range', (t) => {
    const f = setup();
    const [lo, hi] = f.config.bots.difficulty[t].retreatHpPct;
    for (let seed = 1; seed <= 20; seed++) {
      const r = f.make(t, seed).personality.retreatHp;
      expect(r).toBeGreaterThanOrEqual(lo);
      expect(r).toBeLessThanOrEqual(hi);
    }
  });

  it.each(TIERS)('%s tries to dodge at its chance, after its reaction time', (t) => {
    const f = setup();
    const tier = f.config.bots.difficulty[t];
    const snap = f.sim.snapshot();
    snap.telegraphs.push(marker);
    let tried = 0;
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      const bot = f.make(t, seed);
      bot.command(snap, 100, f.e);
      expect(bot.dodging).toBe(false); // not before its reaction time
      bot.command(snap, 100 + tier.reactionSeconds, f.e);
      if (bot.dodging) tried++;
    }
    expect(Math.abs(tried / N - tier.dodgeChancePct)).toBeLessThan(0.1);
  });

  it.each(['easy', 'hard'] as const)('%s breaks off to retreat only after its reaction time', (t) => {
    const f = setup();
    const bot = f.make(t);
    const react = f.config.bots.difficulty[t].reactionSeconds;
    const snap = f.sim.snapshot();
    const me = snap.entities.find((x) => x.id === f.e)!;
    me.hp = me.maxHp * 0.05;
    for (let tick = 100; tick < 100 + react; tick++) {
      bot.command(snap, tick, f.e);
      expect(bot.mode).not.toBe('retreat');
    }
    bot.command(snap, 100 + react, f.e);
    expect(bot.mode).toBe('retreat');
  });

  it('Easy drafts among its best two cards, Normal and Hard take the best', () => {
    const f = setup();
    const cards = ['hollowPoints', 'deadEye', 'fieldRations']; // for Alpha: 2nd, 1st, last
    const snap = f.sim.snapshot();
    snap.entities.find((x) => x.id === f.e)!.draftCards = cards;
    const picks = (t: Difficulty) => {
      const seen = new Set<number>();
      for (let seed = 1; seed <= 40; seed++) {
        const bot = f.make(t, seed);
        bot.command(snap, 100, f.e);
        seen.add(bot.command(snap, 300, f.e).draftPick);
      }
      return [...seen].sort();
    };
    expect(picks('easy')).toEqual([0, 1]);
    expect(picks('normal')).toEqual([1]);
    expect(picks('hard')).toEqual([1]);
  });
});
