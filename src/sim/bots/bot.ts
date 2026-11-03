import type { Config } from '../../data/schema';
import type { LanePath } from '../../data/map-geometry';
import type { Entity } from '../ecs';
import { len, sin } from '../math';
import type { Rng } from '../rng';
import { Kind, Team, type Command, type EntitySnapshot, type PlayerId, type Snapshot } from '../sim';
import { steerAround } from '../systems/minions';
import { LaneTrack } from './lane';
import { emptyRead, readLane, type LaneRead } from './lane-read';
import { rollPersonality, type Personality } from './personality';

/**
 * Bot modes (D-043), after Dota 2's desire-scored bot modes and MOBA wave play:
 * - `retreat`: walk home to heal; `backoff`: drop behind its wave or tower and reassess;
 * - `defend`: fight under its own tower; `freeze`: hold near it when behind;
 * - `contest`: clear the enemy wave; `push`: advance with a winning wave;
 * - `siege`: hit the enemy tower while it shoots our minions;
 * - `trade`: harass the enemy champion; `allin`: chase it down for the kill.
 */
export type BotMode = 'retreat' | 'backoff' | 'defend' | 'freeze' | 'contest' | 'push' | 'siege' | 'trade' | 'allin' | 'dead';
const MODES: readonly Exclude<BotMode, 'dead'>[] = ['retreat', 'backoff', 'defend', 'freeze', 'contest', 'push', 'siege', 'trade', 'allin'];
const FIGHTING = new Set<BotMode>(['trade', 'allin', 'defend', 'siege']);

/** How far ahead along the lane it aims while travelling (m; beyond a Sub-base the lane runs through), and when it has arrived. */
const LOOKAHEAD = 6;
const ARRIVED = 0.4;
/** Clearance kept from structure footprints while steering (m). */
const AVOID_MARGIN = 0.25;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const quantise = (v: number) => Math.sign(v) * Math.min(127, Math.round(Math.abs(v) * 127)) || 0;

/**
 * The lane bot, v2 (TDD §7, D-043). It reads only the previous snapshot and returns the same
 * `Command` a human sends; its randomness comes from the seeded `ai` stream it is given.
 *
 * Every `decisionSeconds` it scores each mode's desire (0–1) from a lane read, adds a
 * commitment bonus to the current mode while its patience lasts, and takes the highest.
 * A personality rolled per match and a confidence that rises with kills and falls with
 * deaths shape every desire, so no two matches play the same.
 */
