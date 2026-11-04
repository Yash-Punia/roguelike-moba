import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Team, type Command } from '../src/sim/sim';
import { respawnTicks } from '../src/sim/systems/life';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;
const RESPAWN = { baseSeconds: 4, perLevelSeconds: 1.2, maxSeconds: 18, sprintPct: 0 };

const move = (player: number, moveX: number, moveY = 0): Command => ({ tick: 0, player, moveX, moveY, ult: false, draftPick: -1, reroll: false });

/** Arena that records every event (copied) with the tick it happened on. */
function field(units: Unit[]) {
  const a = arena(units);
  const events: (SimEvent & { tick: number })[] = [];
  const run = (n = 1, commands: Command[] = []) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step(commands).events) events.push({ ...ev, tick: a.sim.tick - 1 });
  };
  const champ = (id: number) => a.sim.stores.champions.get(id)!;
  const pos = (id: number) => {
    const t = a.sim.stores.transforms.get(id)!;
    return { x: t.x, y: t.y };
  };
  const of = <T extends SimEvent['type']>(type: T) => events.filter((e) => e.type === type) as (Extract<SimEvent, { type: T }> & { tick: number })[];
  return { ...a, events, run, champ, pos, of };
}

describe('respawn timer (GDD §9)', () => {
  it('is 4 s + 1.2 s × level, capped at 18 s', () => {
    expect(respawnTicks(1, RESPAWN)).toBe(156);
    expect(respawnTicks(10, RESPAWN)).toBe(480);
    expect(respawnTicks(12, RESPAWN)).toBe(540);
  });
});

describe('death', () => {
  it('knocks the champion out with credit to the killer and starts the timer', () => {
    const a = field([{ team: Red, x: 0, y: 5 }]);
    a.hp(2, 50);
    a.run(10);
    const [death] = a.of('death');
    expect(death).toMatchObject({ id: 2, killer: a.shooter, x: 0, y: 5 });
    expect(a.champ(2).respawnTicks).toBe(156 - (a.sim.tick - 1 - death!.tick));
    const s = a.sim.snapshot().entities.find((e) => e.id === 2)!;
    expect([s.killer, s.respawnTicks > 0]).toEqual([a.shooter, true]);
  });

  it('credits no one for a debug kill', () => {
    const a = field([{ team: Red, x: 0, y: 20 }]);
    a.sim.debug.kill(2);
    a.run();
    expect(a.of('death')[0]).toMatchObject({ id: 2, killer: 0 });
  });

  it('leaves the knocked-out champion still: no moving, firing, charging or being targeted', () => {
    const a = field([{ team: Red, x: 0, y: 5, armed: true }]);
    // Bullets it fired before going down may still land and charge it (D-065); this checks the passive charge stops.
    Object.assign(a.config.progression.ultCharge, { perDamageDealt: Infinity, perDamageTaken: Infinity });
    a.run();
    a.sim.debug.kill(2);
    a.run();
    const charge = a.champ(2).ultCharge;
    const shotsBefore = a.of('shot').filter((e) => e.id === 2).length;
    a.run(60, [move(1, 127, 127)]);
    expect(a.pos(2)).toEqual({ x: 0, y: 5 });
    expect(a.sim.snapshot().entities.find((e) => e.id === 2)!.vx).toBe(0);
    expect(a.of('shot').filter((e) => e.id === 2).length).toBe(shotsBefore);
    expect(a.champ(2).ultCharge).toBe(charge);
    expect(a.target()).toBe(0);
    expect(a.of('damage').filter((e) => e.target === 2 && e.tick > 1)).toHaveLength(0);
  });
});

