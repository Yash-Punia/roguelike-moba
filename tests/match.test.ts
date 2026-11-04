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
    expect(a.sim.snapshot().match).toMatchObject({ phase: 'deploy', winner: undefined }); // the arena's first wave is at 0:15
    a.sim.debug.destroyHq(Red);
    a.run(3);
    const over = a.events.filter((e) => e.type === 'matchOver');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ winner: Blue, reason: 'hq' });
    expect(a.sim.snapshot().match).toMatchObject({ phase: 'ended', winner: Blue, reason: 'hq', endTick: over[0]!.tick });
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
    expect(a.sim.match.phase).not.toBe('ended');
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

describe('match phases (GDD §2, TDD §6.12, D-068)', () => {
  /** Tweaked phase times (ticks): first wave 30, Sudden Death 60, surrender from 90, time-out 150. */
  function timed(units: Unit[] = []) {
    const a = arena(units, (c) => {
      c.waves.firstSeconds = 30;
      Object.assign(c.match.phases, { suddenDeathSeconds: 60, surrenderFromSeconds: 90, timeoutSeconds: 150 });
    });
    const events: SimEvent[] = [];
    const run = (n = 1, surrender = false) => {
      const cmd = [{ tick: 0, player: 0, moveX: 0, moveY: 0, ult: false, draftPick: -1 as const, reroll: false, surrender }];
      for (let i = 0; i < n; i++) for (const ev of a.sim.step(cmd).events) events.push({ ...ev });
    };
    const structure = (kind: 'subBase' | 'hq', team: Team) =>
      a.sim.stores.structures.ids.find((e) => a.sim.stores.structures.get(e)!.kind === kind && a.sim.stores.teams.get(e) === team)!;
    return { ...a, events, run, structure };
  }

  it('goes Deploy → Live at the first wave → Sudden Death on time', () => {
    const a = timed();
    a.run(1);
    expect(a.sim.match.phase).toBe('deploy');
    a.run(30);
    expect(a.sim.match.phase).toBe('live');
    a.run(30);
    expect(a.sim.match.phase).toBe('suddenDeath');
    expect(a.events.filter((e) => e.type === 'phaseChanged').map((e) => e.type === 'phaseChanged' && e.phase)).toEqual(['live', 'suddenDeath']);
  });

  it('Sudden Death: structures take +50% damage and respawns take 1.5×', () => {
    const a = timed([{ team: Red, x: 0, y: 6, structure: 'subBase' }]);
    a.hp(a.structure('subBase', Red), 1e6);
    const hit = () => {
      const before = a.hp(a.structure('subBase', Red));
      for (let i = 0; i < 40 && a.hp(a.structure('subBase', Red)) === before; i++) a.run();
      return before - a.hp(a.structure('subBase', Red));
    };
    const calm = hit();
    a.run(61 - a.sim.tick);
    expect(a.sim.match.phase).toBe('suddenDeath');
    expect(hit()).toBeCloseTo(calm * 1.5);
    a.sim.debug.kill(a.shooter);
    a.run();
    expect(a.sim.stores.champions.get(a.shooter)!.respawnTicks).toBe(Math.round(156 * 1.5)); // set this tick, counting down from the next
  });

  it('time-out: the higher HQ HP% wins; all equal is a draw', () => {
    const a = timed([{ team: Red, x: 10, y: 40, structure: 'hq' }, { team: Blue, x: -10, y: -40, structure: 'hq' }]);
    const red = a.sim.stores.healths.get(a.structure('hq', Red))!;
    red.hp = red.maxHp * 0.5;
    a.run(160);
    const over = a.events.filter((e) => e.type === 'matchOver');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ winner: Blue, reason: 'timeout', tick: 150 });

    const b = timed([{ team: Red, x: 10, y: 40, structure: 'hq' }, { team: Blue, x: -10, y: -40, structure: 'hq' }]);
    b.run(160);
    expect(b.events.find((e) => e.type === 'matchOver')).toMatchObject({ winner: undefined, reason: 'timeout' });
  });

  it('time-out ties on HQ HP% go to more Sub-bases destroyed, then more takedowns', () => {
    const a = timed([
      { team: Red, x: 10, y: 40, structure: 'hq' }, { team: Blue, x: -10, y: -40, structure: 'hq' },
      { team: Red, x: 10, y: 20, structure: 'subBase' },
    ]);
    a.sim.debug.kill(a.structure('subBase', Red));
    a.run(160);
    expect(a.events.find((e) => e.type === 'matchOver')).toMatchObject({ winner: Blue });

    const b = timed([{ team: Red, x: 10, y: 40, structure: 'hq' }, { team: Blue, x: -10, y: -40, structure: 'hq' }, { team: Red, x: 0, y: -30 }]);
    b.run(10);
    b.sim.stores.champions.get(2)!.kills = 1;
    b.run(160);
    expect(b.events.find((e) => e.type === 'matchOver')).toMatchObject({ winner: Red });
  });

  it('surrender: ignored before 5:00 (here tick 90), then the other team wins', () => {
    const a = timed();
    a.run(5, true);
    expect(a.sim.match.phase).not.toBe('ended');
    a.run(90 - a.sim.tick); // the next step is tick 90
    a.run(1, true);
    expect(a.events.find((e) => e.type === 'matchOver')).toMatchObject({ winner: Red, reason: 'surrender' });
    expect(a.sim.match.phase).toBe('ended');
  });
});
