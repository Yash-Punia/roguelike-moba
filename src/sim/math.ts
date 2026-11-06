// All sim trig goes through here. Cross-browser determinism (lockstep netcode) would
// swap these for table-based versions in this one file (TDD §4 rule 4).
export const sin = Math.sin;
export const cos = Math.cos;
export const atan2 = Math.atan2;
export const asin = Math.asin;

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

const TAU = 2 * Math.PI;

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  return w === -Math.PI ? Math.PI : w;
}

/**
 * Does a circle of radius `r` at (x, y) overlap the sector from (ox, oy) along `aim`, `range`
 * long and `half` either side? The half-angle is widened by the angle the circle covers at its
 * distance. Gamma's flames and the Halftrack's spray (D-080).
 */
export function inSector(ox: number, oy: number, aim: number, range: number, half: number, x: number, y: number, r: number): boolean {
  const d = len(x - ox, y - oy);
  if (d - r > range) return false;
  return d <= r || Math.abs(wrapAngle(atan2(y - oy, x - ox) - aim)) <= half + asin(r / d);
}

/** Rotates `current` towards `target` by at most `maxStep` radians, the short way round. */
export function turnTowards(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= maxStep) return target;
  return wrapAngle(current + (d > 0 ? maxStep : -maxStep));
}
