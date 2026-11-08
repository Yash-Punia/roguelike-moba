import { describe, expect, it } from 'vitest';
import type { Config } from '../src/data/schema';
import { createBot } from '../src/sim/bots/bot';
import { bestCard } from '../src/sim/systems/draft';
import { createSim, Team, type Command, type Snapshot, type TelegraphSnapshot } from '../src/sim/sim';
import { arena, fixtureConfig } from './helpers';

const { Blue, Red } = Team;

/** Bot dodge numbers pinned (D-085); the fixture's open lane, no hesitation. */
function pinDodge(c: Config, chance = 1, reaction = 0) {
  c.bots.hesitation.chancePerSecond = 0;
  c.bots.dodge = { margin: 0.3 };
  Object.assign(c.bots.difficulty.normal, { dodgeChancePct: chance, reactionSeconds: reaction });
}

/** A Blue Alpha bot at (0, −30) on the open lane; Red far up the lane. `danger` is added to every snapshot it reads. */
function lone(tweak?: (c: Config) => void) {
  const config = fixtureConfig();
  config.waves.enabled = false;
  pinDodge(config);
  tweak?.(config);
  const sim = createSim(config, 1, [
    { team: Blue, championId: 'alpha', spawnAt: { x: 0, y: -30 } },
    { team: Red, championId: 'alpha', spawnAt: { x: 0, y: 40 } },
  ]);
  const bot = createBot(0, Blue, () => config, () => sim.lanes, sim.rng.ai);
  const e = sim.entityOf(0)!;
  const danger: TelegraphSnapshot[] = [];
  const at = () => sim.stores.transforms.get(e)!;
  /** One tick: the bot reads the snapshot plus `danger`, and its command is stepped. */
  const tick = () => {
    const snap = sim.snapshot() as Snapshot;
    snap.telegraphs.push(...danger);
    const cmd = { ...bot.command(snap, sim.tick, e) };
    sim.step([cmd]);
    return cmd;
  };
  return { config, sim, bot, e, danger, at, tick };
}

const mark = (m: Partial<TelegraphSnapshot>): TelegraphSnapshot => ({
  team: Red, shape: 'circle', x: 0, y: 0, angle: 0, radius: 2, arc: 0, length: 0, width: 0, anchor: 0, elapsed: 0, total: 30, ...m,
});

