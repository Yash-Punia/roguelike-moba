import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Team, type Command } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;
type Tweak = Parameters<typeof arena>[1];
const press: Command[] = [{ tick: 0, player: 0, moveX: 0, moveY: 0, ult: true, draftPick: -1, reroll: false }];

function field(units: Unit[] = [], tweak?: Tweak) {
  const a = arena(units, tweak);
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step(commands).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const champ = (id: number) => a.sim.stores.champions.get(id)!;
  const xp = (id: number) => champ(id).xp;
  /** One MG Soldier of `team` at (x, y); the rest of the wave is removed (no XP: nobody near). */
  const soldier = (team: Team, x: number, y: number) => {
    a.sim.debug.spawnWave();
    const ids = a.sim.stores.laneAgents.ids.slice(-6);
    const keep = ids.find((e) => a.sim.stores.teams.get(e) === team)!;
    for (const e of ids) if (e !== keep) a.sim.debug.kill(e);
    run(); // the kills land far from every champion
    a.move(keep, x, y);
    return keep;
  };
  const disarm = (e: number) => a.sim.stores.weapons.remove(e);
  return { ...a, events, run, champ, xp, soldier, disarm };
}

describe('levels (GDD §8)', () => {
  it('follow the XP table, cap at level 12, and announce every level gained', () => {
    const a = field();
    a.sim.debug.giveXp(a.shooter, 99);
    a.run();
    expect(a.champ(a.shooter).level).toBe(1);
    a.sim.debug.giveXp(a.shooter, 1);
    a.run();
    expect(a.champ(a.shooter).level).toBe(2);
    a.sim.debug.giveXp(a.shooter, 120);
    a.run();
    expect([a.champ(a.shooter).level, a.xp(a.shooter)]).toEqual([3, 220]);
    a.sim.debug.giveXp(a.shooter, 5000);
    a.run();
    expect([a.champ(a.shooter).level, a.xp(a.shooter)]).toEqual([12, 2200]);
    expect(a.events.filter((e) => e.type === 'levelUp').map((e) => (e as { level: number }).level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const s = a.sim.snapshot().entities.find((e) => e.id === a.shooter)!;
    expect([s.level, s.xp]).toEqual([12, 2200]);
  });
});

describe('stat growth (GDD §7: +5% HP, +4% damage per level)', () => {
  it('grows max HP and damage, and a level-up adds the new HP', () => {
    const a = field([{ team: Red, x: 0, y: 5 }]);
    a.hp(a.shooter, 600);
    a.sim.debug.giveXp(a.shooter, 520); // level 5
    a.run();
    const h = a.sim.stores.healths.get(a.shooter)!;
    expect(h.maxHp).toBeCloseTo(1200);
    expect(h.hp).toBeCloseTo(800);
    a.run(10);
    const hit = a.events.find((e) => e.type === 'damage' && e.source === a.shooter) as Extract<SimEvent, { type: 'damage' }>;
    expect(hit.amount).toBeCloseTo(95 * 1.16);
  });

  it('keeps other stat sources through a level-up', () => {
    const a = field();
    a.sim.debug.setStatPct(a.shooter, 1, 0.3);
    a.sim.debug.levelUp(a.shooter);
    a.run();
    expect(a.sim.stores.stats.get(a.shooter)!.pct[1]).toBeCloseTo(0.3);
  });
});

describe('minion XP (GDD §8)', () => {
  it('splits 30 XP between the enemy champions within 10 m, whoever killed it', () => {
    const a = field([{ team: Blue, x: 3, y: 30 }, { team: Blue, x: -6, y: 30 }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 15, -50);
    const m = a.soldier(Red, 0, 30);
    a.move(3, -10.5, 30); // 10.5 m away: none
    a.sim.debug.kill(m);
    a.run();
    expect([a.xp(a.shooter), a.xp(2), a.xp(3)]).toEqual([0, 30, 0]);

    const m2 = a.soldier(Red, 0, 30);
    a.move(3, -6, 30);
    a.sim.debug.kill(m2);
    a.run();
    expect([a.xp(2), a.xp(3)]).toEqual([45, 15]);
  });

  it('pays nothing to dead champions', () => {
    const a = field([{ team: Blue, x: 3, y: 30 }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 15, -50);
    a.sim.debug.kill(2);
    a.run();
    const m = a.soldier(Red, 0, 30);
    a.sim.debug.kill(m);
    a.run();
    expect(a.xp(2)).toBe(0);
  });
});

describe('champion and structure XP', () => {
  it('pays the killer 120 + 25 × victim level + 30; other kills pay nothing', () => {
    const a = field([{ team: Red, x: 0, y: 5 }, { team: Red, x: 10, y: 30 }]);
    a.hp(2, 50);
    a.run(10);
    expect(a.xp(a.shooter)).toBe(175);
    a.sim.debug.kill(3);
    a.run();
    expect(a.events.filter((e) => e.type === 'death' && e.id === 3)).toHaveLength(1);
    expect(a.xp(a.shooter)).toBe(175);
  });

  it('pays the whole team 150 when a Sub-base falls, the dead included', () => {
    const a = field([{ team: Blue, x: 12, y: -30 }, { team: Red, x: 0, y: 6, structure: 'subBase' }]);
    a.sim.debug.kill(2);
    a.run();
    const sub = a.sim.stores.structures.ids[0]!;
    a.hp(sub, 50);
    a.run(15);
    expect([a.xp(a.shooter), a.xp(2)]).toEqual([150, 150]);
  });
});

describe('level effects', () => {
  it('lengthen the respawn timer and grow the grenade', () => {
    const a = field([{ team: Red, x: 0, y: 8.5 }]);
    a.sim.debug.giveXp(a.shooter, 220); // level 3
    a.sim.debug.giveXp(2, 220);
    a.run();
    a.sim.debug.fillUltimate(a.shooter);
    a.run(1, press);
    a.run(18);
    const blast = a.events.find((e) => e.type === 'damage' && e.target === 2) as Extract<SimEvent, { type: 'damage' }>;
    expect(blast.amount).toBeCloseTo((250 + 2 * 20) * (1 + 0.04 * 2));
    a.sim.debug.kill(2);
    a.run();
    expect(a.champ(2).respawnTicks).toBe(228);
  });
});

describe('Ultimate charge from kills (GDD §8)', () => {
  it('gives +3 to each living enemy champion within 10 m of a dying minion, not split', () => {
    const a = field([{ team: Blue, x: 3, y: 30 }, { team: Blue, x: -6, y: 30 }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 15, -50);
    const charge = (id: number) => a.champ(id).ultCharge;
    const m = a.soldier(Red, 0, 30);
    a.move(3, -10.5, 30); // 10.5 m: none
    const [c2, c3] = [charge(2), charge(3)];
    a.sim.debug.kill(m);
    a.run();
    const passive = 100 / 1500; // one tick of passive charge
    expect(charge(2) - c2).toBeCloseTo(3 + passive);
    expect(charge(3) - c3).toBeCloseTo(passive);

    const m2 = a.soldier(Red, 0, 30);
    a.move(3, -6, 30);
    const [d2, d3] = [charge(2), charge(3)];
    a.sim.debug.kill(m2);
    a.run();
    expect(charge(2) - d2).toBeCloseTo(3 + passive);
    expect(charge(3) - d3).toBeCloseTo(3 + passive);
  });

  it('gives nothing to a dead champion near a minion', () => {
    const a = field([{ team: Blue, x: 3, y: 30 }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 15, -50);
    a.sim.debug.kill(2);
    a.run();
    const before = a.champ(2).ultCharge;
    const m = a.soldier(Red, 0, 30);
    a.sim.debug.kill(m);
    a.run();
    expect(a.champ(2).ultCharge).toBe(before);
  });

  it('gives the killer +25 for a champion takedown; other kills give none', () => {
    const a = field([{ team: Red, x: 0, y: 5 }, { team: Red, x: 10, y: 30 }], (c) => {
      Object.assign(c.progression.ultCharge, { perDamageDealt: Infinity, perDamageTaken: Infinity }); // takedown charge only
    });
    a.hp(2, 50);
    let before = 0;
    for (let i = 0; i < 10 && a.champ(2).respawnTicks === 0; i++) {
      before = a.champ(a.shooter).ultCharge;
      a.run();
    }
    expect(a.champ(a.shooter).ultCharge - before).toBeCloseTo(25 + 100 / 1500);
    const b = a.champ(a.shooter).ultCharge;
    a.sim.debug.kill(3);
    a.run();
    expect(a.champ(a.shooter).ultCharge - b).toBeCloseTo(100 / 1500);
  });

  it('scales with the Ult-charge stat and caps at 100', () => {
    const a = field([{ team: Blue, x: 3, y: 30 }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 15, -50);
    a.sim.debug.setStatPct(2, 6, 0.5); // +50% Ult charge
    const m = a.soldier(Red, 0, 30);
    const before = a.champ(2).ultCharge;
    a.sim.debug.kill(m);
    a.run();
    expect(a.champ(2).ultCharge - before).toBeCloseTo((3 + 100 / 1500) * 1.5);
    a.champ(2).ultCharge = 99;
    const m2 = a.soldier(Red, 0, 30);
    a.sim.debug.kill(m2);
    a.run();
    expect(a.champ(2).ultCharge).toBe(100);
  });
});

describe('Ultimate charge from fighting (GDD §8, D-065)', () => {
  const passive = 100 / 1500; // the arena's charge time, per tick

  it('+1 per 100 damage dealt to enemy champions and per 150 taken from them', () => {
    const a = field([{ team: Red, x: 0, y: 5 }]);
    a.hp(2, 1e6);
    let n = 0;
    while (a.hp(2) === 1e6 && n < 60) {
      a.run();
      n++;
    }
    expect(a.champ(a.shooter).ultCharge).toBeCloseTo(n * passive + 95 / 100);
    expect(a.champ(2).ultCharge).toBeCloseTo(n * passive + 95 / 150);
  });

  it('gives nothing for damage to or from structures', () => {
    const a = field([{ team: Red, x: 0, y: 5, structure: 'subBase' }]);
    const sub = a.sim.stores.structures.ids[0]!;
    const full = a.hp(sub);
    let n = 0;
    while (a.hp(sub) === full && n < 60) {
      a.run();
      n++;
    }
    expect(a.hp(sub)).toBeLessThan(full);
    expect(a.champ(a.shooter).ultCharge).toBeCloseTo(n * passive);
  });

  it('a takedown charges every enemy champion that damaged the victim within 8 s', () => {
    for (const [wait, assisted] of [[200, true], [280, false]] as const) {
      const a = field([{ team: Red, x: 0, y: 5 }, { team: Blue, x: 3, y: 5 }]);
      a.hp(2, 1e6);
      // The ally (3) lands one bullet on the victim (2), then waits.
      a.sim.projectiles.spawn(3, Blue, 2, true, 3, 5, -25 / 30, 0, 50, 1, 30);
      a.run(wait);
      a.hp(2, 1);
      const ally = a.champ(3);
      let before = ally.ultCharge;
      for (let i = 0; i < 40 && a.champ(2).respawnTicks === 0; i++) {
        before = ally.ultCharge;
        a.run();
      }
      expect(a.champ(2).respawnTicks).toBeGreaterThan(0);
      expect(ally.ultCharge - before).toBeCloseTo(passive + (assisted ? 25 : 0));
    }
  });
});

describe('takedown credit (GDD §8, D-067)', () => {
  it('the killer and every assist within 8 s get the full takedown XP; the killer +30 more', () => {
    for (const [wait, assisted] of [[200, true], [280, false]] as const) {
      const a = field([{ team: Red, x: 0, y: 5 }, { team: Blue, x: 3, y: 5 }]);
      a.hp(2, 1e6);
      a.sim.projectiles.spawn(3, Blue, 2, true, 3, 5, -25 / 30, 0, 50, 1, 30); // the ally's hit
      a.run(wait);
      const killerXp = a.xp(a.shooter);
      const allyXp = a.xp(3);
      a.hp(2, 1);
      for (let i = 0; i < 40 && a.champ(2).respawnTicks === 0; i++) a.run();
      const k = a.config.progression.championKill;
      const full = k.base + k.perVictimLevel * 1;
      expect(a.xp(a.shooter) - killerXp).toBe(full + k.killerBonus);
      expect(a.xp(3) - allyXp).toBe(assisted ? full : 0);
      expect(a.champ(a.shooter).kills).toBe(1);
      expect(a.champ(a.shooter).assists).toBe(0);
      expect(a.champ(3).assists).toBe(assisted ? 1 : 0);
    }
  });
});
