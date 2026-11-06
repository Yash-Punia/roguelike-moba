import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import type { Config } from '../src/data/schema';
import type { SimEvent } from '../src/sim/events';
import { buildGrid, isBlocked } from '../src/sim/grid';
import { CampState } from '../src/sim/systems/camps';
import { Kind, Team } from '../src/sim/sim';
import { arena, type Unit } from './helpers';

const { Red } = Team;
const bullet = { kind: 'bullet' as const, coneAngle: 0, spread: 0, targets: 1, burstCount: 1, burstGapSeconds: 1, splashRadius: 0, vsStructuresPct: 0 };

/** Neutral tuning pinned to the GDD / NT-01 numbers (D-073), in ticks, so retuning data/ doesn't move these tests. */
function pinNeutrals(c: Config, camps: Config['map']['camps']) {
  c.neutrals = {
    leashRadius: 10, resetSeconds: 120, returnSpeedPct: 0.5, rewardRadius: 10, ringRadius: 1.2,
    camps: {
      deserter: { name: 'Deserter Squad', firstSpawnSeconds: 900, respawnSeconds: 1200, xp: 60, ultCharge: 5, unit: { maxHp: 350, radius: 0.35, moveSpeed: 2.6, weapon: { ...bullet, damage: 20, interval: 30, range: 5, projectileSpeed: 25 } } },
      sniper: { name: 'Sniper Nest', firstSpawnSeconds: 900, respawnSeconds: 1800, xp: 80, ultCharge: 8, unit: { maxHp: 300, radius: 0.35, moveSpeed: 0, weapon: { ...bullet, damage: 60, interval: 75, range: 9, projectileSpeed: 40 } } },
      fieldGun: c.neutrals.camps.fieldGun,
    },
  };
  c.map.camps = camps;
}

const SQUAD = { id: 'C1', kind: 'deserter' as const, x: 0, y: 20, count: 3 };
const NEST = { id: 'S1', kind: 'sniper' as const, x: 0, y: 20, count: 1 };

function field(camps: Config['map']['camps'], units: Unit[] = []) {
  const a = arena(units, (c) => pinNeutrals(c, camps));
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step([]).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const members = () => [...a.sim.stores.neutrals.ids];
  const camp = () => a.sim.camps[0]!;
  const neutralShots = () => events.filter((e) => e.type === 'shot' && a.sim.stores.kinds.get(e.id) === Kind.Neutral).length;
  return { ...a, events, run, members, camp, neutralShots };
}

describe('neutral camps (GDD §4, TDD §6.8)', () => {
  it('spawn at 0:30 round the campfire and sit idle until hit', () => {
    const a = field([SQUAD]);
    a.run(900);
    expect(a.members()).toHaveLength(0);
    a.run();
    expect(a.members()).toHaveLength(3);
    expect(a.camp().state).toBe(CampState.Idle);
    for (const e of a.members()) {
      const t = a.sim.stores.transforms.get(e)!;
      expect(Math.hypot(t.x - SQUAD.x, t.y - SQUAD.y)).toBeCloseTo(1.2);
      expect(a.sim.stores.teams.get(e)).toBe(Team.Neutral);
    }
    // A champion walking past outside its own range doesn't wake them.
    a.move(a.shooter, 0, 10);
    a.run(300);
    expect(a.neutralShots()).toBe(0);
    expect(a.camp().state).toBe(CampState.Idle);
  });

  it('engage the champion that hits them, and shoot back', () => {
    const a = field([SQUAD]);
    a.run(901);
    a.move(a.shooter, 0, 14);
    a.run(60);
    expect(a.camp().state).toBe(CampState.Engaged);
    expect(a.camp().aggro).toBe(a.shooter);
    expect(a.neutralShots()).toBeGreaterThan(0);
    expect(a.hp(a.shooter)).toBeLessThan(1000);
  });

  it('leash: pulled past 10 m they walk home invulnerable, then heal to full', () => {
    const a = field([SQUAD]);
    a.run(901);
    a.move(a.shooter, 0, 14);
    a.run(30);
    expect(a.camp().state).toBe(CampState.Engaged);
    for (const e of a.members()) a.hp(e, 100);
    a.move(a.shooter, 0, -20); // far out of reach: they chase until the leash
    let leashed = false;
    for (let i = 0; i < 300 && a.camp().state !== CampState.Idle; i++) {
      a.run();
      if (a.camp().state === CampState.Leashing) {
        leashed = true;
        for (const e of a.members()) expect(a.sim.stores.healths.get(e)!.invulnerable).toBe(true);
      }
      for (const e of a.members()) {
        const n = a.sim.stores.neutrals.get(e)!;
        const t = a.sim.stores.transforms.get(e)!;
        expect(Math.hypot(t.x - n.homeX, t.y - n.homeY)).toBeLessThanOrEqual(10.01);
      }
    }
    expect(leashed).toBe(true);
    expect(a.camp().state).toBe(CampState.Idle);
    for (const e of a.members()) {
      const h = a.sim.stores.healths.get(e)!;
      expect([h.hp, h.invulnerable]).toEqual([350, false]);
      const n = a.sim.stores.neutrals.get(e)!;
      const t = a.sim.stores.transforms.get(e)!;
      expect([t.x, t.y]).toEqual([n.homeX, n.homeY]);
    }
  });

  it('a sniper holds its nest and resets after 4 s out of combat', () => {
    const a = field([NEST]);
    a.run(901);
    const [sniper] = a.members();
    a.move(a.shooter, 0, 14.5); // 5.5 m: both in range
    a.run(40);
    expect(a.camp().state).toBe(CampState.Engaged);
    expect(a.hp(sniper!)).toBeLessThan(300);
    a.move(a.shooter, 0, -10); // out of both ranges
    a.run(130);
    expect(a.camp().state).toBe(CampState.Idle);
    expect(a.hp(sniper!)).toBe(300);
    const t = a.sim.stores.transforms.get(sniper!)!;
    expect([t.x, t.y]).toEqual([0, 20]);
  });

  it('clearing pays the killing team near the camp, then the camp respawns', () => {
    // Player 2 (Red) stands by the camp (out of Alpha's range, which prefers champions); player 3 (Blue) is too far for a share.
    const a = field([SQUAD], [{ team: Red, x: 6, y: 25 }, { team: Team.Blue, x: 20, y: 40 }]);
    a.run(901);
    for (const e of a.members()) a.hp(e, 1);
    a.move(a.shooter, 0, 14);
    const charge = () => a.sim.stores.champions.get(a.shooter)!.ultCharge;
    let before = 0;
    for (let i = 0; i < 300 && !a.events.some((e) => e.type === 'campCleared'); i++) {
      before = charge();
      a.run();
    }
    const cleared = a.events.find((e) => e.type === 'campCleared');
    expect(cleared).toMatchObject({ camp: 'C1', kind: 'deserter', team: Team.Blue });
    expect(a.sim.stores.champions.get(a.shooter)!.xp).toBeCloseTo(60);
    expect(charge() - before).toBeCloseTo(5, 0);
    expect(a.sim.stores.champions.get(2)!.xp).toBe(0); // the Red champion: the other team
    expect(a.sim.stores.champions.get(3)!.xp).toBe(0); // too far
    expect(a.camp().state).toBe(CampState.Respawning);
    a.move(a.shooter, 0, -20);
    const at = cleared!.tick;
    a.run(at + 1200 - a.sim.tick);
    expect(a.members()).toHaveLength(0);
    a.run();
    expect(a.members()).toHaveLength(3);
    expect(a.camp().state).toBe(CampState.Idle);
  });

  it('a debug kill pays nobody', () => {
    const a = field([NEST]);
    a.run(901);
    a.move(a.shooter, 0, 16);
    a.sim.debug.kill(a.members()[0]!);
    a.run();
    expect(a.events.find((e) => e.type === 'campCleared')).toMatchObject({ team: undefined });
    expect(a.sim.stores.champions.get(a.shooter)!.xp).toBe(0);
  });
});

