import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import type { Config } from '../src/data/schema';
import type { SimEvent } from '../src/sim/events';
import { buildGrid, isBlocked } from '../src/sim/grid';
import { CampState } from '../src/sim/systems/camps';
import { inTelegraph } from '../src/sim/telegraph-shape';
import { createSim, Kind, Team, type Command } from '../src/sim/sim';
import { arena, fixtureConfig, type Unit } from './helpers';

const { Blue, Red } = Team;
const GUN = { id: 'FG', kind: 'fieldGun' as const, x: 0, y: 20, count: 1 };

/** The Field Gun pinned to its D-079 numbers in ticks, up from the first tick, so retuning data/ doesn't move these tests. */
function pinGun(c: Config) {
  c.neutrals.resetSeconds = 120;
  c.neutrals.camps.fieldGun = {
    name: 'Field Gun', firstSpawnSeconds: 0, respawnSeconds: 2700, xp: 250, ultCharge: 15,
    unit: { maxHp: 3000, radius: 1.2, moveSpeed: 0 },
    boss: { pattern: { kind: 'shells', range: 12, intervalSeconds: 75, targets: 2, flightSeconds: 24, damage: 240, radius: 2, arcHeight: 6 }, artilleryWaves: 2 },
  };
  c.map.camps = [GUN];
  c.progression.xpPerLevel = [1e9]; // no level-ups: XP reads back exactly
}

function gunField(units: Unit[] = [], tweak?: (c: Config) => void) {
  const a = arena(units, (c) => {
    pinGun(c);
    tweak?.(c);
  });
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step(commands).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const gun = () => a.sim.stores.neutrals.ids[0]!;
  const fromGun = (target: number) => events.filter((e) => e.type === 'damage' && e.source === gun() && e.target === target);
  return { ...a, events, run, gun, fromGun };
}

describe('mini-bosses as camps (D-079)', () => {
  it.each([3, 2] as const)('the Field Gun sits at its arena centre on open ground, up at 2:00, back 90 s after a clear (%d lanes)', (lanes) => {
    const config = parseConfig({ ...rawConfig, map: maps[lanes] });
    const spot = config.map.camps.find((c) => c.kind === 'fieldGun')!;
    const arenaShape = config.map.walkable.find((s) => s.id === 'arena-fieldgun')!;
    expect(arenaShape.shape === 'circle' && [arenaShape.x, arenaShape.y]).toEqual([spot.x, spot.y]);
    const g = buildGrid(config.map);
    expect(isBlocked(g, Math.floor((spot.x - g.minX) / g.cell), Math.floor((spot.y - g.minY) / g.cell))).toBe(false);
    expect(config.neutrals.camps.fieldGun.firstSpawnSeconds).toBe(120 * 30);
    expect(config.neutrals.camps.fieldGun.respawnSeconds).toBe(90 * 30);
  });

  it('has no weapon, and is never recycled into a deserter', () => {
    const a = gunField();
    a.run();
    expect(a.sim.stores.weapons.get(a.gun())).toBeUndefined();
    expect(a.sim.snapshot().entities.find((e) => e.id === a.gun())?.modelId).toBe('fieldGun');
  });
});

describe('Field Gun shells (D-079)', () => {
  /** Alpha in range of the gun; returns the tick its first shell launched and that shell's telegraph. */
  function firstShell(a: ReturnType<typeof gunField>) {
    a.move(a.shooter, 0, 13);
    for (let i = 0; i < 120 && a.sim.snapshot().lobs.length === 0; i++) a.run();
    const tel = a.sim.snapshot().telegraphs[0]!;
    return { launched: a.sim.tick - 1, tel };
  }

  it('marks the landing spot flightSeconds ahead; a champion that steps out takes nothing, one that stays is hit', () => {
    const stay = gunField();
    const s = firstShell(stay);
    expect(s.tel).toMatchObject({ shape: 'circle', x: 0, y: 13, radius: 2, elapsed: 0, total: 24 });
    stay.run(30);
    const blast = stay.events.find((e) => e.type === 'explosion')!;
    expect(blast.tick - s.launched).toBe(24);
    expect(stay.fromGun(stay.shooter).map((e) => e.type === 'damage' && e.amount)).toEqual([240]);

    const dodge = gunField();
    firstShell(dodge);
    dodge.move(dodge.shooter, 3, 14); // 3.2 m from the centre: out of the 2 m circle plus its 0.5 m body
    dodge.run(30);
    expect(dodge.events.some((e) => e.type === 'explosion')).toBe(true);
    expect(dodge.fromGun(dodge.shooter)).toHaveLength(0);
  });

  it('shells each of two attackers in one volley', () => {
    const a = gunField([{ team: Blue, x: 4, y: 14, armed: true }]);
    a.move(a.shooter, -4, 14);
    const volleys = new Map<number, { x: number; y: number }[]>();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      a.run();
      for (const l of a.sim.snapshot().lobs) {
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        const v = volleys.get(a.sim.tick) ?? [];
        v.push({ x: l.x1, y: l.y1 });
        volleys.set(a.sim.tick, v);
      }
    }
    const pairs = [...volleys.values()].filter((v) => v.length === 2);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0]!.map((p) => p.x).sort((x, y) => x - y)).toEqual([-4, 4]);
  });

  it('goes home and heals to full when no attacker is left', () => {
    const a = gunField();
    a.run();
    a.hp(a.gun(), 2000);
    a.move(a.shooter, 0, 13);
    a.run(40);
    expect(a.sim.camps[0]!.state).toBe(CampState.Engaged);
    a.move(a.shooter, 0, -20);
    a.run(200);
    expect(a.sim.camps[0]!.state).toBe(CampState.Idle);
    expect(a.hp(a.gun())).toBe(3000);
  });
});

