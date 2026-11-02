import type { Config } from '../data/schema';
import type { Store } from './ecs';
import { DamageLog, HitFlag } from './damage-log';
import type { DamageEvent, SimEvent } from './events';
import type { HitQueue } from './hits';
import { Kind, type Health, type Structure } from './sim';
import { Stat, stat, type Stats } from './stats';

/** True while a unit takes no damage and can't be targeted: a permanent flag (HQ) or a timed window (lethal save). */
export function isInvulnerable(h: Health, tick: number): boolean {
  return h.invulnerable || tick < h.invulnUntil;
}

export interface DamageContext {
  hits: HitQueue;
  log: DamageLog;
  healths: Store<Health>;
  stats: Store<Stats>;
  kinds: Store<Kind>;
  events: SimEvent[];
  structures: Store<Structure>;
}

const eventPool: DamageEvent[] = [];

/**
 * Applies this tick's hits in queue order through the fixed TDD §6.4 pipeline, so powers
 * combine predictably:
 *
 * 1. base damage from the weapon or effect;
 * 2. attacker: damage stat, then the vs-champions or vs-structures stat by the target's kind;
 * 3. crit multiplier carried by the hit;
 * 4. target: damage-taken stat, then structure rules (the hit's structure share, backdoor protection);
 * 5. shield absorbs first, then HP;
 * 6. a lethal hit on a unit with a lethal save leaves 1 HP and a short invulnerability;
 * 7. log the hit and emit a `damage` event.
 *
 * Invulnerable and already-dead targets take nothing and are not logged. Damage stays a
 * float (small damage-over-time ticks would vanish if rounded); only the display rounds.
 */
export function damageSystem(ctx: DamageContext, cfg: Config['combat']['damage'], tick: number, backdoorPct = 0) {
  const { hits, log, healths, stats, kinds, events } = ctx;
  log.windowTicks = cfg.logSeconds;
  let pooled = 0;

  for (let k = 0; k < hits.count; k++) {
    const target = hits.target[k]!;
    const h = healths.get(target);
    if (!h || h.hp <= 0 || isInvulnerable(h, tick)) continue;
    const source = hits.source[k]!;
    const kind = kinds.get(target);

    // 1–2. Base, then the attacker's modifiers, read now (a missing attacker counts as ×1).
    let amount = hits.base[k]!;
    const as = stats.get(source);
    if (as) {
      amount *= stat(as, Stat.Damage);
      if (kind === Kind.Champion) amount *= stat(as, Stat.DamageVsChampions);
      else if (kind === Kind.SubBase || kind === Kind.HQ) amount *= stat(as, Stat.DamageVsStructures);
    }
    // 3. Crit.
    const critMult = hits.critMult[k]!;
    amount *= critMult;
    // 4. The target's modifiers.
    const ts = stats.get(target);
    if (ts) amount *= stat(ts, Stat.DamageTaken);
    // Structure rules: the hit's own structure share (fire pool 50%), then backdoor protection;
    // the Bazooka Tank's resistance to structure fire (M3) joins here.
    if (kind === Kind.SubBase || kind === Kind.HQ) {
      amount *= hits.structureMult[k]!;
      if (ctx.structures.get(target)?.backdoor) amount *= 1 - backdoorPct; // no enemy minion near (GDD §5)
    }
    if (amount < 0) amount = 0;

    // 5. Shield, then HP.
    const absorbed = Math.min(h.shield, amount);
    h.shield -= absorbed;
    let toHp = amount - absorbed;
    let flags = critMult > 1 ? HitFlag.Critical : 0;
    // 6. Lethal check.
    if (toHp >= h.hp) {
      if (h.lethalSaves > 0) {
        h.lethalSaves--;
        toHp = Math.max(0, h.hp - 1);
        h.invulnUntil = tick + cfg.lethalSaveSeconds;
        flags |= HitFlag.Saved;
      } else {
        toHp = h.hp;
        flags |= HitFlag.Lethal;
        h.killer = source;
      }
    }
    h.hp -= toHp;

    // 7. Log and announce.
    const dealt = absorbed + toHp;
    log.push(tick, source, target, dealt, absorbed, flags);
    const ev = (eventPool[pooled++] ??= { type: 'damage', source: 0, target: 0, amount: 0, absorbed: 0, critical: false, lethal: false, saved: false });
    ev.source = source;
    ev.target = target;
    ev.amount = dealt;
    ev.absorbed = absorbed;
    ev.critical = (flags & HitFlag.Critical) !== 0;
    ev.lethal = (flags & HitFlag.Lethal) !== 0;
    ev.saved = (flags & HitFlag.Saved) !== 0;
    events.push(ev);
  }
  hits.count = 0;
}
