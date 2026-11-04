import { describe, expect, it } from 'vitest';
import type { Config, FragGrenadeConfig } from '../src/data/schema';
import type { Champion, Command } from '../src/sim/sim';
import { Team } from '../src/sim/sim';
import { createStreams } from '../src/sim/rng';
import { stat, Stat } from '../src/sim/stats';
import { makeOffer } from '../src/sim/systems/draft';
import { emptyMods } from '../src/sim/powers';
import { arena, fixtureConfig, withPowers, type Unit } from './helpers';

const Red = Team.Red;
const ult: Command = { tick: 0, player: 0, moveX: 0, moveY: 0, ult: true, draftPick: -1, reroll: false };

/** The arena with the shipped catalogue; `powers` granted to the shooter (player 0) before the first step. */
function withGrants(units: Unit[], powers: string[], tweak?: (c: Config) => void) {
  const m = arena(units, (c) => {
    withPowers(c);
    tweak?.(c);
  });
  for (const p of powers) m.sim.debug.grantPower(m.shooter, p);
  return m;
}

/** Steps until unit `id` has lost HP; returns how much the first volley took. */
function firstVolley(m: ReturnType<typeof arena>, id: number, start = 1000) {
  for (let i = 0; i < 120 && m.hp(id) === start; i++) m.step(1);
  m.step(1); // a second bullet of the same volley lands within a tick
  return start - m.hp(id);
}

/** Fires one bullet from the shooter straight up the y axis by hand (the shooter's own weapon removed). */
function oneBullet(m: ReturnType<typeof arena>, damage = 95) {
  m.sim.projectiles.spawn(m.shooter, Team.Blue, 0, false, 0, 0.6, 0, 25 / 30, damage, 1, 60);
}

describe('stat Rares (D-060)', () => {
  it('Bounty Hunter: +20% damage to champions', () => {
    expect(firstVolley(withGrants([{ team: Red, x: 0, y: 5 }], ['bountyHunter']), 2)).toBeCloseTo(114);
  });
});

describe('weapon mods (D-060)', () => {
  it('Double Tap: two bullets per shot that both land; a burst weapon gets one more bullet per burst', () => {
    expect(firstVolley(withGrants([{ team: Red, x: 0, y: 5 }], ['doubleTap']), 2)).toBeCloseTo(190);
    const burst = withGrants([], ['doubleTap', 'extendedMag'], (c) => {
      c.champions[0]!.weapon.burstCount = 4;
    });
    expect(burst.sim.stores.weapons.get(burst.shooter)!.burstCount).toBe(7);
  });

  it('Double Tap on a flamethrower: +10° cone and +0.5 m range instead (GDD §8 rule 8)', () => {
    const m = withGrants([], ['doubleTap'], (c) => {
      Object.assign(c.champions[0]!.weapon, { kind: 'cone', coneAngle: (40 * Math.PI) / 180, range: 4, interval: 6 });
    });
    const w = m.sim.stores.weapons.get(m.shooter)!;
    expect(w.coneAngle).toBeCloseTo((50 * Math.PI) / 180);
    expect(w.burstCount).toBe(1);
    expect(stat(m.sim.stores.stats.get(m.shooter)!, Stat.Range)).toBeCloseTo(4.5);
  });

  it('Piercing Rounds: a bullet goes on through the first enemy into the next', () => {
    const m = withGrants([{ team: Red, x: 0, y: 4 }, { team: Red, x: 0, y: 6 }], ['piercingRounds']);
    expect(firstVolley(m, 2)).toBe(95);
    m.step(4);
    expect(m.hp(3)).toBe(905);
  });

  it('Ricochet: the bullet bounces to the nearest other enemy within 4 m for 50%', () => {
    const m = withGrants([{ team: Red, x: 0, y: 5 }, { team: Red, x: 3, y: 5 }], ['ricochet']);
    expect(firstVolley(m, 2)).toBe(95);
    m.step(6);
    expect(m.hp(3)).toBeCloseTo(952.5);
  });

  it('Dead Eye: every 6th shot is a critical hit', () => {
    const m = withGrants([{ team: Red, x: 0, y: 5 }], ['deadEye']);
    m.hp(2, 1e6);
    let crits = 0;
    let hits = 0;
    for (let i = 0; i < 12 * 25 + 20; i++) {
      for (const ev of m.sim.step([]).events) {
        if (ev.type !== 'damage' || ev.target !== 2) continue;
        hits++;
        if (ev.critical) crits++;
      }
    }
    expect(hits).toBeGreaterThanOrEqual(12);
    expect(crits).toBe(Math.floor(hits / 6));
  });
});

