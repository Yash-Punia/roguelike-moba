import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { createSim, Kind, Team, type Command } from '../src/sim/sim';
import { reachable } from './helpers';

const config = parseConfig(rawConfig);
const sim = () => createSim(config, 1, [{ team: Team.Blue, championId: 'alpha' }]);

describe('centre lane structures', () => {
  it('spawns both HQs and both centre Sub-bases from the map spec', () => {
    const found = sim()
      .snapshot()
      .entities.filter((e) => e.kind !== Kind.Champion)
      .map((e) => ({ kind: e.kind, modelId: e.modelId, team: e.team, x: e.x, y: e.y }));
    expect(found).toEqual([
      { kind: Kind.HQ, modelId: 'hq', team: Team.Blue, x: 0, y: -72 },
      { kind: Kind.HQ, modelId: 'hq', team: Team.Red, x: 0, y: 72 },
      { kind: Kind.SubBase, modelId: 'subBase', team: Team.Blue, x: 1, y: -40 },
      { kind: Kind.SubBase, modelId: 'subBase', team: Team.Red, x: -1, y: 40 },
    ]);
  });

  it('gives champions their model id and kind', () => {
    const e = sim().snapshot().entities[0]!;
    expect([e.kind, e.modelId]).toEqual([Kind.Champion, 'alpha']);
  });

  it('faces each Sub-base towards the enemy side', () => {
    const subs = sim().snapshot().entities.filter((e) => e.kind === Kind.SubBase);
    expect(subs.map((e) => Math.sign(Math.sin(e.facing)))).toEqual([1, -1]);
  });

  it('blocks structure footprints but keeps the lane passable round them', () => {
    const s = sim();
    const blocked = (x: number, y: number) =>
      s.grid.blocked[Math.floor((y - s.grid.minY) / s.grid.cell) * s.grid.cols + Math.floor((x - s.grid.minX) / s.grid.cell)] === 1;
    expect(blocked(1, -40)).toBe(true);
    expect(blocked(-1, 40)).toBe(true);
    expect(blocked(0, -72)).toBe(true);
    expect(blocked(2.4, -73.9)).toBe(true); // HQ corner
    expect(reachable(s.grid, config.map.spawn.blue, config.map.spawn.red)).toBe(true);
  });

  it('stops a champion walking into a Sub-base', () => {
    const c = structuredClone(config);
    c.map.spawn.blue = { x: 1, y: -46 };
    const s = createSim(c, 1, [{ team: Team.Blue, championId: 'alpha' }]);
    const up: Command = { tick: 0, player: 0, moveX: 0, moveY: 127, ult: false, draftPick: -1, reroll: false };
    for (let i = 0; i < 90; i++) s.step([up]);
    // Footprints block by cell centre, so the wall sits within half a cell of the 1.6 m radius.
    const gap = -40 - s.snapshot().entities[0]!.y;
    expect(gap).toBeGreaterThanOrEqual(1.6 + 0.5 - 0.25 - 1e-6);
    expect(gap).toBeLessThanOrEqual(1.6 + 0.5 + 0.25);
  });

  it('moves a structure and its footprint on a live config edit', () => {
    const s = sim();
    const next = structuredClone(config);
    next.map.structures[2]!.x = 3;
    s.setConfig(next);
    const sub = s.snapshot().entities.find((e) => e.kind === Kind.SubBase)!;
    expect(sub.x).toBe(3);
    const col = Math.floor((3 - s.grid.minX) / s.grid.cell);
    const row = Math.floor((-40 - s.grid.minY) / s.grid.cell);
    expect(s.grid.blocked[row * s.grid.cols + col]).toBe(1);
  });
});
