import { describe, expect, it } from 'vitest';
import { Team } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;

describe('auto-targeting (GDD §6)', () => {
  it('targets the nearest enemy champion whose edge is within range, never allies', () => {
    // Edge distances: id 2 at 6.4 m, id 3 at 7.5 m (out of range), id 4 is an ally at 2 m.
    const { step } = arena([{ team: Red, x: 0, y: 6.9 }, { team: Red, x: 0, y: 8 }, { team: Blue, x: 0, y: 2.5 }]);
    expect(step()).toBe(2);
  });

  it('has no target when nothing is in range', () => {
    expect(arena([{ team: Red, x: 0, y: 8 }]).step()).toBe(0);
  });

  it('prefers a champion over a nearer Sub-base (class order)', () => {
    const { step } = arena([{ team: Red, x: 0, y: 6 }, { team: Red, x: 4, y: 0, structure: 'subBase' }]);
    expect(step()).toBe(2);
  });

  it('prefers the HQ over a Sub-base, and skips an invulnerable HQ', () => {
    const units: Unit[] = [
      { team: Red, x: 4, y: 0, structure: 'subBase' }, // id 2
      { team: Red, x: -6, y: 0, structure: 'hq' }, // id 3
    ];
    expect(arena(units).step()).toBe(3);
    const shielded = arena(units);
    shielded.sim.stores.healths.get(3)!.invulnerable = true;
    expect(shielded.step()).toBe(2);
  });

  it('breaks a tie within 0.5 m by lowest HP%, otherwise takes the nearest', () => {
    const tied = arena([{ team: Red, x: 0, y: 3.5 }, { team: Red, x: 0, y: -3.9 }]); // edges 3.0 and 3.4
    tied.hp(3, 400);
    expect(tied.step()).toBe(3);
    const apart = arena([{ team: Red, x: 0, y: 3.5 }, { team: Red, x: 0, y: -4.1 }]); // edges 3.0 and 3.6
    apart.hp(3, 400);
    expect(apart.step()).toBe(2);
  });

  it('sticks to the current target out to range + 0.5 m, then drops it', () => {
    const { step, move } = arena([{ team: Red, x: 0, y: 7 }]); // edge 6.5
    expect(step()).toBe(2);
    move(2, 0, 7.9); // edge 7.4: beyond range, inside the sticky band
    expect(step()).toBe(2);
    move(2, 0, 8.1); // edge 7.6: gone
    expect(step()).toBe(0);
  });

  it('a fresh target outside range is not picked up by stickiness', () => {
    expect(arena([{ team: Red, x: 0, y: 7.9 }]).step()).toBe(0);
  });

  it('switches within a class only to a unit more than 1.5 m nearer', () => {
    const { step, move } = arena([{ team: Red, x: 0, y: 5.5 }, { team: Red, x: 0, y: -20 }]); // edge 5.0
    expect(step()).toBe(2);
    move(3, 0, -4.0); // edge 3.5: only 1.5 m nearer → keep
    expect(step()).toBe(2);
    move(3, 0, -3.9); // edge 3.4: 1.6 m nearer → switch
    expect(step()).toBe(3);
  });

  it('lets a higher class override only after it stays in range 5 ticks (0.15 s)', () => {
    const { sim, shooter, step, move } = arena([{ team: Red, x: 0, y: -20 }, { team: Red, x: 4, y: 0, structure: 'subBase' }]);
    expect(step()).toBe(3); // the Sub-base is the only thing in range
    move(2, 0, 6);
    expect(step(4)).toBe(3);
    expect(sim.stores.targetings.get(shooter)).toMatchObject({ pendingSwitchId: 2, pendingTicks: 4 });
    expect(step()).toBe(2);
  });

  it('resets the override countdown if the higher class leaves range', () => {
    const { step, move } = arena([{ team: Red, x: 0, y: -20 }, { team: Red, x: 4, y: 0, structure: 'subBase' }]);
    step();
    move(2, 0, 6);
    step(4);
    move(2, 0, -20);
    step();
    move(2, 0, 6);
    expect(step(4)).toBe(3);
    expect(step()).toBe(2);
  });

  it('re-selects at once when the target dies and holds fire 6 ticks (0.2 s)', () => {
    const { sim, shooter, step, hp } = arena([{ team: Red, x: 0, y: 3 }, { team: Red, x: 0, y: -5 }]);
    expect(step()).toBe(2);
    hp(2, 0);
    expect(step()).toBe(3);
    const hold = () => sim.stores.targetings.get(shooter)!.holdTicks;
    expect(hold()).toBe(6);
    step(5);
    expect(hold()).toBe(1);
    step();
    expect(hold()).toBe(0);
  });

  it('drops a target that becomes invulnerable without a retarget pause', () => {
    const { sim, shooter, step } = arena([{ team: Red, x: 0, y: 3 }]);
    step();
    sim.stores.healths.get(2)!.invulnerable = true;
    expect(step()).toBe(0);
    expect(sim.stores.targetings.get(shooter)!.holdTicks).toBe(0);
  });

  it('uses tuning from combat.json live', () => {
    const { sim, config, step, move } = arena([{ team: Red, x: 0, y: 7 }]);
    step();
    const next = structuredClone(config);
    next.combat.targeting.stickyRange = 0;
    sim.setConfig(next);
    move(2, 0, 7.9);
    expect(step()).toBe(0);
  });

  it('shows the target in the snapshot', () => {
    const { sim, step } = arena([{ team: Red, x: 0, y: 3 }]);
    step();
    expect(sim.snapshot().entities[0]!.targetId).toBe(2);
  });
});
