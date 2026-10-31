import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { fnv1a, mulberry32 } from '../src/sim/rng';
import { createSim, Team, type Command } from '../src/sim/sim';

const config = parseConfig(rawConfig);
const TICKS = 9000; // 5 minutes of match time

/** Scripted input log: each player changes stick direction every 15 ticks. */
function commandLog(seed: number): Command[][] {
  const rand = mulberry32(seed);
  const log: Command[][] = [];
  const sticks = [
    [0, 0],
    [0, 0],
  ];
  for (let tick = 0; tick < TICKS; tick++) {
    if (tick % 15 === 0) for (const s of sticks) [s[0], s[1]] = [Math.round(rand() * 254 - 127), Math.round(rand() * 254 - 127)];
    log.push(
      sticks.map(([moveX, moveY], player) => ({
        tick, player, moveX: moveX!, moveY: moveY!, ult: false, draftPick: -1, reroll: false,
      })),
    );
  }
  return log;
}

/** Runs a match headless and returns the state hash every 300 ticks. */
function run(seed: number, log: Command[][]): number[] {
  const sim = createSim(config, seed, [
    { team: Team.Blue, championId: 'alpha' },
    { team: Team.Red, championId: 'alpha' },
  ]);
  const hashes: number[] = [];
  for (const cmds of log) {
    sim.step(cmds);
    if (sim.tick % 300 === 0) hashes.push(fnv1a(JSON.stringify(sim.snapshot())));
  }
  return hashes;
}

describe('determinism', () => {
  it('same seed and commands give the same state hash every 300 ticks', () => {
    const log = commandLog(99);
    const a = run(1, log);
    const b = run(1, log);
    expect(a).toHaveLength(TICKS / 300);
    expect(b).toEqual(a);
  });

  it('different commands give a different match', () => {
    expect(run(1, commandLog(1)).at(-1)).not.toBe(run(1, commandLog(2)).at(-1));
  });
});
