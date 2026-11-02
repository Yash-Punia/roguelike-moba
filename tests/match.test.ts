import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Team } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;

function field(units: Unit[]) {
  const a = arena(units);
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step([]).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const champ = (id: number) => a.sim.stores.champions.get(id)!;
  const structure = (kind: 'subBase' | 'hq', team: Team) =>
    a.sim.stores.structures.ids.find((e) => a.sim.stores.structures.get(e)!.kind === kind && a.sim.stores.teams.get(e) === team)!;
  return { ...a, events, run, champ, structure };
}

describe('win and lose (GDD §2, TDD §6.12)', () => {
  it('ends the match when an HQ falls, with the other team as winner', () => {
    const a = field([{ team: Red, x: 10, y: 40, structure: 'hq' }, { team: Blue, x: -10, y: -40, structure: 'hq' }]);
    expect(a.sim.snapshot().match).toMatchObject({ phase: 'live', winner: undefined });
    a.sim.debug.destroyHq(Red);
    a.run(3);
    const over = a.events.filter((e) => e.type === 'matchOver');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ winner: Blue });
    expect(a.sim.snapshot().match).toMatchObject({ phase: 'ended', winner: Blue, endTick: over[0]!.tick });
  });

  it('freezes the sim once over: no events, no ticks, nothing moves', () => {
    const a = field([{ team: Red, x: 0, y: 5, armed: true }, { team: Red, x: 10, y: 40, structure: 'hq' }]);
    a.run(10);
    a.sim.debug.destroyHq(Red);
    a.run();
    const tick = a.sim.tick;
    const hp = a.hp(a.shooter);
    const count = a.events.length;
    const command = { tick: 0, player: 0, moveX: 127, moveY: 0, ult: false, draftPick: -1 as const, reroll: false };
    for (let i = 0; i < 100; i++) expect(a.sim.step([command]).events).toHaveLength(0);
    expect(a.sim.tick).toBe(tick);
    expect(a.hp(a.shooter)).toBe(hp);
    expect(a.sim.stores.transforms.get(a.shooter)!.x).toBe(0);
    expect(a.events.length).toBe(count);
  });

  it('cannot end while the HQ gate holds', () => {
    const a = field([
      { team: Red, x: 10, y: 40, structure: 'hq', shielded: true },
      { team: Red, x: -10, y: 40, structure: 'subBase' },
    ]);
    a.sim.debug.kill(a.structure('hq', Red));
    a.run(5);
    expect(a.sim.match.phase).toBe('live');
  });

  it('ends through a real push: Sub-base first, then the HQ', () => {
    const a = field([
      { team: Red, x: 0, y: 6, structure: 'subBase' },
      { team: Red, x: 6, y: 3, structure: 'hq', shielded: true },
    ]);
    a.hp(a.structure('subBase', Red), 40);
    a.hp(a.structure('hq', Red), 40);
    a.run(120);
    expect(a.events.filter((e) => e.type === 'structureDestroyed').map((e) => (e as { kind: string }).kind)).toEqual(['subBase', 'hq']);
    expect(a.sim.match).toMatchObject({ phase: 'ended', winner: Blue });
  });
});

describe('kills and deaths', () => {
  it('count a takedown for the killing champion and a death for the victim; other deaths count no kill', () => {
    const a = field([{ team: Red, x: 0, y: 5 }, { team: Red, x: 10, y: 40 }]);
    a.hp(2, 50);
    a.run(10);
    expect([a.champ(a.shooter).kills, a.champ(2).deaths]).toEqual([1, 1]);
    a.sim.debug.kill(3);
    a.run();
    expect([a.champ(a.shooter).kills, a.champ(3).deaths]).toEqual([1, 1]);
    const s = a.sim.snapshot().entities.find((e) => e.id === a.shooter)!;
    expect([s.kills, s.deaths]).toEqual([1, 0]);
  });
});