describe('respawn', () => {
  it('redeploys on the HQ pad after exactly the timer, fresh but keeping the Ultimate charge', () => {
    const a = field([{ team: Red, x: 0, y: 20, atPad: true }]); // starts on the Red pad (0, 42)
    a.move(2, 3, 30);
    a.sim.debug.fillUltimate(2);
    a.sim.debug.addShield(2, 100);
    a.sim.debug.kill(2);
    a.run(); // dies this tick
    a.run(155);
    expect(a.of('respawn')).toHaveLength(0);
    a.run();
    expect(a.of('respawn')[0]).toMatchObject({ id: 2, x: 0, y: 42 });
    expect(a.pos(2)).toEqual({ x: 0, y: 42 });
    const h = a.sim.stores.healths.get(2)!;
    expect([h.hp, h.shield, h.killer]).toEqual([1000, 0, 0]);
    expect(a.champ(2).respawnTicks).toBe(0);
    expect(a.champ(2).ultCharge).toBe(100);
    expect(a.sim.stores.transforms.get(2)!.facing).toBeCloseTo(-Math.PI / 2);
    a.run(30, [move(1, 127)]);
    expect(a.pos(2).x).toBeGreaterThan(0); // moves again
  });

  it('returns a unit placed with a debug spawn point to that spot', () => {
    const a = field([{ team: Red, x: 0, y: 5 }]);
    a.move(2, 3, 3);
    a.sim.debug.kill(2);
    a.run(157);
    expect(a.pos(2)).toEqual({ x: 0, y: 5 });
  });

  it('is targeted and shot again once back', () => {
    const a = field([{ team: Red, x: 0, y: 5 }]);
    a.hp(2, 50);
    a.run(200);
    expect(a.of('damage').filter((e) => e.target === 2 && e.tick > a.of('respawn')[0]!.tick).length).toBeGreaterThan(0);
  });
});

describe('spawn-pad heal', () => {
  it('heals 10% max HP per second on your own pad, up to max', () => {
    const a = field([{ team: Blue, x: 0, y: 0, atPad: true }]); // on the Blue pad (0, −42)
    a.hp(2, 500);
    a.run(30);
    expect(a.hp(2)).toBeCloseTo(600);
    a.hp(2, 990);
    a.run(30);
    expect(a.hp(2)).toBe(1000);
  });

  it('does nothing off the pad or on the enemy pad', () => {
    const a = field([
      { team: Blue, x: 0, y: -38.5, atPad: true }, // 3.5 m off its own pad
      { team: Red, x: 0, y: 0, atPad: true },
    ]);
    a.move(2, 0, -38.5);
    a.move(3, 0, -42); // a Red champion standing on the Blue pad
    a.hp(2, 500);
    a.hp(3, 500);
    a.run(30);
    expect([a.hp(2), a.hp(3)]).toEqual([500, 500]);
  });
});

describe('Redeploy sprint (GDD §9, D-067)', () => {
  /** A Blue champion (the shooter) knocked out and redeployed at its (0, 0) spot with the sprint on. */
  function redeployed(units: Unit[] = []) {
    const a = field(units);
    a.config.match.respawn.sprintPct = 0.5;
    a.run();
    a.sim.debug.kill(a.shooter);
    for (let i = 0; i < 400 && a.of('respawn').length === 0; i++) a.run();
    return a;
  }
  const speed = (a: ReturnType<typeof field>, id: number) => a.sim.stores.motions.get(id)!.speed;

  it('+50% move speed after respawning; kept while moving away from the enemy', () => {
    const a = redeployed();
    expect(speed(a, a.shooter)).toBeCloseTo(7.5);
    a.run(30, [move(0, 0, -127)]);
    expect(speed(a, a.shooter)).toBeCloseTo(7.5);
  });

  it('ends on crossing y = 0 towards the enemy', () => {
    const a = redeployed();
    a.run(10, [move(0, 0, 127)]);
    expect(speed(a, a.shooter)).toBeCloseTo(5);
  });

  it('ends once it takes damage', () => {
    const a = redeployed([{ team: Red, x: 0, y: -8 }]);
    a.sim.projectiles.spawn(2, Red, a.shooter, true, 0, -6, 0, 25 / 30, 10, 1, 30);
    a.run(10);
    expect(speed(a, a.shooter)).toBeCloseTo(5);
  });

  it('a Red champion sprints until it crosses y = 0 the other way', () => {
    const a = field([{ team: Red, x: 0, y: 10 }]);
    a.config.match.respawn.sprintPct = 0.5;
    a.run();
    a.sim.debug.kill(2);
    for (let i = 0; i < 400 && a.of('respawn').length === 0; i++) a.run();
    expect(speed(a, 2)).toBeCloseTo(7.5);
    a.move(2, 0, -0.5);
    a.run(2);
    expect(speed(a, 2)).toBeCloseTo(5);
  });
});