describe('mini-boss rewards (D-079)', () => {
  it('pays every champion of the killing team, far away or knocked out, and nobody else; a steal pays the stealer', () => {
    const units: Unit[] = [
      { team: Blue, x: 30, y: -30 }, // far away
      { team: Blue, x: -30, y: -30 }, // knocked out below
      { team: Red, x: 30, y: 30 },
    ];
    const a = gunField(units);
    const [far, down, red] = [1, 2, 3].map((p) => a.sim.entityOf(p)!);
    a.sim.debug.kill(down!);
    a.run();
    a.hp(a.gun(), 1);
    const charge = (e: number) => a.sim.stores.champions.get(e)!.ultCharge;
    const before = [a.shooter, far!, down!].map(charge);
    a.move(a.shooter, 0, 13);
    for (let i = 0; i < 120 && !a.events.some((e) => e.type === 'campCleared'); i++) a.run();
    expect(a.events.find((e) => e.type === 'campCleared')).toMatchObject({ kind: 'fieldGun', team: Blue });
    for (const e of [a.shooter, far!, down!]) expect(a.sim.stores.champions.get(e)!.xp).toBe(250);
    expect(a.sim.stores.champions.get(red!)!.xp).toBe(0);
    [a.shooter, far!, down!].forEach((e, i) => expect(charge(e) - before[i]!).toBeGreaterThanOrEqual(15));

    const steal = gunField([{ team: Red, x: 0, y: 27, armed: true }]);
    steal.run();
    steal.hp(steal.gun(), 1);
    for (let i = 0; i < 120 && !steal.events.some((e) => e.type === 'campCleared'); i++) steal.run();
    expect(steal.events.find((e) => e.type === 'campCleared')).toMatchObject({ team: Red });
    expect(steal.sim.stores.champions.get(steal.sim.entityOf(1)!)!.xp).toBe(250);
    expect(steal.sim.stores.champions.get(steal.shooter)!.xp).toBe(0);
  });

  it("Artillery Support: the killers' next 2 waves bring an extra Bazooka Tank, the 3rd doesn't, the other team none", () => {
    const a = gunField([], (c) => Object.assign(c.waves, { enabled: true, firstSeconds: 90, intervalSeconds: 150, spawnGapSeconds: 5 }));
    a.run();
    a.hp(a.gun(), 1);
    a.move(a.shooter, 0, 13);
    a.run(60);
    expect(a.events.find((e) => e.type === 'campCleared')).toMatchObject({ team: Blue });
    const tanks = [new Map<number, number>(), new Map<number, number>()];
    const counted = new Set<number>();
    let wave = -1;
    for (let i = 0; i < 90 + 150 * 3 - 60; i++) {
      a.run();
      for (const ev of a.events) if (ev.type === 'waveSpawned' && ev.tick === a.sim.tick - 1) wave = ev.wave;
      for (const e of a.sim.snapshot().entities) {
        if (e.modelId !== 'bazookaTank' || counted.has(e.id)) continue;
        counted.add(e.id);
        tanks[e.team]!.set(wave, (tanks[e.team]!.get(wave) ?? 0) + 1);
      }
    }
    expect([0, 1, 2].map((w) => tanks[Blue]!.get(w) ?? 0)).toEqual([1, 1, 0]);
    expect(tanks[Red]!.size).toBe(0);
  });
});

