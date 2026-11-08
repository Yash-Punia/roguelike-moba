import { describe, expect, it } from 'vitest';
import type { Config } from '../src/data/schema';
import { createBot } from '../src/sim/bots/bot';
import { LaneTrack } from '../src/sim/bots/lane';
import { rollPersonality } from '../src/sim/bots/personality';
import type { SimEvent } from '../src/sim/events';
import { fnv1a, mulberry32 } from '../src/sim/rng';
import { createSim, Kind, Team, type Command, type PlayerSetup } from '../src/sim/sim';
import { parseConfig, rawConfig } from '../src/data/load';
import { fixtureConfig } from './helpers';

const { Blue, Red } = Team;
type Placement = { id: string; kind: 'subBase' | 'hq'; team: 'blue' | 'red'; lane: string; x: number; y: number };
const redSub: Placement = { id: 'red-sub', kind: 'subBase', team: 'red', lane: 'centre', x: 0, y: 30 };
const blueSub: Placement = { id: 'blue-sub', kind: 'subBase', team: 'blue', lane: 'centre', x: 0, y: -25 };

/**
 * Headless match on the open fixture lane: (0, −42) → (0, −10) → west (−8, 0) → (0, 10) →
 * (0, 42), 89.6 m. Player 0 is Blue, player 1 Red; `bots` lists the players a bot drives.
 */
function match(opts: { bots: number[]; waves?: boolean; blueAt?: { x: number; y: number }; structures?: Placement[]; tweak?: (c: Config) => void; seed?: number; realMap?: boolean }) {
  const config = opts.realMap ? parseConfig(rawConfig) : fixtureConfig();
  config.waves.enabled = opts.waves ?? false;
  config.map.structures.push(...(opts.structures ?? []));
  opts.tweak?.(config);
  const players: PlayerSetup[] = [
    { team: Blue, championId: 'alpha', spawnAt: opts.blueAt },
    { team: Red, championId: 'alpha' },
  ];
  const sim = createSim(config, opts.seed ?? 1, players);
  const bots = opts.bots.map((pl) => ({ pl, bot: createBot(pl, pl === 0 ? Blue : Red, () => config, () => sim.lanes, sim.rng.ai), e: sim.entityOf(pl)! }));
  let snap = sim.snapshot();
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      const commands: Command[] = [];
      for (const b of bots) commands.push({ ...b.bot.command(snap, sim.tick, b.e) });
      for (const ev of sim.step(commands).events) events.push({ ...ev, tick: sim.tick - 1 });
      snap = sim.snapshot();
      each?.();
    }
  };
  const ent = (id: number) => sim.snapshot().entities.find((e) => e.id === id)!;
  const place = (id: number, x: number, y: number) => Object.assign(sim.stores.transforms.get(id)!, { x, y });
  /** A team's HQ, or its Sub-base in `lane` (the bot plays the centre). */
  const structure = (team: Team, kind: 'subBase' | 'hq' = 'subBase', lane = 'centre') =>
    sim.stores.structures.ids.find((e) => {
      const st = sim.stores.structures.get(e)!;
      return sim.stores.teams.get(e) === team && st.kind === kind && (kind === 'hq' || st.lane === lane);
    })!;
  const red = sim.entityOf(1)!;
  const blue = sim.entityOf(0)!;
  const bot = () => bots.find((b) => b.pl === 1)!.bot;
  return { sim, config, bots, bot, run, ent, place, structure, events, red, blue };
}

describe('lane track', () => {
  it('maps points to distance along the lane and back', () => {
    const m = match({ bots: [] });
    const t = new LaneTrack(m.sim.lanes[0]!.branches[0]!);
    expect(t.length).toBeCloseTo(64 + 2 * Math.hypot(8, 10));
    const p = t.pointAt(10, { x: 0, y: 0 });
    expect([p.x, p.y]).toEqual([0, -32]);
    expect(t.project(0, -32)).toBeCloseTo(10);
    const bend = t.pointAt(32 + Math.hypot(8, 10) / 2, { x: 0, y: 0 });
    expect([bend.x, bend.y]).toEqual([expect.closeTo(-4), expect.closeTo(-5)]);
  });
});