describe('on-hit statuses (D-060)', () => {
  it('Incendiary Rounds: a hit burns for 20 per second for 2 s', () => {
    const m = withGrants([{ team: Red, x: 0, y: 5 }], ['incendiaryRounds']);
    m.sim.stores.weapons.remove(m.shooter);
    oneBullet(m);
    m.step(120);
    expect(m.hp(2)).toBeCloseTo(1000 - 95 - 40);
  });

  it('Tracer Rounds: a marked enemy takes +10% from the next hit', () => {
    const m = withGrants([{ team: Red, x: 0, y: 5 }], ['tracerRounds']);
    m.sim.stores.weapons.remove(m.shooter);
    oneBullet(m);
    m.step(10);
    expect(m.hp(2)).toBe(905);
    oneBullet(m);
    m.step(10);
    expect(m.hp(2)).toBeCloseTo(905 - 104.5);
  });
});

describe('triggers (D-060)', () => {
  it('Second Wind: below 30% HP a 20% max HP shield for 3 s, then a 30 s cooldown', () => {
    const m = withGrants([], ['secondWind']);
    const h = m.sim.stores.healths.get(m.shooter)!;
    m.step(1);
    expect(h.shield).toBe(0);
    m.hp(m.shooter, 250);
    m.step(1);
    expect(h.shield).toBeCloseTo(200);
    m.step(90);
    expect(h.shield).toBe(0);
    m.step(30);
    expect(h.shield).toBe(0); // still on cooldown
  });

  it('Dug In: −25% damage taken on a trench floor or near an allied structure, not in the open', () => {
    const m = withGrants([{ team: Team.Blue, x: 0, y: -20, structure: 'subBase' }], ['dugIn'], (c) => {
      c.map.walkable.push({ id: 'trench', shape: 'rect', surface: 'trench', height: 0, x: 10, y: 10, w: 4, h: 4 });
    });
    const taken = () => stat(m.sim.stores.stats.get(m.shooter)!, Stat.DamageTaken);
    m.step(1);
    expect(taken()).toBeCloseTo(1);
    m.move(m.shooter, 10, 10);
    m.step(1);
    expect(taken()).toBeCloseTo(0.75);
    m.move(m.shooter, 0, -16);
    m.step(1);
    expect(taken()).toBeCloseTo(0.75);
    m.move(m.shooter, 0, 0);
    m.step(1);
    expect(taken()).toBeCloseTo(1);
  });

  it('Adrenaline: +30% move speed for 2 s after knocking out an enemy champion', () => {
    const m = withGrants([{ team: Red, x: 0, y: 5 }], ['adrenaline']);
    const speed = () => stat(m.sim.stores.stats.get(m.shooter)!, Stat.MoveSpeed);
    const base = speed();
    m.hp(2, 1);
    let at = -1;
    for (let i = 0; i < 90 && at < 0; i++) for (const ev of m.sim.step([]).events) if (ev.type === 'death' && ev.id === 2) at = m.sim.tick;
    expect(at).toBeGreaterThan(0);
    expect(speed()).toBeCloseTo(base * 1.3);
    m.step(60);
    expect(speed()).toBeCloseTo(base);
  });

  it('Scavenger: heals 3% max HP when an enemy minion dies within 10 m', () => {
    const m = withGrants([], ['scavenger'], (c) => {
      c.waves.enabled = false;
    });
    m.sim.debug.spawnWave();
    m.step(1);
    const { laneAgents, teams, weapons, transforms } = m.sim.stores;
    for (const e of laneAgents.ids) weapons.get(e)!.damage = 0;
    const minion = laneAgents.ids.find((e) => teams.get(e) === Red)!;
    const at = transforms.get(minion)!;
    m.move(m.shooter, at.x + 3, at.y);
    m.sim.stores.weapons.remove(m.shooter);
    m.hp(m.shooter, 500);
    m.sim.debug.kill(minion);
    m.step(1);
    expect(m.hp(m.shooter)).toBeCloseTo(530);
  });
});