describe('camp placement (map spec)', () => {
  it.each([
    [3, 4, 4],
    [2, 4, 2],
  ] as const)('%d-lane map: %d deserter camps and %d sniper nests, on walkable ground', (lanes, squads, nests) => {
    const map = parseConfig({ ...rawConfig, map: maps[lanes] }).map;
    expect(map.camps.filter((c) => c.kind === 'deserter')).toHaveLength(squads);
    expect(map.camps.filter((c) => c.kind === 'sniper')).toHaveLength(nests);
    const g = buildGrid(map);
    for (const c of map.camps) {
      // The centre and every ring spot (1.2 m) are open.
      for (let k = 0; k < c.count; k++) {
        const a = (k * 2 * Math.PI) / c.count;
        const x = c.count === 1 ? c.x : c.x + Math.cos(a) * 1.2;
        const y = c.count === 1 ? c.y : c.y + Math.sin(a) * 1.2;
        expect(isBlocked(g, Math.floor((x - g.minX) / g.cell), Math.floor((y - g.minY) / g.cell)), `${c.id} #${k}`).toBe(false);
      }
    }
  });
});

describe('camps are always seen (D-074); only a squad of 4 needs two champions (D-077)', () => {
  it('stay visible to both teams in a Trench and in the fog', () => {
    const a = arena([], (c) => {
      c.combat.fog.enabled = true;
      c.map.camps = [SQUAD];
    });
    a.step(1);
    const snap = a.sim.snapshot();
    const units = snap.entities.filter((e) => e.kind === Kind.Neutral);
    expect(units).toHaveLength(3); // the shipped camps spawn at 0:00
    for (const e of units) expect(e.visibleMask & 3).toBe(3);
  });

  /** Shipped camp numbers against level 1 Alphas that stand and shoot: who is left after a minute? */
  function duel(spot: Config['map']['camps'][number], champions: number) {
    const others: Unit[] = champions > 1 ? [{ team: Team.Blue, x: spot.x + 1.5, y: spot.y - 6, armed: true }] : [];
    const a = arena(others, (c) => {
      c.map.camps = [spot];
    });
    a.move(a.shooter, spot.x - 1.5, spot.y - 6);
    let cleared = false;
    let down = false; // arena champions respawn: stop at the first knock-out
    for (let i = 0; i < 60 * 30 && !cleared && !down; i++) {
      for (const ev of a.sim.step([]).events) {
        if (ev.type === 'campCleared') cleared = true;
        if (ev.type === 'death' && ev.unit === undefined) down = true;
      }
    }
    const alive = a.sim.stores.champions.ids.filter((e) => a.sim.stores.healths.get(e)!.hp > 0).length;
    return { cleared, alive };
  }

  it.each([
    ['a deserter squad of 3', SQUAD, true],
    ['a deserter squad of 4', { ...SQUAD, count: 4 }, false],
    ['a sniper nest', NEST, true],
  ])('%s: one champion clears it alone: %s; two clear it with both standing', (_, spot, solo) => {
    expect(duel(spot, 1)).toEqual(solo ? { cleared: true, alive: 1 } : { cleared: false, alive: 0 });
    expect(duel(spot, 2)).toEqual({ cleared: true, alive: 2 });
  });
});
