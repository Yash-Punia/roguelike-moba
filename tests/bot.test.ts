import { describe, expect, it } from 'vitest';
import type { Config } from '../src/data/schema';
import { createBot } from '../src/sim/bots/bot';
import { LaneTrack } from '../src/sim/bots/lane';
import type { SimEvent } from '../src/sim/events';
import { fnv1a } from '../src/sim/rng';
import { createSim, Kind, Team, type Command, type PlayerSetup } from '../src/sim/sim';
import { fixtureConfig } from './helpers';

const { Blue, Red } = Team;

/**
 * Headless match on the open fixture lane: (0, −42) → (0, −10) → west (−8, 0) → (0, 10) →
 * (0, 42), 89.6 m. Player 0 is Blue, player 1 Red; `bots` lists which players a bot drives.
 */
function match(opts: { bots: number[]; waves?: boolean; blueAt?: { x: number; y: number }; tweak?: (c: Config) => void; seed?: number }) {
  const config = fixtureConfig();
  config.waves.enabled = opts.waves ?? false;
  opts.tweak?.(config);
  const players: PlayerSetup[] = [
    { team: Blue, championId: 'alpha', spawnAt: opts.blueAt },
    { team: Red, championId: 'alpha' },
  ];
  const sim = createSim(config, opts.seed ?? 1, players);
  const bots = opts.bots.map((pl) => ({ pl, bot: createBot(pl, pl === 0 ? Blue : Red, () => config, () => sim.lanes), e: sim.entityOf(pl)! }));
  let snap = sim.snapshot();
  const events: SimEvent[] = [];
  const run = (n = 1, human?: Command) => {
    for (let i = 0; i < n; i++) {
      const commands: Command[] = human ? [{ ...human, tick: sim.tick }] : [];
      for (const b of bots) commands.push({ ...b.bot.command(snap, sim.tick, b.e) });
      for (const ev of sim.step(commands).events) events.push({ ...ev });
      snap = sim.snapshot();
    }
  };
  const ent = (id: number) => sim.snapshot().entities.find((e) => e.id === id)!;
  const track = () => new LaneTrack(sim.lanes[0]!.branches[0]!);
  return { sim, config, bots, run, ent, events, track, red: sim.entityOf(1)!, blue: sim.entityOf(0)! };
}

describe('lane track', () => {
  it('maps points to distance along the lane and back', () => {
    const m = match({ bots: [] });
    const t = m.track();
    expect(t.length).toBeCloseTo(64 + 2 * Math.hypot(8, 10));
    const p = t.pointAt(10, { x: 0, y: 0 });
    expect([p.x, p.y]).toEqual([0, -32]);
    expect(t.project(0, -32)).toBeCloseTo(10);
    const bend = t.pointAt(32 + Math.hypot(8, 10) / 2, { x: 0, y: 0 });
    expect(bend.x).toBeCloseTo(-4);
    expect(bend.y).toBeCloseTo(-5);
    expect(t.project(bend.x, bend.y)).toBeCloseTo(32 + Math.hypot(8, 10) / 2);
  });
});

describe('farm', () => {
  it('stands behind its own wave, about 85% of its range short of the enemy front', () => {
    const m = match({ bots: [1], waves: true, blueAt: { x: 16, y: -50 } });
    const t = m.track();
    const fwd = (y: number, x: number) => t.length - t.project(x, y); // Red's progress
    let samples = 0;
    let good = 0;
    for (let i = 0; i < 1500; i++) {
      m.run();
      const s = m.sim.snapshot();
      const red = s.entities.find((e) => e.id === m.red)!;
      let own = -Infinity;
      let enemy = Infinity;
      for (const e of s.entities) {
        if (e.kind !== Kind.Minion || e.hp <= 0) continue;
        const f = fwd(e.y, e.x);
        if (e.team === Red) own = Math.max(own, f);
        else enemy = Math.min(enemy, f);
      }
      if (own === -Infinity || enemy === Infinity || enemy - own > 6) continue; // waves not engaged yet
      samples++;
      const f = fwd(red.y, red.x);
      if (f <= own + 0.5 && enemy - f >= 7 * 0.85 - 1.2) good++;
    }
    expect(samples).toBeGreaterThan(60);
    expect(good / samples).toBeGreaterThan(0.85);
  });

  it('holds in front of its own Sub-base when it has no wave', () => {
    const m = match({
      bots: [1],
      blueAt: { x: 16, y: -50 },
      tweak: (c) => c.map.structures.push({ id: 'red-sub', kind: 'subBase', team: 'red', lane: 'centre', x: 0, y: 30 }),
    });
    m.run(400);
    const red = m.ent(m.red);
    expect(red.y).toBeGreaterThan(24.5);
    expect(red.y).toBeLessThan(27.5);
    expect(m.bots[0]!.bot.goal).toBe('farm');
  });

  it('never walks into an enemy tower’s range alone', () => {
    const m = match({
      bots: [1],
      waves: true,
      blueAt: { x: 16, y: -50 },
      tweak: (c) => {
        c.map.structures.push({ id: 'blue-sub', kind: 'subBase', team: 'blue', lane: 'centre', x: 0, y: -20 });
        c.waves.firstSeconds = 1;
      },
    });
    // Blue's waves die at once, so the Red bot never has a Blue minion tanking the tower for it... but its own wave may.
    let closest = Infinity;
    let freeFor = 0; // ticks since the tower last shot one of its minions: it gets 1 s to step back out
    for (let i = 0; i < 1200; i++) {
      for (const e of m.sim.stores.laneAgents.ids.slice()) if (m.sim.stores.teams.get(e) === Blue) m.sim.debug.kill(e);
      m.run();
      const red = m.ent(m.red);
      const sub = m.sim.snapshot().entities.find((e) => e.kind === Kind.SubBase)!;
      const towerBusy = m.sim.snapshot().entities.some((e) => e.id === sub.targetId && e.kind === Kind.Minion);
      freeFor = towerBusy ? 0 : freeFor + 1;
      if (freeFor > 30 && red.hp > 0) closest = Math.min(closest, Math.hypot(red.x - sub.x, red.y - sub.y) - red.radius);
    }
    expect(closest).toBeGreaterThan(8);
  });
});

