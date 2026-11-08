import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Team, type Snapshot } from '../src/sim/sim';
import { hud, pushNotices, resetNotices } from '../src/ui/store';
import { arena } from './helpers';

const { Blue, Red } = Team;
const BANNER = 90;
const WINDOW = 300; // ticks

/** Blue: 1 (you), 3. Red: 2, 4. Then a Red Pillbox (entity 5) and the banner text helpers. */
function field() {
  const a = arena(
    [
      { team: Red, x: 8, y: 25 },
      { team: Blue, x: -8, y: -25 },
      { team: Red, x: 12, y: 25 },
      { team: Red, x: -10, y: 30, structure: 'subBase' },
    ],
    (c) => {
      c.progression.announcer = { multiKillSeconds: WINDOW, shutdownKills: 3 };
    },
  );
  const sub = a.sim.stores.structures.ids[0]!;
  const death = (id: number, killer: number, team: Team): SimEvent => ({ type: 'death', id, team, killer, x: 0, y: 0 });
  /** Runs a notices pass, `down` marking champions as knocked out in the snapshot. */
  const push = (events: SimEvent[], tick: number, viewer = Blue, local: number | undefined = a.shooter, down: number[] = []) => {
    const snap: Snapshot = { ...a.sim.snapshot(), tick };
    for (const e of snap.entities) if (down.includes(e.id)) e.hp = 0;
    pushNotices(events, snap, local, viewer, a.config);
  };
  const shown = () => (hud.kill.value ? [hud.kill.value.headline, hud.kill.value.parts.map((p) => p.text).join('')] : null);
  return { ...a, sub, death, push, shown };
}

beforeEach(() => resetNotices());

describe('kill banners (D-088)', () => {
  it('names killer and victim, says You for the local player, and colours by side', () => {
    const f = field();
    f.push([f.death(2, 3, Red)], 0);
    expect(f.shown()).toEqual(['FIRST BLOOD', 'Alpha has slain Alpha']);
    expect(hud.kill.value!.parts.map((p) => p.side)).toEqual(['ours', 'plain', 'theirs']);
    f.push([f.death(4, 1, Red)], BANNER);
    expect(f.shown()).toEqual(['', 'You have slain Alpha']);
    f.push([f.death(1, 2, Blue)], 2 * BANNER);
    expect(f.shown()).toEqual(['', 'Alpha has slain you']);
  });

  it('flips the sides for a Red viewer', () => {
    const f = field();
    f.push([f.death(2, 3, Red)], 0, Red, 2);
    expect(hud.kill.value!.parts.map((p) => [p.text, p.side])).toEqual([['Alpha', 'theirs'], [' has slain ', 'plain'], ['you', 'ours']]);
  });

  it('names a structure killer, and gives no first blood for it', () => {
    const f = field();
    f.push([f.death(3, f.sub, Blue)], 0);
    expect(f.shown()).toEqual(['', `Alpha was slain by the ${f.config.structures.subBase.name}`]);
    f.push([f.death(1, f.sub, Blue)], BANNER);
    expect(f.shown()).toEqual(['', `You were slain by the ${f.config.structures.subBase.name}`]);
    f.push([f.death(2, 3, Red)], 2 * BANNER);
    expect(f.shown()![0]).toBe('FIRST BLOOD');
  });

  it('with an unknown killer just says so', () => {
    const f = field();
    f.push([f.death(3, 12345, Blue)], 0);
    expect(f.shown()).toEqual(['', 'Alpha was slain']);
  });

  it('chains multi-kills inside the window, and starts over outside it', () => {
    const f = field();
    f.push([f.death(2, 1, Red)], 0); // first blood
    f.push([f.death(4, 1, Red)], WINDOW);
    expect(f.shown()![0]).toBe('DOUBLE KILL');
    f.push([f.death(2, 1, Red)], 2 * WINDOW);
    expect(f.shown()![0]).toBe('TRIPLE KILL');
    f.push([f.death(4, 1, Red)], 3 * WINDOW + 1);
    expect(f.shown()![0]).toBe('RAMPAGE'); // 4 without dying, chain over
  });

  it('names sprees, and a spree’s end is a shutdown', () => {
    const f = field();
    const gap = WINDOW + 1;
    f.push([f.death(2, 1, Red)], 0);
    f.push([f.death(4, 1, Red)], gap);
    expect(f.shown()![0]).toBe('');
    f.push([f.death(2, 1, Red)], 2 * gap);
    expect(f.shown()![0]).toBe('KILLING SPREE');
    f.push([f.death(1, 2, Blue)], 3 * gap);
    expect(f.shown()).toEqual(['SHUTDOWN', 'Alpha has slain you']);
    f.push([f.death(2, 1, Red)], 4 * gap);
    expect(f.shown()![0]).toBe(''); // the spree started over
  });

  it('announces an Ace once per wipe, after the kill, for a team of two or more', () => {
    const f = field();
    f.push([f.death(2, 1, Red)], 0, Blue, 1, [2]);
    f.push([f.death(4, 1, Red)], BANNER, Blue, 1, [2, 4]);
    expect(f.shown()![0]).toBe('DOUBLE KILL');
    f.push([], 2 * BANNER, Blue, 1, [2, 4]);
    expect(f.shown()).toEqual(['ACE', 'Enemy team is down']);
    expect(hud.kill.value!.parts[0]!.side).toBe('theirs');
    f.push([], 3 * BANNER, Blue, 1, [2, 4]);
    expect(hud.kill.value).toBeNull();
    f.push([], 4 * BANNER, Blue, 1, []); // back up
    f.push([f.death(2, 1, Red), f.death(4, 3, Red)], 5 * BANNER, Blue, 1, [2, 4]);
    f.push([], 6 * BANNER, Blue, 1, [2, 4]);
    f.push([], 7 * BANNER, Blue, 1, [2, 4]);
    expect(f.shown()![0]).toBe('ACE');
  });

  it('never knocks a structure notice out of its own queue', () => {
    const f = field();
    f.push(
      [f.death(2, 1, Red), f.death(4, 1, Red), f.death(2, 1, Red), f.death(4, 1, Red), f.death(2, 1, Red), { type: 'structureDestroyed', id: 9, kind: 'subBase', team: Blue, killer: 0, x: 0, y: 0 }],
      0,
    );
    expect(hud.notice.value?.text).toBe('Our Sub-base lost');
    expect(hud.kill.value).not.toBeNull();
  });
});
