import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Kind, Team } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;
type Tweak = Parameters<typeof arena>[1];

/**
 * Open fixture lane (Blue → Red): (0, −42) → (0, −10), then west via (−8, 0) or east via
 * (8, 0) to (0, 10), then (0, 42). The arena's Blue Alpha (id 1) starts at the origin, so
 * most tests park it out of the way first.
 */
function field(units: Unit[] = [], tweak?: Tweak) {
  const a = arena(units, tweak);
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step([]).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const minions = (team?: Team) => a.sim.stores.laneAgents.ids.filter((e) => team === undefined || a.sim.stores.teams.get(e) === team);
  const pos = (e: number) => {
    const t = a.sim.stores.transforms.get(e)!;
    return { x: t.x, y: t.y };
  };
  const agent = (e: number) => a.sim.stores.laneAgents.get(e)!;
  const targetOf = (e: number) => a.sim.stores.targetings.get(e)!.targetId;
  /** Spawns one wave and keeps only the first Blue soldier, moved to (x, y). */
  const lone = (x: number, y: number) => {
    a.sim.debug.spawnWave();
    const [keep, ...rest] = minions();
    for (const e of rest) a.sim.debug.kill(e);
    a.move(keep!, x, y);
    run(); // the kills land
    return keep!;
  };
  const park = () => a.move(a.shooter, 16, -54); // far from the lane
  return { ...a, events, run, minions, pos, agent, targetOf, lone, park };
}

