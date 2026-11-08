import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import { Squad } from '../src/sim/bots/squad';
import { matchSlots } from '../src/sim/match-setup';
import { createSim, Kind, Team, type Command } from '../src/sim/sim';

const { Blue } = Team;

/** The Front, 3v3, no waves or camps; only Blue's bots play, in their lanes after 15 s. */
function front() {
  const config = parseConfig({ ...rawConfig, map: maps[3] });
  config.waves.enabled = false;
  config.map.camps = [];
  config.bots.hesitation.chancePerSecond = 0;
  config.bots.regroup.recheckSeconds = 30;
  const slots = matchSlots(config, { teamSize: 3, localTeam: Blue });
  const sim = createSim(config, 1, slots);
  const squad = new Squad();
  const blue = slots.flatMap((s, pl) =>
    s.team === Blue ? [{ home: s.lane, bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane, squad, () => sim.grid), e: sim.entityOf(pl)! }] : [],
  );
  let snap = sim.snapshot();
  const step = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      const commands: Command[] = blue.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) }));
      sim.step(commands);
      snap = sim.snapshot();
    }
  };
  const fell = () => {
    const sub = snap.entities.find((e) => e.kind === Kind.SubBase && e.team !== Blue && e.lane === 'right')!;
    sim.stores.healths.get(sub.id)!.hp = 0;
  };
  const move = (e: number, x: number, y: number) => Object.assign(sim.stores.transforms.get(e)!, { x, y });
  const of = (home: string) => blue.find((b) => b.home === home)!;
  step(15 * 30);
  return { sim, squad, blue, step, fell, move, of };
}

describe('bots regroup after the first Sub-base falls (D-094)', () => {
  it('stay in their own lanes until one falls', () => {
    const f = front();
    f.step(60);
    expect(f.squad.regroupLane).toBeUndefined();
    expect(f.blue.every((b) => b.bot.lane === b.home)).toBe(true);
  });

  it('all move to the lane with the most allies', () => {
    const f = front();
    f.move(f.of('centre').e, -27, -30); // on the left lane, with the left bot
    f.fell();
    f.step(10);
    expect(f.squad.regroupLane).toBe('left');
    f.step(2);
    expect(f.blue.map((b) => b.bot.lane)).toEqual(['left', 'left', 'left']);
  });

  it('keeps its lane on a tie', () => {
    const f = front();
    f.squad.regroupLane = 'right';
    f.fell();
    f.step(10);
    expect(f.squad.regroupLane).toBe('right'); // one bot in each lane
  });

  it('chooses again after its recheck time', () => {
    const f = front();
    f.fell();
    f.step(10);
    const first = f.squad.regroupLane!;
    const other = first === 'left' ? 'right' : 'left';
    const pos = other === 'left' ? [-27, -30] : [26, -30];
    for (const b of f.blue) f.move(b.e, pos[0]!, pos[1]!);
    f.step(2);
    expect(f.squad.regroupLane).toBe(first); // too soon
    f.step(40);
    expect(f.squad.regroupLane).toBe(other);
  });

  it('gives way to a call to defend', () => {
    const f = front();
    f.squad.regroupLane = 'left';
    f.fell();
    f.step(2);
    const right = f.of('right');
    const sub = f.sim.snapshot().entities.find((e) => e.kind === Kind.SubBase && e.team === Blue && e.lane === 'right')!;
    f.squad.defend(sub.id, 'right', right.e, f.sim.tick);
    f.step(1);
    expect(right.bot.lane).toBe('right');
    expect(f.of('centre').bot.lane).toBe('left');
  });
});
