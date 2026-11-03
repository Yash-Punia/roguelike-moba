import { describe, expect, it } from 'vitest';
import type { DamageEvent } from '../src/sim/events';
import { atan2, wrapAngle } from '../src/sim/math';
import { createSim, Team, type Command, type PlayerSetup } from '../src/sim/sim';
import { fixtureConfig } from './helpers';

const { Blue, Red } = Team;
const DEG = Math.PI / 180;

const cmd = (player: number, opts: { moveX?: number; moveY?: number; ult?: boolean } = {}): Command => ({
  tick: 0, player, moveX: opts.moveX ?? 0, moveY: opts.moveY ?? 0, ult: opts.ult ?? false, draftPick: -1, reroll: false,
});

/**
 * Open fixture map, waves off: Beta (player 0, Blue) at the origin facing +y, plus unarmed
 * Red Alphas at the given spots (`armed` ones fire back). Records damage, shots and channel ends.
 */
function field(enemies: { x: number; y: number; armed?: boolean }[], seed = 1) {
  const config = fixtureConfig();
  config.waves.enabled = false;
  const players: PlayerSetup[] = [{ team: Blue, championId: 'beta', spawnAt: { x: 0, y: 0 } }];
  for (const p of enemies) players.push({ team: Red, championId: 'alpha', spawnAt: { x: p.x, y: p.y }, unarmed: !p.armed });
  const sim = createSim(config, seed, players);
  const beta = sim.entityOf(0)!;
  const hits: (DamageEvent & { tick: number })[] = [];
  const shots: number[] = [];
  const ends: number[] = [];
  const run = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) {
      for (const ev of sim.step(commands).events) {
        if (ev.type === 'damage') hits.push({ ...ev, tick: sim.tick - 1 });
        if (ev.type === 'shot' && ev.id === beta) shots.push(sim.tick - 1);
        if (ev.type === 'channelEnd') ends.push(sim.tick - 1);
      }
    }
  };
  const def = config.champions.find((c) => c.id === 'beta')!;
  const storm = def.ultimate.id === 'leadStorm' ? def.ultimate : undefined!;
  const champ = () => sim.stores.champions.get(beta)!;
  /** Fills Beta's Ultimate with her SMG on a long cooldown (so only the storm deals damage), then casts. */
  const cast = () => {
    sim.stores.weapons.get(beta)!.cooldown = 10_000;
    sim.debug.fillUltimate(beta);
    run(1, [cmd(0, { ult: true })]);
  };
  const dealt = (target: number, from = 0) => hits.filter((h) => h.source === beta && h.target === target && h.tick >= from).reduce((s, h) => s + h.amount, 0);
  return { sim, config, def, storm, beta, hits, shots, ends, run, champ, cast, dealt, enemy: (i: number) => sim.entityOf(i + 1)! };
}

describe('Burst SMG', () => {
  it('fires bursts of 4 bullets 2 ticks apart every 0.85 s, 96 damage each at point blank', () => {
    const f = field([{ x: 0, y: 3 }]);
    f.run(80);
    const first = f.shots.slice(0, 8);
    expect(first.slice(1, 4).map((t, i) => t - first[i]!)).toEqual([2, 2, 2]);
    expect(first[4]! - first[0]!).toBe(f.def.weapon.interval); // 0.85 s → 26 ticks
    const burst = f.hits.filter((h) => h.source === f.beta && h.tick < first[4]!);
    expect(burst.reduce((s, h) => s + h.amount, 0)).toBe(96);
  });

  it('spreads each bullet within ±4°, the same way for the same seed', () => {
    const angles = (seed: number) => {
      const f = field([{ x: 0, y: 5 }], seed);
      const out: number[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < 120; i++) {
        f.run();
        for (const p of f.sim.snapshot().projectiles) {
          if (seen.has(p.id) || p.team !== Blue) continue;
          seen.add(p.id);
          out.push(atan2(p.vy, p.vx));
        }
      }
      return out;
    };
    const a = angles(3);
    expect(a.length).toBeGreaterThanOrEqual(16);
    for (const x of a) expect(Math.abs(wrapAngle(x - Math.PI / 2))).toBeLessThanOrEqual(4 * DEG + 1e-9);
    expect(new Set(a.map((x) => x.toFixed(6))).size).toBeGreaterThan(4);
    expect(angles(3)).toEqual(a);
    expect(angles(4)).not.toEqual(a);
  });
});