describe('waves (GDD §5, TDD §6.6)', () => {
  it('spawn at 0:15, then every 25 s: 3 per team in a row at their end of the lane', () => {
    const a = field([], (c) => (c.waves.enabled = true));
    a.park();
    a.run(450);
    expect(a.minions()).toHaveLength(0);
    a.run();
    expect(a.events.filter((e) => e.type === 'waveSpawned')).toHaveLength(1);
    const blue = a.minions(Blue).map(a.pos);
    const red = a.minions(Red).map(a.pos);
    expect(blue).toHaveLength(3);
    expect(red).toHaveLength(3);
    for (const p of blue) expect(p.y).toBeCloseTo(-42 + 0.087, 1);
    expect(blue.map((p) => Math.round(p.x * 10) / 10).sort((x, y) => x - y)).toEqual([-1.1, 0, 1.1]);
    for (const p of red) expect(p.y).toBeCloseTo(42 - 0.087, 1);
    a.run(749);
    expect(a.minions()).toHaveLength(6);
    a.run();
    expect(a.minions()).toHaveLength(12);
  });

  it('alternate branches by wave, the same branch for both teams', () => {
    const a = field();
    a.park();
    a.sim.debug.spawnWave();
    expect(a.minions().map((e) => a.agent(e).branch)).toEqual([0, 0, 0, 0, 0, 0]);
    a.sim.debug.spawnWave();
    expect(a.minions().slice(6).map((e) => a.agent(e).branch)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('march their lane: a lone Blue wave takes the west branch and reaches the Red end', () => {
    const a = field();
    a.park();
    a.sim.debug.spawnWave();
    for (const e of a.minions(Red)) a.sim.debug.kill(e);
    let minX = 0;
    for (let i = 0; i < 1300; i++) {
      a.run();
      for (const e of a.minions(Blue)) minX = Math.min(minX, a.pos(e).x);
    }
    expect(minX).toBeLessThan(-6); // went round (−8, 0)
    for (const e of a.minions(Blue)) {
      expect(a.pos(e).y).toBeGreaterThan(40);
      expect(Math.abs(a.pos(e).x)).toBeLessThan(2.5);
    }
  });
});

describe('minion targeting (GDD §5)', () => {
  it('prefers an enemy minion, then a structure, then a champion', () => {
    const a = field([{ team: Red, x: 0, y: -25 }, { team: Red, x: 3, y: -24, structure: 'subBase' }]);
    a.park();
    a.sim.debug.spawnWave();
    const all = a.minions();
    const blue = all[0]!;
    const red = all.find((e) => a.sim.stores.teams.get(e) === Red)!;
    for (const e of all) if (e !== blue && e !== red) a.sim.debug.kill(e);
    a.move(blue, 0, -30);
    a.move(red, -2, -27);
    a.run();
    expect(a.targetOf(blue)).toBe(red);
    a.sim.debug.kill(red);
    a.run(2);
    const sub = a.sim.stores.kinds.ids.find((e) => a.sim.stores.kinds.get(e) === Kind.SubBase)!;
    expect(a.targetOf(blue)).toBe(sub);
    a.sim.stores.healths.get(sub)!.invulnerable = true;
    a.run();
    expect(a.targetOf(blue)).toBe(2); // the Red champion
  });

  it('notices targets within 7 m, walks up and fires within 5 m', () => {
    const near = field([{ team: Red, x: 0, y: -23.5 }]); // 6 m to the champion's edge
    near.park();
    const m = near.lone(0, -30);
    expect(near.targetOf(m)).toBe(2);
    near.run(30);
    const shots = near.events.filter((e) => e.type === 'shot' && e.id === m);
    expect(shots.length).toBeGreaterThan(0);
    expect(near.pos(m).y).toBeGreaterThan(-29.5);
    expect(near.pos(m).y).toBeLessThan(-28.4); // stopped once in range

    const far = field([{ team: Red, x: 0, y: -21 }]); // 8.5 m
    far.park();
    const f = far.lone(0, -30);
    expect(far.targetOf(f)).toBe(0);
  });

  it('chases off the lane no further than its 6 m leash, and ignores enemies it could not reach', () => {
    const a = field([{ team: Red, x: 11, y: -30 }]);
    a.park();
    const m = a.lone(0, -30);
    a.agent(m).helpTarget = 2; // pulled onto it, as by a call for help
    a.agent(m).helpTicks = 200;
    let maxX = 0;
    for (let i = 0; i < 150; i++) {
      a.run();
      maxX = Math.max(maxX, a.pos(m).x);
    }
    expect(maxX).toBeLessThanOrEqual(6.01);
    expect(a.events.some((e) => e.type === 'shot' && e.id === m)).toBe(true);

    const out = field([{ team: Red, x: 13, y: -30 }]);
    out.park();
    const o = out.lone(0, -30);
    out.agent(o).helpTarget = 2;
    out.agent(o).helpTicks = 200;
    out.run();
    expect(out.targetOf(o)).toBe(0);
  });
});

describe('call for help (GDD §5, TDD §6.2)', () => {
  it('pulls nearby minions onto an enemy champion hitting an allied one, for 3 s', () => {
    const a = field([{ team: Red, x: 2, y: -24.5, armed: true }]);
    a.move(a.shooter, 2, -30.5);
    a.sim.debug.setStatPct(a.shooter, 1, -0.999); // our Alpha barely fires, so the Red champion survives
    a.sim.debug.spawnWave();
    const all = a.minions();
    const blue = all[0]!;
    const red = all.find((e) => a.sim.stores.teams.get(e) === Red)!;
    for (const e of all) if (e !== blue && e !== red) a.sim.debug.kill(e);
    a.move(blue, 0, -30);
    a.move(red, -3.5, -30);
    a.run();
    expect(a.targetOf(blue)).toBe(red);
    let hitTick = -1;
    for (let i = 0; i < 40 && hitTick < 0; i++) {
      a.run();
      const hit = a.events.find((e) => e.type === 'damage' && e.source === 2 && e.target === a.shooter);
      if (hit) hitTick = hit.tick;
    }
    expect(hitTick).toBeGreaterThan(0);
    a.run();
    expect(a.targetOf(blue)).toBe(2);
    a.sim.stores.weapons.get(2)!.cooldown = 1e9; // no more hits on anyone
    a.run(95);
    expect(a.targetOf(blue)).toBe(red);
  });
});

describe('separation (TDD §6.1)', () => {
  it('pushes stacked minions apart, and minions aside for a champion that never moves', () => {
    const a = field();
    a.park();
    a.sim.debug.spawnWave();
    const [m1, m2] = a.minions(Blue);
    for (const e of a.minions()) if (e !== m1 && e !== m2) a.sim.debug.kill(e);
    a.move(m1!, 0.05, -20);
    a.move(m2!, 0, -20);
    a.run(10);
    const d = Math.hypot(a.pos(m1!).x - a.pos(m2!).x, a.pos(m1!).y - a.pos(m2!).y);
    expect(d).toBeGreaterThan(0.6);

    a.move(a.shooter, 0, -10);
    a.move(m1!, 0.1, -10.1);
    a.run(5);
    expect(a.pos(a.shooter)).toEqual({ x: 0, y: -10 });
    expect(Math.hypot(a.pos(m1!).x, a.pos(m1!).y + 10)).toBeGreaterThan(0.6);
  });
});

describe('minion death', () => {
  it('announces the killer, removes the minion and reuses its components', () => {
    const a = field([{ team: Red, x: 0, y: 4 }]);
    a.sim.debug.spawnWave();
    const m = a.minions(Red)[0]!;
    const transform = a.sim.stores.transforms.get(m);
    a.sim.stores.healths.get(m)!.hp = 50;
    a.move(m, 2, 3);
    a.move(2, 15, 20); // the Red champion out of range, so Alpha shoots the minion
    for (const e of a.minions()) if (e !== m) a.sim.debug.kill(e);
    a.run(40);
    expect(a.events.find((e) => e.type === 'death' && e.id === m)).toMatchObject({ killer: a.shooter });
    expect(a.sim.stores.transforms.has(m)).toBe(false);
    expect(a.minions()).toHaveLength(0);
    a.sim.debug.spawnWave();
    expect(a.minions().some((e) => a.sim.stores.transforms.get(e) === transform)).toBe(true);
  });
});
