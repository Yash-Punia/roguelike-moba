import { describe, expect, it } from 'vitest';
import type { DamageEvent } from '../src/sim/events';
import { Team, type Command } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;
type Tweak = Parameters<typeof arena>[1];

const cmd = (player: number, opts: { moveX?: number; moveY?: number; ult?: boolean } = {}): Command => ({
  tick: 0, player, moveX: opts.moveX ?? 0, moveY: opts.moveY ?? 0, ult: opts.ult ?? false, draftPick: -1, reroll: false,
});
const press = [cmd(0, { ult: true })];

/** Arena that records damage events with their tick, and the shooter's casts. */
function field(units: Unit[], tweak?: Tweak) {
  const a = arena(units, tweak);
  const hits: (DamageEvent & { tick: number })[] = [];
  let casts = 0;
  const run = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) {
      for (const ev of a.sim.step(commands).events) {
        if (ev.type === 'damage') hits.push({ ...ev, tick: a.sim.tick - 1 });
        if (ev.type === 'ultCast' && ev.id === a.shooter) casts++;
      }
    }
  };
  const champ = (id: number) => a.sim.stores.champions.get(id)!;
  return { ...a, hits, run, champ, casts: () => casts };
}

const steady: Tweak = (c) => Object.assign(c.champions[0]!.trait, { stillSeconds: 15, fireRatePct: 0.2 });

describe('Steady Hand', () => {
  it('adds +20% fire rate after 0.5 s still, and drops it on the first move', () => {
    const a = field([{ team: Red, x: 0, y: 20 }], steady);
    a.run(14);
    expect(a.champ(a.shooter).traitPct).toBe(0);
    a.run();
    expect(a.champ(a.shooter).traitPct).toBeCloseTo(0.2);
    expect(a.sim.snapshot().entities.find((e) => e.id === a.shooter)!.traitActive).toBe(true);
    a.run(1, [cmd(0, { moveX: 127 })]);
    expect(a.champ(a.shooter).traitPct).toBe(0);
    expect(a.sim.stores.stats.get(a.shooter)!.pct[1]).toBeCloseTo(0); // FireRate back to +0%
  });

  it('never turns on while moving', () => {
    const a = field([{ team: Red, x: 0, y: 20 }], steady);
    a.run(100, [cmd(0, { moveX: 60 })]);
    expect(a.champ(a.shooter).traitPct).toBe(0);
  });

  it('gives 1.2× the shots while standing still, stacking with other fire-rate sources', () => {
    const a = field([{ team: Red, x: 0, y: 4, structure: 'subBase' }], steady);
    a.sim.debug.setStatPct(a.shooter, 1, 0.3); // +30% from "another source"
    a.step(1000); // the arena's own step counts shots
    expect(Math.abs(a.shots() - (1000 * 1.5) / 25)).toBeLessThanOrEqual(2);
  });
});

describe('Ultimate charge', () => {
  it('fills 0 → 100 passively over the charge time', () => {
    const a = field([]);
    a.run(1499);
    expect(a.champ(a.shooter).ultCharge).toBeLessThan(100);
    a.run();
    expect(a.champ(a.shooter).ultCharge).toBe(100);
  });
});

