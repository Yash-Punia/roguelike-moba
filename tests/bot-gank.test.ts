import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import type { Difficulty } from '../src/data/schema';
import { createBot } from '../src/sim/bots/bot';
import { Squad } from '../src/sim/bots/squad';
import { matchSlots } from '../src/sim/match-setup';
import { createSim, Team, type Command } from '../src/sim/sim';

const { Blue, Red } = Team;
const ON_LANE: Record<string, [number, number]> = { left: [-25, -22], centre: [1, -26], right: [26, -23] };

/**
 * The Front, 3v3, no waves or camps. One Blue bot plays (the first with \`champ\`); the rest
 * stand at their pads. Red's \`weak\` champion is held at a set HP share in \`lane\`.
 */
function front(champ: string, difficulty: Difficulty = 'hard') {
  const config = parseConfig({ ...rawConfig, map: maps[3] });
  config.waves.enabled = false;
  config.map.camps = [];
  config.bots.hesitation.chancePerSecond = 0;
  Object.assign(config.bots.gank, { desire: 0.8, hpPct: 0.5, healedHpPct: 0.6, maxTravel: 40, maxSeconds: 360, cooldownSeconds: 60 });
  const slots = matchSlots(config, { teamSize: 3, localTeam: Blue });
  const sim = createSim(config, 1, slots);
  const pl = slots.findIndex((s) => s.team === Blue && s.championId === champ);
  const home = slots[pl]!.lane;
  const squad = new Squad();
  const bot = createBot(pl, Blue, () => config, () => sim.lanes, sim.rng.ai, home, squad, () => sim.grid, difficulty);
  const e = sim.entityOf(pl)!;
  const weak = sim.entityOf(slots.findIndex((s) => s.team === Red))!;
  let snap = sim.snapshot();
  let hold = 1;
  const step = (ticks: number, until?: () => boolean) => {
    for (let i = 0; i < ticks && !(until?.() ?? false); i++) {
      const h = sim.stores.healths.get(weak)!;
      h.hp = h.maxHp * hold;
      const commands: Command[] = [{ ...bot.command(snap, sim.tick, e) }];
      sim.step(commands);
      snap = sim.snapshot();
    }
  };
  const place = (lane: string, share: number) => {
    Object.assign(sim.stores.transforms.get(weak)!, { x: ON_LANE[lane]![0], y: ON_LANE[lane]![1] });
    hold = share;
  };
  step(15 * 30); // into its lane, out of combat long enough for Light Feet
  const adjacent = home === 'centre' ? 'left' : 'centre';
  const farSide = home === 'left' ? 'right' : home === 'right' ? 'left' : undefined;
  return { config, sim, bot, e, weak, step, place, home, adjacent, farSide, setHold: (s: number) => (hold = s), dist: () => {
    const a = sim.stores.transforms.get(e)!;
    const b = sim.stores.transforms.get(weak)!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  } };
}

describe('Beta ganks (D-096)', () => {
  it('goes for a weak enemy in the next lane, by the trenches', () => {
    const f = front('beta');
    f.place(f.adjacent, 0.3);
    f.step(20, () => f.bot.gankTarget !== 0);
    expect(f.bot.gankTarget).toBe(f.weak);
    f.step(1);
    expect(f.bot.lane).toBe(f.adjacent);
    expect(f.bot.mode).toBe('gank');
    f.step(12 * 30, () => f.dist() < 10);
    expect(f.dist()).toBeLessThan(10);
  }, 30_000);

  it('only with Light Feet', () => {
    const f = front('alpha');
    f.place(f.adjacent, 0.3);
    f.step(60);
    expect(f.bot.gankTarget).toBe(0);
  }, 30_000);

  it('leaves a healthy enemy and a far lane alone', () => {
    const healthy = front('beta');
    healthy.place(healthy.adjacent, 0.8);
    healthy.step(60);
    expect(healthy.bot.gankTarget).toBe(0);
    const far = front('beta');
    far.place(far.farSide!, 0.3);
    far.step(60);
    expect(far.bot.gankTarget).toBe(0);
  }, 30_000);

  it('never on Easy', () => {
    const f = front('beta', 'easy');
    f.place(f.adjacent, 0.3);
    f.step(60);
    expect(f.bot.gankTarget).toBe(0);
  }, 30_000);

  it('calls it off when the target heals, goes home, and waits out the cooldown', () => {
    const f = front('beta');
    f.place(f.adjacent, 0.3);
    f.step(20, () => f.bot.gankTarget !== 0);
    f.setHold(0.9);
    f.step(5);
    expect(f.bot.gankTarget).toBe(0);
    f.step(1);
    expect(f.bot.lane).toBe(f.home);
    f.setHold(0.3);
    f.step(30);
    expect(f.bot.gankTarget).toBe(0); // cooldown
  }, 30_000);

  it('gives up on time-out', () => {
    const f = front('beta');
    f.config.bots.gank.maxSeconds = 15;
    f.place(f.adjacent, 0.3);
    f.step(20, () => f.bot.gankTarget !== 0);
    expect(f.bot.gankTarget).toBe(f.weak);
    f.step(20);
    expect(f.bot.gankTarget).toBe(0);
  }, 30_000);
});
