import { describe, expect, it } from 'vitest';
import { buildCommand, keyVector, shapeStick } from '../src/input/command-builder';
import { Team } from '../src/sim/sim';
import { createLatch, inputKindOf } from '../src/input/ult-latch';
import { ultGaugeGeometry, RING_LENGTH } from '../src/ui/ult-gauge';

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

  it('never emits -0 (replays round-trip through JSON)', () => {
    const c = buildCommand(0, 0, { x: 1, y: 0 }, Team.Red);
    expect(Object.is(c.moveY, 0)).toBe(true);
    expect(Object.is(buildCommand(0, 0, { x: -0.001, y: 0 }, Team.Blue).moveX, 0)).toBe(true);
  });

  it('rotates 180° for Red: stick up moves towards -y', () => {
    const c = buildCommand(0, 0, { x: 0.5, y: 1 }, Team.Red);
    expect(c.moveY).toBe(-127);
    expect(c.moveX).toBe(-64);
  });
});

describe('Ultimate button input', () => {
  it('latches a press for exactly one sample', () => {
    const l = createLatch();
    expect(l.take()).toBe(false);
    l.press();
    l.press();
    expect(l.take()).toBe(true);
    expect(l.take()).toBe(false);
  });

  it('tells keyboard from pointer input for key hints', () => {
    expect([inputKindOf('keydown'), inputKindOf('pointerdown'), inputKindOf('touchstart'), inputKindOf('mousemove')]).toEqual([
      'keyboard', 'pointer', 'pointer', undefined,
    ]);
  });
});

describe('Ultimate gauge geometry', () => {
  it('fills the ring and sweeps the needle 270° with the charge', () => {
    expect(ultGaugeGeometry(0)).toEqual({ dashOffset: RING_LENGTH, needleDeg: -135 });
    expect(ultGaugeGeometry(50).dashOffset).toBeCloseTo(RING_LENGTH / 2);
    expect(ultGaugeGeometry(50).needleDeg).toBe(0);
    expect(ultGaugeGeometry(100)).toEqual({ dashOffset: 0, needleDeg: 135 });
    expect(ultGaugeGeometry(140)).toEqual(ultGaugeGeometry(100));
  });
});