describe('Frag Grenade (GDD §7)', () => {
  it('needs full charge and a target; casting empties the charge', () => {
    const a = field([{ team: Red, x: 0, y: 8.5 }]);
    a.run(1, press);
    expect(a.casts()).toBe(0);
    a.sim.debug.fillUltimate(a.shooter);
    a.run(1, press);
    expect(a.casts()).toBe(1);
    expect(a.champ(a.shooter).ultCharge).toBeLessThan(1);
    expect(a.sim.lobs.live).toBe(1);
  });

  it('does nothing without a target in cast range, and keeps the charge', () => {
    const a = field([{ team: Red, x: 0, y: 10 }]); // 9.5 m to the collider edge
    a.sim.debug.fillUltimate(a.shooter);
    a.run(1, press);
    expect(a.casts()).toBe(0);
    expect(a.champ(a.shooter).ultCharge).toBe(100);
    expect(a.sim.snapshot().entities.find((e) => e.id === a.shooter)!.ultTargetable).toBe(false);
  });

  it('prefers a champion, then the HQ only if vulnerable, then a Sub-base', () => {
    const order = (units: Unit[], invulnerableHq = false) => {
      const a = field(units);
      if (invulnerableHq) for (const id of a.sim.stores.healths.ids) if (a.sim.stores.kinds.get(id) === 2) a.sim.stores.healths.get(id)!.invulnerable = true;
      a.run();
      return a.champ(a.shooter).ultTargetId;
    };
    expect(order([{ team: Red, x: 0, y: 8.5 }, { team: Red, x: 3, y: 4, structure: 'subBase' }])).toBe(2);
    // Units without a champion: ids 2 (HQ) and 3 (Sub-base).
    expect(order([{ team: Red, x: 0, y: 7, structure: 'hq' }, { team: Red, x: 0, y: -6, structure: 'subBase' }])).toBe(2);
    expect(order([{ team: Red, x: 0, y: 7, structure: 'hq' }, { team: Red, x: 0, y: -6, structure: 'subBase' }], true)).toBe(3);
  });

  it('lands 18 ticks after the cast for 250 in 3 m, hitting enemies it overlaps and no allies', () => {
    const a = field([
      { team: Red, x: 0, y: 8.5 }, // target (2)
      { team: Red, x: 3.4, y: 8.5 }, // collider overlaps the 3 m blast (3)
      { team: Red, x: -3.6, y: 8.5 }, // just outside (4)
      { team: Blue, x: 0.5, y: 8.5 }, // ally in the blast (5)
    ]);
    a.sim.debug.fillUltimate(a.shooter);
    a.run(1, press);
    a.run(17);
    expect(a.hp(2)).toBe(1000);
    a.run();
    expect(a.hits.map((h) => [h.target, h.amount])).toEqual([[2, 250], [3, 250]]);
    expect(a.hits[0]!.tick - (a.sim.tick - 19)).toBe(18);
    expect([a.hp(4), a.hp(5)]).toEqual([1000, 1000]);
  });

  it('lands on the spot the target stood at the cast, so a quick runner dodges it', () => {
    const a = field([{ team: Red, x: 0, y: 8.5 }], (c) => (c.champions[0]!.moveSpeed = 8));
    a.sim.debug.fillUltimate(a.shooter);
    a.run(1, press);
    a.run(30, [cmd(1, { moveX: 127 })]); // 4.8 m sideways during the 0.6 s flight
    expect(a.hits.filter((h) => h.target === 2)).toHaveLength(0);
  });

  it('leaves a fire pool: 25 every 0.5 s for 4 s, then gone', () => {
    const a = field([{ team: Red, x: 0, y: 8.5 }]);
    a.sim.debug.fillUltimate(a.shooter);
    a.run(1, press);
    a.run(18); // landed: 750
    expect(a.sim.zones.live).toBe(1);
    a.run(14);
    expect(a.hp(2)).toBe(750);
    a.run();
    expect(a.hp(2)).toBe(725);
    a.run(105); // to the pool's 120th tick
    expect(a.hp(2)).toBe(750 - 8 * 25);
    expect(a.sim.zones.live).toBe(0);
    a.run(30);
    expect(a.hp(2)).toBe(550);
  });

  it('hits structures in full with the blast but at 50% with the fire', () => {
    const a = field([{ team: Red, x: 0, y: 8.5, structure: 'subBase' }]); // 7.05 m to its edge: out of revolver range
    const max = a.hp(2);
    a.sim.debug.fillUltimate(a.shooter);
    a.run(1, press);
    a.run(18 + 120);
    expect(a.hp(2)).toBeCloseTo(max - 250 - 8 * 12.5);
  });
});
