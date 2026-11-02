import type { Config } from '../../data/schema';
import type { LanePath } from '../../data/map-geometry';
import type { Entity } from '../ecs';
import { len } from '../math';
import { Kind, Team, type Command, type EntitySnapshot, type PlayerId, type Snapshot } from '../sim';
import { steerAround } from '../systems/minions';
import { LaneTrack } from './lane';

export type BotGoal = 'farm' | 'trade' | 'retreat' | 'dead';

/**
 * How far ahead along the lane the bot aims while travelling (m), and when it counts as
 * arrived. Far enough that the aim point lies beyond a Sub-base the lane runs through, so the
 * tangent steering takes it round instead of into it.
 */
const LOOKAHEAD = 6;
const ARRIVED = 0.4;
/** Holds this far in front of its own Sub-base when it has no wave to follow (m). */
const HOLD_AHEAD = 4;
/** Clearance kept from structure footprints while steering (m). */
const AVOID_MARGIN = 0.25;

const quantise = (v: number) => Math.sign(v) * Math.min(127, Math.round(Math.abs(v) * 127)) || 0;

/**
 * The M2 lane bot (TDD §7, D-042). It reads only the previous snapshot and returns the same
 * `Command` a human sends. Goals: retreat when low (an emergency, any time), trade with the
 * enemy champion when healthier and the enemy isn't under its tower, otherwise farm behind its
 * own wave, pushing with it but never diving a tower alone. It casts the Ultimate on a
 * champion, or on a bunch of minions. Drafts are left to the 10 s auto-pick.
 */
