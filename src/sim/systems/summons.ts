import type { Entity, Store, World } from '../ecs';
import type { SimEvent } from '../events';
import type { HitQueue } from '../hits';
import { len } from '../math';
import {
  Kind, TargetClass,
  type Champion, type Collider, type Concealment, type Health, type Motion, type Status, type Summon, type Targeting, type Team, type Transform,
} from '../sim';
import type { SpatialIndex } from '../spatial';

export interface SummonContext {
  world: World;
  summons: Store<Summon>;
  champions: Store<Champion>;
  transforms: Store<Transform>;
  motions: Store<Motion>;
  colliders: Store<Collider>;
  teams: Store<Team>;
  healths: Store<Health>;
  kinds: Store<Kind>;
  models: Store<string>;
  targetClasses: Store<TargetClass>;
  targetings: Store<Targeting>;
  concealments: Store<Concealment>;
  statuses: Store<Status>;
  spatial: SpatialIndex;
  hits: HitQueue;
  events: SimEvent[];
  /** Can `team` see `e` (Trench concealment, fog)? */
  seen(e: Entity, team: Team): boolean;
}

/** With no target the dog heels this close to its owner. */
const HEEL = 2;
const nearby: Entity[] = [];

function spawnDog(ctx: SummonContext, owner: Entity, c: Champion) {
  const m = c.mods;
  const t = ctx.transforms.get(owner)!;
  const e = ctx.world.create();
  ctx.transforms.add(e, { x: t.x - 0.8, y: t.y, facing: t.facing });
  ctx.motions.add(e, { vx: 0, vy: 0, speed: m.dogSpeed, intentX: 0, intentY: 0, slowTicks: 0, slowMult: 1, channelMult: 1 });
  ctx.colliders.add(e, { radius: m.dogRadius });
  ctx.teams.add(e, ctx.teams.get(owner)!);
  ctx.healths.add(e, { hp: m.dogHp, maxHp: m.dogHp, shield: 0, invulnerable: false, invulnUntil: 0, lethalSaves: 0, killer: 0 });
  ctx.kinds.add(e, Kind.Summon);
  ctx.models.add(e, 'warDog');
  ctx.targetClasses.add(e, TargetClass.Minion); // shot at the bottom of the order, with minions
  ctx.concealments.add(e, { zone: 0, visible: 0xff });
  ctx.statuses.add(e, { burnDps: 0, burnTicks: 0, burnSource: 0, markPct: 0, markTicks: 0, shieldLeft: 0, shieldTicks: 0, buffStat: 0, buffPct: 0, buffTicks: 0 });
  ctx.summons.add(e, { owner, biteWait: 0 });
  c.dogId = e;
}

/** Valid for the dog: a living enemy unit its team can see, within the leash of the owner. */
function biteable(ctx: SummonContext, o: Entity, team: Team, ot: Transform, leash: number): boolean {
  if (o === 0 || ctx.teams.get(o) === team) return false;
  const h = ctx.healths.get(o);
  if (!h || h.hp <= 0 || h.invulnerable || !ctx.seen(o, team)) return false;
  const t = ctx.transforms.get(o)!;
  return len(t.x - ot.x, t.y - ot.y) <= leash;
}

/**
 * War Dog (GDD §8, D-063), before movement:
 * - A champion with the power has a dog while it is up: it appears beside the owner on the pick,
 *   on the owner's respawn, and `dogRespawn` after its own death. It vanishes when the owner is
 *   knocked out.
 * - Target: the owner's auto-target if it is within `dogLeash` of the owner, else the nearest
 *   seen enemy unit (champion, minion, summon) there. It runs to it and bites for `dogBite` every
 *   `dogBiteTicks` within `dogReach`, credited to the owner as a fixed amount. With nothing to
 *   bite it heels within 2 m.
 */
export function summonSystem(ctx: SummonContext, tick: number) {
  const { champions, summons, transforms, motions, healths, teams } = ctx;
  for (let i = 0; i < champions.ids.length; i++) {
    const owner = champions.ids[i]!;
    const c = champions.data[i]!;
    const up = healths.get(owner)!.hp > 0;
    if (c.dogId !== 0 && (!up || c.mods.dogHp === 0)) {
      ctx.world.destroy(c.dogId);
      c.dogId = 0;
      c.dogRespawnAt = 0; // back with the owner
    }
    if (up && c.mods.dogHp > 0 && c.dogId === 0 && tick >= c.dogRespawnAt) spawnDog(ctx, owner, c);
  }

  for (let i = 0; i < summons.ids.length; i++) {
    const e = summons.ids[i]!;
    const s = summons.data[i]!;
    const c = champions.get(s.owner)!;
    const m = c.mods;
    const t = transforms.get(e)!;
    const mo = motions.get(e)!;
    if (healths.get(e)!.hp <= 0) continue;
    if (s.biteWait > 0) s.biteWait--;
    const team = teams.get(e)!;
    const ot = transforms.get(s.owner)!;
    let target = ctx.targetings.get(s.owner)?.targetId ?? 0;
    if (!biteable(ctx, target, team, ot, m.dogLeash) || ctx.kinds.get(target) === Kind.SubBase || ctx.kinds.get(target) === Kind.HQ) {
      target = 0;
      let best = Infinity;
      ctx.spatial.query(ot.x, ot.y, m.dogLeash + 1, nearby);
      for (let k = 0; k < nearby.length; k++) {
        const o = nearby[k]!;
        const kind = ctx.kinds.get(o);
        if (kind === Kind.SubBase || kind === Kind.HQ || !biteable(ctx, o, team, ot, m.dogLeash)) continue;
        const tt = transforms.get(o)!;
        const d = len(tt.x - t.x, tt.y - t.y);
        if (d < best) {
          best = d;
          target = o;
        }
      }
    }
    let gx = ot.x;
    let gy = ot.y;
    let stopAt = HEEL;
    if (target !== 0) {
      const tt = transforms.get(target)!;
      gx = tt.x;
      gy = tt.y;
      stopAt = m.dogReach + (ctx.colliders.get(target)?.radius ?? 0);
      if (len(gx - t.x, gy - t.y) <= stopAt && s.biteWait === 0) {
        ctx.hits.push(s.owner, target, m.dogBite, 1, 1, true);
        s.biteWait = m.dogBiteTicks;
      }
    }
    const d = len(gx - t.x, gy - t.y);
    mo.speed = m.dogSpeed;
    if (d > stopAt * 0.8) {
      mo.intentX = (gx - t.x) / d;
      mo.intentY = (gy - t.y) / d;
    } else {
      mo.intentX = mo.intentY = 0;
    }
  }
}

/** Removes dogs knocked out this tick (`summonDown`, which pays no XP), starting their owner's respawn timer. */
export function summonDeathSystem(ctx: SummonContext, tick: number) {
  const { summons, healths, transforms, champions } = ctx;
  for (let i = summons.ids.length - 1; i >= 0; i--) {
    const e = summons.ids[i]!;
    if (healths.get(e)!.hp > 0) continue;
    const s = summons.data[i]!;
    const c = champions.get(s.owner)!;
    const t = transforms.get(e)!;
    ctx.events.push({ type: 'summonDown', id: e, owner: s.owner, x: t.x, y: t.y });
    ctx.world.destroy(e);
    c.dogId = 0;
    c.dogRespawnAt = tick + c.mods.dogRespawn;
  }
}
