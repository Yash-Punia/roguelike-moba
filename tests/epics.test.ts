import { describe, expect, it } from 'vitest';
import type { Config } from '../src/data/schema';
import type { SimEvent } from '../src/sim/events';
import { Team, type Command } from '../src/sim/sim';
import { arena, withPowers, type Unit } from './helpers';

const Red = Team.Red;
const ult: Command = { tick: 0, player: 0, moveX: 0, moveY: 0, ult: true, draftPick: -1, reroll: false };
const go = (moveX: number, moveY: number): Command => ({ tick: 0, player: 0, moveX, moveY, ult: false, draftPick: -1, reroll: false });

/** The arena with the shipped catalogue; `powers` granted to the shooter (player 0) before the first step. */
function withGrants(units: Unit[], powers: string[], tweak?: (c: Config) => void) {
  const m = arena(units, (c) => {
    withPowers(c);
    tweak?.(c);
  });
  for (const p of powers) m.sim.debug.grantPower(m.shooter, p);
  return m;
}

/** Steps n ticks and returns every event. */
function run(m: ReturnType<typeof arena>, n: number, commands: Command[] = []) {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...m.sim.step(commands).events.map((e) => ({ ...e })));
  return out;
}

const tough = (m: ReturnType<typeof arena>, ...ids: number[]) => {
  for (const id of ids) m.hp(id, 1e6);
};

