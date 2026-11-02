import { describe, expect, it } from 'vitest';
import { Team, type Command } from '../src/sim/sim';
import { Stat } from '../src/sim/stats';
import { segmentCircle } from '../src/sim/systems/projectiles';
import { interceptTime } from '../src/sim/systems/weapons';
import { arena } from './helpers';

const { Blue, Red } = Team;
const strafe = (player: number, moveX: number): Command => ({ tick: 0, player, moveX, moveY: 0, ult: false, draftPick: -1, reroll: false });

describe('aiming and firing (TDD §6.3)', () => {
  it('fires as soon as it is aimed, then once per 25-tick interval', () => {
    const a = arena([{ team: Red, x: 0, y: 5 }]); // straight ahead of Blue's starting aim
    a.step();
    expect(a.shots()).toBe(1);
    a.step(99);
    expect(a.shots()).toBe(4); // ticks 1, 26, 51, 76
  });

  it('turns the aim at 720°/s and only fires within 10° of the target', () => {
    const a = arena([{ team: Red, x: 0, y: -5 }]); // directly behind: a 180° turn at 24°/tick
    a.step(7); // 168° turned, still 12° off
    expect(a.shots()).toBe(0);
    a.step();
    expect(a.shots()).toBe(1);
  });

  it('carries the cooldown remainder, so +20% fire rate gives 1.2× the shots', () => {
    const a = arena([{ team: Red, x: 0, y: 4, structure: 'subBase' }]); // 6,000 HP: survives the test
    const st = a.sim.stores.stats.get(a.shooter)!;
    st.pct[Stat.FireRate] = 0.2;
    st.dirty = true;
    a.step(1000);
    expect(Math.abs(a.shots() - (1000 * 1.2) / 25)).toBeLessThanOrEqual(1);
  });

  it('holds fire for the retarget pause after the target dies', () => {
    const a = arena([{ team: Red, x: 0, y: 3 }, { team: Red, x: 0.5, y: 5 }], (c) => {
      c.champions[0]!.weapon.interval = 1; // fire every tick, so only the pause can stop it
    });
    a.step();
    expect(a.shots()).toBe(1);
    a.hp(2, 0);
    a.step(6);
    expect(a.shots()).toBe(1);
    a.step();
    expect(a.shots()).toBe(2);
  });

  it('an armed enemy fires back; an unarmed one never does', () => {
    const duel = arena([{ team: Red, x: 0, y: 5, armed: true }]);
    duel.step(10);
    expect(duel.hp(duel.shooter)).toBe(1000 - 95);
    const dummy = arena([{ team: Red, x: 0, y: 5 }]);
    dummy.step(60);
    expect(dummy.hp(dummy.shooter)).toBe(1000);
  });

  it('does not fire without a target', () => {
    const a = arena([{ team: Red, x: 0, y: 20 }]);
    a.step(60);
    expect(a.shots()).toBe(0);
    expect(a.sim.projectiles.live).toBe(0);
  });
});

describe('bullets', () => {
  it('fly straight and deal their damage on contact', () => {
    const a = arena([{ team: Red, x: 0, y: 5 }]);
    a.step();
    expect(a.sim.projectiles.live).toBe(1);
    a.step(5);
    expect(a.hp(2)).toBe(1000 - 95);
    expect(a.sim.projectiles.live).toBe(0);
  });

  it('lead the target, so a champion strafing at full speed is still hit', () => {
    const a = arena([{ team: Red, x: 0, y: 6 }]);
    a.step(20, [strafe(1, 127)]);
    expect(a.hp(2)).toBe(1000 - 95);
  });

  it('miss a strafing champion when aimed straight at it (direct mode)', () => {
    const a = arena([{ team: Red, x: 0, y: 6 }], (c) => (c.combat.weapons.bulletAim = 'direct'));
    a.step(20, [strafe(1, 127)]);
    expect(a.hp(2)).toBe(1000);
  });

  it('can be dodged by reversing direction while the bullet is in flight', () => {
    const a = arena([{ team: Red, x: 0, y: 6.4 }]);
    a.step(1, [strafe(1, 127)]); // shot fired, leading to the right
    a.step(19, [strafe(1, -127)]);
    expect(a.hp(2)).toBe(1000);
  });

  it('hit the first enemy in the path: a Sub-base blocks a shot at a champion behind it', () => {
    const a = arena([{ team: Red, x: 0, y: 6.5 }, { team: Red, x: 0, y: 3.5, structure: 'subBase' }]);
    expect(a.step()).toBe(2); // the champion is the target...
    a.step(10);
    expect(a.hp(2)).toBe(1000); // ...but the Sub-base took the bullet
    expect(a.hp(3)).toBe(a.sim.stores.healths.get(3)!.maxHp - 95);
  });

  it('pass through allies', () => {
    const a = arena([{ team: Red, x: 0, y: 6.5 }, { team: Blue, x: 0, y: 3 }]);
    a.step(10);
    expect(a.hp(2)).toBe(1000 - 95);
    expect(a.hp(3)).toBe(1000);
  });

  it('home onto their target past blockers in homing mode', () => {
    const a = arena([{ team: Red, x: 0, y: 6.5 }, { team: Red, x: 0, y: 3.5, structure: 'subBase' }], (c) => (c.combat.weapons.bulletAim = 'homing'));
    a.step(12);
    expect(a.hp(2)).toBe(1000 - 95);
    expect(a.hp(3)).toBe(a.sim.stores.healths.get(3)!.maxHp);
  });

  it('expire after range + overshoot without hitting anything', () => {
    const a = arena([{ team: Red, x: 0, y: 5 }]);
    a.step();
    a.move(2, 20, 0); // the target vanishes from the bullet's path
    a.step(11); // 9 m at 0.833 m/tick = 11 ticks
    expect(a.sim.projectiles.live).toBe(0);
    expect(a.hp(2)).toBe(1000);
  });

  it('appear in the snapshot with velocity in m/s', () => {
    const a = arena([{ team: Red, x: 0, y: 5 }]);
    a.step();
    const [p] = a.sim.snapshot().projectiles;
    expect(p).toMatchObject({ team: Blue });
    expect(p!.vx).toBeCloseTo(0, 9);
    expect(p!.vy).toBeCloseTo(25, 9);
  });
});

describe('geometry helpers', () => {
  it('interceptTime leads a moving target exactly', () => {
    const t = interceptTime(0, 10, 5, 0, 25);
    expect(Math.hypot(5 * t, 10)).toBeCloseTo(25 * t, 9);
    expect(interceptTime(0, 10, 0, 0, 25)).toBeCloseTo(0.4, 9);
    expect(interceptTime(0, 10, 0, 30, 25)).toBe(0); // can't catch it: fire straight
  });

  it('segmentCircle finds the entry point, a start inside, and misses', () => {
    expect(segmentCircle(0, 0, 10, 0, 5, 0, 1)).toBeCloseTo(0.4);
    expect(segmentCircle(5, 0, 10, 0, 5, 0, 1)).toBe(0);
    expect(segmentCircle(0, 2, 10, 2, 5, 0, 1)).toBe(-1);
    expect(segmentCircle(0, 0, 3, 0, 5, 0, 1)).toBe(-1);
  });
});
