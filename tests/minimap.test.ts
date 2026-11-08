import { describe, expect, it } from 'vitest';
import { Kind, Team, type EntitySnapshot } from '../src/sim/sim';
import { fromMinimap, livePings, showsOnMinimap, toMinimap, type Ping } from '../src/ui/minimap';

const { Blue, Red } = Team;
const b = { minX: -34, maxX: 34, minY: -82, maxY: 82 };
const W = 68;
const H = 164;

describe('minimap (D-090)', () => {
  it('puts the Red end up for a Blue viewer', () => {
    expect(toMinimap(-34, 82, b, W, H, false)).toEqual({ x: 0, y: 0 });
    expect(toMinimap(34, -82, b, W, H, false)).toEqual({ x: W, y: H });
    expect(toMinimap(0, 0, b, W, H, false)).toEqual({ x: W / 2, y: H / 2 });
  });

  it('turns round for a Red viewer, like its camera', () => {
    expect(toMinimap(-34, 82, b, W, H, true)).toEqual({ x: W, y: H });
    expect(toMinimap(34, -82, b, W, H, true)).toEqual({ x: 0, y: 0 });
  });

  it.each([false, true])('maps a tap back to the same world point (flip %s)', (flip) => {
    const p = toMinimap(12.5, -40, b, W, H, flip);
    const w = fromMinimap(p.x, p.y, b, W, H, flip);
    expect(w.x).toBeCloseTo(12.5);
    expect(w.y).toBeCloseTo(-40);
  });

  const unit = (team: Team, visibleMask: number, hp = 100) => ({ kind: Kind.Champion, team, visibleMask, hp }) as EntitySnapshot;

  it('shows allies always, enemies only when your team can see them', () => {
    expect(showsOnMinimap(unit(Blue, 0), Blue)).toBe(true);
    expect(showsOnMinimap(unit(Red, 0), Blue)).toBe(false);
    expect(showsOnMinimap(unit(Red, 1 << Blue), Blue)).toBe(true);
    expect(showsOnMinimap(unit(Blue, 1 << Red), Red)).toBe(true);
    expect(showsOnMinimap(unit(Blue, 1 << Blue), Red)).toBe(false);
  });

  it('leaves the dead off', () => {
    expect(showsOnMinimap(unit(Blue, 0xff, 0), Blue)).toBe(false);
  });

  it('drops a ping at its expiry tick', () => {
    const p: Ping[] = [
      { kind: 'attack', x: 0, y: 0, until: 100 },
      { kind: 'danger', x: 0, y: 0, until: 50 },
    ];
    expect(livePings(p, 49).map((q) => q.kind)).toEqual(['attack', 'danger']);
    expect(livePings(p, 50).map((q) => q.kind)).toEqual(['attack']);
    expect(livePings(p, 100)).toEqual([]);
  });
});
