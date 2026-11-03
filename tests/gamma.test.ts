import { describe, expect, it } from 'vitest';
import { createBot } from '../src/sim/bots/bot';
import type { DamageEvent } from '../src/sim/events';
import { createSim, Team, type Command, type PlayerSetup } from '../src/sim/sim';
import { fixtureConfig } from './helpers';

const { Blue, Red } = Team;
const DEG = Math.PI / 180;

const cmd = (player: number, opts: { moveX?: number; moveY?: number; ult?: boolean } = {}): Command => ({
  tick: 0, player, moveX: opts.moveX ?? 0, moveY: opts.moveY ?? 0, ult: opts.ult ?? false, draftPick: -1, reroll: false,
});

type Spot = { x: number; y: number; team?: Team.Blue | Team.Red; armed?: boolean };

/**
 * Open fixture map, waves off: Gamma (player 0, Blue) at the origin facing +y, plus Alphas at
 * the given spots (Red and unarmed unless told otherwise; players 1, 2, …). Records damage.
 */
function field(units: Spot[]) {
  const config = fixtureConfig();
  config.waves.enabled = false;
  const players: PlayerSetup[] = [{ team: Blue, championId: 'gamma', spawnAt: { x: 0, y: 0 } }];
  for (const u of units) players.push({ team: u.team ?? Red, championId: 'alpha', spawnAt: { x: u.x, y: u.y }, unarmed: !u.armed });
  const sim = createSim(config, 1, players);
  const gamma = sim.entityOf(0)!;
  const hits: (DamageEvent & { tick: number })[] = [];
  const run = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) for (const ev of sim.step(commands).events) if (ev.type === 'damage') hits.push({ ...ev, tick: sim.tick - 1 });
  };
  const def = config.champions.find((c) => c.id === 'gamma')!;
  const wave = def.ultimate.id === 'heatWave' ? def.ultimate : undefined!;
  const champ = () => sim.stores.champions.get(gamma)!;
  /** Fills Gamma's Ultimate with his flamethrower on a long cooldown (so only the wave acts), then casts. */
  const cast = () => {
    sim.stores.weapons.get(gamma)!.cooldown = 10_000;
    sim.debug.fillUltimate(gamma);
    run(1, [cmd(0, { ult: true })]);
  };
  const dealt = (source: number, target: number) => hits.filter((h) => h.source === source && h.target === target).reduce((s, h) => s + h.amount, 0);
  return { sim, config, def, wave, gamma, hits, run, champ, cast, dealt, unit: (i: number) => sim.entityOf(i + 1)! };
}

describe('Flamethrower', () => {
  it('hits every enemy inside the 4 m × 40° cone, 28 every 6 ticks, and nothing outside it', () => {
    // Inside: straight ahead and 15° off. Outside: 4.6 m away (4.1 m to its edge), and 40° off.
    const f = field([{ x: 0, y: 3 }, { x: 0.8, y: 3 }, { x: 0, y: 4.6 }, { x: 3 * Math.sin(40 * DEG), y: 3 * Math.cos(40 * DEG) }]);
    f.run(60);
    const flames = f.hits.filter((h) => h.source === f.gamma && h.target === f.unit(0)).map((h) => h.tick);
    expect(flames.slice(1).map((t, i) => t - flames[i]!)).toEqual(new Array(flames.length - 1).fill(6));
    expect(flames.length).toBeGreaterThanOrEqual(9);
    expect(f.dealt(f.gamma, f.unit(0))).toBeCloseTo(28 * flames.length);
    expect(f.dealt(f.gamma, f.unit(1))).toBeCloseTo(28 * flames.length);
    expect(f.dealt(f.gamma, f.unit(2))).toBe(0);
    expect(f.dealt(f.gamma, f.unit(3))).toBe(0);
  });
});

