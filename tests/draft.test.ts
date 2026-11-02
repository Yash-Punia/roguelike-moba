import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Team, type Command } from '../src/sim/sim';
import { Stat, stat } from '../src/sim/stats';
import { arena, withPowers, type Unit } from './helpers';

const { Red } = Team;
type Tweak = Parameters<typeof arena>[1];
const pick = (slot: 0 | 1 | 2): Command[] => [{ tick: 0, player: 0, moveX: 0, moveY: 0, ult: false, draftPick: slot, reroll: false }];

function field(units: Unit[] = [], tweak?: Tweak) {
  const a = arena(units, (c) => {
    withPowers(c);
    tweak?.(c);
  });
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step(commands).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const champ = (id: number) => a.sim.stores.champions.get(id)!;
  const levelUp = () => {
    a.sim.debug.levelUp(a.shooter);
    run();
  };
  /** Make the live offer contain `power` in slot 0 (tests pick effects directly). */
  const offerFirst = (power: string) => {
    const q = champ(a.shooter).draftQueue;
    q.length = 0;
    q.push({ cards: [power, 'longBarrel', 'quickCharge'], ticksLeft: 300 });
  };
  const st = () => a.sim.stores.stats.get(a.shooter)!;
  return { ...a, events, run, champ, levelUp, offerFirst, st };
}

describe('draft offers (GDD §8)', () => {
  it('offer 3 distinct Common cards on a level-up, the same for the same seed', () => {
    const cards = () => {
      const a = field();
      a.levelUp();
      const offered = a.events.find((e) => e.type === 'draftOffered') as Extract<SimEvent, { type: 'draftOffered' }>;
      return offered.cards;
    };
    const first = cards();
    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    expect(cards()).toEqual(first);
  });

  it('stop at level 12', () => {
    const a = field();
    a.sim.debug.giveXp(a.shooter, 2200);
    a.run();
    a.champ(a.shooter).draftQueue.length = 0;
    a.levelUp();
    expect(a.champ(a.shooter).draftQueue).toHaveLength(0);
  });

  it('never offer a power already taken 3 times', () => {
    const a = field();
    a.champ(a.shooter).powers.rapidFire = 3;
    for (let i = 0; i < 8; i++) {
      a.levelUp();
      a.run(1, pick(0));
    }
    const offered = a.events.filter((e) => e.type === 'draftOffered').flatMap((e) => (e as { cards: readonly string[] }).cards);
    expect(offered.length).toBeGreaterThan(10);
    expect(offered).not.toContain('rapidFire');
  });
});

describe('picking', () => {
  it('applies the picked card, stacking', () => {
    const a = field();
    a.levelUp();
    a.offerFirst('rapidFire');
    a.run(1, pick(0));
    expect(a.champ(a.shooter).powers.rapidFire).toBe(1);
    expect(stat(a.st(), Stat.FireRate)).toBeCloseTo(1.12);
    a.levelUp();
    a.offerFirst('rapidFire');
    a.run(1, pick(0));
    expect(stat(a.st(), Stat.FireRate)).toBeCloseTo(1.24);
    expect(a.events.filter((e) => e.type === 'powerPicked').map((e) => (e as { auto: boolean }).auto)).toEqual([false, false]);
  });

  it('takes the recommended card after 10 s: the one sharing tags with owned powers', () => {
    const a = field();
    a.champ(a.shooter).powers.hollowPoints = 1; // owns a "damage" power
    a.levelUp();
    const q = a.champ(a.shooter).draftQueue;
    q[0]!.cards = ['lightBoots', 'rapidFire', 'flakVest']; // Rapid Fire shares "damage"
    a.run(299);
    expect(a.champ(a.shooter).powers.rapidFire).toBeUndefined();
    a.run();
    expect(a.champ(a.shooter).powers.rapidFire).toBe(1);
    expect(a.events.find((e) => e.type === 'powerPicked')).toMatchObject({ power: 'rapidFire', auto: true });
  });

  it('queues up to 2 more offers, auto-picks the oldest past that, and restarts the timer for the next', () => {
    const a = field();
    a.sim.debug.giveXp(a.shooter, 220); // levels 2 and 3: two offers
    a.run();
    expect(a.champ(a.shooter).draftQueue).toHaveLength(2);
    a.run(100);
    a.sim.debug.giveXp(a.shooter, 300); // levels 4 and 5: queue overflows once
    a.run();
    expect(a.champ(a.shooter).draftQueue).toHaveLength(3);
    expect(a.events.filter((e) => e.type === 'powerPicked' && e.auto)).toHaveLength(1);
    expect(a.champ(a.shooter).draftQueue[0]!.ticksLeft).toBe(300);
    a.run(1, pick(2));
    expect(a.champ(a.shooter).draftQueue).toHaveLength(2);
    expect(a.champ(a.shooter).draftQueue[0]!.ticksLeft).toBe(300);
  });
});

describe('Common effects', () => {
  const take = (power: string, units: Unit[] = []) => {
    const a = field(units);
    a.levelUp();
    a.offerFirst(power);
    a.run(1, pick(0));
    return a;
  };

  it('Light Boots: +8% move speed', () => {
    const a = take('lightBoots');
    expect(a.sim.stores.motions.get(a.shooter)!.speed).toBeCloseTo(5 * 1.08);
  });

  it('Field Rations: +15% max HP, gained as HP', () => {
    const a = field();
    a.levelUp(); // level 2: 1,050
    a.hp(a.shooter, 500);
    a.offerFirst('fieldRations');
    a.run(1, pick(0));
    const h = a.sim.stores.healths.get(a.shooter)!;
    expect(h.maxHp).toBeCloseTo(1050 * 1.15);
    expect(h.hp).toBeCloseTo(500 + 1050 * 0.15);
  });

  it('Flak Vest: −10% damage taken', () => {
    const a = field([{ team: Red, x: 0, y: 5, armed: true }]);
    a.levelUp();
    a.offerFirst('flakVest');
    a.run(1, pick(0));
    a.run(30);
    const hit = a.events.find((e) => e.type === 'damage' && e.target === a.shooter) as Extract<SimEvent, { type: 'damage' }>;
    expect(hit.amount).toBeCloseTo(95 * 0.9);
  });

  it('Quick Charge: +15% Ultimate charge', () => {
    const a = take('quickCharge');
    const before = a.champ(a.shooter).ultCharge;
    a.run();
    expect(a.champ(a.shooter).ultCharge - before).toBeCloseTo((100 / 1500) * 1.15);
  });

  it('Field Medic: heals 2% max HP/s only after 3 s out of combat', () => {
    const a = field([{ team: Red, x: 0, y: 5, armed: true }]);
    a.levelUp();
    a.offerFirst('fieldMedic');
    a.run(1, pick(0));
    a.run(60); // trading shots: in combat
    const fighting = a.hp(a.shooter);
    a.run(30);
    expect(a.hp(a.shooter)).toBeLessThanOrEqual(fighting);
    a.move(a.shooter, 0, -30); // walk away
    a.sim.stores.weapons.remove(a.shooter);
    a.hp(a.shooter, 500);
    a.champ(a.shooter).lastCombatTick = a.sim.tick; // the last shot exchanged lands now
    a.run(90); // 3 s out of combat
    expect(a.hp(a.shooter)).toBe(500);
    a.run(30);
    const max = a.sim.stores.healths.get(a.shooter)!.maxHp;
    expect(a.hp(a.shooter)).toBeCloseTo(500 + max * 0.02);
  });
});
