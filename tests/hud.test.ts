import { describe, expect, it } from 'vitest';
import { displayTeam } from '../src/sim/sides';
import { Team } from '../src/sim/sim';
import { hud, updateHud } from '../src/ui/store';
import { arena } from './helpers';

const { Blue, Red, Neutral } = Team;

describe('display sides (GDD §10: your team is Blue)', () => {
  it('draws the viewer’s team Blue and the enemy Red, from either side', () => {
    expect([displayTeam(Blue, Blue), displayTeam(Red, Blue), displayTeam(Neutral, Blue)]).toEqual([Blue, Red, Neutral]);
    expect([displayTeam(Red, Red), displayTeam(Blue, Red), displayTeam(Neutral, Red)]).toEqual([Blue, Red, Neutral]);
  });
});

describe('HUD store', () => {
  const setup = () =>
    arena([
      { team: Red, x: 0, y: 5 },
      { team: Blue, x: -10, y: -40, structure: 'hq' },
      { team: Blue, x: 10, y: -30, structure: 'subBase' },
      { team: Red, x: 10, y: 40, structure: 'hq', shielded: true },
      { team: Red, x: -10, y: 30, structure: 'subBase' },
    ]);

  it('shows the clock, own HP, level and progress through the level', () => {
    const a = setup();
    a.sim.debug.giveXp(a.shooter, 160); // level 2 (100) + 60 of the 120 to level 3
    a.step(90);
    a.hp(a.shooter, 700);
    updateHud(a.sim.snapshot(), a.shooter, Blue);
    expect(hud.seconds.value).toBe(3);
    expect([hud.hp.value, hud.maxHp.value, hud.level.value]).toEqual([700, 1050, 2]);
    expect(hud.xpFraction.value).toBeCloseTo(0.5);
    a.sim.debug.giveXp(a.shooter, 5000);
    a.step();
    updateHud(a.sim.snapshot(), a.shooter, Blue);
    expect([hud.level.value, hud.xpFraction.value]).toEqual([12, 1]);
  });

  it('puts your structures on your side, HQ first, with HP, shield and rubble', () => {
    const a = setup();
    const redSub = a.sim.stores.structures.ids.find((e) => a.sim.stores.structures.get(e)!.kind === 'subBase' && a.sim.stores.teams.get(e) === Red)!;
    a.hp(redSub, a.sim.stores.healths.get(redSub)!.maxHp / 2);
    a.step();
    updateHud(a.sim.snapshot(), a.shooter, Blue);
    expect(hud.ours.value.map((s) => s.kind)).toEqual(['hq', 'subBase']);
    expect(hud.theirs.value.map((s) => [s.kind, s.hp, s.shielded, s.destroyed])).toEqual([
      ['hq', 1, true, false],
      ['subBase', 0.5, false, false],
    ]);
    a.sim.debug.kill(redSub);
    a.step(2);
    updateHud(a.sim.snapshot(), a.shooter, Blue);
    expect(hud.theirs.value.map((s) => [s.kind, s.shielded, s.destroyed])).toEqual([
      ['hq', false, false],
      ['subBase', false, true],
    ]);
  });

  it('flips sides when you play Red, and sums takedowns per side', () => {
    const a = setup();
    a.hp(2, 50);
    a.step(10); // Blue Alpha takes down the Red champion
    updateHud(a.sim.snapshot(), 2, Red);
    expect(hud.score.value).toEqual({ ours: 0, theirs: 1 });
    expect(hud.ours.value[0]!.shielded).toBe(true); // Red's own (gated) HQ is now "ours"
    expect(hud.deaths.value).toBe(1);
  });
});
