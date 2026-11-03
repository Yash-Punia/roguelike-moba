import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import type { Config } from '../src/data/schema';
import { buildGrid, rayBlocked, zoneAt, type ObstacleGrid } from '../src/sim/grid';
import { Team } from '../src/sim/sim';
import { arena, reachable } from './helpers';

/** A trench floor x 3..13, y 1..7 on the open test map (zone 4: x > 0, y > 0). */
const withTrench = (c: Config) => {
  c.map.walkable.push({ id: 'trench', shape: 'rect', surface: 'trench', height: 0, x: 8, y: 4, w: 10, h: 6 });
};

describe('trench zones', () => {
  it('marks trench and room floors by quadrant, nothing else', () => {
    const { sim } = arena([], withTrench);
    expect(zoneAt(sim.grid, 8, 4)).toBe(4);
    expect(zoneAt(sim.grid, 0, 0)).toBe(0);
    const g = buildGrid(parseConfig(rawConfig).map);
    expect(zoneAt(g, -9, -56)).toBe(1); // M1 medkit room, Blue left
    expect(zoneAt(g, 18, -17)).toBe(2); // S2 sniper nest, Blue right
    expect(zoneAt(g, -14.5, 35)).toBe(0); // Halftrack arena: no concealment
    expect(zoneAt(g, 0, 0)).toBe(0); // the Crater
  });
});

describe('concealment (GDD §4, TDD §6.9)', () => {
  it('an enemy champion in a trench is not auto-targeted from outside it', () => {
    const { sim, step, move } = arena([{ team: Team.Red, x: 8, y: 4 }], withTrench);
    move(1, 3, 0); // 6.4 m away: in range, outside the trench, beyond 3 m
    expect(step(5)).toBe(0);
    move(2, 8, -1); // out of the trench
    expect(step(5)).toBe(2);
    expect(sim.snapshot().entities.find((e) => e.id === 2)!.visibleMask & (1 << Team.Blue)).not.toBe(0);
  });

  it('is seen by an enemy within 3 m or in the same zone', () => {
    const { step, move } = arena([{ team: Team.Red, x: 8, y: 2.5 }], withTrench);
    move(1, 3, -1); // outside the trench, 6.1 m: hidden
    expect(step(5)).toBe(0);
    move(1, 8, 0); // outside the trench, 2.5 m
    expect(step(5)).toBe(2);
    move(1, 3, -1);
    expect(step(5)).toBe(0);
    move(1, 12, 6); // in the same zone, 5.3 m
    expect(step(5)).toBe(2);
  });

  it('firing reveals for exactly 1 s (30 ticks)', () => {
    const { sim, step, move } = arena([{ team: Team.Red, x: 8, y: 4, armed: true }], withTrench);
    move(1, 0, -30); // far out of everyone's range
    const seen = () => (sim.stores.concealments.get(2)!.visible & (1 << Team.Blue)) !== 0;
    step(1);
    expect(seen()).toBe(false);
    sim.stores.weapons.get(2)!.lastShotTick = sim.tick - 1; // fired last tick
    for (let i = 0; i < 30; i++) {
      step(1);
      expect(seen()).toBe(true);
    }
    step(1);
    expect(seen()).toBe(false);
  });

  it('casting or channelling an Ultimate reveals', () => {
    const { sim, step, move } = arena([{ team: Team.Red, x: 8, y: 4 }], withTrench);
    move(1, 0, -30);
    const seen = () => (sim.stores.concealments.get(2)!.visible & (1 << Team.Blue)) !== 0;
    const red = sim.stores.champions.get(2)!;
    step(1);
    red.lastCastTick = sim.tick - 1; // cast last tick
    step(1);
    expect(seen()).toBe(true);
    step(30);
    expect(seen()).toBe(false);
    red.channelTicks = 10;
    step(1);
    expect(seen()).toBe(true);
  });

  it('a Sub-base does not shoot a champion hidden in a trench', () => {
    const { sim, step, move } = arena(
      [{ team: Team.Red, x: 5, y: 2 }, { team: Team.Blue, x: 2, y: -3, structure: 'subBase', armed: true }],
      withTrench,
    );
    move(1, 0, -30);
    const tower = sim.stores.structures.ids[0]!;
    step(10);
    expect(sim.stores.targetings.get(tower)!.targetId).toBe(0);
    move(2, 5, 0); // out of the trench
    step(10);
    expect(sim.stores.targetings.get(tower)!.targetId).toBe(2);
  });
});

