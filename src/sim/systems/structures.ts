import type { Config } from '../../data/schema';
import { isInvulnerable } from '../damage';
import type { DamageLog } from '../damage-log';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import { len } from '../math';
import { Kind, Team, type Collider, type Health, type Structure, type Targeting, type Transform, type Weapon } from '../sim';
import type { SpatialIndex } from '../spatial';

export interface StructureContext {
  structures: Store<Structure>;
  transforms: Store<Transform>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  weapons: Store<Weapon>;
  targetings: Store<Targeting>;
  kinds: Store<Kind>;
  spatial: SpatialIndex;
  events: SimEvent[];
  /** Current structure config (live edits included). */
  defs(): Config['structures'];
}

type Rules = Config['structures']['rules'];
const nearby: Entity[] = [];
/** Widest unit collider we search for around a structure (champions 0.5 m, minions 0.35 m). */
const UNIT_REACH = 1;

function edge(ctx: StructureContext, t: Transform, o: Entity): number {
  const ot = ctx.transforms.get(o)!;
  return len(ot.x - t.x, ot.y - t.y) - (ctx.colliders.get(o)?.radius ?? 0);
}

/** A unit this structure may shoot: a living, targetable enemy minion or champion within range. */
function shootable(ctx: StructureContext, o: Entity, team: Team, t: Transform, range: number, tick: number): boolean {
  if (o === 0 || ctx.teams.get(o) === team) return false;
  const kind = ctx.kinds.get(o);
  if (kind !== Kind.Minion && kind !== Kind.Champion) return false;
  const h = ctx.healths.get(o);
  if (!h || h.hp <= 0 || isInvulnerable(h, tick)) return false;
  return edge(ctx, t, o) <= range;
}

