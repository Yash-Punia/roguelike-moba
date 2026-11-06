import { describe, expect, it } from 'vitest';
import { createSim, Team, type Command } from '../src/sim/sim';
import { fixtureConfig } from './helpers';

const cmd = (ult: boolean): Command => ({ tick: 0, player: 0, moveX: 0, moveY: 0, ult, draftPick: -1, reroll: false });

/** Open fixture map, waves off: `championId` (player 0, Blue) at the origin, an unarmed Red Alpha at (0, 5). */
function duel(championId: 'alpha' | 'beta') {
  const config = fixtureConfig();
  config.waves.enabled = false;
  const sim = createSim(config, 1, [
    { team: Team.Blue, championId, spawnAt: { x: 0, y: 0 } },
    { team: Team.Red, championId: 'alpha', spawnAt: { x: 0, y: 5 }, unarmed: true },
  ]);
  const me = sim.entityOf(0)!;
  const ult = config.champions.find((c) => c.id === championId)!.ultimate;
  const cast = () => {
    sim.stores.weapons.get(me)!.cooldown = 10_000;
    sim.debug.fillUltimate(me);
    sim.step([cmd(true)]);
  };
  return { sim, config, me, ult, cast };
}

describe('ground telegraphs (D-078)', () => {
  it('a Frag Grenade shows a circle at the landing spot for its whole flight', () => {
    const { sim, ult, cast } = duel('alpha');
    if (ult.id !== 'fragGrenade') throw new Error('alpha casts Frag Grenade');
    cast();
    const [t] = sim.snapshot().telegraphs;
    expect(t).toMatchObject({ team: Team.Blue, shape: 'circle', x: 0, y: 5, radius: ult.radius, anchor: 0, elapsed: 0, total: ult.flightSeconds });
    sim.step([]);
    expect(sim.snapshot().telegraphs[0]!.elapsed).toBe(1);
    for (let i = 1; i < ult.flightSeconds; i++) sim.step([]);
    expect(sim.snapshot().telegraphs).toHaveLength(0); // landed
  });

  it("Lead Storm shows a strip anchored to Beta that fills over the windup and stays live while firing", () => {
    const { sim, me, ult, cast } = duel('beta');
    if (ult.id !== 'leadStorm') throw new Error('beta casts Lead Storm');
    cast();
    const t = sim.snapshot().telegraphs[0]!;
    expect(t).toMatchObject({ shape: 'strip', anchor: me, length: ult.length, width: ult.width, total: ult.windupSeconds });
    expect(t.elapsed).toBe(0);
    // It fills one tick at a time and is full on the first tick of fire.
    for (let i = 1; i <= ult.windupSeconds; i++) {
      sim.step([]);
      expect(sim.snapshot().telegraphs[0]!.elapsed).toBe(i);
    }
    for (let i = 0; i < ult.seconds - 1; i++) {
      sim.step([]);
      expect(sim.snapshot().telegraphs[0]!.elapsed).toBe(ult.windupSeconds); // firing: live
    }
    sim.step([]);
    expect(sim.snapshot().telegraphs).toHaveLength(0); // channel over
  });

  it('every big hit telegraphs at least 0.5 s ahead (GDD §10)', () => {
    const config = fixtureConfig();
    const min = Math.round(0.5 * 30);
    const leads: number[] = [];
    for (const c of config.champions) {
      if (c.ultimate.id === 'fragGrenade') leads.push(c.ultimate.flightSeconds);
      if (c.ultimate.id === 'leadStorm') leads.push(c.ultimate.windupSeconds);
    }
    // Mortar shells, airstrike bombs and mini-boss attacks: every `flightSeconds` and `windupSeconds` in the powers and neutrals.
    const walk = (o: unknown) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if ((k === 'flightSeconds' || k === 'windupSeconds') && typeof v === 'number') leads.push(v);
        else walk(v);
      }
    };
    walk(config.powers);
    walk(config.neutrals);
    expect(leads.length).toBeGreaterThanOrEqual(5);
    for (const lead of leads) expect(lead).toBeGreaterThanOrEqual(min);
  });
});
