import { describe, expect, it } from 'vitest';
import { parseConfig, rawConfig } from '../src/data/load';
import { mulberry32 } from '../src/sim/rng';
import { SpatialIndex } from '../src/sim/spatial';
import { createSim, Kind, TargetClass, Team, type Command, type Transform } from '../src/sim/sim';
import { createStats, Stat, stat } from '../src/sim/stats';
import { World } from '../src/sim/ecs';

const config = parseConfig(rawConfig);
const twoAlphas = () =>
  createSim(config, 1, [
    { team: Team.Blue, championId: 'alpha' },
    { team: Team.Red, championId: 'alpha', spawnAt: { x: 0, y: -50 } },
  ]);

describe('combat components at spawn', () => {
  it("gives Alpha her config HP, revolver (interval in ticks) and the champion target class", () => {
    const sim = twoAlphas();
    const e = sim.entityOf(0)!;
    const alpha = config.champions[0]!;
    expect(sim.stores.healths.get(e)).toEqual({ hp: alpha.maxHp, maxHp: alpha.maxHp, shield: 0, invulnerable: false });
    const w = sim.stores.weapons.get(e)!;
    expect({ ...w }).toEqual({ ...alpha.weapon, cooldown: 0, aim: Math.PI / 2 }); // Blue starts facing the enemy
    expect(Number.isInteger(w.interval)).toBe(true);
    expect(sim.stores.targetClasses.get(e)).toBe(TargetClass.Champion);
    expect(sim.stores.targetings.get(e)).toEqual({ targetId: 0, pendingSwitchId: 0, pendingTicks: 0, holdTicks: 0 });
  });

  it('gives structures their HP, weapons and target classes', () => {
    const sim = twoAlphas();
    const rows = sim.snapshot().entities
      .filter((e) => e.kind !== Kind.Champion)
      .map((e) => [e.modelId, e.hp, e.maxHp, sim.stores.targetClasses.get(e.id), sim.stores.weapons.get(e.id)!.kind]);
    const { hq, subBase } = config.structures;
    expect(rows).toEqual([
      ['hq', hq.maxHp, hq.maxHp, TargetClass.HQ, hq.weapon.kind],
      ['hq', hq.maxHp, hq.maxHp, TargetClass.HQ, hq.weapon.kind],
      ['subBase', subBase.maxHp, subBase.maxHp, TargetClass.SubBase, subBase.weapon.kind],
      ['subBase', subBase.maxHp, subBase.maxHp, TargetClass.SubBase, subBase.weapon.kind],
    ]);
    const hqEntity = sim.snapshot().entities.find((e) => e.kind === Kind.HQ)!;
    expect(sim.stores.weapons.get(hqEntity.id)!.targets).toBe(config.structures.hq.weapon.targets);
  });

  it('spawns a player at spawnAt when given (the ?dummy setup)', () => {
    const e = twoAlphas().snapshot().entities[1]!;
    expect([e.team, e.x, e.y, e.hp]).toEqual([Team.Red, 0, -50, config.champions[0]!.maxHp]);
  });

  it('keeps the HP fraction on a live max-HP edit', () => {
    const sim = twoAlphas();
    const e = sim.entityOf(0)!;
    sim.stores.healths.get(e)!.hp = config.champions[0]!.maxHp / 2;
    const next = structuredClone(config);
    next.champions[0]!.maxHp = 2000;
    next.structures.subBase.maxHp = 3000;
    sim.setConfig(next);
    expect(sim.stores.healths.get(e)).toMatchObject({ hp: 1000, maxHp: 2000 });
    const sub = sim.snapshot().entities.find((x) => x.kind === Kind.SubBase)!;
    expect([sub.hp, sub.maxHp]).toEqual([3000, 3000]);
  });
});

describe('stats', () => {
  it('computes (base + flat) × (1 + Σpct) × Πmult and caches until dirty', () => {
    const s = createStats();
    s.base[Stat.Damage] = 95;
    s.flat[Stat.Damage] = 5;
    s.pct[Stat.Damage] = 0.12 * 3; // three Hollow Points stack additively
    s.mult[Stat.Damage] = 1.5;
    expect(stat(s, Stat.Damage)).toBeCloseTo(100 * 1.36 * 1.5);
    s.base[Stat.Damage] = 0; // not marked dirty: still the cached value
    expect(stat(s, Stat.Damage)).toBeCloseTo(204);
    s.dirty = true;
    expect(stat(s, Stat.Damage)).toBeCloseTo(5 * 1.36 * 1.5);
  });

  it('drives a champion move speed', () => {
    const sim = twoAlphas();
    const up: Command = { tick: 0, player: 0, moveX: 0, moveY: 127, ult: false, draftPick: -1, reroll: false };
    const y0 = sim.snapshot().entities[0]!.y;
    for (let i = 0; i < 30; i++) sim.step([up]);
    expect(sim.snapshot().entities[0]!.y - y0).toBeCloseTo(config.champions[0]!.moveSpeed, 5);
  });
});

describe('spatial index', () => {
  it('returns exactly the entities within r, ascending, across bucket edges', () => {
    const world = new World();
    const transforms = world.store<Transform>();
    const rand = mulberry32(7);
    const ids: number[] = [];
    for (let i = 0; i < 200; i++) {
      const e = world.create();
      transforms.add(e, { x: rand() * 68 - 34, y: rand() * 164 - 82, facing: 0 });
      ids.push(e);
    }
    const index = new SpatialIndex(-34, -82, 34, 82);
    index.rebuild(ids, transforms);
    const out: number[] = [];
    for (const [x, y, r] of [[0, 0, 9], [-4, 8, 4], [33, 81, 12], [3.9, -4.1, 0.5], [0, 0, 200]] as const) {
      index.query(x, y, r, out);
      const expected = ids.filter((e) => {
        const t = transforms.get(e)!;
        return (t.x - x) ** 2 + (t.y - y) ** 2 <= r * r;
      });
      expect(out).toEqual(expected);
    }
  });

  it('is rebuilt every tick from units with health', () => {
    const sim = twoAlphas();
    const out: number[] = [];
    sim.spatial.query(1, -40, 0.1, out);
    expect(out.map((e) => sim.stores.kinds.get(e))).toEqual([Kind.SubBase]);
    sim.spatial.query(0, -50, 1, out);
    expect(out).toEqual([sim.entityOf(1)]);
    const left: Command = { tick: 0, player: 1, moveX: -127, moveY: 0, ult: false, draftPick: -1, reroll: false };
    for (let i = 0; i < 30; i++) sim.step([left]);
    expect(sim.spatial.query(0, -50, 1, out)).toEqual([]);
  });
});
