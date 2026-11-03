import type { Config } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import { zoneAt, type ObstacleGrid } from '../grid';
import type { Champion, Concealment, Health, Team, Transform, Weapon } from '../sim';

export interface VisibilityContext {
  concealments: Store<Concealment>;
  transforms: Store<Transform>;
  teams: Store<Team>;
  healths: Store<Health>;
  weapons: Store<Weapon>;
  champions: Store<Champion>;
  grid: () => ObstacleGrid;
}

/** Bit mask seen by every team. */
export const SEEN_BY_ALL = 0xff;

/**
 * Trench concealment (GDD §4, TDD §6.9), after movement and before any targeting. A unit on a
 * trench floor is seen by its own team, and by the enemy only if an enemy unit is in the same
 * Trench zone or within `revealRadius`, or if it fired, cast an Ultimate (or is channelling one)
 * within the last `revealSeconds`. Every other unit is seen by all. Units without a
 * `Concealment` (structures) are always seen.
 * ponytail: O(hidden × units) scan for same-zone and nearby enemies; fine at ~100 units, use the spatial grid if it shows in profiles.
 */
export function visibilitySystem(ctx: VisibilityContext, cfg: Config['combat']['trench'], tick: number) {
  const { concealments, transforms, teams, healths, weapons, champions } = ctx;
  const grid = ctx.grid();
  const ids = concealments.ids;
  for (let i = 0; i < ids.length; i++) {
    const t = transforms.get(ids[i]!)!;
    concealments.data[i]!.zone = zoneAt(grid, t.x, t.y);
  }
  const rSq = cfg.revealRadius * cfg.revealRadius;
  for (let i = 0; i < ids.length; i++) {
    const e = ids[i]!;
    const cn = concealments.data[i]!;
    const w = weapons.get(e);
    const c = champions.get(e);
    const revealed =
      (w !== undefined && w.lastShotTick >= 0 && tick - w.lastShotTick <= cfg.revealSeconds) ||
      (c !== undefined && (c.channelTicks > 0 || (c.lastCastTick >= 0 && tick - c.lastCastTick <= cfg.revealSeconds)));
    if (cn.zone === 0 || revealed) {
      cn.visible = SEEN_BY_ALL;
      continue;
    }
    const team = teams.get(e)!;
    cn.visible = 1 << team;
    const t = transforms.get(e)!;
    for (let k = 0; k < ids.length; k++) {
      const o = ids[k]!;
      const ot = teams.get(o)!;
      if (ot === team || healths.get(o)!.hp <= 0) continue;
      const tt = transforms.get(o)!;
      const dx = tt.x - t.x;
      const dy = tt.y - t.y;
      if (concealments.data[k]!.zone === cn.zone || dx * dx + dy * dy <= rSq) cn.visible |= 1 << ot;
    }
  }
}

/** Can `team` see `e`? (Targeting, structures, minions, Ultimates and traits all ask this.) */
export function visibleTo(concealments: Store<Concealment>, e: Entity, team: Team): boolean {
  const cn = concealments.get(e);
  return !cn || (cn.visible & (1 << team)) !== 0;
}
