import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import { Squad } from '../src/sim/bots/squad';
import { matchSlots } from '../src/sim/match-setup';
import { CampState } from '../src/sim/systems/camps';
import { createSim, Team, type Command } from '../src/sim/sim';

const { Blue, Red } = Team;
type Kind = 'fieldGun' | 'behemoth';

/** The Front, 3v3, no waves, one boss up from the start and nothing else to farm; only Blue's bots play. */
function front(kind: Kind) {
  const config = parseConfig({ ...rawConfig, map: maps[3] });
  config.waves.enabled = false;
  config.map.camps = config.map.camps.filter((c) => c.kind === kind && c.y <= 0);
  config.neutrals.camps[kind].firstSpawnSeconds = 0;
  config.bots.hesitation.chancePerSecond = 0;
  config.powers.powers = [];
  const slots = matchSlots(config, { teamSize: 3, localTeam: Blue });
  const sim = createSim(config, 1, slots);
  const squad = new Squad();
  const blue = slots.flatMap((s, pl) =>
    s.team === Blue ? [{ bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane, squad, () => sim.grid), e: sim.entityOf(pl)! }] : [],
  );
  const red = slots.flatMap((s, pl) => (s.team === Red ? [sim.entityOf(pl)!] : []));
  let snap = sim.snapshot();
  const camp = () => sim.camps[0]!;
  const spot = config.map.camps[0]!;
  let cleared = false;
  const step = (ticks: number, until?: () => boolean) => {
    for (let i = 0; i < ticks && !(until?.() ?? false); i++) {
      const commands: Command[] = blue.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) }));
      for (const ev of sim.step(commands).events) if (ev.type === 'campCleared') cleared = true;
      snap = sim.snapshot();
    }
  };
  const levelUp = (count: number, xp: number) => {
    for (let i = 0; i < count; i++) sim.debug.giveXp(blue[i]!.e, xp);
  };
  const move = (e: number, x: number, y: number) => Object.assign(sim.stores.transforms.get(e)!, { x, y });
  const dist = (e: number) => {
    const t = sim.stores.transforms.get(e)!;
    return Math.hypot(t.x - spot.x, t.y - spot.y);
  };
  return { config, sim, squad, blue, red, step, levelUp, move, dist, camp, spot, cleared: () => cleared };
}

const LEVEL_10 = 1000;
const LEVEL_16 = 2200;

describe('bots contest bosses (D-095)', () => {
  it('a pair gathers outside the floor, wakes the Field Gun together, and clears it', () => {
    const f = front('fieldGun');
    f.levelUp(3, LEVEL_10);
    f.step(45 * 30, () => f.squad.plans.length > 0);
    expect(f.squad.plans).toHaveLength(1);
    const members = f.squad.plans[0]!.members;
    expect(members).toHaveLength(2);
    f.step(45 * 30, () => f.camp().state === CampState.Engaged);
    expect(f.camp().state).toBe(CampState.Engaged);
    // Both within reach of the floor when it wakes, so neither fights it alone.
    for (const m of members) expect(f.dist(m)).toBeLessThan(6.5 + f.config.bots.boss.gatherMargin + f.config.bots.farm.gatherSlack + 1);
    f.step(70 * 30, () => f.cleared());
    expect(f.cleared()).toBe(true);
  }, 60_000);

  it('does not start with only one bot of the level', () => {
    const f = front('fieldGun');
    f.levelUp(1, LEVEL_10);
    f.step(20 * 30);
    expect(f.squad.plans).toEqual([]);
    expect(f.camp().state).not.toBe(CampState.Engaged);
  }, 30_000);

  it('leaves an idle boss with an enemy champion at it', () => {
    const f = front('fieldGun');
    f.levelUp(3, LEVEL_10);
    // Just off its floor: it stays asleep, but the Red champion is at it.
    f.move(f.red[0]!, f.spot.x, f.spot.y + 9);
    f.step(20 * 30);
    expect(f.squad.plans).toEqual([]);
  }, 30_000);

  it('goes for a steal when someone else has it below half', () => {
    const f = front('fieldGun');
    f.levelUp(3, LEVEL_10);
    f.move(f.red[0]!, f.spot.x, f.spot.y + 3); // on the floor: it wakes
    f.sim.stores.healths.get(f.red[0]!)!.hp = 1e6;
    const gun = f.sim.stores.neutrals.ids[0];
    f.step(5, () => f.camp().state === CampState.Engaged);
    expect(f.camp().state).toBe(CampState.Engaged);
    f.step(20);
    expect(f.squad.plans).toEqual([]); // healthy: not worth it
    const h = f.sim.stores.healths.get(gun ?? f.sim.stores.neutrals.ids[0]!)!;
    h.hp = h.maxHp * 0.4;
    f.step(30, () => f.squad.plans.length > 0);
    expect(f.squad.plans).toHaveLength(1);
  }, 30_000);

  it('the Behemoth waits for three of the level', () => {
    const two = front('behemoth');
    two.levelUp(2, LEVEL_16);
    two.step(20 * 30);
    expect(two.squad.plans).toEqual([]);
    const three = front('behemoth');
    three.levelUp(3, LEVEL_16);
    three.step(20 * 30, () => three.squad.plans.length > 0);
    expect(three.squad.plans[0]?.members).toHaveLength(3);
  }, 30_000);
});
