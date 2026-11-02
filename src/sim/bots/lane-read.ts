import type { Config } from '../../data/schema';
import type { Entity } from '../ecs';
import { len } from '../math';
import { Kind, Team, type EntitySnapshot, type Snapshot } from '../sim';
import type { LaneTrack } from './lane';

/**
 * What a bot sees of its lane in one snapshot (D-043), measured along the lane as forward
 * progress `f` (0 at its own end, growing towards the enemy). Plain fields, refilled in place.
 */
export interface LaneRead {
  me: EntitySnapshot | undefined;
  fMe: number;
  enemy: EntitySnapshot | undefined;
  /** The enemy champion is down: ticks until it is back (0 = alive or none). */
  enemyRespawn: number;
  fEnemy: number;
  /** Fronts of each wave (−∞ / +∞ without one), and minions near the clash on each side. */
  ownFront: number;
  enemyFront: number;
  ownNear: number;
  enemyNear: number;
  /** Own minions minus enemy minions around the clash. */
  waveAdvantage: number;
  /** The nearest standing enemy structure in the way, and our furthest standing one. */
  enemyTower: EntitySnapshot | undefined;
  fEnemyTower: number;
  enemyTowerRange: number;
  ownTower: EntitySnapshot | undefined;
  fOwnTower: number;
  ownTowerRange: number;
  /** The enemy tower is shooting one of our minions / us. */
  towerBusy: boolean;
  towerOnMe: boolean;
  /** Own minions within reach of the enemy tower (they tank it for a siege). */
  ownAtTower: number;
  /** The enemy champion stands inside its own tower's range. */
  enemyUnderTower: boolean;
  /** Enemy minions close enough to answer a call for help if we hit their champion. */
  enemyMinionsNearMe: number;
  /** Something hostile is inside our own tower's range (defend). */
  ownTowerThreatened: boolean;
  enemyAtOwnTower: boolean;
  /** Seconds for us to kill the enemy champion, and for it to kill us (∞ if it can't). */
  ttkUs: number;
  ttkThem: number;
  /** Our weapon range. */
  range: number;
}

export function emptyRead(): LaneRead {
  return {
    me: undefined, fMe: 0, enemy: undefined, enemyRespawn: 0, fEnemy: 0, ownFront: -Infinity, enemyFront: Infinity, ownNear: 0,
    enemyNear: 0, waveAdvantage: 0, enemyTower: undefined, fEnemyTower: Infinity, enemyTowerRange: 0, ownTower: undefined,
    fOwnTower: 0, ownTowerRange: 0, towerBusy: false, towerOnMe: false, ownAtTower: 0, enemyUnderTower: false, enemyMinionsNearMe: 0,
    ownTowerThreatened: false, enemyAtOwnTower: false, ttkUs: Infinity, ttkThem: Infinity, range: 7,
  };
}

const kindName = (k: Kind) => (k === Kind.HQ ? 'hq' : 'subBase');

/** Damage per second of a champion's weapon at its level (stat bonuses from powers aside). */
export function championDps(cfg: Config, e: EntitySnapshot): number {
  const def = cfg.champions.find((c) => c.id === e.modelId);
  if (!def) return 0;
  return (def.weapon.damage * (1 + def.growth.damagePct * Math.max(0, e.level - 1))) / (def.weapon.interval / 30);
}

