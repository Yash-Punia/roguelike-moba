import type { CampKind, Config } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import { len } from '../math';
import type { DamageLog } from '../damage-log';
import type { Champion, Health, Team, Transform } from '../sim';
import type { SpatialIndex } from '../spatial';
import type { Stats } from '../stats';
import { addUltCharge } from './charge';

type Progression = Config['progression'];

export interface ProgressionContext {
  champions: Store<Champion>;
  transforms: Store<Transform>;
  healths: Store<Health>;
  teams: Store<Team>;
  spatial: SpatialIndex;
  stats: Store<Stats>;
  events: SimEvent[];
  /** Every hit of the last few seconds, for takedown assists. */
  log: DamageLog;
  /** Re-derives a champion's stats after its level changed (growth is part of `base`, TDD §5). */
  onLevelUp(e: Entity): void;
}

/** Highest level reachable: one more than the number of steps in the table. */
export const maxLevel = (p: Progression) => p.xpPerLevel.length + 1;

/** Total XP needed to reach `level` (level 1 = 0). */
export function xpForLevel(p: Progression, level: number): number {
  let total = 0;
  for (let i = 0; i < level - 1 && i < p.xpPerLevel.length; i++) total += p.xpPerLevel[i]!;
  return total;
}

/**
 * Adds XP to a champion (GDD §8), capped at the max level's total, and levels it up as many
 * times as the new total allows, emitting `levelUp` for each level.
 */
export function grantXp(ctx: ProgressionContext, p: Progression, e: Entity, amount: number) {
  const c = ctx.champions.get(e);
  if (!c || amount <= 0) return;
  c.xp = Math.min(xpForLevel(p, maxLevel(p)), c.xp + amount);
  while (c.level < maxLevel(p) && c.xp >= xpForLevel(p, c.level + 1)) {
    c.level++;
    ctx.onLevelUp(e);
    ctx.events.push({ type: 'levelUp', id: e, level: c.level });
  }
}

const nearby: Entity[] = [];
const sharers: Entity[] = [];
const takers: Entity[] = [];

/**
 * Ultimate charge from fighting (GDD §8, D-065), right after the damage stage: for every hit
 * between champions of different teams, the attacker gains a point per `perDamageDealt` and the
 * victim a point per `perDamageTaken` (shield damage counts). Hits credited to a champion count
 * however it dealt them (weapon, Ultimate, burn, dog, mine).
 */
export function damageChargeSystem(ctx: ProgressionContext, p: Progression, events: readonly SimEvent[]) {
  const { champions, teams } = ctx;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.type !== 'damage' || ev.amount <= 0) continue;
    const src = champions.get(ev.source);
    const dst = champions.get(ev.target);
    if (!src || !dst || teams.get(ev.source) === teams.get(ev.target)) continue;
    addUltCharge(src, ctx.stats.get(ev.source), ev.amount / p.ultCharge.perDamageDealt);
    addUltCharge(dst, ctx.stats.get(ev.target), ev.amount / p.ultCharge.perDamageTaken);
  }
}

/** The enemy champions in on a takedown of `victim`: the killer, and every one that damaged it since `since`; ascending ids. */
function takedownCredit(ctx: ProgressionContext, victim: Entity, killer: Entity, since: number): Entity[] {
  takers.length = 0;
  const team = ctx.teams.get(victim);
  const add = (e: Entity) => {
    if (e !== 0 && ctx.champions.has(e) && ctx.teams.get(e) !== team && !takers.includes(e)) takers.push(e);
  };
  add(killer);
  const { log } = ctx;
  for (let k = 0; k < log.count; k++) {
    const s = log.slot(k);
    if (log.tick[s]! >= since && log.target[s] === victim) add(log.source[s]!);
  }
  return takers.sort((a, b) => a - b);
}

/**
 * XP from this tick's deaths (GDD §8, TDD §6.10), after the death systems:
 * - a minion's XP is split evenly between the living enemy champions within `shareRadius` of
 *   where it fell, whoever landed the last hit;
 * - a champion takedown pays the killer and every assist (damage on the victim within
 *   `assistSeconds`) the full takedown XP, plus the killer's bonus to the killer (D-067);
 * Ultimate charge follows the same deaths: each living enemy champion near a dying minion, and
 * every enemy champion in on a takedown (D-040, D-065).
 * - a cleared neutral camp pays the clearing team's living champions near its last unit (D-073);
 *   a mini-boss pays every champion of that team, anywhere, alive or not (GDD §4, D-079);
 * - a destroyed Sub-base pays every champion of the other team, alive or not.
 * Events are read in the order they happened, so grants are deterministic.
 */