describe('Ultimate and flame mods (D-060)', () => {
  it('Cluster Grenade: 3 bomblets for 100 each round the impact', () => {
    const m = withGrants([{ team: Red, x: 0, y: 6 }, { team: Red, x: 2, y: 6 }], ['clusterGrenade'], (c) => {
      Object.assign(c.champions[0]!.ultimate as FragGrenadeConfig, { radius: 1 });
    });
    m.sim.stores.weapons.remove(m.shooter);
    m.sim.debug.fillUltimate(m.shooter);
    let blasts = 0;
    for (const ev of m.sim.step([ult]).events) if (ev.type === 'explosion') blasts++;
    for (let i = 0; i < 20; i++) for (const ev of m.sim.step([]).events) if (ev.type === 'explosion') blasts++;
    expect(blasts).toBe(4);
    expect(m.hp(3)).toBeCloseTo(900); // only the east bomblet reaches it
  });

  it('Inferno Shell: Heat Wave +30% radius and +2 s', () => {
    const m = withGrants([], ['infernoShell'], (c) => {
      c.champions[0] = { ...c.champions.find((ch) => ch.id === 'gamma')!, id: 'alpha' };
    });
    const heat = m.config.champions[0]!.ultimate;
    if (heat.id !== 'heatWave') throw new Error('expected Gamma');
    m.sim.debug.fillUltimate(m.shooter);
    m.sim.step([ult]);
    const c = m.sim.stores.champions.get(m.shooter)!;
    expect(c.auraTicks).toBe(heat.seconds + 60); // cast this tick, after the aura stage
    expect(m.sim.snapshot().entities.find((e) => e.id === m.shooter)!.auraRadius).toBeCloseTo(heat.radius * 1.3);
  });

  it('Napalm Tank: flames leave burning ground every 0.5 s', () => {
    const m = withGrants([{ team: Red, x: 0, y: 2.5 }], ['napalmTank'], (c) => {
      Object.assign(c.champions[0]!.weapon, { kind: 'cone', coneAngle: (40 * Math.PI) / 180, range: 4, interval: 6, damage: 14 });
    });
    m.hp(2, 1e6);
    m.step(31);
    let live = 0;
    for (let i = 0; i < m.sim.zones.capacity; i++) live += m.sim.zones.active[i]!;
    expect(live).toBeGreaterThanOrEqual(2);
  });
});

describe('rarity odds (GDD §8 rule 4, D-060)', () => {
  it('the first card of an offer is Common ~65%, Rare ~30%, Epic ~5%', () => {
    const cfg = fixtureConfig();
    const c = { championId: 'alpha', def: cfg.champions[0]!, powers: {}, mods: emptyMods() } as unknown as Champion;
    const rng = createStreams(7).draft;
    const count = { common: 0, rare: 0, epic: 0 };
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const id = makeOffer(cfg.powers, c, rng, 2)[0]!; // a level with no guaranteed Epic
      count[cfg.powers.powers.find((p) => p.id === id)!.rarity]++;
    }
    expect(count.common / n).toBeCloseTo(0.65, 1);
    expect(count.rare / n).toBeCloseTo(0.3, 1);
    expect(count.epic / n).toBeCloseTo(0.05, 1);
  });

  it('a rarity with nothing left falls back a tier', () => {
    const cfg = fixtureConfig();
    cfg.powers.draft.rarityOdds = { common: 0, rare: 0, epic: 1 };
    cfg.powers.powers = cfg.powers.powers.filter((p) => p.rarity !== 'epic'); // no Epics left to offer
    const beta = cfg.champions.find((ch) => ch.id === 'beta')!;
    const c = { championId: 'beta', def: { ...beta, weaponTags: ['damage', 'defence'] }, powers: {}, mods: emptyMods() } as unknown as Champion; // every card fits: no relevance swap
    const cards = makeOffer(cfg.powers, c, createStreams(3).draft, 2);
    expect(cards).toHaveLength(3);
    for (const id of cards) expect(cfg.powers.powers.find((p) => p.id === id)!.rarity).toBe('rare');
  });
});
