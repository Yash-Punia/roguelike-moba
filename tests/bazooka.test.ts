import { describe, expect, it } from 'vitest';
import type { DamageEvent, SimEvent } from '../src/sim/events';
import { Team } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;
type Tweak = Parameters<typeof arena>[1];

/** Open fixture lane (Blue → Red along x = 0); every debug wave brings a tank (`tankEveryNthWave` 1). */
function field(units: Unit[] = [], tweak?: Tweak) {
  const a = arena(units, (c) => {
    c.waves.tankEveryNthWave = 1;
    tweak?.(c);
  });
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step([]).events) events.push({ ...(ev as SimEvent), tick: a.sim.tick - 1 } as SimEvent & { tick: number });
  };
  const unit = (e: number) => a.sim.stores.laneAgents.get(e)!.unit;
  const team = (e: number) => a.sim.stores.teams.get(e);
  /** One debug wave; keeps the units `keep` picks, moved where it says, and removes the rest. */
  const wave = (keep: (team: Team | undefined, unit: string, i: number) => [number, number] | undefined) => {
    const before = new Set(a.sim.stores.laneAgents.ids);
    a.sim.debug.spawnWave();
    const fresh = a.sim.stores.laneAgents.ids.filter((e) => !before.has(e));
    const kept: number[] = [];
    fresh.forEach((e, i) => {
      const at = keep(team(e), unit(e), i);
      if (at) {
        a.move(e, at[0], at[1]);
        kept.push(e);
      } else a.sim.debug.kill(e);
    });
    run(); // the kills land
    return kept;
  };
  const damage = () => events.filter((e): e is DamageEvent & { tick: number } => e.type === 'damage');
  const park = () => a.move(a.shooter, 16, -54); // far from the lane
  return { ...a, events, run, unit, team, wave, damage, park };
}

describe('wave composition (GDD §5, D-053)', () => {
  it('brings a Bazooka Tank at the back of every second wave, never the first', () => {
    const a = field([], (c) => {
      c.waves.enabled = true;
      c.waves.tankEveryNthWave = 2;
    });
    a.park();
    const spawned = (from: number, to: number) => {
      const out: string[] = [];
      for (let t = from; t < to; t++) {
        const before = new Set(a.sim.stores.laneAgents.ids);
        a.run();
        for (const e of a.sim.stores.laneAgents.ids) if (!before.has(e) && a.team(e) === Blue) out.push(a.unit(e));
      }
      return out;
    };
    // Wave 1 at tick 450, wave 2 at 1200, wave 3 at 1950, wave 4 at 2700; units 18 ticks apart.
    expect(spawned(0, 1200)).toEqual(['mgSoldier', 'mgSoldier', 'mgSoldier']);
    expect(spawned(1200, 1950)).toEqual(['mgSoldier', 'mgSoldier', 'mgSoldier', 'bazookaTank']);
    expect(spawned(1950, 2700)).toEqual(['mgSoldier', 'mgSoldier', 'mgSoldier']);
    expect(spawned(2700, 3450)).toEqual(['mgSoldier', 'mgSoldier', 'mgSoldier', 'bazookaTank']);
  });
});

describe('Bazooka Tank (GDD §5)', () => {
  it('fires rockets that splash every enemy within 1.5 m of the impact, allies untouched', () => {
    const a = field();
    a.park();
    const clump: [number, number][] = [[0, -15], [0.7, -15.3], [-0.7, -15.3]];
    let r = 0;
    const kept = a.wave((t, u) => (t === Blue && u === 'bazookaTank' ? [0, -21.5] : t === Red && u === 'mgSoldier' ? clump[r++] : undefined));
    const tank = kept.find((e) => a.unit(e) === 'bazookaTank')!;
    const reds = kept.filter((e) => a.team(e) === Red);
    for (const e of reds) a.sim.stores.weapons.get(e)!.cooldown = 1e9; // they don't shoot back
    let first: (DamageEvent & { tick: number })[] = [];
    for (let i = 0; i < 120 && first.length === 0; i++) {
      a.run();
      first = a.damage().filter((d) => d.source === tank);
    }
    expect(first.length).toBe(3);
    expect(new Set(first.map((d) => d.target))).toEqual(new Set(reds));
    for (const d of first) expect(d.amount).toBeCloseTo(100);
    expect(new Set(first.map((d) => d.tick)).size).toBe(1); // one rocket, one burst
  });

  it('deals double damage to structures', () => {
    const a = field([{ team: Red, x: 0, y: -14, structure: 'subBase' }]);
    a.park();
    const [tank] = a.wave((t, u) => (t === Blue && u === 'bazookaTank' ? [0, -22] : undefined));
    a.run(150);
    const hits = a.damage().filter((d) => d.source === tank);
    expect(hits.length).toBeGreaterThan(0);
    for (const d of hits) expect(d.amount).toBeCloseTo(200);
  });

  it('takes half damage from structures', () => {
    const a = field([{ team: Red, x: 0, y: -14, structure: 'subBase', armed: true }]);
    a.park();
    const sub = a.sim.stores.structures.ids.at(-1)!;
    const [soldier, tank] = a.wave((t, u, i) => (t === Blue && i === 0 ? [2, -22] : t === Blue && u === 'bazookaTank' ? [0, -22] : undefined));
    for (const e of [soldier!, tank!]) a.sim.stores.weapons.get(e)!.cooldown = 1e9; // they don't shoot back
    a.run(1200);
    const onSoldier = a.damage().find((d) => d.source === sub && d.target === soldier);
    const onTank = a.damage().find((d) => d.source === sub && d.target === tank);
    expect(onSoldier).toBeDefined();
    expect(onTank).toBeDefined();
    // Both first shots against a fresh target carry the same warm-up: the tank takes half.
    expect(onTank!.amount).toBeCloseTo(onSoldier!.amount / 2);
  });

  it('is worth 80 XP and 8 Ultimate charge to a champion nearby', () => {
    const a = field();
    a.move(a.shooter, 0, -30);
    const [tank] = a.wave((t, u) => (t === Red && u === 'bazookaTank' ? [3, -30] : undefined));
    const c = a.sim.stores.champions.get(a.shooter)!;
    const [xp, charge] = [c.xp, c.ultCharge];
    a.sim.debug.kill(tank!);
    a.run();
    expect(c.xp - xp).toBeCloseTo(80);
    expect(c.ultCharge - charge).toBeCloseTo(8 + 100 / 1500);
  });
});