/** Fills `r` from the snapshot for the champion `self` of team `team`. */
export function readLane(r: LaneRead, snap: Snapshot, self: Entity, team: Team, track: LaneTrack, cfg: Config) {
  const b = cfg.bots;
  const forward = (x: number, y: number) => (team === Team.Blue ? track.project(x, y) : track.length - track.project(x, y));
  r.me = undefined;
  r.enemy = undefined;
  r.enemyRespawn = 0;
  r.ownFront = -Infinity;
  r.enemyFront = Infinity;
  r.enemyTower = undefined;
  r.fEnemyTower = Infinity;
  r.ownTower = undefined;
  r.fOwnTower = -Infinity;
  const list = snap.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.id === self) r.me = e;
    else if (e.kind === Kind.Champion && e.team !== team) r.enemy = e;
    else if (e.kind === Kind.Minion && e.hp > 0) {
      const f = forward(e.x, e.y);
      if (e.team === team) r.ownFront = Math.max(r.ownFront, f);
      else r.enemyFront = Math.min(r.enemyFront, f);
    } else if ((e.kind === Kind.SubBase || e.kind === Kind.HQ) && !e.destroyed) {
      const f = forward(e.x, e.y);
      if (e.team !== team && f < r.fEnemyTower) {
        r.enemyTower = e;
        r.fEnemyTower = f;
      } else if (e.team === team && f > r.fOwnTower) {
        r.ownTower = e;
        r.fOwnTower = f;
      }
    }
  }
  const me = r.me;
  if (!me) return;
  r.fMe = forward(me.x, me.y);
  r.range = cfg.champions.find((c) => c.id === me.modelId)?.weapon.range ?? 7;
  const enemy = r.enemy;
  r.enemyRespawn = enemy && enemy.hp <= 0 ? enemy.respawnTicks : 0;
  r.fEnemy = enemy ? forward(enemy.x, enemy.y) : Infinity;
  r.enemyTowerRange = r.enemyTower ? cfg.structures[kindName(r.enemyTower.kind)].weapon.range : 0;
  r.ownTowerRange = r.ownTower ? cfg.structures[kindName(r.ownTower.kind)].weapon.range : 0;
  if (r.fOwnTower === -Infinity) r.fOwnTower = 0;

  // Around the clash, the enemy tower, our own tower, and us.
  const clash = r.ownFront > -Infinity && r.enemyFront < Infinity ? (r.ownFront + r.enemyFront) / 2 : r.ownFront > -Infinity ? r.ownFront : r.enemyFront;
  r.ownNear = r.enemyNear = r.ownAtTower = r.enemyMinionsNearMe = 0;
  r.towerBusy = r.towerOnMe = r.ownTowerThreatened = r.enemyAtOwnTower = false;
  const tower = r.enemyTower;
  if (tower) r.towerOnMe = tower.targetId === self;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.kind !== Kind.Minion || e.hp <= 0) continue;
    const f = forward(e.x, e.y);
    const near = Math.abs(f - clash) <= b.lane.clashWindow;
    if (e.team === team) {
      if (near) r.ownNear++;
      if (tower && len(e.x - tower.x, e.y - tower.y) - e.radius <= r.enemyTowerRange + 1) r.ownAtTower++;
      if (tower && tower.targetId === e.id) r.towerBusy = true;
    } else {
      if (near) r.enemyNear++;
      if (len(e.x - me.x, e.y - me.y) <= b.lane.callForHelpRadius) r.enemyMinionsNearMe++;
      if (r.ownTower && len(e.x - r.ownTower.x, e.y - r.ownTower.y) - e.radius <= r.ownTowerRange) r.ownTowerThreatened = true;
    }
  }
  r.waveAdvantage = r.ownNear - r.enemyNear;

  r.enemyUnderTower = false;
  r.ttkUs = r.ttkThem = Infinity;
  if (enemy && enemy.hp > 0) {
    if (tower) r.enemyUnderTower = len(enemy.x - tower.x, enemy.y - tower.y) - enemy.radius <= r.enemyTowerRange + b.towerMargin;
    if (r.ownTower && len(enemy.x - r.ownTower.x, enemy.y - r.ownTower.y) - enemy.radius <= r.ownTowerRange) {
      r.ownTowerThreatened = true;
      r.enemyAtOwnTower = true;
    }
    const usDps = championDps(cfg, me);
    const themDps = championDps(cfg, enemy);
    r.ttkUs = usDps > 0 ? enemy.hp / usDps : Infinity;
    r.ttkThem = themDps > 0 ? me.hp / themDps : Infinity;
  }
}
