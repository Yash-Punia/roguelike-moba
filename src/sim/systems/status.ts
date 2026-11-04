import { TICK_HZ } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import { zoneAt, type ObstacleGrid } from '../grid';
import type { HitQueue } from '../hits';
import { len } from '../math';
import type { Champion, Health, Motion, Status, Structure, Team, Transform } from '../sim';
import { addPct, stat, Stat, type Stats } from '../stats';

export interface StatusContext {
  champions: Store<Champion>;
  statuses: Store<Status>;
  healths: Store<Health>;
  stats: Store<Stats>;
  motions: Store<Motion>;
  transforms: Store<Transform>;
  teams: Store<Team>;
  structures: Store<Structure>;
  hits: HitQueue;
  events: SimEvent[];
  grid: () => ObstacleGrid;
}

/** Burns hit on a fixed beat this often (0.5 s), so refreshing one adds no extra hits and its damage numbers stay readable. */
const BURN_PERIOD = 15;

function setBuff(ctx: StatusContext, e: Entity, s: Status, which: Stat, pct: number, ticks: number) {
  const st = ctx.stats.get(e);
  if (!st) return;
  if (s.buffTicks > 0) addPct(st, s.buffStat, -s.buffPct);
  s.buffStat = which;
  s.buffPct = pct;
  s.buffTicks = ticks;
  addPct(st, which, pct);
  refreshSpeed(ctx, e, st);
}

function refreshSpeed(ctx: StatusContext, e: Entity, st: Stats) {
  const m = ctx.motions.get(e);
  if (m) m.speed = stat(st, Stat.MoveSpeed);
}

function clear(ctx: StatusContext, e: Entity, s: Status) {
  if (s.buffTicks > 0) {
    const st = ctx.stats.get(e);
    if (st) {
      addPct(st, s.buffStat, -s.buffPct);
      refreshSpeed(ctx, e, st);
    }
  }
  s.burnDps = s.burnTicks = s.markPct = s.markTicks = s.shieldLeft = s.shieldTicks = s.buffPct = s.buffTicks = 0;
}

/**
 * Power triggers and timed statuses (GDD §8, D-060), at the end of the rewards stage, reading
 * this tick's events:
 * 1. A champion's weapon hits (bullets, flames) burn and mark enemy units with statuses
 *    (Incendiary, Tracer Rounds). A burn keeps the stronger dps and restarts its timer.
 * 2. A knock-out by a champion with an `onKill` power buffs it (Adrenaline); an enemy minion
 *    dying near one with Scavenger heals it.
 * 3. Second Wind: below its threshold, off cooldown, a timed shield.
 * 4. Dug In: its stat delta is on while near a standing allied structure or on a trench floor.
 * 5. Timers: burns hit every 0.5 s (queued for next tick's damage stage, an exact amount), marks
 *    fade, a timed shield takes back what is left of it, buffs come off. A knocked-out unit loses them all.
 */
export function statusSystem(ctx: StatusContext, events: readonly SimEvent[], tick: number) {
  const { champions, statuses, healths, transforms, teams } = ctx;

  for (let k = 0; k < events.length; k++) {
    const ev = events[k]!;
    if (ev.type === 'damage') {
      if (!ev.weapon || ev.amount <= 0) continue;
      const c = champions.get(ev.source);
      const s = statuses.get(ev.target);
      if (!c || !s || healths.get(ev.target)!.hp <= 0) continue;
      const m = c.mods;
      if (m.burnDps > 0) {
        if (m.burnDps >= s.burnDps || s.burnTicks === 0) {
          s.burnDps = m.burnDps;
          s.burnSource = ev.source;
        }
        s.burnTicks = m.burnTicks;
      }
      if (m.markPct > 0) {
        s.markPct = Math.max(s.markTicks > 0 ? s.markPct : 0, m.markPct);
        s.markTicks = m.markTicks;
      }
    } else if (ev.type === 'death') {
      const killer = champions.get(ev.killer);
      if (ev.unit === undefined && killer && killer.mods.killPct > 0 && teams.get(ev.killer) !== ev.team && healths.get(ev.killer)!.hp > 0) {
        setBuff(ctx, ev.killer, statuses.get(ev.killer)!, killer.mods.killStat, killer.mods.killPct, killer.mods.killTicks);
      }
      if (ev.unit === undefined) continue;
      for (let i = 0; i < champions.ids.length; i++) {
        const e = champions.ids[i]!;
        const m = champions.data[i]!.mods;
        const h = healths.get(e)!;
        if (m.scavengePct === 0 || h.hp <= 0 || teams.get(e) === ev.team) continue;
        const t = transforms.get(e)!;
        if (len(t.x - ev.x, t.y - ev.y) <= m.scavengeRadius) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * m.scavengePct);
      }
    }
  }

  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const m = c.mods;
    const h = healths.get(e)!;
    if (m.lowHpShield > 0 && h.hp > 0 && h.hp < h.maxHp * m.lowHpBelow && tick >= c.lowHpReadyAt) {
      const s = statuses.get(e)!;
      const grant = h.maxHp * m.lowHpShield;
      h.shield += grant;
      s.shieldLeft += grant;
      s.shieldTicks = m.lowHpTicks;
      c.lowHpReadyAt = tick + m.lowHpCooldown;
    }
    const want = m.dugInPct !== 0 && h.hp > 0 && dugIn(ctx, e, m.dugInRadius) ? m.dugInPct : 0;
    if (want !== c.dugInApplied) {
      addPct(ctx.stats.get(e)!, m.dugInStat, want - c.dugInApplied);
      c.dugInApplied = want;
    }
  }

  for (let i = 0; i < statuses.ids.length; i++) {
    const e = statuses.ids[i]!;
    const s = statuses.data[i]!;
    const h = healths.get(e)!;
    if (h.hp <= 0) {
      clear(ctx, e, s);
      continue;
    }
    if (s.burnTicks > 0) {
      if (tick % BURN_PERIOD === 0) ctx.hits.push(s.burnSource, e, (s.burnDps * BURN_PERIOD) / TICK_HZ, 1, 1, true);
      if (--s.burnTicks === 0) s.burnDps = 0;
    }
    if (s.markTicks > 0 && --s.markTicks === 0) s.markPct = 0;
    if (s.shieldTicks > 0 && --s.shieldTicks === 0) {
      h.shield -= Math.min(h.shield, s.shieldLeft);
      s.shieldLeft = 0;
    }
    s.shieldLeft = Math.min(s.shieldLeft, h.shield); // hits ate into it
    if (s.buffTicks > 0 && --s.buffTicks === 0) {
      const st = ctx.stats.get(e);
      if (st) {
        addPct(st, s.buffStat, -s.buffPct);
        refreshSpeed(ctx, e, st);
      }
      s.buffPct = 0;
    }
  }
}

/** On a trench floor, or within `radius` of a standing allied structure's centre. */
function dugIn(ctx: StatusContext, e: Entity, radius: number): boolean {
  const t = ctx.transforms.get(e)!;
  if (zoneAt(ctx.grid(), t.x, t.y) !== 0) return true;
  const team = ctx.teams.get(e);
  const { structures } = ctx;
  for (let i = 0; i < structures.ids.length; i++) {
    const s = structures.ids[i]!;
    if (structures.data[i]!.destroyed || ctx.teams.get(s) !== team) continue;
    const st = ctx.transforms.get(s)!;
    if (len(st.x - t.x, st.y - t.y) <= radius) return true;
  }
  return false;
}
