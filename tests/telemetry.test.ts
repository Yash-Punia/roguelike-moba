import { describe, expect, it } from 'vitest';
import { Team } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/events';
import { createTelemetry } from '../src/tools/telemetry';
import { arena } from './helpers';

const { Red } = Team;

const meta = { version: '0', configHash: '0', seed: 1, query: '', map: 'test', lanes: 3, teamSize: 1, difficulty: 'normal', champion: 'alpha', team: 'blue' as const, localEntity: 1, startedAt: '' };
const device = { userAgent: 'test', coarsePointer: false, pixelRatio: 1, screen: { width: 1, height: 1 } };

/** An arena match with a recorder fed exactly like `match.ts` does. */
function recorded(units: Parameters<typeof arena>[0]) {
  const a = arena(units);
  const t = createTelemetry(meta, device);
  const step = (n = 1, events: SimEvent[] = [], move = 0) => {
    for (let i = 0; i < n; i++) {
      const res = a.sim.step([{ tick: a.sim.tick, player: 0, moveX: move, moveY: 0, ult: false, draftPick: -1, reroll: false }]);
      t.onStep([...res.events, ...events], a.sim.snapshot());
    }
  };
  return { a, t, step };
}

describe('telemetry (D-115)', () => {
  it('records a champion knock-out with where it happened and who did it', () => {
    const { a, t, step } = recorded([{ team: Red, x: 0, y: 5 }]);
    a.hp(2, 1);
    step(60);
    const d = t.record().deaths;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ champion: 2, killer: a.shooter, killerKind: 'champion', killerModel: 'alpha', x: 0, y: 5 });
  });

  it('records an Ultimate cast with what it was aimed at', () => {
    const { t, step } = recorded([{ team: Red, x: 0, y: 5 }]);
    step(1, [{ type: 'ultCast', id: 1, target: 2, x: 0, y: 5 }, { type: 'ultCast', id: 1, target: 0, x: 1, y: 1 }]);
    expect(t.record().ultimates).toEqual([
      { tick: 0, champion: 1, target: 2, targetKind: 'champion', x: 0, y: 5 },
      { tick: 0, champion: 1, target: 0, targetKind: null, x: 1, y: 1 },
    ]);
  });

  it('skips minion deaths and keeps draft offers, rerolls and picks with the timer flag', () => {
    const { t, step } = recorded([]);
    const cards = ['a', 'b', 'c'];
    step(1, [
      { type: 'death', id: 99, team: 1, killer: 1, x: 0, y: 0, unit: 'mgSoldier' },
      { type: 'draftOffered', id: 1, cards },
      { type: 'draftRerolled', id: 1, cards: ['d', 'e', 'f'] },
      { type: 'powerPicked', id: 1, power: 'e', auto: true },
    ]);
    cards[0] = 'changed'; // events are pooled: the record keeps its own copy
    const r = t.record();
    expect(r.deaths).toHaveLength(0);
    expect(r.draft.offers[0]!.cards).toEqual(['a', 'b', 'c']);
    expect(r.draft.rerolls[0]!.cards).toEqual(['d', 'e', 'f']);
    expect(r.draft.picks[0]).toMatchObject({ champion: 1, power: 'e', auto: true });
  });

  it('adds up distance and still time, without the jump of a teleport', () => {
    const { a, t, step } = recorded([]);
    step(30, [], 127); // 1 s at 5 m/s
    step(30); // 1 s standing
    a.move(a.shooter, 30, 0); // a respawn-like jump
    step(1);
    const me = t.record().champions[0]!;
    expect(me.distance).toBeGreaterThan(4);
    expect(me.distance).toBeLessThan(5.5);
    expect(me.stillSeconds).toBeGreaterThanOrEqual(1);
    expect(me.human).toBe(true);
  });

  it('samples levels every minute, ends with the result and stops recording after it', () => {
    const { a, t, step } = recorded([{ team: Red, x: 30, y: 30 }]);
    step(1800);
    expect(t.record().champions[0]!.levelsByMinute).toHaveLength(2); // minute 1, and now
    const tick = a.sim.tick; // the tick the next step runs, as the sim stamps its events
    step(1, [{ type: 'matchOver', winner: Team.Red, reason: 'surrender', tick }, { type: 'powerPicked', id: 1, power: 'same', auto: false }]);
    step(1, [{ type: 'powerPicked', id: 1, power: 'late', auto: false }]);
    const r = t.record();
    expect(r.match).toEqual({ winner: 'red', reason: 'surrender', endTick: tick, seconds: Math.round((tick / 30) * 10) / 10 });
    expect(r.draft.picks).toEqual([{ tick, champion: 1, power: 'same', auto: false }]); // same tick as the end; nothing after
  });

  it('is plain JSON: no undefined, NaN or Infinity', () => {
    const { t, step } = recorded([{ team: Red, x: 0, y: 5 }]);
    t.onFrame(16, true);
    t.onInput('keyboard');
    step(1, [{ type: 'matchOver', winner: undefined, reason: 'timeout', tick: 1 }]);
    const r = t.record();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.match.winner).toBeNull();
    expect(r.device.averageFps).toBeGreaterThan(0);
  });
});
