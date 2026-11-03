import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { createBot } from '../src/sim/bots/bot';
import type { SimEvent } from '../src/sim/events';
import { matchSlots } from '../src/sim/match-setup';
import { createSim, Kind, Team, type Command } from '../src/sim/sim';
import { arena, withPowers } from './helpers';

const { Blue, Red } = Team;

/** The real data on The Front, with one idle Blue Alpha. */
function front(tweak?: (c: ReturnType<typeof parseConfig>) => void) {
  const config = parseConfig(rawConfig);
  tweak?.(config);
  const sim = createSim(config, 1, [{ team: Blue, championId: 'alpha' }]);
  const structure = (team: Team, kind: 'hq' | 'subBase', lane?: string) =>
    sim.stores.structures.ids.find((e) => {
      const st = sim.stores.structures.get(e)!;
      return sim.stores.teams.get(e) === team && st.kind === kind && (lane === undefined || st.lane === lane);
    })!;
  return { config, sim, structure };
}

describe('HQ max HP per lost Sub-base (D-051)', () => {
  it('drops by 25% of its base for every Sub-base its team loses, keeping its HP fraction', () => {
    const f = front();
    const hq = f.sim.stores.healths.get(f.structure(Blue, 'hq'))!;
    expect(hq.maxHp).toBe(6000);
    hq.hp = 3000;
    f.sim.debug.kill(f.structure(Blue, 'subBase', 'left'));
    f.sim.step([]);
    expect([hq.maxHp, hq.hp]).toEqual([4500, 2250]);
    f.sim.debug.kill(f.structure(Blue, 'subBase', 'centre'));
    f.sim.debug.kill(f.structure(Blue, 'subBase', 'right'));
    f.sim.step([]);
    expect([hq.maxHp, hq.hp]).toEqual([1500, 750]);
    // The other team's HQ is untouched.
    expect(f.sim.stores.healths.get(f.structure(Red, 'hq'))!.maxHp).toBe(6000);
  });
});

describe('waves from the caves (D-051)', () => {
  it('start every lane route at the cave mouth behind each HQ', () => {
    const f = front();
    for (const lane of f.sim.lanes) {
      for (const b of lane.branches) {
        expect([b[0], b[1]]).toEqual([0, -80]);
        expect([b[b.length - 2], b[b.length - 1]]).toEqual([0, 80]);
      }
    }
    expect(f.config.map.caves.map((c) => [c.team, c.x, c.y])).toEqual([['blue', 0, -81], ['red', 0, 81]]);
  });

  it('make a lane Shock Troops once its enemy Sub-base falls: ×3 HP and damage', () => {
    const f = front();
    f.sim.debug.kill(f.structure(Red, 'subBase', 'left'));
    let guard = 0;
    while (!f.sim.snapshot().entities.some((e) => e.kind === Kind.Minion) && guard++ < 400) f.sim.step([]);
    const scale = 1 + (0.25 * (f.sim.tick - 1)) / 1800;
    const soldiers = f.sim.snapshot().entities.filter((e) => e.kind === Kind.Minion);
    const hp = (team: Team, lane: string) => soldiers.find((e) => e.team === team && e.lane === lane)!.maxHp;
    expect(hp(Blue, 'left')).toBeCloseTo(300 * scale * 3);
    expect(hp(Red, 'left')).toBeCloseTo(300 * scale);
    expect(hp(Blue, 'centre')).toBeCloseTo(300 * scale);
  });
});

describe('draft spacing (D-051)', () => {
  it('offers a card every second level', () => {
    const a = arena([], (c) => {
      withPowers(c);
      c.powers.draft.levelsPerOffer = 2;
    });
    const offers: SimEvent[] = [];
    for (let level = 2; level <= 5; level++) {
      a.sim.debug.levelUp(a.shooter);
      for (const ev of a.sim.step([]).events) if (ev.type === 'draftOffered') offers.push({ ...ev });
    }
    expect(offers).toHaveLength(2); // levels 3 and 5
  });
});

describe('match length (D-051)', () => {
  it('an all-bot 3v3 on The Front ends with an HQ down inside 6 minutes', () => {
    const config = parseConfig(rawConfig);
    const slots = matchSlots(config, { teamSize: 3, localTeam: Blue });
    const sim = createSim(config, 1, slots);
    const bots = slots.map((s, pl) => ({ bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane), e: sim.entityOf(pl)! }));
    let snap = sim.snapshot();
    let over = false;
    while (!over && sim.tick < 6 * 60 * 30) {
      const commands: Command[] = bots.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) }));
      for (const ev of sim.step(commands).events) if (ev.type === 'matchOver') over = true;
      snap = sim.snapshot();
    }
    expect(over).toBe(true);
  }, 30_000);
});
