import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Kind, Team } from '../src/sim/sim';
import { isBlocked } from '../src/sim/grid';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;
type Tweak = Parameters<typeof arena>[1];

function field(units: Unit[], tweak?: Tweak) {
  const a = arena(units, tweak);
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step([]).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const structure = (kind: 'subBase' | 'hq') => a.sim.stores.structures.ids.find((e) => a.sim.stores.structures.get(e)!.kind === kind)!;
  const targetOf = (e: number) => a.sim.stores.targetings.get(e)!.targetId;
  const hits = (source: number, target?: number) =>
    events.filter((e) => e.type === 'damage' && e.source === source && (target === undefined || e.target === target)) as Extract<SimEvent, { type: 'damage' }>[];
  /** One Blue MG Soldier at (x, y); the rest of the wave is removed. */
  const soldier = (x: number, y: number, team = Blue) => {
    a.sim.debug.spawnWave();
    const ids = a.sim.stores.laneAgents.ids.slice(-6);
    const keep = ids.find((e) => a.sim.stores.teams.get(e) === team)!;
    for (const e of ids) if (e !== keep) a.sim.debug.kill(e);
    a.move(keep, x, y);
    return keep;
  };
  const disarm = (e: number) => a.sim.stores.weapons.remove(e);
  return { ...a, events, run, structure, targetOf, hits, soldier, disarm };
}

const SUB = 200; // GDD Sub-base damage per shot
const HQ = 300;

