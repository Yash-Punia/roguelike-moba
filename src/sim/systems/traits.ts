import type { Store } from '../ecs';
import type { Champion, Health, Motion } from '../sim';
import { addPct, stat, Stat, type Stats } from '../stats';

/**
 * Champion traits (GDD §7, TDD §6.1). Each bonus is added and removed as a delta (`traitPct`),
 * so other sources of the same stat stack with it.
 * - Alpha's Steady Hand: once the stick has been at rest for `stillSeconds`, + fire rate until
 *   moving again. It counts intent, not velocity, so being pushed or blocked doesn't break it.
 * - Beta's Light Feet: `outOfCombatSeconds` after she last dealt or took damage (the
 *   `lastCombatTick` stamp), + move speed until the next hit.
 */
export function traitSystem(champions: Store<Champion>, motions: Store<Motion>, stats: Store<Stats>, healths: Store<Health>, tick: number) {
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const m = motions.get(e);
    const st = stats.get(e);
    const h = healths.get(e);
    if (!m || !st || !h) continue;
    const trait = c.def.trait;
    if (trait.id === 'steadyHand') {
      const still = m.intentX === 0 && m.intentY === 0;
      c.stillTicks = still ? c.stillTicks + 1 : 0;
      const want = h.hp > 0 && c.stillTicks >= trait.stillSeconds ? trait.fireRatePct : 0;
      if (want !== c.traitPct) {
        addPct(st, Stat.FireRate, want - c.traitPct);
        c.traitPct = want;
      }
    } else {
      const want = h.hp > 0 && tick - c.lastCombatTick >= trait.outOfCombatSeconds ? trait.moveSpeedPct : 0;
      if (want !== c.traitPct) {
        addPct(st, Stat.MoveSpeed, want - c.traitPct);
        c.traitPct = want;
        m.speed = stat(st, Stat.MoveSpeed);
      }
    }
  }
}