describe('Charge', () => {
  const speed = (f: ReturnType<typeof field>) => f.sim.stores.motions.get(f.gamma)!.speed;

  it('adds +30% move speed while moving towards an enemy champion within 8 m', () => {
    const f = field([{ x: 0, y: 6 }]);
    f.run(1, [cmd(0, { moveY: 127 })]);
    expect(speed(f)).toBeCloseTo(4.3 * 1.3);
    expect(f.sim.snapshot().entities.find((e) => e.id === f.gamma)!.traitActive).toBe(true);
    f.run(1, [cmd(0, { moveY: -127 })]);
    expect(speed(f)).toBeCloseTo(4.3);
    f.run(1, [cmd(0, { moveX: 107, moveY: 127 })]); // 40° off: still charging
    expect(speed(f)).toBeCloseTo(4.3 * 1.3);
  });

  it('does nothing when the nearest enemy champion is beyond 8 m', () => {
    const f = field([{ x: 0, y: 9 }]);
    f.run(5, [cmd(0, { moveY: 127 })]);
    expect(f.champ().traitPct).toBe(0);
  });
});

describe('Heat Wave', () => {
  it('heals allies and burns enemies inside for 3% of max HP per second over 6 s, and nothing outside', () => {
    const f = field([{ x: 2, y: 0, team: Blue }, { x: 0, y: 5 }, { x: 0, y: 9 }]);
    f.sim.stores.healths.get(f.unit(0))!.hp = 500;
    f.cast();
    expect(f.champ().auraTicks).toBe(f.wave.seconds);
    f.run(f.wave.seconds);
    expect(f.champ().auraTicks).toBe(0);
    expect(f.sim.stores.healths.get(f.unit(0))!.hp).toBeCloseTo(500 + 1000 * 0.03 * 6);
    expect(f.dealt(f.gamma, f.unit(1))).toBeCloseTo(1000 * 0.03 * 6); // exact: no damage stat, no +20% from his own wave
    expect(f.dealt(f.gamma, f.unit(2))).toBe(0);
  });

  it('lifts damage dealt from inside an allied wave by 20% and cuts it by 20% inside an enemy one', () => {
    // An armed Blue Alpha and an armed Red Alpha trade shots inside Gamma's wave.
    const f = field([{ x: 1.5, y: 0, team: Blue, armed: true }, { x: 1.5, y: 5, armed: true }]);
    f.cast();
    f.run(90);
    const ours = f.hits.filter((h) => h.source === f.unit(0)).map((h) => Math.round(h.amount));
    const theirs = f.hits.filter((h) => h.source === f.unit(1)).map((h) => Math.round(h.amount));
    expect(ours.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(new Set(ours)).toEqual(new Set([Math.round(95 * 1.2)]));
    expect(new Set(theirs)).toEqual(new Set([Math.round(95 * 0.8)]));
  });

  it('is castable with nobody in range, follows Gamma, and ends when he is knocked out', () => {
    const f = field([{ x: 0, y: 40 }]);
    f.run(); // the Ultimate's target is refreshed each tick
    expect(f.sim.snapshot().entities.find((e) => e.id === f.gamma)!.ultTargetable).toBe(true);
    f.cast();
    expect(f.champ().auraTicks).toBeGreaterThan(0);
    // Walk up to the far enemy: the burn starts once it is inside the moving wave.
    Object.assign(f.sim.stores.transforms.get(f.gamma)!, { x: 0, y: 36 });
    f.run(20);
    expect(f.dealt(f.gamma, f.unit(0))).toBeGreaterThan(0);
    f.sim.debug.kill(f.gamma);
    f.run(2); // knocked out in the first tick's damage stage, the aura gone the next
    expect(f.champ().auraTicks).toBe(0);
  });
});

describe('the Gamma bot', () => {
  const botUlt = (units: Spot[]) => {
    const f = field(units);
    f.sim.debug.fillUltimate(f.gamma);
    f.run();
    const bot = createBot(0, Blue, () => f.config, () => f.sim.lanes, f.sim.rng.ai);
    return bot.command(f.sim.snapshot(), f.sim.tick, f.gamma).ult;
  };

  it('casts Heat Wave with two allies and an enemy champion inside it', () => {
    expect(botUlt([{ x: 2, y: 0, team: Blue }, { x: -2, y: 0, team: Blue }, { x: 0, y: 5 }])).toBe(true);
  });

  it('holds it with no allies near', () => {
    expect(botUlt([{ x: 0, y: 5 }])).toBe(false);
  });
});
