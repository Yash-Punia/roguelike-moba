import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Team } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;

/** The arena with the comeback rules at their GDD §9 values (the fixture turns them off). */
function field(units: Unit[] = []) {
  const a = arena(units, (c) => {
    c.progression.bounty = { minStreak: 3, xpPerTakedown: 100, maxXp: 300 };
    c.progression.catchUp = { pctPerLevel: 0.15, maxPct: 0.6 };
    c.progression.underdogChargePct = 0.2;
    Object.assign(c.structures.rules, { lastLineHpPct: 0.3, lastLineFireRatePct: 0.5 });
  });
  const events: SimEvent[] = [];
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) events.push(...a.sim.step([]).events);
  };
  const champ = (id: number) => a.sim.stores.champions.get(id)!;
  return { ...a, events, run, champ };
}

/** XP the shooter gets for a takedown on champion 2 (a Red Alpha 5 m away) set up by `prep`. */
function takedownXp(prep: (f: ReturnType<typeof field>) => void) {
  const f = field([{ team: Red, x: 0, y: 5 }]);
  prep(f);
  f.run(); // levels from `prep` land
  const before = f.champ(f.shooter).xp;
  f.hp(2, 50);
  f.run(10);
  expect(f.champ(2).respawnTicks).toBeGreaterThan(0);
  return { gained: f.champ(f.shooter).xp - before, f };
}

describe('kill streak bounty (GDD §9, D-084)', () => {
  it.each([
    [2, 0],
    [3, 100],
    [4, 200],
    [9, 300],
  ])('a victim on a streak of %d is worth %d XP more', (streak, bounty) => {
    const { gained } = takedownXp((f) => (f.champ(2).streak = streak));
    expect(gained).toBe(175 + bounty); // 120 + 25 × level 1 + 30 for the killer
  });

  it('counts takedowns since the last knock-out', () => {
    const { f } = takedownXp((f) => (f.champ(2).streak = 5));
    expect([f.champ(f.shooter).streak, f.champ(2).streak]).toEqual([1, 0]);
  });
});

describe('level catch-up (GDD §9, D-084)', () => {
  it.each([
    [1, 1],
    [3, 1.3],
    [9, 1.6], // +15% × 8 levels, capped at +60%
  ])('a level %d victim pays a level 1 killer ×%d', (level, mult) => {
    const xpTo = [0, 0, 100, 220, 360, 520, 700, 900, 1120, 1360];
    const { gained } = takedownXp((f) => f.sim.debug.giveXp(2, xpTo[level]!));
    expect(gained).toBeCloseTo((120 + 25 * level + 30) * mult);
  });
});

describe('underdog charge (GDD §9, D-084)', () => {
  const passive = 100 / 1500; // the arena's charge time, per tick

  it('gives the team with fewer standing Sub-bases +20% passive charge', () => {
    const f = field([{ team: Red, x: 0, y: 40, structure: 'subBase' }]);
    f.run(30);
    expect(f.champ(f.shooter).ultCharge).toBeCloseTo(30 * passive * 1.2);
  });

  it('gives no one more while both have as many', () => {
    const f = field([
      { team: Red, x: 0, y: 40, structure: 'subBase' },
      { team: Blue, x: 0, y: -40, structure: 'subBase' },
    ]);
    f.run(30);
    expect(f.champ(f.shooter).ultCharge).toBeCloseTo(30 * passive);
  });
});

describe('HQ last line (GDD §9, D-084)', () => {
  it('fires 50% faster once below 30% HP, for the rest of the match', () => {
    const f = field([{ team: Red, x: 0, y: 40, structure: 'hq', armed: true }]);
    const hq = f.sim.stores.structures.ids[0]!;
    const w = f.sim.stores.weapons.get(hq)!;
    const base = w.interval;
    const max = f.sim.stores.healths.get(hq)!.maxHp;
    f.hp(hq, max * 0.31);
    f.run();
    expect(w.interval).toBe(base);
    f.hp(hq, max * 0.29);
    f.run();
    expect(w.interval).toBeCloseTo(base / 1.5);
    expect(f.events.filter((e) => e.type === 'hqLastLine')).toEqual([{ type: 'hqLastLine', id: hq, team: Red }]);
    // Healed, or re-tuned live: it stays on.
    f.hp(hq, max);
    f.run();
    f.sim.setConfig(f.config);
    expect(w.interval).toBeCloseTo(base / 1.5);
    expect(f.events.filter((e) => e.type === 'hqLastLine')).toHaveLength(1);
  });
});