describe('trade', () => {
  const lane = { x: 0, y: -20 };

  it('closes to about 95% of its range on a weaker champion, and shoots', () => {
    const m = match({ bots: [1], blueAt: lane });
    m.sim.stores.healths.get(m.blue)!.hp = 500;
    m.sim.stores.weapons.remove(m.blue);
    Object.assign(m.sim.stores.transforms.get(m.red)!, { x: -2, y: -12 }); // 8.2 m away
    m.run(120);
    expect(m.bots[0]!.bot.goal).toBe('trade');
    const red = m.ent(m.red);
    const d = Math.hypot(red.x - lane.x, red.y - lane.y);
    expect(d).toBeGreaterThan(6.3);
    expect(d).toBeLessThan(7.6);
    expect(m.events.some((e) => e.type === 'damage' && e.source === m.red && e.target === m.blue)).toBe(true);
  });

  it('does not engage when it is the weaker one', () => {
    const m = match({ bots: [1], blueAt: lane });
    m.sim.stores.healths.get(m.red)!.hp = 400;
    Object.assign(m.sim.stores.transforms.get(m.red)!, { x: -2, y: -12 });
    m.run(30);
    expect(m.bots[0]!.bot.goal).not.toBe('trade');
  });
});

describe('retreat', () => {
  it('goes home below 30% HP, heals on the pad, and comes back at 90%', () => {
    const m = match({ bots: [1], blueAt: { x: 16, y: -50 } });
    m.sim.stores.transforms.get(m.red)!.y = 0;
    m.sim.stores.transforms.get(m.red)!.x = -8;
    m.sim.stores.healths.get(m.red)!.hp = 250;
    m.run(2); // it answers the previous snapshot
    expect(m.bots[0]!.bot.goal).toBe('retreat');
    let healedAt = -1;
    for (let i = 0; i < 1500 && healedAt < 0; i++) {
      m.run();
      if (m.bots[0]!.bot.goal === 'farm') healedAt = i;
    }
    expect(healedAt).toBeGreaterThan(0);
    const h = m.sim.stores.healths.get(m.red)!;
    expect(h.hp / h.maxHp).toBeGreaterThanOrEqual(0.9);
    expect(m.ent(m.red).y).toBeGreaterThan(38); // it went all the way to its pad at (0, 42)
  });
});

describe('Ultimate', () => {
  it('casts on a champion, not on a lone minion', () => {
    const m = match({ bots: [1], blueAt: { x: -2, y: 8 } });
    m.sim.stores.transforms.get(m.red)!.y = 15;
    m.sim.stores.transforms.get(m.red)!.x = -2;
    m.sim.debug.fillUltimate(m.red);
    m.run(2);
    expect(m.events.some((e) => e.type === 'ultCast' && e.id === m.red)).toBe(true);

    const lone = match({ bots: [1], blueAt: { x: 16, y: -50 } });
    lone.sim.debug.spawnWave();
    for (const e of lone.sim.stores.laneAgents.ids.slice(1)) lone.sim.debug.kill(e); // keep one Blue soldier
    const soldier = lone.sim.stores.laneAgents.ids[0]!;
    Object.assign(lone.sim.stores.transforms.get(soldier)!, { x: -2, y: 9 });
    Object.assign(lone.sim.stores.transforms.get(lone.red)!, { x: -2, y: 15 });
    lone.sim.debug.fillUltimate(lone.red);
    lone.run(3);
    expect(lone.events.some((e) => e.type === 'ultCast')).toBe(false);
  });
});

describe('bot matches', () => {
  it('are deterministic', () => {
    const hashes = () => {
      const m = match({ bots: [0, 1], waves: true });
      const out: number[] = [];
      for (let i = 0; i < 18; i++) {
        m.run(300);
        out.push(fnv1a(JSON.stringify(m.sim.snapshot())));
      }
      return out;
    };
    expect(hashes()).toEqual(hashes());
  });

  it('play 10 minutes of lane without errors: both level up and trade blows', () => {
    const m = match({ bots: [0, 1], waves: true });
    m.run(18000);
    const blue = m.sim.stores.champions.get(m.blue)!;
    const red = m.sim.stores.champions.get(m.red)!;
    expect(blue.level).toBeGreaterThan(3);
    expect(red.level).toBeGreaterThan(3);
    expect(m.events.some((e) => e.type === 'damage' && e.source === m.blue && e.target === m.red)).toBe(true);
    expect(m.events.some((e) => e.type === 'damage' && e.source === m.red && e.target === m.blue)).toBe(true);
  }, 60000);
});