/** Nearest shootable unit of `kind` in range, skipping `except`; 0 if none. */
function nearest(ctx: StructureContext, kind: Kind, team: Team, t: Transform, range: number, tick: number, except: Entity): Entity {
  let best: Entity = 0;
  let bestDist = Infinity;
  for (let k = 0; k < nearby.length; k++) {
    const o = nearby[k]!;
    if (o === except || ctx.kinds.get(o) !== kind || !shootable(ctx, o, team, t, range, tick)) continue;
    const d = edge(ctx, t, o);
    if (d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Backdoor protection (GDD §5), before the damage stage: a structure with no enemy minion
 * within `backdoorRadius` takes `backdoorPct` less damage this tick.
 */
export function backdoorSystem(ctx: StructureContext, rules: Rules) {
  const { structures, transforms, teams, healths, kinds, spatial } = ctx;
  for (let i = 0; i < structures.ids.length; i++) {
    const s = structures.ids[i]!;
    const st = structures.data[i]!;
    const t = transforms.get(s)!;
    const team = teams.get(s);
    spatial.query(t.x, t.y, rules.backdoorRadius + UNIT_REACH, nearby);
    let guarded = false;
    for (let k = 0; k < nearby.length && !guarded; k++) {
      const o = nearby[k]!;
      if (kinds.get(o) !== Kind.Minion || teams.get(o) === team || healths.get(o)!.hp <= 0) continue;
      const ot = transforms.get(o)!;
      guarded = len(ot.x - t.x, ot.y - t.y) <= rules.backdoorRadius;
    }
    st.backdoor = !guarded;
  }
}

/**
 * Structure aggro (GDD §5, TDD §6.2), before the weapons fire:
 * 1. An enemy champion that hit an allied champion standing in range last tick (damage log)
 *    pulls fire onto itself at once, if it is in range too.
 * 2. Otherwise the current target is kept while it stays shootable (D-036).
 * 3. With none, the nearest enemy minion in range, else the nearest enemy champion.
 * Multi-target weapons (HQ flak) also pick a second target by the same order.
 * Warm-up resets after `warmupResetSeconds` without firing.
 */
export function structureTargetingSystem(ctx: StructureContext, rules: Rules, log: DamageLog, tick: number) {
  const { structures, transforms, teams, weapons, targetings, kinds, spatial } = ctx;
  for (let i = 0; i < structures.ids.length; i++) {
    const s = structures.ids[i]!;
    const st = structures.data[i]!;
    const w = weapons.get(s);
    const tg = targetings.get(s);
    if (!w || !tg || st.destroyed) continue;
    if (++st.ticksSinceShot > rules.warmupResetSeconds) {
      st.warmupStacks = 0;
      st.warmupTarget = 0;
    }
    const t = transforms.get(s)!;
    const team = teams.get(s)!;
    const range = w.range;

    // 1. Aggro: last tick's hits by enemy champions on allied champions in range.
    let target: Entity = 0;
    for (let k = log.count - 1; k >= 0; k--) {
      const slot = log.slot(k);
      const at = log.tick[slot]!;
      if (at > tick - 1) continue;
      if (at < tick - 1) break;
      const src = log.source[slot]!;
      const victim = log.target[slot]!;
      if (kinds.get(src) !== Kind.Champion || kinds.get(victim) !== Kind.Champion) continue;
      if (teams.get(victim) !== team || edge(ctx, t, victim) > range) continue;
      if (shootable(ctx, src, team, t, range, tick)) target = src; // scanning newest → oldest: the earliest hit wins
    }
    // 2. Keep the current target.
    if (target === 0 && shootable(ctx, tg.targetId, team, t, range, tick)) target = tg.targetId;
    // 3. Nearest minion, else nearest champion.
    spatial.query(t.x, t.y, range + UNIT_REACH, nearby);
    if (target === 0) target = nearest(ctx, Kind.Minion, team, t, range, tick, 0);
    if (target === 0) target = nearest(ctx, Kind.Champion, team, t, range, tick, 0);
    tg.targetId = target;

    st.secondaryId = 0;
    if (w.targets >= 2 && target !== 0) {
      st.secondaryId = nearest(ctx, Kind.Minion, team, t, range, tick, target);
      if (st.secondaryId === 0) st.secondaryId = nearest(ctx, Kind.Champion, team, t, range, tick, target);
    }
  }
}

/**
 * Warm-up (GDD §5, TDD §6.7), at fire time: each consecutive shot at the same champion adds
 * `warmupPct`, up to `warmupMaxPct`; a shot at anything else resets it. Returns the damage
 * multiplier for this shot.
 */
export function warmupShot(st: Structure, target: Entity, targetKind: Kind | undefined, rules: Rules): number {
  st.ticksSinceShot = 0;
  if (targetKind !== Kind.Champion) {
    st.warmupStacks = 0;
    st.warmupTarget = 0;
    return 1;
  }
  if (st.warmupTarget === target) {
    st.warmupStacks = Math.min(Math.round(rules.warmupMaxPct / rules.warmupPct), st.warmupStacks + 1);
  } else {
    st.warmupTarget = target;
    st.warmupStacks = 0;
  }
  return 1 + st.warmupStacks * rules.warmupPct;
}

/**
 * Structures at 0 HP are destroyed (TDD §6.7): they stop fighting and stay as rubble (their
 * footprint stays in the grid). A fallen Sub-base opens its team's HQ.
 */
export function structureDeathSystem(ctx: StructureContext) {
  const { structures, healths, teams, transforms, targetings, events } = ctx;
  for (let i = 0; i < structures.ids.length; i++) {
    const s = structures.ids[i]!;
    const st = structures.data[i]!;
    const h = healths.get(s)!;
    if (st.destroyed || h.hp > 0) continue;
    st.destroyed = true;
    const tg = targetings.get(s);
    if (tg) tg.targetId = 0;
    st.secondaryId = 0;
    const t = transforms.get(s)!;
    const team = teams.get(s)!;
    events.push({ type: 'structureDestroyed', id: s, kind: st.kind, team, killer: h.killer, x: t.x, y: t.y });
    if (st.kind === 'subBase') updateHqGate(ctx);
  }
}

/**
 * The HQ gate (GDD §5): an HQ is invulnerable while every Sub-base of its team stands (a team
 * with none has no gate). With `hqHpCutEnabled`, its max HP also drops by `hqHpPerSubBaseLostPct`
 * of its base for every Sub-base its team has lost (D-051, off by default since D-052), keeping
 * its HP fraction, so taking Sub-bases shortens the siege and losing them costs more.
 */
export function updateHqGate(ctx: StructureContext) {
  const { structures, healths, teams } = ctx;
  for (let i = 0; i < structures.ids.length; i++) {
    if (structures.data[i]!.kind !== 'hq') continue;
    const hq = structures.ids[i]!;
    const team = teams.get(hq);
    let standing = 0;
    let fallen = 0;
    for (let k = 0; k < structures.ids.length; k++) {
      const sb = structures.data[k]!;
      if (sb.kind !== 'subBase' || teams.get(structures.ids[k]!) !== team) continue;
      if (sb.destroyed) fallen++;
      else standing++;
    }
    const h = healths.get(hq)!;
    h.invulnerable = standing > 0 && fallen === 0;
    const defs = ctx.defs();
    const cut = defs.rules.hqHpCutEnabled ? defs.rules.hqHpPerSubBaseLostPct * fallen : 0;
    const maxHp = Math.max(1, defs.hq.maxHp * (1 - cut));
    if (maxHp !== h.maxHp && h.maxHp > 0) {
      h.hp *= maxHp / h.maxHp;
      h.maxHp = maxHp;
    }
  }
}

/** Regeneration (GDD §5): structures with `regen` heal while no living enemy unit is within `regenClearRadius`. */
export function structureRegenSystem(ctx: StructureContext, defs: Config['structures']) {
  const { structures, healths, teams, transforms, kinds, spatial } = ctx;
  const rules = defs.rules;
  for (let i = 0; i < structures.ids.length; i++) {
    const s = structures.ids[i]!;
    const st = structures.data[i]!;
    const h = healths.get(s)!;
    if (st.destroyed || !defs[st.kind].regen || h.hp >= h.maxHp) continue;
    const t = transforms.get(s)!;
    const team = teams.get(s);
    spatial.query(t.x, t.y, rules.regenClearRadius + UNIT_REACH, nearby);
    let clear = true;
    for (let k = 0; k < nearby.length && clear; k++) {
      const o = nearby[k]!;
      const kind = kinds.get(o);
      if ((kind !== Kind.Champion && kind !== Kind.Minion) || teams.get(o) === team || teams.get(o) === Team.Neutral) continue;
      if (healths.get(o)!.hp <= 0) continue;
      const ot = transforms.get(o)!;
      clear = len(ot.x - t.x, ot.y - t.y) > rules.regenClearRadius;
    }
    if (clear) h.hp = Math.min(h.maxHp, h.hp + (h.maxHp * rules.regenPctPerSecond) / 30);
  }
}
