import type { Config } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import { isInvulnerable } from '../damage';
import { len } from '../math';
import type { Collider, Health, TargetClass, Targeting, Team, Transform } from '../sim';
import type { SpatialIndex } from '../spatial';

export interface TargetingContext {
  transforms: Store<Transform>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  targetClasses: Store<TargetClass>;
  targetings: Store<Targeting>;
  spatial: SpatialIndex;
  /** Current weapon range of a shooter (stat-modified for champions). */
  rangeOf(e: Entity): number;
}

const candidates: Entity[] = [];

/**
 * Champion auto-targeting, GDD §6 / TDD §6.2:
 * 1. Candidates are living, targetable enemies whose collider edge is within weapon range.
 *    (Line of sight and fog join in M3.)
 * 2. The highest class with a candidate wins; within it the nearest unit, and units within
 *    `tieBand` of the nearest go to the lowest HP%.
 * 3. Keep the current target while it stays valid within range + `stickyRange`.
 * 4. Same class: switch only to a unit more than `sameClassSwitch` nearer. A higher class
 *    overrides only after staying in range `overrideSeconds`.
 * 5. When the current target dies, re-select at once but hold fire `retargetPauseSeconds`.
 * Shooters are processed in ascending id order and candidates come back sorted, so ties
 * resolve the same way every run.
 */
export function targetingSystem(shooters: readonly Entity[], ctx: TargetingContext, cfg: Config['combat']['targeting'], tick: number) {
  const { transforms, colliders, teams, healths, targetClasses, targetings, spatial } = ctx;

  let maxRadius = 0;
  for (let i = 0; i < colliders.data.length; i++) maxRadius = Math.max(maxRadius, colliders.data[i]!.radius);

  const edgeDistance = (t: Transform, e: Entity) => {
    const o = transforms.get(e)!;
    return len(o.x - t.x, o.y - t.y) - (colliders.get(e)?.radius ?? 0);
  };
  const targetable = (e: Entity, team: Team) => {
    const h = healths.get(e);
    return h !== undefined && h.hp > 0 && !isInvulnerable(h, tick) && teams.get(e) !== team;
  };

  for (let i = 0; i < shooters.length; i++) {
    const e = shooters[i]!;
    const tg = targetings.get(e);
    const t = transforms.get(e);
    const self = healths.get(e);
    if (!tg || !t || !self) continue;
    if (tg.holdTicks > 0) tg.holdTicks--;
    if (self.hp <= 0) {
      clear(tg);
      continue;
    }
    const team = teams.get(e)!;
    const range = ctx.rangeOf(e);

    // Is the current target still worth keeping?
    let cur = tg.targetId;
    let curDist = Infinity;
    let curClass = 0;
    if (cur !== 0) {
      const h = healths.get(cur);
      if (!h || h.hp <= 0) {
        tg.holdTicks = cfg.retargetPauseSeconds; // it died: re-select now, fire after the pause
        cur = 0;
      } else if (!targetable(cur, team) || (curDist = edgeDistance(t, cur)) > range + cfg.stickyRange) {
        cur = 0;
      } else {
        curClass = targetClasses.get(cur) ?? 0;
      }
    }

    // Best candidate: highest class, nearest, ties within tieBand to the lowest HP%.
    spatial.query(t.x, t.y, range + maxRadius, candidates);
    let topClass = 0;
    let nearest = Infinity;
    for (let k = 0; k < candidates.length; k++) {
      const c = candidates[k]!;
      if (c === e || !targetable(c, team)) continue;
      const d = edgeDistance(t, c);
      if (d > range) continue;
      const cls = targetClasses.get(c) ?? 0;
      if (cls > topClass) {
        topClass = cls;
        nearest = d;
      } else if (cls === topClass && d < nearest) {
        nearest = d;
      }
    }
    let best: Entity = 0;
    let bestDist = Infinity;
    let bestHp = Infinity;
    if (topClass > 0) {
      for (let k = 0; k < candidates.length; k++) {
        const c = candidates[k]!;
        if (c === e || (targetClasses.get(c) ?? 0) !== topClass || !targetable(c, team)) continue;
        const d = edgeDistance(t, c);
        if (d > range || d > nearest + cfg.tieBand) continue;
        const h = healths.get(c)!;
        const hp = h.hp / h.maxHp;
        if (hp < bestHp || (hp === bestHp && d < bestDist)) {
          best = c;
          bestDist = d;
          bestHp = hp;
        }
      }
    }

    if (cur === 0) {
      tg.targetId = best;
      tg.pendingSwitchId = 0;
      tg.pendingTicks = 0;
    } else if (best !== 0 && topClass > curClass) {
      // A higher class is in range: switch once it has stayed there long enough.
      tg.pendingSwitchId = best;
      tg.pendingTicks++;
      if (tg.pendingTicks >= cfg.overrideSeconds) {
        tg.targetId = best;
        tg.pendingSwitchId = 0;
        tg.pendingTicks = 0;
      }
    } else {
      tg.pendingSwitchId = 0;
      tg.pendingTicks = 0;
      const switchSameClass = best !== 0 && best !== cur && topClass === curClass && bestDist < curDist - cfg.sameClassSwitch;
      tg.targetId = switchSameClass ? best : cur;
    }
  }
}

function clear(tg: Targeting) {
  tg.targetId = 0;
  tg.pendingSwitchId = 0;
  tg.pendingTicks = 0;
}
