import { describe, expect, it } from 'vitest';
import type { Config } from '../src/data/schema';
import { createSim, Team, type Command } from '../src/sim/sim';
import { fixtureConfig, raiseGround } from './helpers';

const base = fixtureConfig();
/** Alpha's tuned move speed (data/champions.json), so tuning never breaks these tests. */
const speed = base.champions[0]!.moveSpeed;

/** The open map, optionally with a block of raised ground over x0..x1, y0..y1 (lane paths dropped so they don't fill it). */
function withWall(wall?: [number, number, number, number]): Config {
  const c = structuredClone(base);
  if (!wall) return c;
  raiseGround(c, ...wall);
  c.map.walkable = c.map.walkable.filter((s) => s.shape !== 'path');
  c.map.lanes = [];
  c.waves.enabled = false;
  return c;
}

const move = (moveX: number, moveY: number): Command => ({
  tick: 0, player: 0, moveX, moveY, ult: false, draftPick: -1, reroll: false,
});

function run(config: Config, cmd: Command, ticks: number, team: Team.Blue | Team.Red = Team.Blue) {
  const sim = createSim(config, 1, [{ team, championId: 'alpha' }]);
  for (let i = 0; i < ticks; i++) sim.step([cmd]);
  return sim.snapshot().entities[0]!;
}

describe('movement', () => {
  const open = withWall();
  const spawn = base.map.spawn.blue;

  it('moves at move speed (speed m in 1 s)', () => {
    const e = run(open, move(0, 127), 30);
    expect(e.y - spawn.y).toBeCloseTo(speed, 5);
    expect(e.x).toBeCloseTo(spawn.x);
    expect(e.facing).toBeCloseTo(Math.PI / 2);
  });

  it('never exceeds move speed on a diagonal command', () => {
    const e = run(open, move(127, 127), 30);
    expect(Math.hypot(e.x - spawn.x, e.y - spawn.y)).toBeCloseTo(speed, 5);
  });

  it('stops at a wall face', () => {
    // Wall spans y -40.5..-39.5 straight ahead of the (0, -42) spawn.
    const e = run(withWall([-2, 2, -40.5, -39.5]), move(0, 127), 60);
    expect(e.y).toBeLessThanOrEqual(-41 + 1e-6);
    expect(e.y).toBeGreaterThan(-41.01);
  });

  it('slides along a wall when pushing diagonally into it', () => {
    const e = run(withWall([-10, 10, -40.5, -39.5]), move(90, 90), 60);
    expect(e.y).toBeLessThanOrEqual(-41 + 1e-6);
    expect(e.x - spawn.x).toBeGreaterThan(3);
  });

  it('is clamped inside the map edge', () => {
    const e = run(open, move(-127, 0), 300);
    expect(e.x).toBeCloseTo(base.map.bounds.minX + 0.5);
  });

  it('applies a live moveSpeed change on the next tick', () => {
    const sim = createSim(open, 1, [{ team: Team.Blue, championId: 'alpha' }]);
    const faster = structuredClone(open);
    faster.champions[0]!.moveSpeed = 7;
    sim.setConfig(faster);
    for (let i = 0; i < 30; i++) sim.step([move(0, 127)]);
    expect(sim.snapshot().entities[0]!.y - spawn.y).toBeCloseTo(7, 5);
  });

  it('moves a Red champion towards -y on a -y command', () => {
    const e = run(open, move(0, -127), 30, Team.Red);
    expect(e.y - base.map.spawn.red.y).toBeCloseTo(-speed, 5);
  });
});

describe('fords (D-069)', () => {
  it('slows a unit wading a ford by fordSlowPct', () => {
    const c = structuredClone(base);
    const spawn = c.map.spawn.blue;
    c.map.fordSlowPct = 0.2;
    // A ford strip over the first 5 m ahead of the spawn.
    c.map.walkable.push({ id: 'ford', shape: 'rect', surface: 'ford', height: 0, x: spawn.x, y: spawn.y + 2.5, w: 4, h: 6 });
    const e = run(c, move(0, 127), 30);
    expect(e.y - spawn.y).toBeCloseTo(speed * 0.8, 5);
  });

  it('blocks river cells for movement', () => {
    const c = structuredClone(base);
    const spawn = c.map.spawn.blue;
    c.map.walkable.push({ id: 'river', shape: 'rect', surface: 'river', height: 0, x: 0, y: spawn.y + 3, w: 200, h: 1 });
    const e = run(c, move(0, 127), 60);
    expect(e.y).toBeLessThan(spawn.y + 2.5);
  });
});
