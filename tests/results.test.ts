import { describe, expect, it } from 'vitest';
import { Team } from '../src/sim/sim';
import { boardRows, resultsHeading, resultsView, type ResultsView } from '../src/ui/store';
import { arena } from './helpers';

const { Blue, Red } = Team;

describe('champion damage (D-093)', () => {
  it('adds up what a champion deals, on the snapshot too', () => {
    const a = arena([{ team: Red, x: 0, y: 5 }]);
    a.hp(2, 1e6);
    let dealt = 0;
    for (let i = 0; i < 120; i++) for (const ev of a.sim.step([]).events) if (ev.type === 'damage' && ev.source === a.shooter) dealt += ev.amount;
    expect(dealt).toBeGreaterThan(0);
    expect(a.sim.stores.champions.get(a.shooter)!.damageDealt).toBeCloseTo(dealt);
    expect(a.sim.snapshot().entities.find((e) => e.id === a.shooter)!.damageDealt).toBeCloseTo(dealt);
  });

  it('credits no champion for a structure’s hits', () => {
    const a = arena([{ team: Blue, x: 0, y: 3, structure: 'subBase', armed: true }, { team: Red, x: 0, y: 6 }]);
    const sub = a.sim.stores.structures.ids[0]!;
    a.hp(2, 1e6);
    a.sim.stores.weapons.remove(a.shooter); // only the Sub-base fires
    let hits = 0;
    for (let i = 0; i < 90; i++) for (const ev of a.sim.step([]).events) if (ev.type === 'damage' && ev.source === sub) hits++;
    expect(hits).toBeGreaterThan(0);
    expect(a.sim.stores.champions.get(a.shooter)!.damageDealt).toBe(0);
    expect(a.sim.stores.champions.get(2)!.damageDealt).toBe(0);
  });
});

describe('Results (D-093)', () => {
  const field = () => arena([{ team: Red, x: 8, y: 25 }, { team: Blue, x: -8, y: -25 }]);

  it('reads won, lost or draw from the viewer’s side', () => {
    const a = field();
    const snap = a.sim.snapshot();
    expect(resultsView(snap, Blue, 'hq', a.shooter, Blue).result).toBe('won');
    expect(resultsView(snap, Red, 'hq', a.shooter, Blue).result).toBe('lost');
    expect(resultsView(snap, Blue, 'hq', 2, Red).result).toBe('lost');
    expect(resultsView(snap, undefined, 'timeout', a.shooter, Blue).result).toBe('draw');
  });

  it('lists your side first with each champion’s numbers', () => {
    const a = field();
    a.sim.debug.giveXp(a.shooter, 160);
    a.step();
    const snap = a.sim.snapshot();
    snap.entities.find((e) => e.id === 2)!.damageDealt = 512;
    const rows = resultsView(snap, Blue, 'hq', a.shooter, Blue).rows;
    expect(rows.map((r) => [r.id, r.side, r.me])).toEqual([
      [1, 'ours', true],
      [3, 'ours', false],
      [2, 'theirs', false],
    ]);
    expect(rows[0]).toMatchObject({ xp: 160, level: 2 });
    expect(rows[2]).toMatchObject({ damage: 512 });
    expect(boardRows(snap, a.shooter, Blue)).toEqual(rows);
  });

  it.each([
    ['won', 'hq', 'VICTORY', '4:05'],
    ['lost', 'surrender', 'DEFEAT', 'Surrendered · 4:05'],
    ['draw', 'timeout', 'DRAW', 'Time-out · 4:05'],
  ] as const)('heads a %s by %s', (result, reason, title, line) => {
    const v: ResultsView = { result, reason, seconds: 245.7, rows: [] };
    expect(resultsHeading(v)).toEqual({ title, line });
  });
});
