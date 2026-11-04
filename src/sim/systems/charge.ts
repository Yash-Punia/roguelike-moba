import type { Champion } from '../sim';
import { Stat, stat, type Stats } from '../stats';

/**
 * Adds Ultimate charge (percentage points of the 0–100 meter), scaled by the Ult-charge stat
 * (Quick Charge: "+15% from all sources") and capped at 100 per stored charge (Overcharge: 200,
 * D-063). Passive and event charge both go through here (D-040).
 */
export function addUltCharge(c: Champion, st: Stats | undefined, amount: number) {
  const cap = 100 * c.mods.ultCharges;
  if (amount <= 0 || c.ultCharge >= cap) return;
  c.ultCharge += amount * (st ? stat(st, Stat.UltCharge) : 1);
  if (c.ultCharge > cap - 1e-9) c.ultCharge = cap; // float sums land a hair short
}