describe('bots dodge telegraphs (D-085)', () => {
  it('steps out of a circle away from its centre', () => {
    const f = lone();
    f.danger.push(mark({ x: 0.8, y: -30, total: 40 }));
    for (let i = 0; i < 25; i++) f.tick();
    expect(f.at().x).toBeLessThan(0.8 - 2 - 0.5 + 0.01);
  });

  it('steps sideways out of a strip and a cone, to the side it is on', () => {
    for (const m of [
      mark({ shape: 'strip', x: 0.3, y: -40, angle: Math.PI / 2, length: 20, width: 2.4 }),
      mark({ shape: 'cone', x: 0.4, y: -36, angle: Math.PI / 2, radius: 8, arc: Math.PI / 3 }),
    ]) {
      const f = lone();
      f.danger.push(m);
      const cmd = f.tick();
      expect(f.bot.dodging).toBe(true);
      expect(cmd.moveX).toBeLessThan(0); // it stands west of the axis
      expect(Math.abs(cmd.moveY)).toBeLessThan(5);
    }
  });

  it('waits its reaction time first, and gives up a dodge it cannot finish before impact', () => {
    const slow = lone((c) => pinDodge(c, 1, 10));
    slow.danger.push(mark({ x: 0.8, y: -30, total: 40 }));
    for (let i = 0; i < 10; i++) {
      slow.tick();
      expect(slow.bot.dodging).toBe(false);
    }
    slow.tick();
    expect(slow.bot.dodging).toBe(true);

    const late = lone();
    late.danger.push(mark({ x: 0, y: -30, radius: 3, elapsed: 28, total: 30 })); // 2 ticks to cover 3.8 m
    late.tick();
    expect(late.bot.dodging).toBe(false);
  });

  it('takes the far way out when a wall blocks the near one', () => {
    const f = lone();
    const g = f.sim.grid;
    const blocked = g.blocked.slice();
    // A wall 1 to 1.6 m west of the bot, before the near way out at x = -2, the whole height of the map.
    for (let c = Math.floor((-1.6 - g.minX) / g.cell); c <= Math.floor((-1 - g.minX) / g.cell); c++) for (let r = 0; r < g.rows; r++) blocked[r * g.cols + c] = 1;
    const walled = createBot(0, Blue, () => f.config, () => f.sim.lanes, f.sim.rng.ai, 'centre', undefined, () => ({ ...g, blocked }));
    const snap = f.sim.snapshot();
    snap.telegraphs.push(mark({ x: 0.8, y: -30, total: 40 })); // the near way out is west, into the wall
    const cmd = walled.command(snap, f.sim.tick, f.e);
    expect(walled.dodging).toBe(true);
    expect(cmd.moveX).toBeGreaterThan(0);
  });

  it('ignores its own team’s markers, and never dodges at 0%', () => {
    const own = lone();
    own.danger.push(mark({ team: Blue, x: 0.8, y: -30 }));
    own.tick();
    expect(own.bot.dodging).toBe(false);
    const never = lone((c) => pinDodge(c, 0));
    never.danger.push(mark({ x: 0.8, y: -30 }));
    for (let i = 0; i < 20; i++) never.tick();
    expect(never.bot.dodging).toBe(false);
  });

  it('takes no Field Gun shell while dodging every time, and is shelled when it never dodges', () => {
    const hits = (chance: number) => {
      const a = arena([], (c) => {
        pinDodge(c, chance);
        c.neutrals.resetSeconds = 120;
        c.neutrals.camps.fieldGun = {
          name: 'Field Gun', firstSpawnSeconds: 0, respawnSeconds: 2700, xp: 250, ultCharge: 15,
          unit: { maxHp: 1e6, radius: 1.2, moveSpeed: 0 },
          boss: { pattern: { kind: 'shells', range: 12, intervalSeconds: 75, targets: 2, flightSeconds: 24, damage: 240, radius: 2, arcHeight: 6 }, artilleryWaves: 0 },
        };
        c.map.camps = [{ id: 'FG', kind: 'fieldGun', x: 0, y: 20, count: 1 }];
        c.map.walkable.push({ id: 'arena-test', shape: 'circle', surface: 'arena', x: 0, y: 20, r: 8, height: 0 });
      });
      const bot = createBot(0, Blue, () => a.config, () => a.sim.lanes, a.sim.rng.ai);
      a.move(a.shooter, 0, 14);
      let taken = 0;
      for (let i = 0; i < 4 * 75 + 30; i++) {
        const cmd: Command = { ...bot.command(a.sim.snapshot(), a.sim.tick, a.shooter) };
        if (!bot.dodging) {
          // Between dodges it walks back to its spot, like a player holding position.
          const t = a.sim.stores.transforms.get(a.shooter)!;
          const dx = 0 - t.x;
          const dy = 14 - t.y;
          const d = Math.hypot(dx, dy);
          cmd.moveX = d > 0.2 ? Math.round((dx / d) * 127) : 0;
          cmd.moveY = d > 0.2 ? Math.round((dy / d) * 127) : 0;
        }
        for (const ev of a.sim.step([cmd]).events) if (ev.type === 'damage' && ev.source === a.sim.stores.neutrals.ids[0] && ev.target === a.shooter) taken += ev.amount;
      }
      return taken;
    };
    expect(hits(1)).toBe(0); // the same setup that takes 720+ below
    expect(hits(0)).toBeGreaterThanOrEqual(3 * 240);
  }, 30_000);
});

describe('bots draft (D-085)', () => {
  it('weighs tags per champion: Alpha takes damage, Gamma takes HP', () => {
    const c = fixtureConfig();
    const w = c.bots.draft.tagWeights;
    const cards = ['fieldRations', 'hollowPoints'];
    expect(bestCard(c.powers, {}, cards, w.alpha, 1)).toBe(1);
    expect(bestCard(c.powers, {}, cards, w.gamma, 1)).toBe(0);
    // Synergy: a Gamma owning Incendiary Rounds leans to the burn card over plain damage.
    expect(bestCard(c.powers, { incendiaryRounds: 1 }, ['hollowPoints', 'napalmTank'], w.gamma, 1)).toBe(1);
  });

  it('picks its best card 1–3 s after an offer, before the timer would', () => {
    const f = lone();
    f.sim.debug.giveXp(f.e, 100); // level 2: an offer
    let offered = -1;
    let picked: { tick: number; power: string; auto: boolean } | undefined;
    let cards: readonly string[] = [];
    for (let i = 0; i < 400 && !picked; i++) {
      const before = f.sim.tick;
      const snap = f.sim.snapshot();
      const me = snap.entities.find((x) => x.id === f.e)!;
      if (offered < 0 && me.draftCards.length) {
        offered = before;
        cards = [...me.draftCards];
      }
      const cmd = { ...f.bot.command(snap, before, f.e) };
      for (const ev of f.sim.step([cmd]).events) if (ev.type === 'powerPicked' && ev.id === f.e) picked = { tick: before, power: ev.power, auto: ev.auto };
    }
    expect(picked?.auto).toBe(false);
    expect(picked!.tick - offered).toBeGreaterThanOrEqual(30);
    expect(picked!.tick - offered).toBeLessThanOrEqual(91);
    expect(picked!.power).toBe(cards[bestCard(f.config.powers, {}, cards, f.config.bots.draft.tagWeights.alpha, f.config.bots.draft.synergy)]);
  });
});