export function progressionSystem(ctx: ProgressionContext, p: Progression, neutrals: Config['neutrals'], events: readonly SimEvent[], from: number, tick: number) {
  const { champions, transforms, healths, teams, spatial } = ctx;
  const end = events.length; // grants push levelUp events; don't read those
  for (let i = from; i < end; i++) {
    const ev = events[i]!;
    if (ev.type === 'death') {
      const victim = champions.get(ev.id);
      if (victim) {
        // Champion takedown: everyone in on it (the killer and its assists) gets the full XP and the
        // charge; the killer also gets its bonus, the others an assist (D-067).
        const k = p.championKill;
        const credit = takedownCredit(ctx, ev.id, ev.killer, tick - p.assistSeconds);
        for (let n = 0; n < credit.length; n++) {
          const e = credit[n]!;
          const c = champions.get(e)!;
          grantXp(ctx, p, e, k.base + k.perVictimLevel * victim.level + (e === ev.killer ? k.killerBonus : 0));
          addUltCharge(c, ctx.stats.get(e), p.ultCharge.championTakedown);
          if (e !== ev.killer) c.assists++;
        }
        continue;
      }
      // A minion: shared by presence, worth what its unit is worth. Camp units pay on `campCleared`.
      const team = ev.team;
      const unit = ev.unit ?? 'mgSoldier';
      if (isCamp(neutrals, unit)) continue;
      spatial.query(ev.x, ev.y, Math.max(p.shareRadius, p.ultCharge.minionRadius) + 1, nearby);
      sharers.length = 0;
      for (let k = 0; k < nearby.length; k++) {
        const o = nearby[k]!;
        if (!champions.has(o) || teams.get(o) === team || healths.get(o)!.hp <= 0) continue;
        const t = transforms.get(o)!;
        const d = len(t.x - ev.x, t.y - ev.y);
        if (d <= p.shareRadius) sharers.push(o);
        // Ultimate charge: each champion near a dying minion, not split (GDD §8).
        if (d <= p.ultCharge.minionRadius) addUltCharge(champions.get(o)!, ctx.stats.get(o), p.ultCharge.minion[unit]);
      }
      const xp = p.minionXp[unit];
      for (let k = 0; k < sharers.length; k++) grantXp(ctx, p, sharers[k]!, xp / sharers.length);
    } else if (ev.type === 'campCleared' && ev.team !== undefined) {
      // A camp (GDD §4, D-073): its XP split between the clearing team's living champions near the
      // last unit, and its Ultimate charge to each of them.
      const camp = neutrals.camps[ev.kind];
      if (camp.boss) {
        for (let k = 0; k < champions.ids.length; k++) {
          const c = champions.ids[k]!;
          if (teams.get(c) !== ev.team) continue;
          grantXp(ctx, p, c, camp.xp);
          addUltCharge(champions.data[k]!, ctx.stats.get(c), camp.ultCharge);
        }
        continue;
      }
      spatial.query(ev.x, ev.y, neutrals.rewardRadius + 1, nearby);
      sharers.length = 0;
      for (let k = 0; k < nearby.length; k++) {
        const o = nearby[k]!;
        if (!champions.has(o) || teams.get(o) !== ev.team || healths.get(o)!.hp <= 0) continue;
        const t = transforms.get(o)!;
        if (len(t.x - ev.x, t.y - ev.y) > neutrals.rewardRadius) continue;
        sharers.push(o);
        addUltCharge(champions.get(o)!, ctx.stats.get(o), camp.ultCharge);
      }
      for (let k = 0; k < sharers.length; k++) grantXp(ctx, p, sharers[k]!, camp.xp / sharers.length);
    } else if (ev.type === 'structureDestroyed' && ev.kind === 'subBase') {
      for (let k = 0; k < champions.ids.length; k++) {
        const c = champions.ids[k]!;
        if (teams.get(c) !== ev.team) grantXp(ctx, p, c, p.structureXp.subBase);
      }
    }
  }
}

/** A camp unit's death (its kind in `neutrals.camps`): it pays on `campCleared`, not as a minion. */
function isCamp(neutrals: Config['neutrals'], unit: string): unit is CampKind {
  return unit in neutrals.camps;
}
