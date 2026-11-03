import type { Store } from '../ecs';
import { atan2, len, wrapAngle } from '../math';
import type { Champion, Health, Motion, Team, Transform } from '../sim';
import { addPct, stat, Stat, type Stats } from '../stats';

export interface TraitContext {
  champions: Store<Champion>;
  motions: Store<Motion>;
  stats: Store<Stats>;
  healths: Store<Health>;
  transforms: Store<Transform>;
  teams: Store<Team>;
}

/**
 * Champion traits (GDD §7, TDD §6.1). Each bonus is added and removed as a delta (`traitPct`),
 * so other sources of the same stat stack with it; a move-speed change refreshes `speed`.
 * - Alpha's Steady Hand: once the stick has been at rest for `stillSeconds`, + fire rate until
 *   moving again. It counts intent, not velocity, so being pushed or blocked doesn't break it.
 * - Beta's Light Feet: `outOfCombatSeconds` after she last dealt or took damage (the
 *   `lastCombatTick` stamp), + move speed until the next hit.
 * - Gamma's Charge: + move speed while the stick points within `angle` of the nearest living
 *   enemy champion within `radius` (visibility joins with fog of war).
 */
export function traitSystem(ctx: TraitContext, tick: number) {
  const { champions, motions, stats, healths } = ctx;
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
      continue;
    }
    const on = h.hp > 0 && (trait.id === 'lightFeet' ? tick - c.lastCombatTick >= trait.outOfCombatSeconds : chargingAt(ctx, e, m, trait.radius, trait.angle));
    const want = on ? trait.moveSpeedPct : 0;
    if (want !== c.traitPct) {
      addPct(st, Stat.MoveSpeed, want - c.traitPct);
      c.traitPct = want;
      m.speed = stat(st, Stat.MoveSpeed);
    }
  }
}

/** Is `e` steering within `angle` of the nearest living enemy champion within `radius`? */
function chargingAt(ctx: TraitContext, e: number, m: Motion, radius: number, angle: number): boolean {
  if (m.intentX === 0 && m.intentY === 0) return false;
  const { champions, healths, transforms, teams } = ctx;
  const t = transforms.get(e)!;
  const team = teams.get(e);
  let best = -1;
  let bestDist = radius;
  for (let k = 0; k < champions.ids.length; k++) {
    const o = champions.ids[k]!;
    if (teams.get(o) === team || healths.get(o)!.hp <= 0) continue;
    const ot = transforms.get(o)!;
    const d = len(ot.x - t.x, ot.y - t.y);
    if (d <= bestDist) {
      best = o;
      bestDist = d;
    }
  }
  if (best < 0) return false;
  const ot = transforms.get(best)!;
  return Math.abs(wrapAngle(atan2(m.intentY, m.intentX) - atan2(ot.y - t.y, ot.x - t.x))) <= angle;
}
