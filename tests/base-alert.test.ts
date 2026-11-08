import { beforeEach, describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/sim/events';
import { Kind, Team } from '../src/sim/sim';
import { hud, pushNotices, resetNotices, updateHud } from '../src/ui/store';
import { arena, type Unit } from './helpers';

const { Blue, Red } = Team;
const COOLDOWN = 30;
const WINDOW = 10;

function field(units: Unit[]) {
  const a = arena(units, (c) => {
    c.structures.rules.alertCooldownSeconds = COOLDOWN;
    c.structures.rules.underAttackSeconds = WINDOW;
  });
  const alerts: (SimEvent & { type: 'baseUnderAttack' })[] = [];
  const run = (n: number) => {
    for (let i = 0; i < n; i++) for (const ev of a.sim.step([]).events) if (ev.type === 'baseUnderAttack') alerts.push({ ...ev });
  };
  const snapOf = (id: number) => a.sim.snapshot().entities.find((e) => e.id === id)!;
  return { ...a, alerts, run, snapOf };
}

/** A hit from `source` on `target`, as a real bullet would land it. */
function hit(f: ReturnType<typeof field>, source: number, team: Team, target: number) {
  const t = f.sim.stores.transforms.get(target)!;
  f.sim.projectiles.spawn(source, team, target, true, t.x, t.y - 1, 0, 25 / 30, 50, 1, 30);
}

beforeEach(() => {
  resetNotices();
  hud.ours.value = [];
  hud.theirs.value = [];
});

describe('base under attack (D-089)', () => {
  const sub: Unit = { team: Red, x: 15, y: 30, structure: 'subBase' };

  it('raises one alert on a hit, then waits out its cooldown', () => {
    const f = field([sub]);
    const id = f.sim.stores.structures.ids[0]!;
    hit(f, f.shooter, Blue, id);
    f.run(5);
    expect(f.alerts.map((e) => [e.id, e.kind, e.team])).toEqual([[id, 'subBase', Red]]);
    hit(f, f.shooter, Blue, id);
    f.run(5);
    expect(f.alerts).toHaveLength(1);
    f.run(COOLDOWN);
    hit(f, f.shooter, Blue, id);
    f.run(5);
    expect(f.alerts).toHaveLength(2);
  });

  it('counts each structure on its own', () => {
    const f = field([sub, { team: Red, x: -15, y: 30, structure: 'subBase' }]);
    const [a, b] = f.sim.stores.structures.ids;
    hit(f, f.shooter, Blue, a!);
    hit(f, f.shooter, Blue, b!);
    f.run(5);
    expect(f.alerts.map((e) => e.id).sort()).toEqual([a, b].sort());
  });

  it('stays quiet for a shielded HQ', () => {
    const f = field([{ team: Red, x: 15, y: 40, structure: 'hq', shielded: true }, sub]); // its Sub-base keeps the gate shut
    hit(f, f.shooter, Blue, f.sim.stores.structures.ids[0]!);
    f.run(5);
    expect(f.alerts).toEqual([]);
  });

  it('reads as under attack for its window after a hit, then not', () => {
    const f = field([sub]);
    const id = f.sim.stores.structures.ids[0]!;
    expect(f.snapOf(id).underAttack).toBe(false);
    hit(f, f.shooter, Blue, id);
    f.run(3);
    expect(f.snapOf(id).underAttack).toBe(true);
    updateHud(f.sim.snapshot(), f.shooter, Blue);
    expect(hud.theirs.value[0]!.attacked).toBe(true);
    f.run(WINDOW + 3);
    expect(f.snapOf(id).underAttack).toBe(false);
    updateHud(f.sim.snapshot(), f.shooter, Blue);
    expect(hud.theirs.value[0]!.attacked).toBe(false);
    expect(f.sim.snapshot().entities.find((e) => e.kind === Kind.Champion)!.underAttack).toBe(false);
  });

  describe('the banner', () => {
    const alert = (kind: 'subBase' | 'hq', lane: string, team: Team): SimEvent => ({ type: 'baseUnderAttack', id: 9, kind, lane, team });
    const show = (ev: SimEvent, viewer = Blue) => {
      const a = arena([]);
      pushNotices([ev], { ...a.sim.snapshot(), tick: 0 }, a.shooter, viewer, a.config);
      return hud.notice.value;
    };

    it('says which one, in your words', () => {
      expect(show(alert('hq', '', Blue))).toMatchObject({ text: 'Your base is under attack!', tone: 'bad' });
      resetNotices();
      expect(show(alert('subBase', 'left', Blue))?.text).toBe('Your Left Sub-base is under attack!');
      resetNotices();
      expect(show(alert('subBase', 'centre', Red), Red)?.text).toBe('Your Centre Sub-base is under attack!');
    });

    it('is only for the team under attack', () => {
      expect(show(alert('hq', '', Red))).toBeNull();
      resetNotices();
      expect(show(alert('subBase', 'left', Blue), Red)).toBeNull();
    });
  });
});