/** Is the champion entity `me` inside any telegraph, and if so which way out (unit vector)? */
function wayOut(snap: ReturnType<ReturnType<typeof createSim>['snapshot']>, x: number, y: number, r: number, from: { x: number; y: number }) {
  for (const t of snap.telegraphs) {
    if (!inTelegraph(t, x, y, r)) continue;
    let dx = x - t.x;
    let dy = y - t.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) {
      // At the centre: strafe across the line to the boss.
      dx = -(from.y - y);
      dy = from.x - x;
    }
    const n = Math.hypot(dx, dy) || 1;
    return { x: dx / n, y: dy / n };
  }
  return undefined;
}

describe('a mini-boss is soloable with dodging (D-079, user)', () => {
  /** A level 4 Alpha alone against the shipped Field Gun on the open map; `dodge` steps out of every marker. */
  function duel(dodge: boolean) {
    const config = fixtureConfig();
    config.waves.enabled = false;
    config.powers.powers = []; // no drafts on level-up
    config.neutrals.camps.fieldGun.firstSpawnSeconds = 0;
    config.map.camps = [GUN];
    const alpha = config.champions.find((c) => c.id === 'alpha')!;
    const hold = { x: 0, y: GUN.y - (alpha.weapon.range + config.neutrals.camps.fieldGun.unit.radius - 0.3) };
    const sim = createSim(config, 1, [{ team: Blue, championId: 'alpha', spawnAt: hold }]);
    const me = sim.entityOf(0)!;
    for (let k = 0; k < 3; k++) sim.debug.levelUp(me);
    let cleared = false;
    for (let i = 0; i < 120 * 30 && !cleared && sim.stores.healths.get(me)!.hp > 0; i++) {
      const t = sim.stores.transforms.get(me)!;
      let mx = 0;
      let my = 0;
      if (dodge) {
        const out = wayOut(sim.snapshot(), t.x, t.y, alpha.radius + 0.2, GUN);
        if (out) [mx, my] = [out.x, out.y];
        else if (Math.hypot(hold.x - t.x, hold.y - t.y) > 0.3) [mx, my] = [(hold.x - t.x) / Math.hypot(hold.x - t.x, hold.y - t.y), (hold.y - t.y) / Math.hypot(hold.x - t.x, hold.y - t.y)];
      }
      const cmd: Command = { tick: sim.tick, player: 0, moveX: Math.round(mx * 127), moveY: Math.round(my * 127), ult: false, draftPick: -1, reroll: false };
      for (const ev of sim.step([cmd]).events) if (ev.type === 'campCleared') cleared = true;
    }
    return { cleared, alive: sim.stores.healths.get(me)!.hp > 0, level: sim.stores.champions.get(me)!.level };
  }

  it('a level 4 Alpha standing still is knocked out by the Field Gun', () => {
    expect(duel(false)).toMatchObject({ cleared: false, alive: false, level: 4 });
  });

  it('a level 4 Alpha that steps out of every shell clears it alone', () => {
    expect(duel(true)).toMatchObject({ cleared: true, alive: true });
  });
});

describe('bots leave the mini-bosses alone (D-079, user)', () => {
  it.each([3, 2] as const)('no farm plan targets a boss, and no bot pulls one walking past (%d lanes)', async (lanes) => {
    const { createBot } = await import('../src/sim/bots/bot');
    const { Squad } = await import('../src/sim/bots/squad');
    const { matchSlots } = await import('../src/sim/match-setup');
    const config = parseConfig({ ...rawConfig, map: maps[lanes] });
    const slots = matchSlots(config, { teamSize: 3, localTeam: Blue });
    const sim = createSim(config, 1, slots);
    const squads = [new Squad(), new Squad()];
    const bots = slots.map((s, pl) => ({ bot: createBot(pl, s.team, () => config, () => sim.lanes, sim.rng.ai, s.lane, squads[s.team], () => sim.grid), e: sim.entityOf(pl)! }));
    const bossCamps = new Set(config.map.camps.flatMap((c, i) => (config.neutrals.camps[c.kind].boss ? [i] : [])));
    let snap = sim.snapshot();
    let planned = 0;
    let pulled = 0;
    while (sim.tick < 4 * 60 * 30 && snap.match.phase !== 'ended') {
      sim.step(bots.map((b) => ({ ...b.bot.command(snap, sim.tick, b.e) })));
      snap = sim.snapshot();
      for (const s of squads) for (const p of s.plans) if (bossCamps.has(p.camp)) planned++;
      for (const i of bossCamps) if (sim.camps[i]!.state === CampState.Engaged) pulled++;
    }
    expect(planned).toBe(0);
    expect(pulled).toBe(0);
    expect(snap.entities.some((e) => e.kind === Kind.Neutral && e.modelId === 'fieldGun')).toBe(true);
  }, 60_000);
});
