import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import { Nav } from '../src/sim/bots/nav';
import { Squad } from '../src/sim/bots/squad';
import { matchSlots } from '../src/sim/match-setup';
import { createSim, Kind, Team, type Command } from '../src/sim/sim';

describe('bot navigation (D-075)', () => {
  it.each([3, 2] as const)('walks the flow field from the Blue pad to every camp without touching a wall (%d lanes)', (lanes) => {
    const config = parseConfig({ ...rawConfig, map: maps[lanes] });
    const sim = createSim(config, 1, matchSlots(config, { teamSize: 3, localTeam: Team.Blue }));
    const nav = new Nav(sim.grid, config.bots.farm.clearance);
    const aim = { x: 0, y: 0 };
    for (const c of config.map.camps) {
      const f = nav.field(c.id, () => nav.disc(c.x, c.y, 1.5));
      let { x, y } = config.map.spawn.blue;
      let steps = 0;
      while (nav.towards(f, x, y, 6, aim) && steps++ < 3000) {
        const d = Math.hypot(aim.x - x, aim.y - y);
        const step = Math.min(d, 0.17); // 5 m/s at 30 Hz
        x += ((aim.x - x) / d) * step;
        y += ((aim.y - y) / d) * step;
        expect(sim.grid.blocked[nav.cellOf(x, y)], `${c.id} at ${x.toFixed(1)},${y.toFixed(1)}`).toBe(0);
      }
      expect(Math.hypot(x - c.x, y - c.y), c.id).toBeLessThan(2.5);
    }
  });
});

describe('bots farm camps in pairs (D-075)', () => {
  it.each([3, 2] as const)('each team clears a camp in the first minute, two champions at it (%d lanes)', (lanes) => {
    const config = parseConfig({ ...rawConfig, map: maps[lanes] });
    const slots = matchSlots(config, { teamSize: 3, localTeam: Team.Blue });
    const sim = createSim(config, 1, slots);
    const squads = [new Squad(), new Squad()];
    const bots = slots.map((s, pl) => ({ bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane, squads[s.team], () => sim.grid), e: sim.entityOf(pl)! }));
    let snap = sim.snapshot();
    const first: (number | undefined)[] = [undefined, undefined];
    while (sim.tick < 60 * 30 && (first[0] === undefined || first[1] === undefined)) {
      const commands: Command[] = bots.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) }));
      for (const ev of sim.step(commands).events) {
        if (ev.type !== 'campCleared' || ev.team === undefined || first[ev.team] !== undefined) continue;
        // Champions of the clearing team within the reward radius.
        first[ev.team] = snap.entities.filter((e) => e.kind === Kind.Champion && e.team === ev.team && e.hp > 0 && Math.hypot(e.x - ev.x, e.y - ev.y) <= config.neutrals.rewardRadius).length;
      }
      snap = sim.snapshot();
    }
    expect(first).toEqual([2, 2]);
  }, 60_000);
});
