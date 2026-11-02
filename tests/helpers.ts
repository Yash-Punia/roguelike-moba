import { parseConfig, rawConfig } from '../src/data/load';
import type { Config, RawConfig } from '../src/data/schema';
import { createSim, Team, type Command, type PlayerSetup } from '../src/sim/sim';
import type { ObstacleGrid } from '../src/sim/grid';
import openMap from './fixtures/map-open.json';

/** Shipped config on a fixed open test map (36 × 110 m, all walkable), so tests don't move when the real map does. */
export function fixtureConfig(): Config {
  return parseConfig({ ...rawConfig, map: openMap as RawConfig['map'] });
}

type Point = { x: number; y: number };

/** 4-connected flood fill over open grid cells: can a unit get from `from` to `to` at all? */
export function reachable(g: ObstacleGrid, from: Point, to: Point): boolean {
  const idx = (p: Point) => Math.floor((p.y - g.minY) / g.cell) * g.cols + Math.floor((p.x - g.minX) / g.cell);
  const goal = idx(to);
  const seen = new Uint8Array(g.blocked.length);
  const stack = [idx(from)];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    if (i === goal) return true;
    const c = i % g.cols;
    const next = [c > 0 ? i - 1 : -1, c < g.cols - 1 ? i + 1 : -1, i - g.cols, i + g.cols];
    for (const n of next) {
      if (n < 0 || n >= g.blocked.length || seen[n] || g.blocked[n]) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return false;
}

/** `armed` champions fire back; by default only the shooter (player 0) fires. */
export type Unit = { team: Team.Blue | Team.Red; x: number; y: number; structure?: 'subBase' | 'hq'; armed?: boolean };

/**
 * Open test map with Blue Alpha (player 0) at the origin plus the given units. Champions get
 * ids 1..n in order (player = id − 1), then structures. Tuning is pinned to the values the
 * combat tests are written against, so retuning data/ never breaks them: Alpha has a 7 m
 * range, 0.5 m radius, 95 damage every 25 ticks, 25 m/s bullets, 5 m/s move speed; lethal
 * saves last 45 ticks.
 */
export function arena(units: Unit[], tweak?: (c: Config) => void) {
  const config = fixtureConfig();
  const alpha = config.champions[0]!;
  Object.assign(alpha, { radius: 0.5, maxHp: 1000, moveSpeed: 5 });
  Object.assign(alpha.weapon, { damage: 95, interval: 25, range: 7, projectileSpeed: 25, spread: 0, targets: 1 });
  config.combat.targeting = { stickyRange: 0.5, sameClassSwitch: 1.5, tieBand: 0.5, overrideSeconds: 5, retargetPauseSeconds: 6 };
  config.combat.weapons = { aimTurnRate: 4 * Math.PI, fireCone: Math.PI / 18, bulletAim: 'lead', bulletRadius: 0.1, bulletOvershoot: 2 };
  config.combat.damage = { logSeconds: 240, lethalSaveSeconds: 45, critMultiplier: 2 };
  tweak?.(config);
  const players: PlayerSetup[] = [{ team: Team.Blue, championId: 'alpha', spawnAt: { x: 0, y: 0 } }];
  for (const u of units) {
    if (u.structure) {
      config.map.structures.push({ id: `s${config.map.structures.length}`, kind: u.structure, team: u.team === Team.Blue ? 'blue' : 'red', lane: undefined, x: u.x, y: u.y });
    } else {
      players.push({ team: u.team, championId: 'alpha', spawnAt: { x: u.x, y: u.y }, unarmed: !u.armed });
    }
  }
  const sim = createSim(config, 1, players);
  const shooter = sim.entityOf(0)!;
  const target = () => sim.stores.targetings.get(shooter)!.targetId;
  let shots = 0;
  /** Steps n ticks with the given commands; returns the shooter's target afterwards. */
  const step = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) {
      for (const ev of sim.step(commands).events) if (ev.type === 'shot' && ev.id === shooter) shots++;
    }
    return target();
  };
  const move = (id: number, x: number, y: number) => Object.assign(sim.stores.transforms.get(id)!, { x, y });
  const hp = (id: number, value?: number) => {
    const h = sim.stores.healths.get(id)!;
    if (value !== undefined) h.hp = value;
    return h.hp;
  };
  return { sim, config, shooter, step, move, hp, target, shots: () => shots };
}
