import { Team, type Command, type PlayerId } from '../sim/sim';

/** Screen-space move vector: x right, y up the screen, magnitude 0..1. */
export interface Vec {
  x: number;
  y: number;
}

/**
 * Shapes a joystick drag (px, screen y down) into a move vector: zero inside the dead
 * zone, then ramps linearly to full speed at `fullSpeedPx`.
 */
export function shapeStick(dx: number, dy: number, deadZonePx: number, fullSpeedPx: number): Vec {
  const d = Math.hypot(dx, dy);
  if (d <= deadZonePx) return { x: 0, y: 0 };
  const m = Math.min(1, (d - deadZonePx) / Math.max(1e-6, fullSpeedPx - deadZonePx));
  return { x: (dx / d) * m, y: (-dy / d) * m };
}

/** Keyboard directions to a vector; diagonals are normalised so they are not faster. */
export function keyVector(up: boolean, down: boolean, left: boolean, right: boolean): Vec {
  const x = Number(right) - Number(left);
  const y = Number(up) - Number(down);
  const d = Math.hypot(x, y);
  return d === 0 ? { x: 0, y: 0 } : { x: x / d, y: y / d };
}

// Symmetric rounding: Math.round(-63.5) is -63, which would make Red's stick weaker than Blue's.
// `|| 0` normalises -0, which JSON turns into 0 and would make replays diverge (atan2(-0, x) ≠ atan2(0, x)).
const quantise = (v: number) => Math.sign(v) * Math.min(127, Math.round(Math.abs(v) * 127)) || 0;

/**
 * Builds a world-space Command (D-014). Screen up is towards the enemy HQ, so a Red
 * player's stick is rotated 180°.
 */
export function buildCommand(tick: number, player: PlayerId, move: Vec, team: Team): Command {
  const s = team === Team.Red ? -1 : 1;
  return {
    tick,
    player,
    moveX: quantise(move.x * s),
    moveY: quantise(move.y * s),
    ult: false,
    draftPick: -1,
    reroll: false,
  };
}
