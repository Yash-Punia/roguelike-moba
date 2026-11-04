import { describe, expect, it } from 'vitest';
import type { Config } from '../src/data/schema';
import { Team } from '../src/sim/sim';
import { arena, at, O, raiseGround } from './helpers';

const fogOn = (c: Config) => {
  c.combat.fog.enabled = true;
};

describe('fog of war (D-010)', () => {
  /** Blue's view of Red champion 2. */
  const seenByBlue = (m: ReturnType<typeof arena>) => (m.sim.stores.concealments.get(2)!.visible & (1 << Team.Blue)) !== 0;

  it('an enemy beyond every Blue unit\'s vision is unseen until an ally comes within its radius', () => {
    const m = arena([{ team: Team.Red, ...at(0, 12) }, { team: Team.Blue, ...at(-10, -10) }], fogOn);
    m.move(1, O.x, O.y); // 12 m away: beyond a champion's 10 m
    m.step(3);
    expect(seenByBlue(m)).toBe(false);
    m.move(3, O.x + 2, O.y + 14); // the ally walks up: team vision is the union
    m.step(3);
    expect(seenByBlue(m)).toBe(true);
  });

  it('raised ground blocks vision', () => {
    const blocked = arena([{ team: Team.Red, ...at(0, 5) }], (c) => {
      fogOn(c);
      raiseGround(c, O.x - 2, O.x + 2, O.y + 2, O.y + 3);
    });
    blocked.move(1, O.x, O.y);
    blocked.step(3);
    expect(seenByBlue(blocked)).toBe(false);
  });

  it('the Trench 3 m reveal does not work through a bank', () => {
    const trench = (bank: boolean) => arena([{ team: Team.Red, ...at(0, 3.8) }], (c) => {
      fogOn(c);
      if (bank) raiseGround(c, O.x - 2, O.x + 2, O.y + 2, O.y + 3);
      c.map.walkable.push({ id: 'trench', shape: 'rect', surface: 'trench', height: 0, ...at(0, 4), w: 4, h: 2 });
    });
    for (const bank of [false, true]) {
      const m = trench(bank);
      m.move(1, O.x, O.y + 1.5); // 2.3 m from Red, outside the trench
      m.step(3);
      expect(seenByBlue(m)).toBe(!bank);
    }
  });

  it('a knocked-out champion gives no vision', () => {
    const m = arena([{ team: Team.Red, ...at(0, 12) }, { team: Team.Blue, ...at(0, 9) }], fogOn);
    m.move(1, O.x, O.y - 20);
    m.step(3);
    expect(seenByBlue(m)).toBe(true);
    m.hp(3, 0);
    m.step(3);
    expect(seenByBlue(m)).toBe(false);
  });

  it('vision is rebuilt every 3 ticks', () => {
    const m = arena([{ team: Team.Red, ...at(0, 12) }, { team: Team.Blue, ...at(-10, -10) }], fogOn);
    m.move(1, O.x, O.y - 20);
    while (m.sim.tick % 3 !== 1) m.step(1); // the next two ticks don't rebuild
    m.move(3, O.x, O.y + 9);
    m.step(2);
    expect(seenByBlue(m)).toBe(false);
    m.step(1);
    expect(seenByBlue(m)).toBe(true);
  });

  it('with fog off everyone is seen, as before', () => {
    const m = arena([{ team: Team.Red, ...at(0, 20) }]);
    m.step(3);
    expect(seenByBlue(m)).toBe(true);
    expect(m.sim.vision.teams[Team.Blue]!.every((v) => v === 1)).toBe(true);
  });
});