export function createBot(
  player: PlayerId,
  team: Team,
  getConfig: () => Config,
  getLanes: () => readonly LanePath[],
  rng: Rng,
  /** The lane it plays (`map.lanes` id); falls back to the first lane if the map has none by that id. */
  laneId = 'centre',
) {
  const personality: Personality = rollPersonality(getConfig().bots.personality, rng);
  const desires: Record<Exclude<BotMode, 'dead'>, number> = {
    retreat: 0, backoff: 0, defend: 0, freeze: 0, contest: 0, push: 0, siege: 0, trade: 0, allin: 0,
  };
  const state = {
    mode: 'contest' as BotMode,
    committedUntil: 0,
    nextDecision: 0,
    pauseUntil: 0,
    confidence: 0,
    lastKills: 0,
    lastDeaths: 0,
    lastTowerHp: -1,
    lastTower: 0 as Entity,
    lastTick: 0,
  };
  let track: LaneTrack | undefined;
  let trackFrom: Float64Array | undefined;
  const read: LaneRead = emptyRead();
  const p = { x: 0, y: 0 };
  const steer = { x: 0, y: 0 };
  const cmd: Command = { tick: 0, player, moveX: 0, moveY: 0, ult: false, draftPick: -1, reroll: false };

  const fromForward = (f: number) => (team === Team.Blue ? f : track!.length - f);

  function laneTrack(): LaneTrack | undefined {
    const lanes = getLanes();
    let lane = lanes[0];
    for (let i = 0; i < lanes.length; i++) if (lanes[i]!.id === laneId) lane = lanes[i];
    const pts = lane?.branches[0];
    if (!pts) return undefined;
    if (pts !== trackFrom) {
      track = new LaneTrack(pts);
      trackFrom = pts;
    }
    return track;
  }

  /** Mood (D-043): + for takedowns and tower damage, − for deaths, decaying to 0. */
  function updateConfidence(cfg: Config, me: EntitySnapshot, tick: number) {
    const c = cfg.bots.confidence;
    const dt = Math.max(0, tick - state.lastTick) / 30;
    state.lastTick = tick;
    state.confidence *= Math.pow(0.5, dt / c.halfLifeSeconds);
    if (me.kills > state.lastKills) state.confidence += c.kill * (me.kills - state.lastKills);
    if (me.deaths > state.lastDeaths) state.confidence += c.death * (me.deaths - state.lastDeaths);
    state.lastKills = me.kills;
    state.lastDeaths = me.deaths;
    const tower = read.enemyTower;
    if (tower && tower.id === state.lastTower && state.lastTowerHp > tower.hp && len(tower.x - me.x, tower.y - me.y) < 12) {
      state.confidence += (c.towerDamagePer1000 * (state.lastTowerHp - tower.hp)) / 1000;
    }
    state.lastTower = tower?.id ?? 0;
    state.lastTowerHp = tower?.hp ?? -1;
    state.confidence = Math.min(c.max, Math.max(c.min, state.confidence));
  }

  /** Scores every mode from the lane read (0–1; higher wins). */
  function score(cfg: Config, hpMe: number) {
    const r = read;
    const pers = personality;
    const aggr = clamp01(pers.aggression + state.confidence);
    const enemy = r.enemy;
    const enemyAlive = !!enemy && enemy.hp > 0 && !enemy.invulnerable;
    const hpEnemy = enemyAlive ? enemy.hp / enemy.maxHp : 0;
    const dist = enemyAlive ? len(enemy.x - r.me!.x, enemy.y - r.me!.y) : Infinity;
    const levelGap = enemy ? (r.me!.level - enemy.level) : 0;
    const inReach = enemyAlive && dist <= cfg.bots.tradeRange;
    const outTtk = r.ttkThem / Math.max(0.1, r.ttkUs); // > 1: we win the race

    // Retreat: below its personal threshold (or still healing up); back off from a losing fight.
    desires.retreat = hpMe < pers.retreatHp || (state.mode === 'retreat' && hpMe < pers.returnHp) ? 1 : 0;
    desires.backoff = inReach && hpMe < 0.5 && outTtk < 0.67 ? 0.9 : r.towerOnMe && !r.towerBusy ? 0.95 : 0;

    // Defend its tower; punish an enemy champion standing under it.
    desires.defend = r.enemyAtOwnTower ? 0.7 + 0.2 * aggr : r.ownTowerThreatened ? 0.55 : 0;

    // Behind: freeze near its own tower (MOBA "behind → freeze, farm safe").
    // Only an enemy close enough to contest the lane makes it play safe.
    const behind = -levelGap >= 2 || hpMe < hpEnemy - 0.3;
    desires.freeze = behind && enemyAlive && dist < cfg.bots.lane.threatRadius ? 0.5 + 0.2 * (1 - aggr) : 0;

    // Contest the wave: the steady default.
    desires.contest = 0.4;

    // Push with a winning wave, or while the enemy is down or weak.
    const pushReason = Math.max(0, r.waveAdvantage) * 0.08 + (r.enemyRespawn > 0 ? 0.3 : 0) + (enemyAlive && hpEnemy < 0.4 ? 0.15 : 0);
    desires.push = r.ownFront > -Infinity || r.enemyRespawn > 0 ? clamp01(0.3 + 0.3 * aggr + pushReason + state.confidence * 0.3) : 0;

    // Siege while the tower is busy with our minions; never while it is shooting us.
    desires.siege = r.enemyTower && r.towerBusy && r.ownAtTower >= 1 && !r.towerOnMe ? clamp01(0.5 + 0.3 * aggr + (r.enemyRespawn > 0 ? 0.25 : 0) + (1 - r.enemyTower.hp / r.enemyTower.maxHp) * 0.2) : 0;

    // Trade: in reach, not under its tower, not in the middle of the enemy wave.
    desires.trade =
      inReach && !r.enemyUnderTower && r.enemyMinionsNearMe < 2
        ? clamp01(0.25 + 0.55 * aggr + (hpMe - hpEnemy) * 0.8 + levelGap * 0.08 + (outTtk - 1) * 0.15)
        : 0;

    // All in: a kill it can win quickly, or a weak enemy; dive a tower only for a near-certain kill.
    const quickKill = r.ttkUs <= cfg.bots.lane.allInSeconds && outTtk > 1.4;
    const weak = hpEnemy < 0.35 && hpMe > hpEnemy + 0.1;
    const twoShots = enemyAlive && enemy.hp <= 2 * 95 * (1 + 0.04 * Math.max(0, r.me!.level - 1));
    const diveOk = !r.enemyUnderTower || (pers.riskTolerance >= 0.6 && hpMe >= 0.6 && twoShots);
    desires.allin = enemyAlive && dist <= cfg.bots.tradeRange + 3 && (quickKill || weak) && diveOk ? clamp01(0.7 + 0.3 * aggr) : 0;
  }

  /** Lane progress it should stand at for the lane modes. */
  function laneTarget(cfg: Config, mode: BotMode): number {
    const r = read;
    const b = cfg.bots.lane;
    const fight = r.range * personality.spacing;
    const hold = r.fOwnTower + b.holdAhead;
    const enemyEdge = Math.min(r.enemyFront, r.fEnemyTower);
    // Outside the enemy tower unless it is busy with our minions.
    const towerLimit = r.enemyTower && !r.towerBusy ? r.fEnemyTower - (r.enemyTowerRange + cfg.bots.towerMargin + 0.5 + r.enemyTower.radius) : Infinity;
    let f: number;
    switch (mode) {
      case 'backoff':
        f = r.ownFront > -Infinity ? Math.max(hold - 2, r.ownFront - 4) : r.fOwnTower - 2;
        return Math.min(f, r.fMe);
      case 'freeze':
        return Math.min(r.fOwnTower + 3, enemyEdge - fight);
      case 'defend':
        return Math.min(r.fOwnTower + r.ownTowerRange - 1, enemyEdge - fight);
      case 'siege':
        return r.fEnemyTower - (r.range * 0.9 + (r.enemyTower?.radius ?? 0));
      case 'push': {
        // Ahead of its own wave if it has one; as far as is safe if the enemy is down.
        // Never back past its hold point to fetch a fresh wave: the wave walks up to it.
        const lead = r.ownFront > -Infinity ? Math.max(r.ownFront + b.aheadOfWave, hold) : r.enemyRespawn > 0 ? towerLimit : hold;
        f = Math.min(lead, enemyEdge - fight);
        return Math.min(f, towerLimit);
      }
      default: {
        // contest: clear the enemy wave, a little ahead of its own when the enemy isn't a threat.
        const ahead = r.enemy && r.enemy.hp > 0 && len(r.enemy.x - r.me!.x, r.enemy.y - r.me!.y) < 12 ? 1 : b.aheadOfWave;
        const front = r.ownFront > -Infinity ? Math.max(r.ownFront + ahead, hold) : hold;
        f = Math.min(front, enemyEdge - fight);
        return Math.min(f, towerLimit);
      }
    }
  }

  return {
    personality,
    desires: desires as Readonly<typeof desires>,
    get mode(): BotMode {
      return state.mode;
    },
    /** Same as `mode` (the debug panel reads `goal`). */
    get goal(): string {
      return state.mode;
    },
    get confidence() {
      return state.confidence;
    },

    command(snap: Snapshot, tick: number, self: Entity): Command {
      const cfg = getConfig();
      const b = cfg.bots;
      cmd.tick = tick;
      cmd.moveX = cmd.moveY = 0;
      cmd.ult = false;
      if (snap.match.phase !== 'live' || !laneTrack()) return cmd;
      readLane(read, snap, self, team, track!, cfg, laneId);
      const me = read.me;
      if (!me) return cmd;
      updateConfidence(cfg, me, tick);
      if (me.hp <= 0) {
        state.mode = 'dead';
        return cmd;
      }
      const hpMe = me.hp / me.maxHp;

      // Decide: on the beat, or at once when retreat fires.
      score(cfg, hpMe);
      const urgent = desires.retreat >= 1 && state.mode !== 'retreat';
      if (tick >= state.nextDecision || urgent || state.mode === 'dead') {
        state.nextDecision = tick + b.decisionSeconds;
        let best: Exclude<BotMode, 'dead'> = 'contest';
        let bestScore = -1;
        for (let mi = 0; mi < MODES.length; mi++) {
          const m = MODES[mi]!;
          const s = desires[m] + (m === state.mode && tick < state.committedUntil ? b.commitBonus : 0);
          if (s > bestScore) {
            best = m;
            bestScore = s;
          }
        }
        if (best !== state.mode) {
          state.mode = best;
          state.committedUntil = tick + personality.patience;
        }
        // Now and then it hesitates, like a human (never while retreating).
        if (best !== 'retreat' && rng() < b.hesitation.chance) {
          state.pauseUntil = tick + Math.round((b.hesitation.minSeconds + (b.hesitation.maxSeconds - b.hesitation.minSeconds) * rng()) * 30);
        }
      }
      if (tick < state.pauseUntil && state.mode !== 'retreat') return cmd;

      // Where to go.
      const mode = state.mode;
      const enemy = read.enemy;
      let aim: { x: number; y: number } | undefined;
      if (mode === 'retreat') {
        const pad = team === Team.Blue ? cfg.map.spawn.blue : cfg.map.spawn.red;
        // Follow the lane home until level with the pad, then walk onto it. The track starts at
        // the cave behind the HQ (D-051), so following it to its start would end behind the bunker.
        const along = track!.project(pad.x, pad.y);
        const fPad = team === Team.Blue ? along : track!.length - along;
        aim = read.fMe > fPad + LOOKAHEAD ? track!.pointAt(fromForward(read.fMe - LOOKAHEAD), p) : pad;
        if (len(pad.x - me.x, pad.y - me.y) < 0.6) aim = undefined; // on the pad: heal
      } else if ((mode === 'trade' || mode === 'allin') && enemy && enemy.hp > 0) {
        const dx = me.x - enemy.x;
        const dy = me.y - enemy.y;
        const d = len(dx, dy) || 1;
        const want = read.range * personality.spacing * (mode === 'allin' ? 0.85 : 1) + enemy.radius;
        p.x = enemy.x + (dx / d) * want;
        p.y = enemy.y + (dy / d) * want;
        aim = p;
      } else {
        const target = laneTarget(cfg, mode);
        const delta = target - read.fMe;
        if (Math.abs(delta) > ARRIVED) aim = track!.pointAt(fromForward(read.fMe + Math.sign(delta) * Math.min(Math.abs(delta), LOOKAHEAD)), p);
      }

      // Weave sideways while fighting (dodges lead-aimed bullets).
      let dx = 0;
      let dy = 0;
      if (aim) {
        dx = aim.x - me.x;
        dy = aim.y - me.y;
      }
      if (FIGHTING.has(mode) && personality.weaveAmplitude > 0) {
        const ref = enemy && enemy.hp > 0 ? enemy : read.enemyTower;
        if (ref) {
          const ux = ref.x - me.x;
          const uy = ref.y - me.y;
          const ul = len(ux, uy) || 1;
          const w = personality.weaveAmplitude * sin((2 * Math.PI * tick) / personality.weavePeriod);
          dx += (-uy / ul) * w;
          dy += (ux / ul) * w;
        }
      }
      const d = len(dx, dy);
      if (d > 0.08) {
        dx /= d;
        dy /= d;
        // Round structures, not through them (shared with minions).
        for (let i = 0; i < snap.entities.length; i++) {
          const e = snap.entities[i]!;
          if (e.kind !== Kind.SubBase && e.kind !== Kind.HQ) continue;
          const fp = cfg.structures[e.kind === Kind.HQ ? 'hq' : 'subBase'].footprint;
          const rad = fp.shape === 'circle' ? fp.r : Math.max(fp.w, fp.h) / 2;
          if (steerAround(me.x, me.y, dx, dy, d, e.x, e.y, rad + me.radius + AVOID_MARGIN, steer)) {
            dx = steer.x;
            dy = steer.y;
            break;
          }
        }
        cmd.moveX = quantise(dx);
        cmd.moveY = quantise(dy);
      }

      // Ultimate (TDD §7): Heat Wave with 2+ allies and an enemy champion inside it, or when low
      // in a fight (retreating included: it heals him); the others on a champion when fighting or
      // it is weak, or on bunched minions when pushing.
      const ult = cfg.champions.find((c) => c.id === me.modelId)?.ultimate;
      if (ult?.id === 'heatWave') {
        if (me.ultCharge >= 100 && me.aura === 0) {
          let allies = 0;
          let enemies = 0;
          for (let i = 0; i < snap.entities.length; i++) {
            const e = snap.entities[i]!;
            if (e.id === me.id || e.hp <= 0 || (e.kind !== Kind.Champion && e.kind !== Kind.Minion) || (e.visibleMask & (1 << team)) === 0) continue;
            if (len(e.x - me.x, e.y - me.y) > ult.radius) continue;
            if (e.team === team) allies++;
            else if (e.kind === Kind.Champion) enemies++;
          }
          cmd.ult = enemies >= 1 && (allies >= 2 || me.hp / me.maxHp < 0.4);
        }
      } else if (me.ultCharge >= 100 && me.ultTargetable && me.ultTargetId !== 0 && mode !== 'retreat') {
        const target = byId(snap, me.ultTargetId);
        if (target?.kind === Kind.Champion) cmd.ult = FIGHTING.has(mode) || target.hp / target.maxHp < 0.6 || state.confidence > 0.2;
        else if (target?.kind === Kind.Minion && (mode === 'push' || mode === 'siege' || mode === 'contest' || mode === 'defend')) {
          let near = 0;
          for (let i = 0; i < snap.entities.length; i++) {
            const e = snap.entities[i]!;
            if (e.kind === Kind.Minion && e.team !== team && e.hp > 0 && (e.visibleMask & (1 << team)) !== 0 && len(e.x - target.x, e.y - target.y) <= b.ult.clusterRadius) near++;
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
