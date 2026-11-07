import { describe, expect, it } from 'vitest';
import { maps, parseConfig, rawConfig } from '../src/data/load';
import type { Config } from '../src/data/schema';
import type { SimEvent } from '../src/sim/events';
import { buildGrid, isBlocked, ownerAt } from '../src/sim/grid';
import { CampState } from '../src/sim/systems/camps';
import { inTelegraph } from '../src/sim/telegraph-shape';
import { createSim, Kind, Team, type Command } from '../src/sim/sim';
import { arena, fixtureConfig, type Unit } from './helpers';

const { Blue, Red } = Team;
const GUN = { id: 'FG', kind: 'fieldGun' as const, x: 0, y: 20, count: 1 };

/** An 8 m arena floor under the test boss spot (painted last, so it owns its cells): a boss wakes when a champion stands on it (D-081). */
function addArena(c: Config) {
  c.map.walkable.push({ id: 'arena-test', shape: 'circle', surface: 'arena', x: GUN.x, y: GUN.y, r: 8, height: 0 });
}

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
  addArena(c);
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

  it.each([3, 2] as const)('every boss stands on its own arena floor, which no lane owns (%d lanes, D-081)', (lanes) => {
    const config = parseConfig({ ...rawConfig, map: maps[lanes] });
    const g = buildGrid(config.map);
    const bosses = config.map.camps.filter((c) => config.neutrals.camps[c.kind].boss);
    expect(bosses.length).toBeGreaterThan(0);
    for (const b of bosses) {
      const floor = config.map.walkable[ownerAt(g, b.x, b.y)]!;
      expect(floor.surface, b.id).not.toBe('dirt');
      expect(['arena', 'crater', 'gravel'], b.id).toContain(floor.surface);
    }
  });

  it('sleeps through fire from the lane 8 m away on The Front, and wakes when a champion steps onto its arena (D-081)', () => {
    const config = parseConfig({ ...rawConfig, map: maps[3] });
    config.waves.enabled = false;
    config.neutrals.camps.fieldGun.firstSpawnSeconds = 0;
    const fg = config.map.camps.find((c) => c.kind === 'fieldGun')!;
    const lane = { x: fg.x - 8, y: fg.y }; // centre lane, in an Alpha's reach through the trench mouth
    const sim = createSim(config, 1, [{ team: Blue, championId: 'alpha', spawnAt: lane }]);
    const me = sim.entityOf(0)!;
    expect(config.map.walkable[ownerAt(sim.grid, lane.x, lane.y)]!.surface).toBe('dirt');
    for (let i = 0; i < 90; i++) sim.step([]);
    const gun = sim.stores.neutrals.ids.find((e) => sim.snapshot().entities.find((s) => s.id === e)?.modelId === 'fieldGun')!;
    const ci = config.map.camps.indexOf(fg);
    expect(sim.camps[ci]!.state).toBe(CampState.Idle);
    expect(sim.stores.healths.get(gun)!.hp).toBe(3000);
    Object.assign(sim.stores.transforms.get(me)!, { x: fg.x, y: fg.y + 3 });
    sim.step([]);
    expect(sim.camps[ci]!.state).toBe(CampState.Engaged);
    expect(sim.camps[ci]!.attackers).toEqual([me]);
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

/**
 * Which way out of the first telegraph covering a unit of radius `r` at (x, y), by shape: a circle
 * away from its centre (across the line to the boss when at the centre); a strip sideways out of
 * the nearer edge; a cone out of range or sideways to the nearer edge, whichever is shorter.
 */
function wayOut(snap: ReturnType<ReturnType<typeof createSim>['snapshot']>, x: number, y: number, r: number, boss: { x: number; y: number }) {
  for (const t of snap.telegraphs) {
    if (!inTelegraph(t, x, y, r)) continue;
    const dx = Math.cos(t.angle);
    const dy = Math.sin(t.angle);
    let ox: number;
    let oy: number;
    if (t.shape === 'circle') {
      ox = x - t.x;
      oy = y - t.y;
      if (Math.hypot(ox, oy) < 0.3) [ox, oy] = [-(boss.y - y), boss.x - x];
    } else if (t.shape === 'strip') {
      const across = (y - t.y) * dx - (x - t.x) * dy;
      [ox, oy] = across >= 0 ? [-dy, dx] : [dy, -dx];
    } else {
      const d = Math.hypot(x - t.x, y - t.y) || 1;
      const off = Math.atan2(y - t.y, x - t.x) - t.angle;
      const w = Math.atan2(Math.sin(off), Math.cos(off));
      const out = t.radius + r - d;
      const side = d * Math.sin(Math.max(0, t.arc / 2 - Math.abs(w))) + r;
      const rx = (x - t.x) / d;
      const ry = (y - t.y) / d;
      [ox, oy] = out < side ? [rx, ry] : w >= 0 ? [-ry, rx] : [ry, -rx];
    }
    const n = Math.hypot(ox, oy) || 1;
    return { x: ox / n, y: oy / n };
  }
  return undefined;
}

describe('a mini-boss is soloable with dodging (D-079, D-080, user)', () => {
  /**
   * A level 4 Alpha alone against a shipped mini-boss on the open map; `dodge` steps out of every
   * marker, then back to its spot at its own range from the boss's home. (Backing off to just
   * outside the Halftrack's reach instead pulls it to its leash, and it goes home and heals.)
   */
  function duel(kind: 'fieldGun' | 'halftrack', dodge: boolean) {
    const config = fixtureConfig();
    config.waves.enabled = false;
    config.powers.powers = []; // no drafts on level-up
    config.neutrals.camps[kind].firstSpawnSeconds = 0;
    config.map.camps = [{ ...GUN, kind }];
    addArena(config);
    const alpha = config.champions.find((c) => c.id === 'alpha')!;
    const keep = alpha.weapon.range + config.neutrals.camps[kind].unit.radius - 0.3;
    const spot = { x: 0, y: GUN.y - keep };
    // It starts on the arena floor (5 m in) to wake the boss, then holds at its spot.
    const sim = createSim(config, 1, [{ team: Blue, championId: 'alpha', spawnAt: { x: 0, y: GUN.y - 5 } }]);
    const me = sim.entityOf(0)!;
    for (let k = 0; k < 3; k++) sim.debug.levelUp(me);
    let cleared = false;
    for (let i = 0; i < 120 * 30 && !cleared && sim.stores.healths.get(me)!.hp > 0; i++) {
      const t = sim.stores.transforms.get(me)!;
      const bossId = sim.stores.neutrals.ids[0];
      const b = bossId ? sim.stores.transforms.get(bossId)! : GUN;
      let mx = 0;
      let my = 0;
      if (dodge) {
        const out = wayOut(sim.snapshot(), t.x, t.y, alpha.radius + 0.2, b);
        const d = Math.hypot(spot.x - t.x, spot.y - t.y);
        if (out) [mx, my] = [out.x, out.y];
        else if (d > 0.3) [mx, my] = [(spot.x - t.x) / d, (spot.y - t.y) / d];
      }
      const cmd: Command = { tick: sim.tick, player: 0, moveX: Math.round(mx * 127), moveY: Math.round(my * 127), ult: false, draftPick: -1, reroll: false };
      for (const ev of sim.step([cmd]).events) if (ev.type === 'campCleared') cleared = true;
    }
    return { cleared, alive: sim.stores.healths.get(me)!.hp > 0, level: sim.stores.champions.get(me)!.level };
  }

  it.each(['fieldGun', 'halftrack'] as const)('a level 4 Alpha standing still is knocked out by the %s', (kind) => {
    expect(duel(kind, false)).toMatchObject({ cleared: false, alive: false, level: 4 });
  });

  it.each(['fieldGun', 'halftrack'] as const)('a level 4 Alpha that steps out of every marker clears the %s alone', (kind) => {
    expect(duel(kind, true)).toMatchObject({ cleared: true, alive: true });
  });
});

const HT = { id: 'HT', kind: 'halftrack' as const, x: 0, y: 20, count: 1 };

/** The Halftrack pinned to its D-080 numbers in ticks and radians, up from the first tick. */
function htField(units: Unit[] = []) {
  return gunField(units, (c) => {
    c.neutrals.camps.halftrack = {
      name: 'Halftrack', firstSpawnSeconds: 0, respawnSeconds: 100, xp: 250, ultCharge: 15,
      unit: { maxHp: 3500, radius: 1.4, moveSpeed: 2.2 },
      boss: {
        pattern: { kind: 'halftrack', range: 7, intervalSeconds: 75, windupSeconds: 24, chargeEvery: 3, spray: { angle: Math.PI / 3, damage: 260 }, charge: { length: 8, width: 2.4, damage: 320, speed: 16 } },
        artilleryWaves: 0,
        supplyDrop: { damagePct: 0.15, speedPct: 0.1, seconds: 1800 },
      },
    };
    c.map.camps = [HT];
  });
}

describe('Halftrack (D-080)', () => {
  /** Alpha 7 m south of the Halftrack, in both ranges; runs until its first windup shows. */
  function firstWindup(a: ReturnType<typeof htField>) {
    a.move(a.shooter, 0, 13);
    for (let i = 0; i < 120 && a.sim.snapshot().telegraphs.length === 0; i++) a.run();
    return { start: a.sim.tick - 1, tel: a.sim.snapshot().telegraphs[0]! };
  }

  it('sprays a 60° cone marked windupSeconds ahead; a champion that steps out takes nothing, one that stays is hit', () => {
    const stay = htField();
    const s = firstWindup(stay);
    expect(s.tel).toMatchObject({ shape: 'cone', radius: 7, elapsed: 0, total: 24 });
    expect(s.tel.arc).toBeCloseTo(Math.PI / 3);
    expect(s.tel.angle).toBeCloseTo(-Math.PI / 2, 1);
    stay.run(30);
    expect(stay.fromGun(stay.shooter).map((e) => e.type === 'damage' && [e.amount, e.tick - s.start])).toEqual([[260, 24]]);

    const dodge = htField();
    firstWindup(dodge);
    dodge.move(dodge.shooter, 6.5, 13); // out of the cone's side
    dodge.run(30);
    expect(dodge.fromGun(dodge.shooter)).toHaveLength(0);
  });

  it('a windup dies with the Halftrack: no marker left behind', () => {
    const a = htField();
    firstWindup(a);
    a.sim.debug.kill(a.gun());
    a.run(2);
    expect(a.sim.camps[0]!.state).toBe(CampState.Respawning);
    expect(a.sim.snapshot().telegraphs).toHaveLength(0);
  });

  it('every third attack is a charge: a marked strip, then it drives down it', () => {
    const a = htField();
    a.move(a.shooter, 0, 13);
    let strip;
    for (let i = 0; i < 400 && !strip; i++) {
      a.run();
      strip = a.sim.snapshot().telegraphs.find((t) => t.shape === 'strip');
    }
    expect(strip).toMatchObject({ team: Team.Neutral, length: 8, width: 2.4, total: 24, elapsed: 0 });
    const from = { ...a.sim.stores.transforms.get(a.gun())! };
    const hitsBefore = a.fromGun(a.shooter).length;
    a.move(a.shooter, 8, 13); // out of the strip
    a.run(24 + 20);
    const to = a.sim.stores.transforms.get(a.gun())!;
    const along = (to.x - from.x) * Math.cos(strip!.angle) + (to.y - from.y) * Math.sin(strip!.angle);
    expect(along).toBeGreaterThan(6);
    expect(a.fromGun(a.shooter)).toHaveLength(hitsBefore);
  });

  it('a chase past 10 m sends it home, and it heals to full', () => {
    const a = htField();
    a.run();
    a.hp(a.gun(), 2000);
    a.move(a.shooter, 0, 12);
    a.run(10);
    a.move(a.shooter, 0, -5); // runs off; the Halftrack follows to its leash
    a.run(400);
    expect(a.sim.camps[0]!.state).toBe(CampState.Idle);
    expect(a.hp(a.gun())).toBe(3500);
    const t = a.sim.stores.transforms.get(a.gun())!;
    expect([t.x, t.y]).toEqual([HT.x, HT.y]);
  });

  it('Supply Drop: the killing team deals 15% more and moves 10% faster for 60 s; a second clear restarts it without stacking', async () => {
    const { Stat } = await import('../src/sim/stats');
    const a = htField([{ team: Blue, x: 30, y: -30 }, { team: Red, x: 30, y: 30 }]);
    const [mate, red] = [1, 2].map((p) => a.sim.entityOf(p)!);
    const pct = (e: number, s: number) => a.sim.stores.stats.get(e)!.pct[s]!;
    const base = [a.shooter, mate!, red!].map((e) => [pct(e, Stat.Damage), pct(e, Stat.MoveSpeed)]);
    const clear = () => {
      a.hp(a.gun(), 1);
      a.move(a.shooter, 0, 13);
      const before = a.events.filter((e) => e.type === 'campCleared').length;
      for (let i = 0; i < 120 && a.events.filter((e) => e.type === 'campCleared').length === before; i++) a.run();
    };
    a.run();
    clear();
    const on = a.sim.tick;
    for (const [i, e] of [a.shooter, mate!].entries()) {
      expect(pct(e, Stat.Damage)).toBeCloseTo(base[i]![0]! + 0.15);
      expect(pct(e, Stat.MoveSpeed)).toBeCloseTo(base[i]![1]! + 0.1);
    }
    expect([pct(red!, Stat.Damage), pct(red!, Stat.MoveSpeed)]).toEqual(base[2]);
    expect(a.sim.snapshot().entities.find((e) => e.id === mate)!.supply).toBe(true);
    // It respawns after 100 ticks: a second clear while the buff is on.
    a.run(110);
    clear();
    const again = a.sim.tick;
    expect(pct(a.shooter, Stat.Damage)).toBeCloseTo(base[0]![0]! + 0.15);
    a.run(1800 - 3);
    expect(a.sim.tick - on).toBeGreaterThan(1800);
    expect(pct(mate!, Stat.Damage)).toBeCloseTo(base[1]![0]! + 0.15); // restarted, so still on past the first 60 s
    a.run(again + 1800 + 2 - a.sim.tick);
    expect(pct(mate!, Stat.Damage)).toBeCloseTo(base[1]![0]!);
    expect(pct(mate!, Stat.MoveSpeed)).toBeCloseTo(base[1]![1]!);
  });
});

describe('bots leave the mini-bosses alone (D-079, user)', () => {
  it.each([3, 2] as const)('no farm plan targets a boss, and no bot wakes one walking past, the Behemoth brought in at 1:00 (%d lanes)', async (lanes) => {
    const { createBot } = await import('../src/sim/bots/bot');
    const { Squad } = await import('../src/sim/bots/squad');
    const { matchSlots } = await import('../src/sim/match-setup');
    const config = parseConfig({ ...rawConfig, map: maps[lanes] });
    config.neutrals.camps.behemoth.firstSpawnSeconds = 60 * 30; // most all-bot matches end before 6:00
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
    expect(snap.entities.some((e) => e.kind === Kind.Neutral && e.modelId === 'behemoth')).toBe(true);
  }, 60_000);
});

const BH = { id: 'BH', kind: 'behemoth' as const, x: 0, y: 20, count: 1 };

/** The Behemoth pinned to its D-082 numbers in ticks, up from the first tick. */
function bhField(units: Unit[] = []) {
  return gunField(units, (c) => {
    c.neutrals.camps.behemoth = {
      name: 'Behemoth', firstSpawnSeconds: 0, respawnSeconds: 3600, xp: 400, ultCharge: 25,
      unit: { maxHp: 9000, radius: 2.2, moveSpeed: 0 },
      boss: {
        pattern: { kind: 'shells', range: 14, intervalSeconds: 90, targets: 4, flightSeconds: 24, damage: 300, radius: 2.2, arcHeight: 8, blast: { every: 3, radius: 6, damage: 450, windupSeconds: 24 } },
        artilleryWaves: 0,
        invincibleSeconds: 450,
      },
    };
    c.map.camps = [BH];
  });
}

describe('Behemoth (D-082)', () => {
  it.each([3, 2] as const)('waits at the map centre, up at 6:00, back 120 s after a clear (%d lanes)', (lanes) => {
    const config = parseConfig({ ...rawConfig, map: maps[lanes] });
    const spot = config.map.camps.find((c) => c.kind === 'behemoth')!;
    expect([spot.x, spot.y]).toEqual([0, 0]);
    expect(config.neutrals.camps.behemoth.firstSpawnSeconds).toBe(360 * 30);
    expect(config.neutrals.camps.behemoth.respawnSeconds).toBe(120 * 30);
  });

  it('shells all four attackers in one volley', () => {
    const spots = [[-5, 14], [5, 14], [-6, 20], [6, 20]] as const;
    const a = bhField(spots.slice(1).map(([x, y]) => ({ team: Blue, x, y, armed: true })));
    a.move(a.shooter, spots[0][0], spots[0][1]);
    let most = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) {
      a.run();
      const fresh = a.sim.snapshot().lobs.filter((l) => !seen.has(l.id));
      for (const l of fresh) seen.add(l.id);
      most = Math.max(most, fresh.length);
    }
    expect(most).toBe(4);
  });

  it('every 3rd attack with someone close is a steam blast: a 6 m circle marked 24 ticks ahead; a champion that steps out takes nothing', () => {
    const blastOf = (dodge: boolean) => {
      const a = bhField();
      a.move(a.shooter, 0, 16); // 4 m from it
      let tel;
      for (let i = 0; i < 400 && !tel; i++) {
        a.run();
        tel = a.sim.snapshot().telegraphs.find((t) => t.radius === 6);
      }
      if (dodge) a.move(a.shooter, 0, 11); // 9 m out
      const start = a.sim.tick - 1;
      a.run(30);
      // Any hit after the windup starts is the blast (the shells landed long before); its amount is capped by the HP left.
      return { tel, hits: a.fromGun(a.shooter).filter((e) => e.tick > start).map((e) => e.tick - start) };
    };
    const stay = blastOf(false);
    expect(stay.tel).toMatchObject({ shape: 'circle', x: 0, y: 20, radius: 6, elapsed: 0, total: 24 });
    expect(stay.hits).toEqual([24]);
    expect(blastOf(true).hits).toEqual([]);
  });

  it('pays 400 XP and +25 charge to the whole team, and makes its living champions invincible for 15 s', async () => {
    const { isInvulnerable } = await import('../src/sim/damage');
    const a = bhField([{ team: Blue, x: 30, y: -30 }, { team: Blue, x: -30, y: -30 }, { team: Red, x: 30, y: 30 }]);
    const [far, down, red] = [1, 2, 3].map((p) => a.sim.entityOf(p)!);
    a.sim.debug.kill(down!);
    a.move(a.shooter, 0, 14);
    a.run(2);
    a.hp(a.gun(), 1);
    for (let i = 0; i < 120 && !a.events.some((e) => e.type === 'campCleared'); i++) a.run();
    const at = a.events.find((e) => e.type === 'campCleared')!;
    expect(at).toMatchObject({ kind: 'behemoth', team: Blue });
    for (const e of [a.shooter, far!, down!]) expect(a.sim.stores.champions.get(e)!.xp).toBe(400);
    expect(a.sim.stores.champions.get(red!)!.xp).toBe(0);
    const inv = (e: number) => isInvulnerable(a.sim.stores.healths.get(e)!, a.sim.tick);
    expect([inv(a.shooter), inv(far!), inv(red!)]).toEqual([true, true, false]);
    expect(a.sim.snapshot().entities.find((e) => e.id === far)!.invulnerable).toBe(true);
    a.run(at.tick + 450 - a.sim.tick);
    expect([inv(a.shooter), inv(far!)]).toEqual([false, false]);
  });
});

describe('the Behemoth is a team fight (D-082)', () => {
  /** Three level 9 Alphas round the shipped Behemoth on the open map; `dodge` steps out of every marker, then back to each one's spot. */
  function teamFight(dodge: boolean) {
    const config = fixtureConfig();
    config.waves.enabled = false;
    config.powers.powers = [];
    config.neutrals.camps.behemoth.firstSpawnSeconds = 0;
    config.map.camps = [{ ...GUN, kind: 'behemoth' }];
    addArena(config);
    const alpha = config.champions.find((c) => c.id === 'alpha')!;
    const keep = alpha.weapon.range + config.neutrals.camps.behemoth.unit.radius - 0.3;
    const angles = [-Math.PI / 2, -Math.PI / 2 + 0.7, -Math.PI / 2 - 0.7];
    const spots = angles.map((a) => ({ x: GUN.x + Math.cos(a) * keep, y: GUN.y + Math.sin(a) * keep }));
    // They start on the arena floor (5 m in) to wake it.
    const sim = createSim(config, 1, angles.map((a) => ({ team: Blue, championId: 'alpha', spawnAt: { x: GUN.x + Math.cos(a) * 5, y: GUN.y + Math.sin(a) * 5 } })));
    const ids = angles.map((_, p) => sim.entityOf(p)!);
    for (const e of ids) for (let k = 0; k < 8; k++) sim.debug.levelUp(e);
    let cleared = false;
    const alive = () => ids.filter((e) => sim.stores.healths.get(e)!.hp > 0).length;
    for (let i = 0; i < 180 * 30 && !cleared && alive() > 0; i++) {
      const snap = sim.snapshot();
      const cmds: Command[] = ids.map((e, p) => {
        const t = sim.stores.transforms.get(e)!;
        let mx = 0;
        let my = 0;
        if (dodge) {
          const out = wayOut(snap, t.x, t.y, alpha.radius + 0.2, GUN);
          const s = spots[p]!;
          const d = Math.hypot(s.x - t.x, s.y - t.y);
          if (out) [mx, my] = [out.x, out.y];
          else if (d > 0.3) [mx, my] = [(s.x - t.x) / d, (s.y - t.y) / d];
        }
        return { tick: sim.tick, player: p, moveX: Math.round(mx * 127), moveY: Math.round(my * 127), ult: false, draftPick: -1, reroll: false };
      });
      for (const ev of sim.step(cmds).events) if (ev.type === 'campCleared') cleared = true;
    }
    return { cleared, alive: alive(), level: sim.stores.champions.get(ids[0]!)!.level };
  }

  it('three level 9 Alphas that stand still lose it', () => {
    expect(teamFight(false)).toMatchObject({ cleared: false, level: 9 });
  }, 30_000);

  it('three level 9 Alphas that step out of every marker clear it, at least two standing', () => {
    const r = teamFight(true);
    expect(r.cleared).toBe(true);
    expect(r.alive).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
