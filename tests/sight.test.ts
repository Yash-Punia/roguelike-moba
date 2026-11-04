import { describe, expect, it } from 'vitest';
import type { Config, FragGrenadeConfig } from '../src/data/schema';
import { Team, type Command } from '../src/sim/sim';
import { arena, at, O, raiseGround } from './helpers';

/** Raised ground across x −2..2, y 2–3 from O. */
const ground = (c: Config) => raiseGround(c, O.x - 2, O.x + 2, O.y + 2, O.y + 3);
/** The arena spawns 'alpha' everywhere: give it Gamma's kit. */
const gamma = (c: Config) => {
  c.champions[0] = { ...c.champions.find((ch) => ch.id === 'gamma')!, id: 'alpha' };
};
const ult: Command = { tick: 0, player: 0, moveX: 0, moveY: 0, ult: true, draftPick: -1, reroll: false };

describe('line of sight (GDD §6, D-018)', () => {
  it('a champion does not target an enemy behind raised ground', () => {
    const { step, move } = arena([{ team: Team.Red, ...at(0, 5) }], ground);
    move(1, O.x, O.y);
    expect(step(5)).toBe(0);
  });

  it('takes a target in the open and drops it when it steps behind cover', () => {
    const { step, move } = arena([{ team: Team.Red, ...at(5, 4) }], ground);
    move(1, O.x, O.y);
    expect(step(5)).toBe(2); // the line passes east of the bank
    move(2, O.x, O.y + 5);
    expect(step(1)).toBe(0);
  });

  it('flames stop at raised ground', () => {
    const { step, move, hp } = arena([{ team: Team.Red, ...at(0, 3.5) }], (c) => {
      gamma(c);
      ground(c);
    });
    move(1, O.x, O.y + 1.6);
    const full = hp(2);
    expect(step(5)).toBe(0);
    step(60);
    expect(hp(2)).toBe(full);
  });

  it('a Sub-base does not target a champion behind raised ground', () => {
    const { sim, step, move } = arena([{ team: Team.Red, ...at(0, 5) }, { team: Team.Blue, ...at(0, -2), structure: 'subBase', armed: true }], ground);
    move(1, 0, -30);
    const tower = sim.stores.structures.ids[0]!;
    step(10);
    expect(sim.stores.targetings.get(tower)!.targetId).toBe(0);
  });

  it('a grenade blast and its fire pool spare a unit behind raised ground', () => {
    const { sim, step, move, hp } = arena([{ team: Team.Red, ...at(0, 1.2) }, { team: Team.Red, ...at(0, 3.6) }], ground);
    move(1, O.x, O.y - 6);
    sim.debug.fillUltimate(1);
    step(1, [ult]); // lobbed at Red 2, the nearest champion; 3 m blast, then a 3 m fire pool
    const frag = sim.stores.champions.get(1)!.def.ultimate as FragGrenadeConfig;
    step(frag.flightSeconds);
    expect(hp(2)).toBeLessThan(1000);
    expect(hp(3)).toBe(1000);
    step(frag.zone.tickSeconds);
    expect(hp(3)).toBe(1000);
  });

  it('rocket splash does not reach past the wall it bursts on', () => {
    const { sim, step, hp, shooter } = arena([{ team: Team.Red, ...at(0.5, 3.4) }, { team: Team.Red, ...at(0.5, 1.4) }], ground);
    sim.projectiles.spawn(shooter, Team.Blue, 0, false, O.x + 1.5, O.y, 0, 14 / 30, 100, 1, 30, 1, 1.5);
    step(10);
    expect(hp(3)).toBeLessThan(1000); // in front of the wall, within the splash
    expect(hp(2)).toBe(1000); // behind it
  });
});