describe('personality (D-043)', () => {
  const cfg = fixtureConfig().bots.personality;
  const retreat = fixtureConfig().bots.difficulty.normal.retreatHpPct;

  it('stays inside its ranges, repeats for a seed and differs between seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = rollPersonality(cfg, retreat, mulberry32(seed));
      expect(p.aggression).toBeGreaterThanOrEqual(cfg.aggression[0]);
      expect(p.aggression).toBeLessThanOrEqual(cfg.aggression[1]);
      expect(p.retreatHp).toBeGreaterThanOrEqual(retreat[0]);
      expect(p.retreatHp).toBeLessThanOrEqual(retreat[1]);
      expect(p.returnHp).toBeGreaterThan(p.retreatHp);
    }
    expect(rollPersonality(cfg, retreat, mulberry32(7))).toEqual(rollPersonality(cfg, retreat, mulberry32(7)));
    expect(rollPersonality(cfg, retreat, mulberry32(7)).aggression).not.toBe(rollPersonality(cfg, retreat, mulberry32(8)).aggression);
  });
});

describe('pushing (the playtest complaint)', () => {
  it('pushes into your half and hits your Sub-base while you stay home (The Front)', () => {
    const m = match({ bots: [1], waves: true, realMap: true }); // you idle on your pad
    let inEnemyHalf = 0;
    let counted = 0;
    m.run(7200, () => {
      if (m.sim.tick < 1800) return; // from minute 1
      counted++;
      if (m.sim.stores.transforms.get(m.red)!.y < 0) inEnemyHalf++;
    });
    expect(inEnemyHalf / counted).toBeGreaterThan(0.5);
    const sub = m.structure(Blue);
    expect(m.events.some((e) => e.type === 'damage' && e.source === m.red && e.target === sub)).toBe(true);
  }, 30_000); // 4 real-map minutes: about 2 s alone, past 5 s under a full parallel run

  it('sieges only while the tower shoots its minions, and steps out when the tower turns on it', () => {
    const m = match({ bots: [1], waves: true, blueAt: { x: 16, y: -50 }, structures: [redSub, blueSub] });
    const sub = m.structure(Blue);
    let streak = 0;
    let longest = 0;
    m.run(7200, () => {
      const onBot = m.sim.stores.targetings.get(sub)!.targetId === m.red;
      streak = onBot ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    });
    expect(longest).toBeLessThan(75); // never tanks the tower for long
  });
});

describe('fighting', () => {
  it('goes all in on a weak champion out of tower range and lands the kill', () => {
    const m = match({ bots: [1], blueAt: { x: 0, y: -20 } });
    m.sim.stores.healths.get(m.blue)!.hp = 300;
    m.sim.stores.weapons.remove(m.blue);
    m.place(m.red, -2, -11);
    m.run(300);
    expect(m.events.find((e) => e.type === 'death' && e.id === m.blue)).toMatchObject({ killer: m.red });
  });

  it('freezes near its own tower when it is levels behind and the enemy is close', () => {
    const m = match({ bots: [1], blueAt: { x: 0, y: 12 }, structures: [redSub] });
    m.sim.debug.giveXp(m.blue, 360); // Blue level 4, the bot level 1
    m.sim.stores.weapons.remove(m.blue);
    m.run(240);
    expect(m.bot().mode).toBe('freeze');
    expect(m.ent(m.red).y).toBeGreaterThan(25);
  });

  it('retreats home below its threshold and returns once healed', () => {
    const m = match({ bots: [1], blueAt: { x: 16, y: -50 } });
    m.place(m.red, -8, 0);
    m.sim.stores.healths.get(m.red)!.hp = 120;
    m.run(2 + m.config.bots.difficulty.normal.reactionSeconds); // answers after its reaction time (D-086)
    expect(m.bot().mode).toBe('retreat');
    let back = -1;
    for (let i = 0; i < 1800 && back < 0; i++) {
      m.run();
      if (m.bot().mode !== 'retreat') back = i;
    }
    expect(back).toBeGreaterThan(0);
    expect(m.sim.stores.healths.get(m.red)!.hp / 1000).toBeGreaterThanOrEqual(m.bot().personality.returnHp - 0.01);
  });

  it('comes back to defend its tower', () => {
    const m = match({ bots: [1], blueAt: { x: 16, y: -50 }, structures: [redSub] });
    m.place(m.red, 0, -30);
    m.sim.debug.spawnWave();
    for (const e of m.sim.stores.laneAgents.ids.slice()) {
      if (m.sim.stores.teams.get(e) === Red) m.sim.debug.kill(e);
      else m.place(e, 0, 34); // Blue soldiers at the Red tower
    }
    m.run(30);
    expect(m.bot().mode).toBe('defend');
    m.run(300);
    expect(m.ent(m.red).y).toBeGreaterThan(15);
  });
});

