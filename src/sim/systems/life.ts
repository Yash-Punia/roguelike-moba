import { TICK_HZ, type Config } from '../../data/schema';
import type { Store } from '../ecs';
import type { SimEvent } from '../events';
import { len } from '../math';
import { Team, type Champion, type Health, type Motion, type Targeting, type Transform, type Weapon } from '../sim';

export interface LifeContext {
  champions: Store<Champion>;
  transforms: Store<Transform>;
  motions: Store<Motion>;
  healths: Store<Health>;
  weapons: Store<Weapon>;
  targetings: Store<Targeting>;
  teams: Store<Team>;
  events: SimEvent[];
}

/** Ticks a champion of this level stays down (GDD §9): base + perLevel × level, capped. At least one tick. */
export function respawnTicks(level: number, cfg: Config['match']['respawn']): number {
  return Math.max(1, Math.round(Math.min(cfg.maxSeconds, cfg.baseSeconds + cfg.perLevelSeconds * level) * TICK_HZ));
}

/** Where a champion redeploys: its debug spawn point if it has one, else its team's HQ pad. */
export function homeOf(c: Champion, team: Team, map: Config['map']) {
  return c.spawnAt ?? (team === Team.Blue ? map.spawn.blue : map.spawn.red);
}

/**
 * Knock-outs (TDD §6.11), after the damage stage: a champion at 0 HP that isn't already down
 * starts its respawn timer and stops; it keeps its level, Ultimate charge and powers.
 * Kill XP, charge and assists hook onto the `death` event (M2 features 11 and 13, M3).
 */
export function deathSystem(ctx: LifeContext, cfg: Config['match']['respawn']) {
  const { champions, healths, motions, transforms, events } = ctx;
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const h = healths.get(e);
    if (!h || h.hp > 0 || c.respawnTicks > 0) continue;
    c.respawnTicks = respawnTicks(c.level, cfg);
    c.deaths++;
    const killer = champions.get(h.killer);
    if (killer && ctx.teams.get(h.killer) !== ctx.teams.get(e)) killer.kills++;
    const m = motions.get(e);
    if (m) m.vx = m.vy = m.intentX = m.intentY = 0;
    const t = transforms.get(e)!;
    events.push({ type: 'death', id: e, team: ctx.teams.get(e)!, killer: h.killer, x: t.x, y: t.y });
  }
}

/**
 * Respawn timers, first in the tick ("spawners and timers", TDD §4). When one runs out the
 * champion redeploys at home facing the enemy, with full HP and a fresh weapon and target;
 * its Ultimate charge is kept.
 */
export function respawnSystem(ctx: LifeContext, map: Config['map']) {
  const { champions, transforms, motions, healths, weapons, targetings, teams, events } = ctx;
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    if (c.respawnTicks === 0 || --c.respawnTicks > 0) continue;
    const team = teams.get(e)!;
    const home = homeOf(c, team, map);
    const t = transforms.get(e)!;
    t.x = home.x;
    t.y = home.y;
    t.facing = team === Team.Blue ? Math.PI / 2 : -Math.PI / 2;
    const m = motions.get(e);
    if (m) m.vx = m.vy = m.intentX = m.intentY = 0;
    const h = healths.get(e)!;
    h.hp = h.maxHp;
    h.shield = 0;
    h.invulnUntil = 0;
    h.killer = 0;
    const w = weapons.get(e);
    if (w) {
      w.cooldown = 0;
      w.aim = t.facing;
    }
    const tg = targetings.get(e);
    if (tg) tg.targetId = tg.pendingSwitchId = tg.pendingTicks = tg.holdTicks = 0;
    c.stillTicks = 0;
    c.castQueued = false;
    events.push({ type: 'respawn', id: e, x: t.x, y: t.y });
  }
}

/** The HQ spawn pad heals its own team's living champions standing on it (GDD §9), up to max HP. */
export function padHealSystem(ctx: LifeContext, map: Config['map'], pad: Config['match']['spawnPad']) {
  const { champions, transforms, healths, teams } = ctx;
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const h = healths.get(e);
    if (!h || h.hp <= 0 || h.hp >= h.maxHp) continue;
    const at = teams.get(e) === Team.Blue ? map.spawn.blue : map.spawn.red;
    const t = transforms.get(e)!;
    if (len(t.x - at.x, t.y - at.y) > pad.radius) continue;
    h.hp = Math.min(h.maxHp, h.hp + (h.maxHp * pad.healPctPerSecond) / TICK_HZ);
  }
}

/**
 * Trench medkits (GDD §4): a ready crate goes to the first living champion (ascending id)
 * below max HP within `pickupRadius`, healing `healPct` of max HP; it is back `respawnSeconds`
 * later. `readyAt[i]` is the tick crate i is ready from (0 at the start).
 */
export function medkitSystem(ctx: LifeContext, map: Config['map'], cfg: Config['combat']['medkit'], readyAt: number[], tick: number) {
  const { champions, transforms, healths } = ctx;
  for (let k = 0; k < map.medkits.length; k++) {
    if ((readyAt[k] ?? 0) > tick) continue;
    const at = map.medkits[k]!;
    for (let i = 0; i < champions.ids.length; i++) {
      const e = champions.ids[i]!;
      const h = healths.get(e);
      if (!h || h.hp <= 0 || h.hp >= h.maxHp) continue;
      const t = transforms.get(e)!;
      if (len(t.x - at.x, t.y - at.y) > cfg.pickupRadius) continue;
      const amount = Math.min(h.maxHp - h.hp, h.maxHp * cfg.healPct);
      h.hp += amount;
      readyAt[k] = tick + cfg.respawnSeconds;
      ctx.events.push({ type: 'medkitTaken', id: e, medkit: k, amount });
      break;
    }
  }
}