describe('sandbags (blocksShots)', () => {
  it('the ray march stops at a shot-blocking cell', () => {
    const { sim } = arena([], (c) => c.map.obstacles.push({ kind: 'sandbag', x: 0, y: 2.5, w: 4, h: 0.5 }));
    const at = rayBlocked(sim.grid, 0, 0, 0, 5);
    expect(at).toBeCloseTo(0.4); // the wall's cells span y 2–3
    expect(rayBlocked(sim.grid, 3, 0, 3, 5)).toBe(-1);
  });

  it('bullets stop at a sandbag wall: the unit behind it takes no damage', () => {
    const { step, hp, shots } = arena([{ team: Team.Red, x: 0, y: 5 }], (c) => c.map.obstacles.push({ kind: 'sandbag', x: 0, y: 2.5, w: 4, h: 0.5 }));
    step(90);
    expect(shots()).toBeGreaterThan(0);
    expect(hp(2)).toBe(1000);
  });
});

describe('medkits', () => {
  it('heals 25% of max HP, is gone for 45 s, and is left alone at full HP', () => {
    const { sim, step, move, hp } = arena([], (c) => {
      c.map.medkits = [{ x: 0, y: 3 }];
    });
    step(1);
    expect(sim.snapshot().medkits[0]!.ready).toBe(true);
    move(1, 0, 3);
    step(5);
    expect(hp(1)).toBe(1000); // full HP: not taken
    expect(sim.snapshot().medkits[0]!.ready).toBe(true);
    hp(1, 500);
    let taken = 0;
    for (const ev of sim.step([]).events) if (ev.type === 'medkitTaken') taken++;
    expect(taken).toBe(1);
    expect(hp(1)).toBe(750);
    expect(sim.snapshot().medkits[0]!.ready).toBe(false);
    hp(1, 500);
    step(45 * 30 - 2);
    expect(hp(1)).toBe(500);
    step(2);
    expect(hp(1)).toBe(750);
  });
});

describe('The Front sandbags', () => {
  /** Blocked grown by one cell, so a 0.5–0.6 m champion fits through what stays open. */
  const dilated = (g: ObstacleGrid): ObstacleGrid => {
    const blocked = new Uint8Array(g.blocked.length);
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        for (let dr = -1; dr <= 1 && !blocked[r * g.cols + c]; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr >= 0 && cc >= 0 && rr < g.rows && cc < g.cols && g.blocked[rr * g.cols + cc]) blocked[r * g.cols + c] = 1;
          }
        }
      }
    }
    return { ...g, blocked };
  };

  it('stop shots and leave every trench passable for a champion', () => {
    const map = parseConfig(rawConfig).map;
    const g = buildGrid(map);
    expect(g.shotBlocked.some((v) => v === 1)).toBe(true);
    const d = dilated(g);
    const rooms = map.walkable.filter((s) => s.id.startsWith('room-'));
    for (const s of map.walkable) {
      if (s.shape !== 'path' || s.surface !== 'trench') continue;
      for (const p of s.points) {
        if (rooms.some((r) => r.shape === 'circle' && r.x === p.x && r.y === p.y)) continue; // room centres: below
        expect(reachable(d, map.spawn.blue, p), `${s.id} (${p.x}, ${p.y})`).toBe(true);
      }
    }
    for (const r of rooms) {
      if (r.shape !== 'circle') continue;
      const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: r.x + dx! * (r.r - 1), y: r.y + dy! * (r.r - 1) }));
      expect(near.some((p) => reachable(d, map.spawn.blue, p)), r.id).toBe(true);
    }
  });
});
