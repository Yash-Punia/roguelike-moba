import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Team, type CampSnapshot, type Snapshot } from '../src/sim/sim';
import { hud, pushNotices, resetNotices, updateHud } from '../src/ui/store';
import { arena, fixtureConfig } from './helpers';

const { Blue, Red } = Team;
const NOTICE_TICKS = 75;

function field() {
  const a = arena([
    { team: Red, x: 8, y: 25 },
    { team: Blue, x: -8, y: -25 },
    { team: Red, x: 10, y: 40, structure: 'hq' },
    { team: Red, x: -10, y: 30, structure: 'subBase' },
  ]);
  const hq = a.sim.stores.structures.ids[0]!;
  const sub = a.sim.stores.structures.ids[1]!;
  /** Runs one notices pass on a fresh snapshot at `tick`. */
  const push = (events: SimEvent[] = [], tick = 0, team = Blue, edit?: (s: Snapshot) => void) => {
    const snap = { ...a.sim.snapshot(), tick };
    edit?.(snap);
    pushNotices(events, snap, a.shooter, team, a.config);
    return snap;
  };
  return { ...a, hq, sub, push };
}

const fell = (team: Team, kind: 'subBase' | 'hq' = 'subBase'): SimEvent => ({ type: 'structureDestroyed', id: 99, kind, team, killer: 0, x: 0, y: 0 });
const camp = (members: number, kind: CampSnapshot['kind'] = 'halftrack'): CampSnapshot => ({ x: 0, y: 0, kind, members, hp: 0, maxHp: 0, engaged: false, leashing: false });

beforeEach(() => {
  resetNotices();
  hud.boardOpen.value = false;
  hud.board.value = [];
});

describe('HUD notices (TDD §10, D-087)', () => {
  it.each([
    [Blue, Blue, 'Our Sub-base lost', 'bad'],
    [Red, Blue, 'Enemy Sub-base destroyed', 'good'],
    [Blue, Red, 'Enemy Sub-base destroyed', 'good'],
    [Red, Red, 'Our Sub-base lost', 'bad'],
  ] as const)('a %d Sub-base falling, seen by team %d: %s', (team, viewer, text, tone) => {
    field().push([fell(team)], 0, viewer);
    expect([hud.notice.value?.text, hud.notice.value?.tone]).toEqual([text, tone]);
  });

  it('names the HQ, last line and Sudden Death', () => {
    const f = field();
    f.push([fell(Red, 'hq')]);
    expect(hud.notice.value?.text).toBe('Enemy HQ destroyed');
    resetNotices();
    f.push([{ type: 'hqLastLine', id: f.hq, team: Blue }]);
    expect(hud.notice.value?.text).toBe('Our HQ: last line');
    resetNotices();
    f.push([{ type: 'phaseChanged', phase: 'suddenDeath' }]);
    expect(hud.notice.value?.text).toBe('Sudden Death');
  });

  it('shows one at a time in order, and clears when none is left', () => {
    const f = field();
    f.push([fell(Red), fell(Blue)]);
    expect(hud.notice.value?.text).toBe('Enemy Sub-base destroyed');
    f.push([], NOTICE_TICKS - 1);
    expect(hud.notice.value?.text).toBe('Enemy Sub-base destroyed');
    f.push([], NOTICE_TICKS);
    expect(hud.notice.value?.text).toBe('Our Sub-base lost');
    f.push([], 2 * NOTICE_TICKS);
    expect(hud.notice.value).toBeNull();
  });

  it('keeps only the newest few waiting', () => {
    const f = field();
    f.push([fell(Red)]); // showing
    f.push([fell(Blue), fell(Blue), fell(Blue), fell(Blue), fell(Red, 'hq')], 1);
    const seen: string[] = [];
    for (let i = 1; i <= 4; i++) {
      f.push([], i * NOTICE_TICKS);
      seen.push(hud.notice.value!.text);
    }
    expect(seen).toEqual(['Our Sub-base lost', 'Our Sub-base lost', 'Our Sub-base lost', 'Enemy HQ destroyed']);
  });

  it('announces a boss when it appears, not on the first look, and who took it', () => {
    const f = field();
    const camps = (c: CampSnapshot[]) => (s: Snapshot) => (s.camps = c);
    f.push([], 0, Blue, camps([camp(1), camp(0, 'behemoth'), camp(0, 'deserter')]));
    expect(hud.notice.value).toBeNull();
    f.push([], 1, Blue, camps([camp(1), camp(1, 'behemoth'), camp(3, 'deserter')]));
    expect(hud.notice.value?.text).toBe('Behemoth has awoken');
    resetNotices();
    f.push([], 0, Blue, camps([camp(0)]));
    f.push([], 1, Blue, camps([camp(1)]));
    expect(hud.notice.value?.text).toBe('Halftrack spotted');
    resetNotices();
    f.push([{ type: 'campCleared', camp: 'HT', kind: 'halftrack', team: Red, x: 0, y: 0 }]);
    expect(hud.notice.value?.text).toBe('Enemy took the Halftrack');
    resetNotices();
    f.push([{ type: 'campCleared', camp: 'C1', kind: 'deserter', team: Red, x: 0, y: 0 }]);
    expect(hud.notice.value).toBeNull();
  });

  it('announces a bounty once, on reaching the streak', () => {
    const f = field();
    const rival = f.sim.stores.champions.get(2)!;
    rival.streak = 2;
    f.push();
    expect(hud.notice.value).toBeNull();
    rival.streak = 3;
    f.push([], 1);
    expect(hud.notice.value?.text).toBe('Enemy Alpha has a bounty');
    rival.streak = 4;
    f.push([], NOTICE_TICKS + 1);
    expect(hud.notice.value).toBeNull();
    f.sim.stores.champions.get(f.shooter)!.streak = 3;
    f.push([], NOTICE_TICKS + 2);
    expect(hud.notice.value?.text).toBe('You have a bounty');
  });
});

