// All sim trig goes through here. Cross-browser determinism (lockstep netcode) would
// swap these for table-based versions in this one file (TDD §4 rule 4).
export const sin = Math.sin;
export const cos = Math.cos;
export const atan2 = Math.atan2;

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
