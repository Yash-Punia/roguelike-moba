import { describe, expect, it } from 'vitest';
import { buildCommand, keyVector, shapeStick } from '../src/input/command-builder';
import { Team } from '../src/sim/sim';

describe('joystick shaping', () => {
  const dead = 11;
  const full = 36;

  it('is zero inside the dead zone', () => {
    expect(shapeStick(5, -8, dead, full)).toEqual({ x: 0, y: 0 });
  });

  it('reaches full speed at the full-speed radius and caps there', () => {
    expect(shapeStick(0, -full, dead, full).y).toBeCloseTo(1);
    expect(shapeStick(0, -60, dead, full).y).toBeCloseTo(1);
  });

  it('ramps linearly between and flips screen y to up', () => {
    const v = shapeStick(0, -(dead + full) / 2, dead, full);
    expect(v.y).toBeCloseTo(0.5);
    expect(shapeStick(0, 30, dead, full).y).toBeLessThan(0);
  });
});

describe('keyboard', () => {
  it('normalises diagonals', () => {
    const v = keyVector(true, false, false, true);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });

  it('cancels opposite keys', () => {
    expect(keyVector(true, true, false, false)).toEqual({ x: 0, y: 0 });
  });
});

describe('command', () => {
  it('quantises to -127..127 in world space for Blue', () => {
    const c = buildCommand(3, 0, { x: 0, y: 1 }, Team.Blue);
    expect([c.moveX, c.moveY, c.tick]).toEqual([0, 127, 3]);
  });

  it('rotates 180° for Red: stick up moves towards -y', () => {
    const c = buildCommand(0, 0, { x: 0.5, y: 1 }, Team.Red);
    expect(c.moveY).toBe(-127);
    expect(c.moveX).toBe(-64);
  });
});
