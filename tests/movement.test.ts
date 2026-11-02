import { describe, expect, it } from 'vitest';
import type { Config } from '../src/data/schema';
import { createSim, Team, type Command } from '../src/sim/sim';
import { fixtureConfig } from './helpers';

const base = fixtureConfig();

function withObstacles(obstacles: Config['map']['obstacles']): Config {
  const c = structuredClone(base);
  c.map.obstacles = obstacles;
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
  const open = withObstacles([]);
  const spawn = base.map.spawn.blue;

  it('moves at move speed (3.5 m in 1 s)', () => {
    const e = run(open, move(0, 127), 30);
    expect(e.y - spawn.y).toBeCloseTo(3.5, 5);
    expect(e.x).toBeCloseTo(spawn.x);
    expect(e.facing).toBeCloseTo(Math.PI / 2);
  });

  it('never exceeds move speed on a diagonal command', () => {
    const e = run(open, move(127, 127), 30);
    expect(Math.hypot(e.x - spawn.x, e.y - spawn.y)).toBeCloseTo(3.5, 5);
  });

  it('stops at a wall face', () => {
    // Wall spans y -40.5..-39.5 straight ahead of the (0, -42) spawn.
    const e = run(withObstacles([{ kind: 'sandbag', x: 0, y: -40, w: 4, h: 1 }]), move(0, 127), 60);
    expect(e.y).toBeLessThanOrEqual(-41 + 1e-6);
    expect(e.y).toBeGreaterThan(-41.01);
  });

  it('slides along a wall when pushing diagonally into it', () => {
    const e = run(withObstacles([{ kind: 'sandbag', x: 0, y: -40, w: 20, h: 1 }]), move(90, 90), 60);
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
    expect(e.y - base.map.spawn.red.y).toBeCloseTo(-3.5, 5);
  });
});
