import { parseConfig, rawConfig } from '../src/data/load';
import type { Config, FragGrenadeConfig, RawConfig } from '../src/data/schema';
import { createSim, Team, type Command, type PlayerSetup } from '../src/sim/sim';
import type { ObstacleGrid } from '../src/sim/grid';
import openMap from './fixtures/map-open.json';

/**
 * Shipped config on a fixed open test map (36 × 110 m, all walkable), so tests don't move when
 * the real map does. The level table, draft spacing and structure stats stay pinned to the
 * values the tests were written against (D-051 retuned them for 5-minute matches): 12 levels
 * with an offer every level, a 6000 HP Sub-base firing 200, a 10 000 HP HQ firing 300 that regenerates.
 */
export function fixtureConfig(): Config {
  const c = parseConfig({ ...rawConfig, map: openMap as RawConfig['map'] });
  c.progression.xpPerLevel = [100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300];
  c.powers.draft.levelsPerOffer = 1;
  Object.assign(c.structures.subBase, { maxHp: 6000 });
  Object.assign(c.structures.subBase.weapon, { damage: 200 });
  Object.assign(c.structures.hq, { maxHp: 10000, regen: true });
  Object.assign(c.structures.hq.weapon, { damage: 300 });
  return c;
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

/** Tweak for `arena`: the shipped power catalogue, for draft tests. */
export const withPowers = (c: Config) => {
  c.powers.powers = fixtureConfig().powers.powers;
};

/** `armed` champions fire back; by default only the shooter (player 0) fires. */
export type Unit = { team: Team.Blue | Team.Red; x: number; y: number; structure?: 'subBase' | 'hq'; armed?: boolean; /** Spawn on the team pad like a real champion (respawns there too). */ atPad?: boolean; /** HQ: keep the gate (invulnerable while its team's Sub-bases stand). */ shielded?: boolean };

/**
 * Open test map with Blue Alpha (player 0) at the origin plus the given units. Champions get
 * ids 1..n in order (player = id − 1), then structures. Tuning is pinned to the values the
 * combat tests are written against, so retuning data/ never breaks them: Alpha has a 7 m
 * range, 0.5 m radius, 95 damage every 25 ticks, 25 m/s bullets, 5 m/s move speed; lethal
 * saves last 45 ticks. Steady Hand is off (fire rate +0%); the Frag Grenade has a 9 m cast
 * range, 18-tick flight, 250 damage in 3 m and a 3 m fire pool doing 25 every 15 ticks for
 * 120 ticks (structures 50%); the Ultimate charges over 1,500 ticks.
 */
export function arena(units: Unit[], tweak?: (c: Config) => void) {
  const config = fixtureConfig();
  const alpha = config.champions[0]!;
  Object.assign(alpha, { radius: 0.5, maxHp: 1000, moveSpeed: 5 });
  Object.assign(alpha.weapon, { damage: 95, interval: 25, range: 7, projectileSpeed: 25, spread: 0, targets: 1 });
  // Steady Hand off unless a test turns it on, so shot counts stay at the plain fire rate.
  Object.assign(alpha.trait, { stillSeconds: 15, fireRatePct: 0 });
  const frag = alpha.ultimate as FragGrenadeConfig;
  Object.assign(frag, { castRange: 9, flightSeconds: 18, radius: 3, damage: 250, damagePerLevel: 20 });
  Object.assign(frag.zone, { radius: 3, seconds: 120, dps: 50, dpsPerLevel: 5, structurePct: 0.5, tickSeconds: 15 });
  alpha.ultChargeSeconds = 1500;
  config.combat.targeting = { stickyRange: 0.5, sameClassSwitch: 1.5, tieBand: 0.5, overrideSeconds: 5, retargetPauseSeconds: 6 };
  config.combat.weapons = { aimTurnRate: 4 * Math.PI, fireCone: Math.PI / 18, bulletAim: 'lead', bulletRadius: 0.1, bulletOvershoot: 2 };
  config.combat.damage = { logSeconds: 240, lethalSaveSeconds: 45, critMultiplier: 2 };
  config.match.respawn = { baseSeconds: 4, perLevelSeconds: 1.2, maxSeconds: 18 };
  config.match.spawnPad = { radius: 2.3, healPctPerSecond: 0.1 };
  // Structure rules: warm-up as in the GDD; backdoor protection and regen off unless a test turns them on.
  config.structures.rules = { warmupPct: 0.25, warmupMaxPct: 1, warmupResetSeconds: 90, backdoorRadius: 10, backdoorPct: 0, regenPctPerSecond: 0, regenClearRadius: 12, hqHpCutEnabled: false, hqHpPerSubBaseLostPct: 0 };
  // No draft offers unless a test restores the catalogue (`withPowers`), so level-ups in older tests change only stats.
  config.powers.powers = [];
  // Waves off unless a test turns them on; MG Soldier pinned to the GDD numbers.
  config.waves = { enabled: false, firstSeconds: 450, intervalSeconds: 750, soldiers: 3, spacing: 1.1, spawnGapSeconds: 18, scalePctPerMinute: 0, shockTroopsMult: 1, lanes: ['centre'] };
  config.units.mgSoldier = {
    name: 'MG Soldier', maxHp: 300, radius: 0.35, moveSpeed: 2.6,
    weapon: { kind: 'bullet', damage: 8, interval: 10, range: 5, projectileSpeed: 25, coneAngle: 0, spread: 0, targets: 1, burstCount: 1, burstGapSeconds: 1 },
    acquireRange: 7, leash: 6, callForHelp: { radius: 6, seconds: 90 },
  };
  tweak?.(config);
  const players: PlayerSetup[] = [{ team: Team.Blue, championId: 'alpha', spawnAt: { x: 0, y: 0 } }];
  for (const u of units) {
    if (u.structure) {
      config.map.structures.push({ id: `s${config.map.structures.length}`, kind: u.structure, team: u.team === Team.Blue ? 'blue' : 'red', lane: undefined, x: u.x, y: u.y });
    } else {
      players.push({ team: u.team, championId: 'alpha', spawnAt: u.atPad ? undefined : { x: u.x, y: u.y }, unarmed: !u.armed });
    }
  }
  const sim = createSim(config, 1, players);
  // Structures don't fire unless `armed`, and an HQ has no gate unless `shielded`, so the
  // combat tests written before structures fought back keep their numbers.
  const placed = units.filter((u) => u.structure);
  for (let i = 0; i < sim.stores.structures.ids.length; i++) {
    const e = sim.stores.structures.ids[i]!;
    const n = Number(sim.stores.structures.data[i]!.placement.slice(1)) - openMap.structures.length;
    const u = placed[n];
    if (!u) continue;
    if (!u.armed) sim.stores.weapons.remove(e);
    if (u.structure === 'hq' && !u.shielded) sim.stores.healths.get(e)!.invulnerable = false;
  }
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