describe('confidence', () => {
  it('rises after a takedown, falls after dying, and decays', () => {
    const m = match({ bots: [1], blueAt: { x: 0, y: -20 } });
    m.sim.stores.healths.get(m.blue)!.hp = 100;
    m.sim.stores.weapons.remove(m.blue);
    m.place(m.red, -2, -11);
    m.run(200);
    const high = m.bot().confidence;
    expect(high).toBeGreaterThan(0.15);
    m.run(160); // Blue redeploys; keep it out of reach so no second takedown lifts the mood
    m.sim.stores.healths.get(m.blue)!.invulnerable = true;
    m.run(740); // 30 s after the kill
    expect(m.bot().confidence).toBeLessThan(high * 0.6);
    m.sim.debug.kill(m.red);
    m.run(3);
    expect(m.bot().confidence).toBeLessThan(0);
  });
});

describe('bot matches', () => {
  const hashes = (seed: number) => {
    const m = match({ bots: [0, 1], waves: true, structures: [redSub, blueSub], seed });
    const out: number[] = [];
    for (let i = 0; i < 12; i++) {
      m.run(300);
      out.push(fnv1a(JSON.stringify(m.sim.snapshot())));
    }
    return out;
  };

  it('repeat exactly for a seed and differ between seeds', () => {
    expect(hashes(3)).toEqual(hashes(3));
    expect(hashes(3).at(-1)).not.toBe(hashes(4).at(-1));
  });

  it('play 10 minutes without errors, fighting and levelling', () => {
    const m = match({ bots: [0, 1], waves: true, structures: [redSub, blueSub] });
    m.run(18000);
    for (const id of [m.blue, m.red]) expect(m.sim.stores.champions.get(id)!.level).toBeGreaterThan(3);
    expect(m.events.some((e) => e.type === 'damage' && e.source === m.blue && e.target === m.red)).toBe(true);
    expect(m.events.some((e) => e.type === 'damage' && e.source === m.red && e.target === m.blue)).toBe(true);
    expect(m.events.some((e) => e.type === 'ultCast')).toBe(true);
  }, 60000);
});

describe('the lane read', () => {
  it('counts the wave advantage and both kill times', async () => {
    const { emptyRead, readLane } = await import('../src/sim/bots/lane-read');
    const m = match({ bots: [], blueAt: { x: 0, y: 0 }, tweak: (c) => (c.waves.soldiers = 3) });
    m.place(m.red, 0, 5);
    m.sim.debug.spawnWave();
    m.run();
    for (const e of m.sim.stores.laneAgents.ids.slice()) {
      if (m.sim.stores.teams.get(e) === Blue) m.place(e, -1, 2);
      else m.place(e, -1, 9);
    }
    m.sim.debug.kill(m.sim.stores.laneAgents.ids.find((e) => m.sim.stores.teams.get(e) === Blue)!);
    m.run();
    const r = emptyRead();
    readLane(r, m.sim.snapshot(), m.red, Red, new LaneTrack(m.sim.lanes[0]!.branches[0]!), m.config, 'centre');
    expect(r.waveAdvantage).toBe(1); // 3 Red soldiers against 2 Blue
    const dps = 95 / (25 / 30);
    expect(r.ttkUs).toBeCloseTo(m.ent(m.blue).hp / dps);
    expect(r.ttkThem).toBeCloseTo(m.ent(m.red).hp / dps);
    expect(m.sim.snapshot().entities.filter((e) => e.kind === Kind.Minion)).toHaveLength(5);
  });
});