describe('HUD respawn overlay (D-087)', () => {
  /** The local champion down, killed by `killer`; returns the view. */
  function knockedOut(f: ReturnType<typeof field>, killer: number) {
    f.sim.debug.kill(f.shooter);
    f.step();
    f.push([{ type: 'death', id: f.shooter, team: Blue, killer, x: 0, y: 0 }]);
    updateHud(f.sim.snapshot(), f.shooter, Blue);
    return hud.respawn.value;
  }

  it('counts down and names a champion, in its side', () => {
    const f = field();
    const v = knockedOut(f, 2)!;
    const ticks = f.sim.stores.champions.get(f.shooter)!.respawnTicks;
    expect(v).toEqual({ seconds: Math.ceil(ticks / 30), killerName: 'Alpha', killerSide: 'theirs' });
  });

  it('names structures and soldiers', () => {
    const hq = field();
    expect(knockedOut(hq, hq.hq)!.killerName).toBe(hq.config.structures.hq.name);
    resetNotices();
    const sub = field();
    expect(knockedOut(sub, sub.sub)!.killerName).toBe(sub.config.structures.subBase.name);
    resetNotices();
    const w = field();
    w.sim.debug.spawnWave();
    const soldier = w.sim.stores.laneAgents.ids[0]!;
    expect(knockedOut(w, soldier)!.killerName).toBe(w.config.units.mgSoldier.name);
  });

  it('keeps the name once its killer is gone, shows none for an unknown killer, and clears on respawn', () => {
    const f = field();
    knockedOut(f, 2);
    const later = f.sim.snapshot();
    later.entities = later.entities.filter((e) => e.id !== 2);
    updateHud(later, f.shooter, Blue);
    expect(hud.respawn.value?.killerName).toBe('Alpha');
    f.step(30 * 30);
    updateHud(f.sim.snapshot(), f.shooter, Blue);
    expect(hud.respawn.value).toBeNull();
    resetNotices();
    expect(knockedOut(f, 12345)!.killerName).toBe('');
  });
});

describe('HUD scoreboard (D-087)', () => {
  it('lists your side first with its stats, and fills only while open', () => {
    const f = field();
    const c = fixtureConfig();
    const snap = f.sim.snapshot();
    const you = snap.entities.find((e) => e.id === f.shooter)!;
    Object.assign(you, { kills: 2, deaths: 1, assists: 3, level: 4, powers: { deadEye: 2, fieldRations: 1 } });
    updateHud(snap, f.shooter, Blue, c.powers, c.champions);
    expect(hud.board.value).toEqual([]);
    hud.boardOpen.value = true;
    updateHud(snap, f.shooter, Blue, c.powers, c.champions);
    expect(hud.board.value.map((r) => [r.id, r.side, r.me])).toEqual([
      [1, 'ours', true],
      [3, 'ours', false],
      [2, 'theirs', false],
    ]);
    expect(hud.board.value[0]).toMatchObject({ name: 'Alpha', level: 4, kills: 2, deaths: 1, assists: 3, down: false, powers: { common: 1, rare: 2, epic: 0 } });
  });

  it('flips sides for a Red viewer', () => {
    const f = field();
    hud.boardOpen.value = true;
    updateHud(f.sim.snapshot(), 2, Red);
    expect(hud.board.value.map((r) => [r.id, r.side, r.me])).toEqual([
      [2, 'ours', true],
      [1, 'theirs', false],
      [3, 'theirs', false],
    ]);
  });
});