describe('Light Feet', () => {
  it('adds +20% move speed after 2 s out of combat, and drops it within a tick of a hit', () => {
    const f = field([{ x: 0, y: 30, armed: true }]);
    const m = () => f.sim.stores.motions.get(f.beta)!;
    f.run(60); // ticks 0–59: under 2 s since the start
    expect(m().speed).toBeCloseTo(5.7);
    f.run();
    expect(m().speed).toBeCloseTo(5.7 * 1.2);
    expect(f.sim.snapshot().entities.find((e) => e.id === f.beta)!.traitActive).toBe(true);
    // Walk into the Alpha's range until she is shot.
    let guard = 0;
    while (!f.hits.some((h) => h.target === f.beta) && guard++ < 300) f.run(1, [cmd(0, { moveY: 127 })]);
    f.run();
    expect(m().speed).toBeCloseTo(5.7);
  });
});

describe('Lead Storm', () => {
  it('shows the strip for 0.5 s, then hits and slows everything in its line for 3 s, and nothing outside', () => {
    // In the strip: straight ahead and off to one side. Outside: beyond its end, and wide of it.
    const f = field([{ x: 0, y: 5 }, { x: 1.6, y: 8 }, { x: 0, y: 12 }, { x: 4, y: 5 }]);
    f.cast();
    const from = f.sim.tick;
    f.run(f.storm.windupSeconds);
    expect(f.hits.filter((h) => h.source === f.beta)).toHaveLength(0);
    f.run(f.storm.seconds);
    const full = 12 * 20 * 3; // per GDD §7: 20 bullets/s × 12 for 3 s at level 1
    expect(f.dealt(f.enemy(0), from)).toBeCloseTo(full);
    expect(f.dealt(f.enemy(1), from)).toBeCloseTo(full);
    expect(f.dealt(f.enemy(2), from)).toBe(0);
    expect(f.dealt(f.enemy(3), from)).toBe(0);
    expect(f.ends).toEqual([f.sim.tick - 1]);
    expect(f.champ().channelTicks).toBe(0);
  });

  it('slows enemies in the line by 35% and moves Beta at 70% meanwhile', () => {
    const f = field([{ x: 0, y: 5 }]);
    f.cast();
    f.run(f.storm.windupSeconds + 3);
    f.run(1, [cmd(0, { moveX: 127 }), cmd(1, { moveX: 127 })]);
    expect(f.sim.stores.motions.get(f.beta)!.vx).toBeCloseTo(5.7 * 0.7);
    expect(f.sim.stores.motions.get(f.enemy(0))!.vx).toBeCloseTo(5 * 0.65);
    expect(f.sim.snapshot().entities.find((e) => e.id === f.enemy(0))!.slowed).toBe(true);
  });

  it('turns towards its target at up to 90° per second', () => {
    const f = field([{ x: 0, y: 5 }]);
    f.cast();
    expect(f.champ().channelAngle).toBeCloseTo(Math.PI / 2);
    Object.assign(f.sim.stores.transforms.get(f.enemy(0))!, { x: 5, y: 0 });
    f.run();
    expect(f.champ().channelAngle).toBeCloseTo(Math.PI / 2 - 3 * DEG);
    f.run(29);
    expect(f.champ().channelAngle).toBeCloseTo(0);
  });

  it('stops when Beta is knocked out, and ignores a second press while channelling', () => {
    const f = field([{ x: 0, y: 5 }]);
    f.cast();
    f.run(20);
    const left = f.champ().channelTicks;
    f.sim.debug.fillUltimate(f.beta);
    f.run(1, [cmd(0, { ult: true })]);
    expect(f.champ().ultCharge).toBe(100);
    expect(f.champ().channelTicks).toBe(left - 1);
    f.sim.debug.kill(f.beta);
    f.run();
    const at = f.hits.length;
    f.run(30);
    expect(f.champ().channelTicks).toBe(0);
    expect(f.ends).toHaveLength(1);
    expect(f.hits.filter((h, i) => i >= at && h.source === f.beta)).toHaveLength(0);
  });

  it('holds the SMG while channelling', () => {
    const f = field([{ x: 0, y: 5 }]);
    f.sim.debug.fillUltimate(f.beta);
    f.run(1, [cmd(0, { ult: true })]); // the SMG is ready: the cast tick may still fire
    const castTick = f.sim.tick - 1;
    f.run(f.storm.windupSeconds + f.storm.seconds - 1);
    expect(f.shots.filter((t) => t > castTick)).toEqual([]);
    f.run(40);
    expect(f.shots.filter((t) => t > castTick).length).toBeGreaterThan(0); // and fires again after
  });
});
