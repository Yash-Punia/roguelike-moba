import type { Config } from '../../data/schema';
import type { Entity } from '../ecs';
import { LobKind, type LobPool } from '../lobs';
import { atan2, len } from '../math';
import { Team } from '../sim';
import { CampState, type CampContext } from './camps';

const picked: Entity[] = [];

/**
 * Mini-boss attack patterns (GDD §4, TDD §6.8, D-079), after `campSystem`. A mini-boss fights
 * only while its camp is `Engaged`, at the camp's attackers within its pattern's `range` and in
 * sight; every attack is telegraphed.
 * - `shells` (Field Gun): every `intervalSeconds`, one shell at each of up to `targets` attackers,
 *   nearest first (ties by id), landing where they stood `flightSeconds` later. The shell is a lob,
 *   so its landing circle is the telegraph (D-078) and `lobSystem` deals the blast.
 */
export function bossSystem(ctx: CampContext, lobs: LobPool, n: Config['neutrals']) {
  const { camps, neutrals, transforms, colliders } = ctx;
  for (let i = 0; i < neutrals.ids.length; i++) {
    const camp = camps[neutrals.data[i]!.camp]!;
    const p = n.camps[camp.spot.kind].boss?.pattern;
    if (!p) continue;
    if (camp.state !== CampState.Engaged) {
      camp.attackWait = 0;
      continue;
    }
    if (camp.attackWait > 0 && --camp.attackWait > 0) continue;
    const e = neutrals.ids[i]!;
    const t = transforms.get(e)!;
    // Up to `targets` attackers in reach, nearest first: a selection pass per pick, no sort or allocation.
    picked.length = 0;
    while (picked.length < p.targets) {
      let best: Entity = 0;
      let bestD = Infinity;
      for (let k = 0; k < camp.attackers.length; k++) {
        const o = camp.attackers[k]!;
        if (picked.includes(o)) continue;
        const ot = transforms.get(o)!;
        const d = len(ot.x - t.x, ot.y - t.y);
        if (d - (colliders.get(o)?.radius ?? 0) > p.range || !ctx.clear(t.x, t.y, ot.x, ot.y)) continue;
        if (d < bestD || (d === bestD && o < best)) {
          best = o;
          bestD = d;
        }
      }
      if (best === 0) break;
      picked.push(best);
    }
    if (picked.length === 0) continue; // fires as soon as someone is in reach
    for (let k = 0; k < picked.length; k++) {
      const ot = transforms.get(picked[k]!)!;
      lobs.spawn(e, Team.Neutral, t.x, t.y, ot.x, ot.y, p.flightSeconds, LobKind.Shell, p.damage, p.radius, p.arcHeight);
    }
    const first = transforms.get(picked[0]!)!;
    t.facing = atan2(first.y - t.y, first.x - t.x); // the barrel follows the first target
    camp.attackWait = p.intervalSeconds;
  }
}
