import type { Store } from '../ecs';
import type { Champion, Health, Motion } from '../sim';
import { addPct, Stat, type Stats } from '../stats';

/**
 * Alpha's Steady Hand (GDD §7, TDD §6.1): once the stick has been at rest for
 * `stillSeconds`, gain `fireRatePct` fire rate until moving again. It counts intent, not
 * velocity, so being pushed or blocked doesn't break it. The bonus is added and removed as a
 * delta, so other fire-rate sources stack with it.
 */
export function steadyHandSystem(champions: Store<Champion>, motions: Store<Motion>, stats: Store<Stats>, healths: Store<Health>) {
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const m = motions.get(e);
    const st = stats.get(e);
    const h = healths.get(e);
    if (!m || !st || !h) continue;
    const still = m.intentX === 0 && m.intentY === 0;
    c.stillTicks = still ? c.stillTicks + 1 : 0;
    const want = h.hp > 0 && c.stillTicks >= c.def.trait.stillSeconds ? c.def.trait.fireRatePct : 0;
    if (want !== c.steadyPct) {
      addPct(st, Stat.FireRate, want - c.steadyPct);
      c.steadyPct = want;
    }
  }
}