describe('structure aggro (GDD §5)', () => {
  it('shoots the nearest enemy minion before a champion', () => {
    const a = field([{ team: Red, x: 0, y: 10, structure: 'subBase', armed: true }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 0, 4);
    const m = a.soldier(2.5, 4.5);
    a.run();
    expect(a.targetOf(a.structure('subBase'))).toBe(m);
  });

  it('keeps its target when a minion walks in (D-036)', () => {
    const a = field([{ team: Red, x: 0, y: 10, structure: 'subBase', armed: true }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 0, 4);
    a.hp(a.shooter, 1e6);
    a.run();
    const sub = a.structure('subBase');
    expect(a.targetOf(sub)).toBe(a.shooter);
    a.soldier(2.5, 4.5);
    a.run(5);
    expect(a.targetOf(sub)).toBe(a.shooter);
  });

  it('turns on an enemy champion who hits an allied champion in its range, the next tick', () => {
    const a = field([
      { team: Red, x: 1.5, y: 6 }, // Red champion under its own tower
      { team: Red, x: 0, y: 10, structure: 'subBase', armed: true },
    ]);
    a.move(a.shooter, 0, 3.5);
    const m = a.soldier(-2.5, 5);
    a.hp(m, 1e6);
    a.run();
    const sub = a.structure('subBase');
    expect(a.targetOf(sub)).toBe(m);
    let hitTick = -1;
    for (let i = 0; i < 30 && hitTick < 0; i++) {
      a.run();
      const h = a.events.find((e) => e.type === 'damage' && e.source === a.shooter && e.target === 2);
      if (h) hitTick = h.tick;
    }
    expect(hitTick).toBeGreaterThanOrEqual(0);
    expect(a.targetOf(sub)).toBe(m); // same tick: not yet
    a.run();
    expect(a.targetOf(sub)).toBe(a.shooter);
  });
});

describe('warm-up (GDD §5, TDD §6.7)', () => {
  it('adds 25% per consecutive shot at the same champion, up to +100%', () => {
    const a = field([{ team: Red, x: 0, y: 10, structure: 'subBase', armed: true }]);
    a.disarm(a.shooter);
    a.move(a.shooter, 0, 4);
    a.hp(a.shooter, 1e6);
    a.run(200);
    expect(a.hits(a.structure('subBase')).slice(0, 6).map((h) => h.amount)).toEqual([1, 1.25, 1.5, 1.75, 2, 2].map((m) => SUB * m));
  });

  it('resets after 3 s without firing, and on a change of target', () => {
    const a = field([{ team: Red, x: 0, y: 10, structure: 'subBase', armed: true }]);
    const sub = a.structure('subBase');
    a.disarm(a.shooter);
    a.move(a.shooter, 0, 4);
    a.hp(a.shooter, 1e6);
    a.run(75); // three shots
    expect(a.hits(sub).length).toBe(3);
    a.move(a.shooter, 0, -10); // out of range for 100 ticks
    a.run(100);
    a.move(a.shooter, 0, 4);
    a.run(40);
    expect(a.hits(sub)[3]!.amount).toBe(SUB);

    // A change of target: an invulnerable moment drops Alpha for a minion, then back.
    a.run(60);
    const m = a.soldier(2.5, 4.5);
    a.hp(m, 1e6);
    a.sim.stores.healths.get(a.shooter)!.invulnUntil = a.sim.tick + 40;
    a.run(40);
    expect(a.targetOf(sub)).toBe(m);
    a.sim.debug.kill(m);
    const before = a.hits(sub, a.shooter).length;
    a.run(40);
    expect(a.hits(sub, a.shooter)[before]!.amount).toBe(SUB);
  });

  it('never warms up on minions', () => {
    const a = field([{ team: Red, x: 0, y: 10, structure: 'subBase', armed: true }]);
    a.move(a.shooter, 16, -50);
    const m = a.soldier(0, 4);
    a.hp(m, 1e6);
    a.run(130);
    expect(a.hits(a.structure('subBase'), m).map((h) => h.amount).slice(0, 4)).toEqual([SUB, SUB, SUB, SUB]);
  });
});

describe('HQ flak', () => {
  it('hits two targets per shot', () => {
    const a = field([{ team: Blue, x: 1.5, y: 3 }, { team: Red, x: 0, y: 10, structure: 'hq', armed: true }]);
    a.disarm(a.shooter);
    a.move(a.shooter, -1, 3);
    a.run(40);
    const hq = a.structure('hq');
    const first = a.hits(hq);
    expect(first.slice(0, 2).map((h) => [h.target, h.amount]).sort()).toEqual([[1, HQ], [2, HQ]]);
  });
});

describe('backdoor protection (GDD §5)', () => {
  it('halves damage to a structure with no enemy minion within 10 m', () => {
    const a = field([{ team: Red, x: 0, y: 6, structure: 'subBase' }], (c) => (c.structures.rules.backdoorPct = 0.5));
    const sub = a.structure('subBase');
    a.run(10);
    expect(a.hits(a.shooter, sub)[0]!.amount).toBe(95 / 2);
    const m = a.soldier(1, 0.5); // in range of the Sub-base, so it stays and shoots it
    a.hp(m, 1e6);
    a.run(30);
    expect(a.hits(a.shooter, sub)[1]!.amount).toBe(95);
  });
});

describe('HQ gate (GDD §5)', () => {
  it('keeps the HQ invulnerable and untargeted while its Sub-base stands', () => {
    const a = field([
      { team: Red, x: 0, y: 6, structure: 'hq', shielded: true },
      { team: Red, x: 14, y: 30, structure: 'subBase' },
    ]);
    const hq = a.structure('hq');
    a.sim.debug.fillUltimate(a.shooter);
    a.run(30);
    expect(a.targetOf(a.shooter)).toBe(0);
    expect(a.sim.snapshot().entities.find((e) => e.id === a.shooter)!.ultTargetable).toBe(false);
    expect(a.hp(hq)).toBe(a.sim.stores.healths.get(hq)!.maxHp);
    a.sim.debug.kill(a.structure('subBase'));
    a.run(2);
    expect(a.sim.stores.healths.get(hq)!.invulnerable).toBe(false);
    expect(a.targetOf(a.shooter)).toBe(hq);
    expect(a.events.find((e) => e.type === 'structureDestroyed')).toMatchObject({ kind: 'subBase', team: Red, killer: 0 });
  });
});

describe('regeneration (GDD §5)', () => {
  const regen: Tweak = (c) => (c.structures.rules.regenPctPerSecond = 0.01);

  it('heals the HQ 1% max HP per second with no enemy within 12 m', () => {
    const a = field([{ team: Red, x: 0, y: 20, structure: 'hq' }, { team: Red, x: 10, y: 30, structure: 'subBase' }], regen);
    a.disarm(a.shooter);
    const hq = a.structure('hq');
    const max = a.sim.stores.healths.get(hq)!.maxHp;
    a.hp(hq, 5000);
    a.run(30);
    expect(a.hp(hq)).toBeCloseTo(5000 + max * 0.01);
    a.move(a.shooter, 0, 9); // 11 m away
    a.run(30);
    expect(a.hp(hq)).toBeCloseTo(5000 + max * 0.01);
  });

  it('never heals a Sub-base (D-036)', () => {
    const a = field([{ team: Red, x: 0, y: 30, structure: 'subBase' }], regen);
    const sub = a.structure('subBase');
    a.hp(sub, 1000);
    a.run(90);
    expect(a.hp(sub)).toBe(1000);
  });
});

describe('destruction', () => {
  it('leaves rubble: an event with the killer, no more targeting or firing, still blocked', () => {
    const a = field([{ team: Red, x: 0, y: 6, structure: 'subBase', armed: true }]);
    const sub = a.structure('subBase');
    a.hp(a.shooter, 1e6);
    a.hp(sub, 50);
    a.run(15);
    expect(a.events.find((e) => e.type === 'structureDestroyed')).toMatchObject({ id: sub, killer: a.shooter, kind: 'subBase' });
    expect(a.sim.snapshot().entities.find((e) => e.id === sub)!.destroyed).toBe(true);
    const shotsBefore = a.events.filter((e) => e.type === 'shot' && e.id === sub).length;
    a.run(60);
    expect(a.events.filter((e) => e.type === 'shot' && e.id === sub).length).toBe(shotsBefore);
    expect(a.targetOf(a.shooter)).toBe(0);
    const g = a.sim.grid;
    expect(isBlocked(g, Math.floor((0 - g.minX) / g.cell), Math.floor((6 - g.minY) / g.cell))).toBe(true);
    expect(a.sim.stores.kinds.get(sub)).toBe(Kind.SubBase);
  });
});
