import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import { LaneTrack } from '../src/sim/bots/lane';
import { emptyRead, readLane } from '../src/sim/bots/lane-read';
import { matchSlots, spreadLanes } from '../src/sim/match-setup';
import { fnv1a } from '../src/sim/rng';
import { createSim, Team, type Command } from '../src/sim/sim';
import { fixtureConfig } from './helpers';

const LANES = ['left', 'centre', 'right'];

describe('lane spread (D-048)', () => {
  it('fills centre first, then the other lanes in map order, doubling up evenly', () => {
    expect(spreadLanes(LANES, 1)).toEqual(['centre']);
    expect(spreadLanes(LANES, 2)).toEqual(['centre', 'left']);
    expect(spreadLanes(LANES, 3)).toEqual(['centre', 'left', 'right']);
    expect(spreadLanes(LANES, 4)).toEqual(['centre', 'left', 'right', 'centre']);
    expect(spreadLanes(LANES, 5)).toEqual(['centre', 'left', 'right', 'centre', 'left']);
    expect(spreadLanes(['left', 'right'], 3, 'centre')).toEqual(['left', 'right', 'left']); // The Bridgehead: no centre (D-069)
  });

  it('gives slot 0 the chosen lane and spreads the rest around it', () => {
    expect(spreadLanes(LANES, 3, 'left')).toEqual(['left', 'centre', 'right']);
    expect(spreadLanes(LANES, 2, 'right')).toEqual(['right', 'centre']);
    expect(spreadLanes(LANES, 4, 'right')).toEqual(['right', 'centre', 'left', 'centre']);
    expect(spreadLanes(LANES, 3, 'nowhere')).toEqual(['centre', 'left', 'right']);
  });

  it('orders players: you, the enemy in your lane, your team, then theirs', () => {
    const config = parseConfig(rawConfig);
    const slots = matchSlots(config, { teamSize: 3, localTeam: Team.Red, localLane: 'right' });
    expect(slots.map((s) => [s.team, s.lane, s.championId])).toEqual([
      [Team.Red, 'right', 'alpha'],
      [Team.Blue, 'right', 'alpha'],
      [Team.Red, 'left', 'beta'], // Beta takes a side lane (D-049), Gamma the centre (D-050)
      [Team.Red, 'centre', 'gamma'],
      [Team.Blue, 'left', 'beta'],
      [Team.Blue, 'centre', 'gamma'],
    ]);
  });

  it('gives you the champion you pick, falling back to the first for an unknown id', () => {
    const config = parseConfig(rawConfig);
    const pick = (localChampion: string) => matchSlots(config, { teamSize: 3, localTeam: Team.Blue, localChampion }).map((s) => s.championId);
    expect(pick('beta')).toEqual(['beta', 'alpha', 'beta', 'gamma', 'beta', 'gamma']);
    expect(pick('nobody')[0]).toBe('alpha');
  });

  it('sends Beta bots to side lanes, Gamma bots to the centre and the rest to what is left', () => {
    const config = parseConfig(rawConfig);
    const blue = matchSlots(config, { teamSize: 5, localTeam: Team.Blue })
      .filter((s) => s.team === Team.Blue)
      .map((s) => `${s.championId}:${s.lane}`);
    // Lanes C L R C L (D-048): the Betas take side lanes and the Gamma the free centre; the Alpha gets what is left.
    expect(blue).toEqual(['alpha:centre', 'beta:left', 'gamma:centre', 'alpha:left', 'beta:right']);
  });
});

describe('the lane read with several enemies', () => {
  const setup = (blueAt: { x: number; y: number }[]) => {
    const config = fixtureConfig();
    config.waves.enabled = false;
    const sim = createSim(config, 1, [{ team: Team.Red, championId: 'alpha', spawnAt: { x: 0, y: 10 } }, ...blueAt.map((spawnAt) => ({ team: Team.Blue, championId: 'alpha', spawnAt }) as const)]);
    const read = () => {
      const r = emptyRead();
      readLane(r, sim.snapshot(), sim.entityOf(0)!, Team.Red, new LaneTrack(sim.lanes[0]!.branches[0]!), config, 'centre');
      return r;
    };
    return { sim, read };
  };

  it('reads the nearest live enemy, whatever its id', () => {
    const { sim, read } = setup([{ x: 0, y: 4 }, { x: 0, y: -30 }]);
    expect(read().enemy?.id).toBe(sim.entityOf(1));
    const far = setup([{ x: 0, y: -30 }, { x: 0, y: 4 }]);
    expect(far.read().enemy?.id).toBe(far.sim.entityOf(2));
  });

  it('reads a knocked-out lane opponent when no live enemy is near', () => {
    const { sim, read } = setup([{ x: 0, y: 4 }, { x: 0, y: -40 }]);
    sim.debug.kill(sim.entityOf(1)!);
    sim.step([]);
    const r = read();
    expect(r.enemy?.id).toBe(sim.entityOf(1));
    expect(r.enemyRespawn).toBeGreaterThan(0);
  });
});

/** An all-bot 3v3 on The Front (or The Bridgehead with lanes = 2); returns the sim, its slots and the state hash every 300 ticks. */
function botMatch(seed: number, ticks: number, lanes: 2 | 3 = 3) {
  const config = parseConfig({ ...rawConfig, map: maps[lanes] });
  const slots = matchSlots(config, { teamSize: 3, localTeam: Team.Blue });
  const sim = createSim(config, seed, slots);
  const bots = slots.map((s, pl) => ({ bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane), e: sim.entityOf(pl)! }));
  let snap = sim.snapshot();
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const commands: Command[] = bots.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) }));
    sim.step(commands);
    snap = sim.snapshot();
    if (sim.tick % 300 === 0) hashes.push(fnv1a(JSON.stringify(snap)));
  }
  return { sim, slots, hashes };
}

describe('3v3 bot matches', () => {
  it('repeat exactly for a seed (the bots share the ai stream)', () => {
    expect(botMatch(5, 600).hashes).toEqual(botMatch(5, 600).hashes);
  }, 30_000);

  it.each([3, 2] as const)('send every bot to its own lane (at the first clash, 30 s; %d lanes)', (lanes) => {
    const { sim, slots } = botMatch(5, 900, lanes);
    const tracks = sim.lanes.map((l) => ({ id: l.id, tracks: l.branches.map((b) => new LaneTrack(b)) }));
    slots.forEach((s, pl) => {
      const t = sim.stores.transforms.get(sim.entityOf(pl)!)!;
      const dist = (id: string) =>
        Math.min(...tracks.find((l) => l.id === id)!.tracks.map((tr) => (tr.project(t.x, t.y), tr.lastDistSq)));
      const nearest = tracks.map((l) => l.id).reduce((a, b) => (dist(b) < dist(a) ? b : a));
      expect([pl, nearest]).toEqual([pl, s.lane]);
    });
  }, 30_000);
});
