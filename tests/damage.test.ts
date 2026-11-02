import { describe, expect, it } from 'vitest';
import { DamageLog, HitFlag } from '../src/sim/damage-log';
import type { DamageEvent } from '../src/sim/events';
import { Team } from '../src/sim/sim';
import { Stat } from '../src/sim/stats';
import { arena, type Unit } from './helpers';

const { Red } = Team;

/** Arena plus a recorder of every damage event (copied, with the tick it happened on). */
function duel(units: Unit[], tweak?: Parameters<typeof arena>[1]) {
  const a = arena(units, tweak);
  const hits: (DamageEvent & { tick: number })[] = [];
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const ev of a.sim.step([]).events) if (ev.type === 'damage') hits.push({ ...ev, tick: a.sim.tick - 1 });
    }
  };
  return { ...a, hits, run };
}

const everyTick = (c: Parameters<NonNullable<Parameters<typeof arena>[1]>>[0]) => {
  c.champions[0]!.weapon.interval = 1;
};

describe('damage pipeline (TDD §6.4)', () => {
  it('applies base × attacker × crit × target in order', () => {
    const a = duel([{ team: Red, x: 0, y: 5 }]);
    a.sim.debug.setStatPct(a.shooter, Stat.Damage, 0.12); // Hollow Points
    a.sim.debug.setStatPct(a.shooter, Stat.DamageVsChampions, 0.2); // Bounty Hunter
    a.sim.debug.setCrit(a.shooter, 1, 2); // every shot a double-damage crit
    a.sim.debug.setStatPct(2, Stat.DamageTaken, -0.1); // Flak Vest
    a.run(10);
    const expected = 95 * 1.12 * 1.2 * 2 * 0.9;
    expect(a.hits).toHaveLength(1);
    expect(a.hits[0]!.amount).toBeCloseTo(expected);
    expect(a.hits[0]!.critical).toBe(true);
    expect(a.hp(2)).toBeCloseTo(1000 - expected);
  });

  it('applies the vs-champions bonus only to champions and the vs-structures bonus only to structures', () => {
    const bonuses = (a: ReturnType<typeof duel>) => {
      a.sim.debug.setStatPct(a.shooter, Stat.DamageVsChampions, 0.5);
      a.sim.debug.setStatPct(a.shooter, Stat.DamageVsStructures, 0.35);
    };
    const champ = duel([{ team: Red, x: 0, y: 5 }]);
    bonuses(champ);
    champ.run(10);
    expect(champ.hits[0]!.amount).toBeCloseTo(95 * 1.5);
    const sub = duel([{ team: Red, x: 0, y: 5, structure: 'subBase' }]);
    bonuses(sub);
    sub.run(10);
    expect(sub.hits[0]!.amount).toBeCloseTo(95 * 1.35);
  });

  it('lets the shield absorb first, then HP', () => {
    const a = duel([{ team: Red, x: 0, y: 5 }]);
    a.sim.debug.addShield(2, 50);
    a.run(10);
    expect(a.hits[0]).toMatchObject({ amount: 95, absorbed: 50, lethal: false });
    expect(a.sim.stores.healths.get(2)!.shield).toBe(0);
    expect(a.hp(2)).toBe(1000 - 45);
  });

  it('logs and announces a hit the shield fully absorbs', () => {
    const a = duel([{ team: Red, x: 0, y: 5 }]);
    a.sim.debug.addShield(2, 200);
    a.run(10);
    expect(a.hits[0]).toMatchObject({ amount: 95, absorbed: 95 });
    expect(a.sim.stores.healths.get(2)!.shield).toBe(105);
    expect(a.hp(2)).toBe(1000);
    expect(a.sim.damageLog.count).toBe(1);
  });

  it('turns a lethal hit into 1 HP and 45 ticks of invulnerability, once', () => {
    const a = duel([{ team: Red, x: 0, y: 3 }], everyTick);
    a.hp(2, 50);
    a.sim.debug.armLethalSave(2);
    a.run(120);
    const saved = a.hits.find((h) => h.saved)!;
    expect(saved).toMatchObject({ amount: 49, lethal: false });
    // Bullets already in flight during the window are stopped but do nothing.
    expect(a.hits.filter((h) => h.tick > saved.tick && h.tick < saved.tick + 45)).toHaveLength(0);
    const kill = a.hits.find((h) => h.lethal)!;
    expect(kill.tick).toBeGreaterThanOrEqual(saved.tick + 45);
    expect(kill.amount).toBe(1);
    expect(a.hp(2)).toBe(0);
    expect(a.sim.stores.healths.get(2)!.lethalSaves).toBe(0);
    expect(a.hits.indexOf(kill)).toBe(a.hits.indexOf(saved) + 1);
  });

  it('kills without a save, dealing only the HP that was left', () => {
    const a = duel([{ team: Red, x: 0, y: 5 }]);
    a.hp(2, 30);
    a.run(10);
    expect(a.hits[0]).toMatchObject({ amount: 30, lethal: true });
    expect(a.hp(2)).toBe(0);
  });

  it('ignores hits on invulnerable or already-dead targets', () => {
    const inv = duel([{ team: Red, x: 0, y: 5 }]);
    inv.run(); // the first bullet is in flight
    inv.sim.stores.healths.get(2)!.invulnerable = true;
    inv.run(10);
    expect(inv.hp(2)).toBe(1000);
    expect(inv.hits).toHaveLength(0);
    expect(inv.sim.damageLog.count).toBe(0);
    expect(inv.sim.projectiles.live).toBe(0); // it still stopped the bullet

    const dead = duel([{ team: Red, x: 0, y: 5 }]);
    dead.run();
    dead.hp(2, 0);
    dead.run(10);
    expect(dead.hits).toHaveLength(0);
  });

  it('crits exactly every Nth shot', () => {
    const a = duel([{ team: Red, x: 0, y: 4, structure: 'subBase' }]);
    a.sim.debug.setCrit(a.shooter, 3, 2);
    a.run(160);
    expect(a.hits.map((h) => h.critical)).toEqual([false, false, true, false, false, true, false]);
    expect(a.hits[2]!.amount).toBeCloseTo(190);
  });

  it('logs source, target, amount and flags in tick order', () => {
    const a = duel([{ team: Red, x: 0, y: 5 }]);
    a.hp(2, 150);
    a.run(60);
    const log = a.sim.damageLog;
    expect(log.count).toBe(2);
    const first = log.slot(0);
    const second = log.slot(1);
    expect([log.source[first], log.target[first], log.amount[first], log.flags[first]]).toEqual([a.shooter, 2, 95, 0]);
    expect([log.amount[second], log.flags[second]]).toEqual([55, HitFlag.Lethal]);
    expect(log.tick[first]).toBeLessThan(log.tick[second]!);
    expect(log.lastHitBy(a.shooter, 2)).toBe(log.tick[second]);
  });
});

describe('damage log ring', () => {
  it('grows rather than drop entries inside the window', () => {
    const log = new DamageLog(10, 4);
    for (let i = 0; i < 6; i++) log.push(5, 1, 2, i, 0, 0);
    expect(log.count).toBe(6);
    const amounts: number[] = [];
    log.forEachSince(0, (i) => amounts.push(log.amount[i]!));
    expect(amounts).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('overwrites the oldest entries once they leave the window', () => {
    const log = new DamageLog(10, 4);
    for (let i = 0; i < 4; i++) log.push(i, 1, 2, i, 0, 0);
    log.push(20, 3, 2, 99, 0, 0); // tick 0 is outside the window: overwritten, no growth
    log.push(21, 3, 2, 100, 0, 0);
    expect(log.count).toBe(4);
    const ticks: number[] = [];
    log.forEachSince(0, (i) => ticks.push(log.tick[i]!));
    expect(ticks).toEqual([2, 3, 20, 21]);
    const recent: number[] = [];
    log.forEachSince(20, (i) => recent.push(log.amount[i]!));
    expect(recent).toEqual([99, 100]);
    expect(log.lastHitBy(1, 2)).toBe(3);
    expect(log.lastHitBy(4, 2)).toBe(-1);
  });
});
