import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import type { HitQueue } from '../hits';
import { LobKind, type LobPool } from '../lobs';
import { len } from '../math';
import type { MinePool } from '../mines';
import { Kind, type Champion, type Collider, type Health, type Motion, type Targeting, type Team, type Transform } from '../sim';
import type { SpatialIndex } from '../spatial';

export interface EpicContext {
  champions: Store<Champion>;
  transforms: Store<Transform>;
  motions: Store<Motion>;
  healths: Store<Health>;
  teams: Store<Team>;
  kinds: Store<Kind>;
  colliders: Store<Collider>;
  targetings: Store<Targeting>;
  lobs: LobPool;
  mines: MinePool;
  hits: HitQueue;
  events: SimEvent[];
  spatial: SpatialIndex;
  /** Is the line from a to b clear of raised ground (line of sight, D-018)? */
  clear(ax: number, ay: number, bx: number, by: number): boolean;
}

/** A mortar shell's apex height (render). */
const SHELL_ARC = 6;
const nearby: Entity[] = [];

/**
 * Mortar Support and Minefield (GDD §8, D-063), after the weapons fire.
 * - Mortar: every \`mortarEvery\`, while the champion has a living auto-target, a shell is lobbed
 *   from it onto the target's spot (the clock waits at zero until there is one).
 * - Minefield: every \`mineEvery\` while moving, a mine at its feet; with \`mineMax\` already out, the
 *   oldest goes. A mine arms after \`mineArm\` and bursts when a living enemy unit (not a structure)
 *   comes within \`trigger\`: every enemy within its radius that raised ground doesn't shield takes
 *   its damage. Mines stay when their layer is knocked out.
 */
export function epicSystem(ctx: EpicContext, tick: number) {
  const { champions, transforms, motions, healths, teams, targetings, lobs, mines, events } = ctx;
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const m = c.mods;
    if (healths.get(e)!.hp <= 0) continue;
    const t = transforms.get(e)!;
    const team = teams.get(e)!;
    if (m.mortarEvery > 0) {
      if (c.mortarWait > 0) c.mortarWait--;
      const target = targetings.get(e)?.targetId ?? 0;
      const th = target !== 0 ? healths.get(target) : undefined;
      if (c.mortarWait === 0 && th && th.hp > 0) {
        const tt = transforms.get(target)!;
        lobs.spawn(e, team, t.x, t.y, tt.x, tt.y, m.mortarTicks, LobKind.Shell, m.mortarDamage, m.mortarRadius, SHELL_ARC);
        c.mortarWait = m.mortarEvery;
      }
    }
    if (m.mineEvery > 0) {
      if (c.mineWait > 0) c.mineWait--;
      const mo = motions.get(e)!;
      const moving = mo.vx !== 0 || mo.vy !== 0;
      if (c.mineWait === 0 && moving) {
        let out = 0;
        let oldest = -1;
        for (let k = 0; k < mines.capacity; k++) {
          if (!mines.active[k] || mines.owner[k] !== e) continue;
          out++;
          if (oldest < 0 || mines.laid[k]! < mines.laid[oldest]!) oldest = k;
        }
        if (out >= m.mineMax && oldest >= 0) mines.release(oldest);
        mines.spawn(e, team, t.x, t.y, tick, tick + m.mineArm, m.mineDamage, m.mineRadius, m.mineTrigger);
        events.push({ type: 'mineLaid', owner: e, team, x: t.x, y: t.y });
        c.mineWait = m.mineEvery;
      }
    }
  }

  for (let k = 0; k < mines.capacity; k++) {
    if (!mines.active[k] || tick < mines.armAt[k]!) continue;
    const team = mines.team[k]!;
    const x = mines.x[k]!;
    const y = mines.y[k]!;
    if (!enemyWithin(ctx, x, y, mines.trigger[k]!, team)) continue;
    const owner = mines.owner[k]!;
    const r = mines.radius[k]!;
    ctx.spatial.query(x, y, r + 4, nearby);
    for (let n = 0; n < nearby.length; n++) {
      const o = nearby[n]!;
      if (teams.get(o) === team) continue;
      const h = healths.get(o);
      if (!h || h.hp <= 0) continue;
      const ot = transforms.get(o)!;
      if (len(ot.x - x, ot.y - y) - (ctx.colliders.get(o)?.radius ?? 0) > r || !ctx.clear(x, y, ot.x, ot.y)) continue;
      ctx.hits.push(owner, o, mines.damage[k]!);
    }
    events.push({ type: 'explosion', owner, team, x, y, radius: r });
    mines.release(k);
  }
}

/** Is a living enemy unit (champion, minion or summon) within `r` of (x, y), to its collider edge? */
function enemyWithin(ctx: EpicContext, x: number, y: number, r: number, team: number): boolean {
  ctx.spatial.query(x, y, r + 1, nearby);
  for (let n = 0; n < nearby.length; n++) {
    const o = nearby[n]!;
    const kind = ctx.kinds.get(o);
    if (ctx.teams.get(o) === team || kind === Kind.SubBase || kind === Kind.HQ) continue;
    const h = ctx.healths.get(o);
    if (!h || h.hp <= 0) continue;
    const ot = ctx.transforms.get(o)!;
    if (len(ot.x - x, ot.y - y) - (ctx.colliders.get(o)?.radius ?? 0) <= r) return true;
  }
  return false;
}