describe('Epics (D-063)', () => {
  it('Mortar Support: a 150 shell on the target every 6 s, none without a target', () => {
    const m = withGrants([{ team: Red, x: 0, y: 5 }], ['mortarSupport']);
    tough(m, 2);
    const ev = run(m, 6 * 30 * 2 + 40);
    const shells = ev.filter((e) => e.type === 'explosion' && e.owner === m.shooter);
    expect(shells).toHaveLength(3);
    expect(ev.some((e) => e.type === 'damage' && e.target === 2 && !e.weapon && Math.abs(e.amount - 150) < 1e-6)).toBe(true);
    const idle = withGrants([], ['mortarSupport']);
    expect(run(idle, 200).filter((e) => e.type === 'explosion')).toHaveLength(0);
  });

  it('Airstrike Beacon: a cast also drops 3 bombs 3 m apart across the target; one lands on it', () => {
    const m = withGrants([{ team: Red, x: 0, y: 6 }], ['airstrikeBeacon']);
    tough(m, 2);
    m.sim.stores.weapons.remove(m.shooter);
    m.sim.debug.fillUltimate(m.shooter);
    const ev = [...run(m, 1, [ult]), ...run(m, 40)];
    const bombs = ev.filter((e): e is Extract<SimEvent, { type: 'explosion' }> => e.type === 'explosion' && e.radius === 2);
    expect(bombs.map((b) => [b.x, b.y]).sort((a, b) => a[0]! - b[0]!)).toEqual([[-3, 6], [0, 6], [3, 6]].map(([x, y]) => [expect.closeTo(x!), expect.closeTo(y!)]));
    expect(ev.filter((e) => e.type === 'damage' && e.target === 2 && Math.abs(e.amount - 200) < 1e-6)).toHaveLength(1);
  });

  it('Tesla Rounds: the 5th weapon hit chains 120 to the 3 nearest other enemies within 5 m', () => {
    const m = withGrants(
      [{ team: Red, x: 0, y: 5 }, { team: Red, x: 2, y: 6 }, { team: Red, x: -2, y: 6 }, { team: Red, x: 0, y: 7.5 }, { team: Red, x: 6, y: 12 }],
      ['teslaRounds'],
    );
    tough(m, 2, 3, 4, 5, 6);
    const ev = run(m, 5 * 25 + 20);
    const hits = ev.filter((e) => e.type === 'damage' && e.target === 2 && e.weapon).length;
    expect(hits).toBeGreaterThanOrEqual(5); // one chain: the 5th hit, not yet the 10th
    expect(hits).toBeLessThan(10);
    const chains = ev.filter((e): e is Extract<SimEvent, { type: 'chain' }> => e.type === 'chain');
    expect(chains.map((c) => c.to).sort()).toEqual([3, 4, 5]);
    expect(ev.filter((e) => e.type === 'damage' && [3, 4, 5].includes(e.target) && Math.abs(e.amount - 120) < 1e-6)).toHaveLength(3);
    expect(ev.some((e) => e.type === 'damage' && e.target === 6)).toBe(false);
  });

  it('Last Stand: once per life a lethal hit leaves 1 HP; armed again on respawn', () => {
    const m = withGrants([], ['lastStand']);
    const h = m.sim.stores.healths.get(m.shooter)!;
    expect(h.lethalSaves).toBe(1);
    m.sim.debug.kill(m.shooter);
    m.step(1);
    expect(h.hp).toBe(1);
    m.step(50);
    m.sim.debug.kill(m.shooter);
    m.step(1);
    expect(h.hp).toBe(0);
    for (let i = 0; i < 400 && h.hp <= 0; i++) m.step(1);
    expect(h.hp).toBeGreaterThan(0);
    expect(h.lethalSaves).toBe(1);
  });

  it('Overcharge: charge stores up to 200; each cast spends 100', () => {
    const m = withGrants([{ team: Red, x: 0, y: 6 }], ['overcharge']);
    tough(m, 2);
    const c = m.sim.stores.champions.get(m.shooter)!;
    c.ultCharge = 199.9;
    m.step(5);
    expect(c.ultCharge).toBe(200);
    const casts = [...run(m, 1, [ult]), ...run(m, 1, [ult]), ...run(m, 1, [ult])].filter((e) => e.type === 'ultCast');
    expect(casts).toHaveLength(2);
    expect(c.ultCharge).toBeLessThan(100);
  });

  it('Minefield: a mine every 6 s while moving, at most 3; armed mines burst on enemies, not allies', () => {
    const m = withGrants([], ['minefield']);
    const live = () => {
      let n = 0;
      for (let i = 0; i < m.sim.mines.capacity; i++) n += m.sim.mines.active[i]!;
      return n;
    };
    run(m, 100);
    expect(live()).toBe(0); // standing still
    for (let leg = 0; leg < 8; leg++) run(m, 90, [go(0, leg % 2 ? -127 : 127)]); // pace up and down for 24 s
    expect(live()).toBe(3);

    const blast = withGrants([{ team: Team.Blue, x: 10, y: 10 }, { team: Red, x: 10, y: -10 }], ['minefield']);
    run(blast, 2, [go(0, 127)]);
    run(blast, 40);
    const mine = { x: blast.sim.mines.x[0]!, y: blast.sim.mines.y[0]! };
    blast.move(2, mine.x + 0.5, mine.y); // an ally on top: nothing
    expect(run(blast, 5).filter((e) => e.type === 'explosion')).toHaveLength(0);
    blast.move(2, 10, 10);
    blast.move(3, mine.x + 0.5, mine.y);
    const ev = run(blast, 2);
    expect(ev.filter((e) => e.type === 'explosion')).toHaveLength(1);
    expect(blast.hp(3)).toBeCloseTo(880);
  });

  it('Attack Drone: each trigger pull adds a homing bullet for 40% at the target', () => {
    const m = withGrants([{ team: Red, x: 0, y: 5 }], ['attackDrone']);
    for (let i = 0; i < 120 && m.hp(2) === 1000; i++) m.step(1);
    m.step(12);
    expect(1000 - m.hp(2)).toBeCloseTo(95 + 38);
  });

  it('War Dog: follows, bites the owner\'s target, falls with no XP, comes back after 20 s and with its owner', () => {
    const m = withGrants([{ team: Red, x: 0, y: 4 }], ['warDog']);
    tough(m, 2);
    m.step(1);
    const summons = m.sim.stores.summons;
    expect(summons.ids).toHaveLength(1);
    const dog = summons.ids[0]!;
    const bites = run(m, 90).filter((e) => e.type === 'damage' && e.target === 2 && !e.weapon && Math.abs(e.amount - 30) < 1e-6);
    expect(bites.length).toBeGreaterThanOrEqual(3);

    const xp = m.sim.stores.champions.get(m.shooter)!.xp;
    m.sim.debug.kill(dog);
    const down = run(m, 2);
    expect(down.some((e) => e.type === 'summonDown' && e.id === dog)).toBe(true);
    expect(down.some((e) => e.type === 'death')).toBe(false);
    expect(m.sim.stores.champions.get(m.shooter)!.xp).toBe(xp);
    expect(summons.ids).toHaveLength(0);
    run(m, 20 * 30);
    expect(summons.ids).toHaveLength(1);

    m.sim.debug.kill(m.shooter);
    m.step(2);
    expect(summons.ids).toHaveLength(0); // gone with its owner
    const h = m.sim.stores.healths.get(m.shooter)!;
    for (let i = 0; i < 400 && h.hp <= 0; i++) m.step(1);
    m.step(1);
    expect(summons.ids).toHaveLength(1);
  });
});