export function createBot(player: PlayerId, team: Team, getConfig: () => Config, getLanes: () => readonly LanePath[]) {
  let goal: BotGoal = 'farm';
  let committedUntil = 0;
  let nextDecision = 0;
  let track: LaneTrack | undefined;
  let trackFrom: Float64Array | undefined;
  const p = { x: 0, y: 0 };
  const steer = { x: 0, y: 0 };
  const cmd: Command = { tick: 0, player, moveX: 0, moveY: 0, ult: false, draftPick: -1, reroll: false };

  /** Lane progress towards the enemy: 0 at its own end. */
  const forward = (s: number) => (team === Team.Blue ? s : track!.length - s);
  const fromForward = (f: number) => (team === Team.Blue ? f : track!.length - f);
  const progress = (e: EntitySnapshot) => forward(track!.project(e.x, e.y));

  function laneTrack(): LaneTrack | undefined {
    const pts = getLanes()[0]?.branches[0];
    if (!pts) return undefined;
    if (pts !== trackFrom) {
      track = new LaneTrack(pts);
      trackFrom = pts;
    }
    return track;
  }

  return {
    get goal() {
      return goal;
    },

    command(snap: Snapshot, tick: number, self: Entity): Command {
      const cfg = getConfig();
      const b = cfg.bots;
      cmd.tick = tick;
      cmd.moveX = cmd.moveY = 0;
      cmd.ult = false;
      const me = byId(snap, self);
      if (!me || me.hp <= 0 || snap.match.phase !== 'live' || !laneTrack()) {
        goal = 'dead';
        return cmd;
      }
      const hpFrac = me.hp / me.maxHp;
      const range = weaponRange(cfg, me);

      // What's around, from the snapshot.
      let enemyChamp: EntitySnapshot | undefined;
      let ownFront = -Infinity;
      let enemyFront = Infinity;
      let enemyTower: EntitySnapshot | undefined;
      let ownSub: EntitySnapshot | undefined;
      for (const e of snap.entities) {
        if (e.kind === Kind.Champion && e.team !== team && e.hp > 0 && !e.invulnerable) enemyChamp = e;
        else if (e.kind === Kind.Minion && e.hp > 0) {
          const f = progress(e);
          if (e.team === team) ownFront = Math.max(ownFront, f);
          else enemyFront = Math.min(enemyFront, f);
        } else if ((e.kind === Kind.SubBase || e.kind === Kind.HQ) && !e.destroyed) {
          if (e.team !== team) {
            if (!enemyTower || progress(e) < progress(enemyTower)) enemyTower = e; // the nearest one in the way
          } else if (e.kind === Kind.SubBase) ownSub = e;
        }
      }
      const towerRange = enemyTower ? cfg.structures[enemyTower.kind === Kind.HQ ? 'hq' : 'subBase'].weapon.range : 0;

      // May it step into the enemy tower's range? Only while that tower is shooting one of its minions.
      const shotAt = enemyTower ? byId(snap, enemyTower.targetId) : undefined;
      const towerBusy = !!shotAt && shotAt.kind === Kind.Minion && shotAt.team === team;
      const towerLimit = enemyTower && !towerBusy ? progress(enemyTower) - (towerRange + b.towerMargin + me.radius + enemyTower.radius) : Infinity;

      // Decide (TDD §7): retreat is an emergency; otherwise re-decide on the beat, keeping a goal for at least `commitSeconds`.
      if (goal === 'dead') goal = 'farm';
      const mustRetreat = hpFrac < b.retreatHpPct || (goal === 'retreat' && hpFrac < b.returnHpPct);
      if (mustRetreat) {
        goal = 'retreat';
      } else if (tick >= nextDecision) {
        nextDecision = tick + b.decisionSeconds;
        const canTrade =
          !!enemyChamp &&
          len(enemyChamp.x - me.x, enemyChamp.y - me.y) <= b.tradeRange &&
          hpFrac >= enemyChamp.hp / enemyChamp.maxHp + b.tradeHpMarginPct &&
          !(enemyTower && len(enemyChamp.x - enemyTower.x, enemyChamp.y - enemyTower.y) - enemyChamp.radius <= towerRange + b.towerMargin);
        const want: BotGoal = canTrade ? 'trade' : 'farm';
        if (want !== goal && (tick >= committedUntil || goal === 'retreat')) {
          goal = want;
          committedUntil = tick + b.commitSeconds;
        }
      }

      // Where to stand.
      const fMe = progress(me);
      let aim: { x: number; y: number } | undefined;
      if (goal === 'retreat') {
        const pad = team === Team.Blue ? cfg.map.spawn.blue : cfg.map.spawn.red;
        aim = fMe > LOOKAHEAD ? track!.pointAt(fromForward(fMe - LOOKAHEAD), p) : pad;
        if (len(pad.x - me.x, pad.y - me.y) < 0.6) aim = undefined; // on the pad: heal
      } else if (goal === 'trade' && enemyChamp) {
        const dx = me.x - enemyChamp.x;
        const dy = me.y - enemyChamp.y;
        const d = len(dx, dy) || 1;
        const want = range * b.tradeRangePct + enemyChamp.radius;
        p.x = enemyChamp.x + (dx / d) * want;
        p.y = enemyChamp.y + (dy / d) * want;
        if (forward(track!.project(p.x, p.y)) > towerLimit) track!.pointAt(fromForward(towerLimit), p);
        aim = p;
      } else {
        const ownHold = ownSub ? progress(ownSub) + HOLD_AHEAD : HOLD_AHEAD;
        // Behind its own front-most minion, but never back past its hold point: a fresh wave
        // walks up to it rather than the bot walking home to fetch it.
        const front = ownFront > -Infinity ? Math.max(ownFront - 1, ownHold) : ownHold;
        const enemyEdge = Math.min(enemyFront, enemyTower ? progress(enemyTower) : Infinity);
        let target = Math.min(front, enemyEdge - range * b.farmRangePct);
        target = Math.min(target, towerLimit);
        const delta = target - fMe;
        if (Math.abs(delta) > ARRIVED) {
          const step = Math.sign(delta) * Math.min(Math.abs(delta), LOOKAHEAD);
          aim = track!.pointAt(fromForward(fMe + step), p);
        }
      }

      if (aim) {
        let dx = aim.x - me.x;
        let dy = aim.y - me.y;
        const d = len(dx, dy);
        if (d > 0.05) {
          dx /= d;
          dy /= d;
          // Round structures, not through them (shared with minions).
          for (const e of snap.entities) {
            if ((e.kind !== Kind.SubBase && e.kind !== Kind.HQ) || !e.radius) continue;
            const f = cfg.structures[e.kind === Kind.HQ ? 'hq' : 'subBase'].footprint;
            const r = f.shape === 'circle' ? f.r : Math.max(f.w, f.h) / 2;
            if (steerAround(me.x, me.y, dx, dy, d, e.x, e.y, r + me.radius + AVOID_MARGIN, steer)) {
              dx = steer.x;
              dy = steer.y;
              break;
            }
          }
          cmd.moveX = quantise(dx);
          cmd.moveY = quantise(dy);
        }
      }

      // Ultimate (TDD §7): on a champion, or on a bunch of minions.
      if (me.ultCharge >= 100 && me.ultTargetable && me.ultTargetId !== 0 && goal !== 'retreat') {
        const target = byId(snap, me.ultTargetId);
        if (target?.kind === Kind.Champion) cmd.ult = true;
        else if (target?.kind === Kind.Minion) {
          let near = 0;
          for (const e of snap.entities) {
            if (e.kind === Kind.Minion && e.team !== team && e.hp > 0 && len(e.x - target.x, e.y - target.y) <= b.ult.clusterRadius) near++;
          }
          cmd.ult = near >= b.ult.minionCluster;
        }
      }
      return cmd;
    },
  };
}

/** The snapshot entity with this id (a plain loop: no per-tick closures). */
function byId(snap: Snapshot, id: Entity): EntitySnapshot | undefined {
  if (id === 0) return undefined;
  const list = snap.entities;
  for (let i = 0; i < list.length; i++) if (list[i]!.id === id) return list[i];
  return undefined;
}

/** The champion's weapon range from config (stat bonuses aside; good enough for positioning). */
function weaponRange(cfg: Config, me: EntitySnapshot): number {
  return cfg.champions.find((c) => c.id === me.modelId)?.weapon.range ?? 7;
}
