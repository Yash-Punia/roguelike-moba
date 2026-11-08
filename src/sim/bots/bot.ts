import type { Config, Difficulty } from '../../data/schema';
import type { LanePath } from '../../data/map-geometry';
import type { Entity } from '../ecs';
import { rayBlocked, type ObstacleGrid } from '../grid';
import { len, sin } from '../math';
import type { Rng } from '../rng';
import { Kind, Team, type Command, type EntitySnapshot, type PlayerId, type Snapshot, type TelegraphSnapshot } from '../sim';
import { rankCards } from '../systems/draft';
import { steerAround } from '../systems/minions';
import { inTelegraph } from '../telegraph-shape';
import { exits } from './dodge';
import { LaneTrack } from './lane';
import { emptyRead, readLane, type LaneRead } from './lane-read';
import { FAR, navFor, type Nav } from './nav';
import { rollPersonality, type Personality } from './personality';
import type { Defence, FarmPlan, Squad } from './squad';

/**
 * Bot modes (D-043), after Dota 2's desire-scored bot modes and MOBA wave play:
 * - `retreat`: walk home to heal; `backoff`: drop behind its wave or tower and reassess;
 * - `defend`: fight under its own tower; `freeze`: hold near it when behind;
 * - `contest`: clear the enemy wave; `push`: advance with a winning wave;
 * - `siege`: hit the enemy tower while it shoots our minions;
 * - `trade`: harass the enemy champion; `allin`: chase it down for the kill;
 * - `farm`: take a neutral camp for its XP with an allied bot (D-075).
 */
export type BotMode = 'retreat' | 'backoff' | 'defend' | 'freeze' | 'contest' | 'push' | 'siege' | 'trade' | 'allin' | 'farm' | 'dead';
const MODES: readonly Exclude<BotMode, 'dead'>[] = ['retreat', 'backoff', 'defend', 'freeze', 'contest', 'push', 'siege', 'trade', 'allin', 'farm'];
/** Lane modes in which a bot may leave its lane to farm. */
const CALM = new Set<BotMode>(['contest', 'push', 'freeze', 'backoff', 'siege']);
/** Camp units this far from their camp's centre count as that camp's (m; the leash is 10). */
const CAMP_REACH = 12;
/** Cells ahead it aims along a flow field. */
const NAV_LOOK = 6;
const FIGHTING = new Set<BotMode>(['trade', 'allin', 'defend', 'siege']);

/** How far ahead along the lane it aims while travelling (m; beyond a Sub-base the lane runs through), and when it has arrived. */
const LOOKAHEAD = 6;
const ARRIVED = 0.4;
/** Clearance kept from structure footprints while steering (m). */
const AVOID_MARGIN = 0.25;

/** Scratch for `countChampions` and `assess`. */
const near = { own: 0, enemy: 0 };
const threat = { on: false, need: 0 };

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
  homeLane = 'centre',
  /** Its team's farming board and the sim's obstacle grid: without them it never farms camps (D-075). */
  squad?: Squad,
  getGrid?: () => ObstacleGrid,
  /** How well it plays (TDD §7, D-086). */
  difficulty: Difficulty = 'normal',
) {
  const personality: Personality = rollPersonality(getConfig().bots.personality, getConfig().bots.difficulty[difficulty].retreatHpPct, rng);
  const desires: Record<Exclude<BotMode, 'dead'>, number> = {
    retreat: 0, backoff: 0, defend: 0, freeze: 0, contest: 0, push: 0, siege: 0, trade: 0, allin: 0, farm: 0,
  };
  const side = team === Team.Blue ? 1 : -1;
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
    retreatSince: -1,
  };
  /** The lane it plays now: its own, or one it was sent to defend (D-083). */
  let laneId = homeLane;
  let track: LaneTrack | undefined;
  let trackFrom: Float64Array | undefined;
  const read: LaneRead = emptyRead();
  const dodge = { danger: false, will: false, since: 0, active: false };
  const exitNear = { x: 0, y: 0 };
  const exitFar = { x: 0, y: 0 };
  const draft = { cards: undefined as readonly string[] | undefined, pickAt: -1 };
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
  function score(cfg: Config, snap: Snapshot, hpMe: number) {
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

    // Outnumbered (D-083): no trades, drop back behind its wave or tower. Not while an enemy
    // champion is under its own tower: the tower is on its side there.
    const o = cfg.bots.outnumbered;
    countChampions(snap, r.me!.x, r.me!.y, o.radius);
    if (!r.enemyAtOwnTower && near.enemy >= near.own + o.margin) {
      desires.trade = desires.allin = 0;
      desires.backoff = Math.max(desires.backoff, o.desire);
    }
  }

  /** Own and visible enemy champions alive within `r` of (x, y), into `near`; `skip` (a defence's bots) isn't counted as own. */
  function countChampions(snap: Snapshot, x: number, y: number, r: number, skip?: readonly Entity[], minusRadius = false) {
    near.own = near.enemy = 0;
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind !== Kind.Champion || e.hp <= 0 || len(e.x - x, e.y - y) - (minusRadius ? e.radius : 0) > r) continue;
      if (e.team === team) {
        if (!skip || !skip.includes(e.id)) near.own++;
      } else if ((e.visibleMask & (1 << team)) !== 0) near.enemy++;
    }
  }

  /**
   * An own structure under attack (D-083): a visible enemy champion at it, or it is shooting
   * something. Sets `threat.on`, and `threat.need`: the defenders it still wants, one per enemy
   * champion there (one for minions alone, up to `maxDefenders`), less the own champions at it
   * and the bots already sent.
   */
  function assess(cfg: Config, snap: Snapshot, s: EntitySnapshot, d: Defence | undefined) {
    threat.on = false;
    threat.need = 0;
    if (s.destroyed || s.hp <= 0 || s.invulnerable) return;
    const def = cfg.bots.defend;
    const reach = cfg.structures[s.kind === Kind.HQ ? 'hq' : 'subBase'].weapon.range + def.margin;
    countChampions(snap, s.x, s.y, reach, d?.bots, true);
    threat.on = near.enemy > 0 || s.targetId !== 0;
    if (threat.on) threat.need = Math.min(def.maxDefenders, Math.max(1, near.enemy)) - near.own - (d ? d.bots.length : 0);
  }

  /**
   * Regrouping (TDD §7, D-094): once any Sub-base has fallen, the team's bots play the lane with
   * the most living allied champions, humans counted. Ties keep the current lane, then map order.
   */
  function updateRegroup(cfg: Config, snap: Snapshot, nav: Nav, tick: number) {
    if (tick < squad!.regroupNext) return;
    let fallen = false;
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind === Kind.SubBase && e.destroyed) fallen = true;
    }
    if (!fallen) return;
    squad!.regroupNext = tick + cfg.bots.regroup.recheckSeconds;
    const lanes = getLanes();
    const counts = lanes.map(() => 0);
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind !== Kind.Champion || e.team !== team || e.hp <= 0) continue;
      let nearest = 0;
      let cost = Infinity;
      for (let k = 0; k < lanes.length; k++) {
        const c = metres(nav, laneField(nav, lanes[k]!.id), e.x, e.y);
        if (c < cost) {
          cost = c;
          nearest = k;
        }
      }
      counts[nearest]!++;
    }
    let best = lanes.findIndex((l) => l.id === squad!.regroupLane);
    for (let k = 0; k < lanes.length; k++) if (best < 0 || counts[k]! > counts[best]!) best = k;
    squad!.regroupLane = lanes[best]?.id;
  }

  /** The lane to defend a structure from: a Sub-base's own; for the HQ, the lane its nearest attacking minion came down, else one whose own Sub-base is down. */
  function defenceLane(snap: Snapshot, s: EntitySnapshot, reach: number): string {
    if (s.kind === Kind.SubBase) return s.lane;
    let lane = '';
    let best = Infinity;
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind !== Kind.Minion || e.team === team || e.hp <= 0 || (e.visibleMask & (1 << team)) === 0) continue;
      const d = len(e.x - s.x, e.y - s.y);
      if (d < best) {
        best = d;
        lane = e.lane;
      }
    }
    if (best <= reach) return lane;
    // ponytail: the first fallen Sub-base's lane in id order, not the one nearest the attacker; fine with 2–3 lanes.
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind === Kind.SubBase && e.team === team && e.destroyed) return e.lane;
    }
    return homeLane;
  }

  /**
   * Sends the nearest available bots of its squad (by walk) to every own structure that wants
   * defenders (D-083). Any bot runs it on its beat; the board makes the result the same whoever does.
   */
  function callDefenders(cfg: Config, snap: Snapshot, nav: Nav, tick: number) {
    const def = cfg.bots.defend;
    for (let i = 0; i < snap.entities.length; i++) {
      const s = snap.entities[i]!;
      if ((s.kind !== Kind.SubBase && s.kind !== Kind.HQ) || s.team !== team) continue;
      const d = squad!.defenceAt(s.id);
      assess(cfg, snap, s, d);
      if (!threat.on) continue;
      if (d) d.lastThreat = tick;
      let need = threat.need;
      if (need <= 0) continue;
      const field = nav.field(`struct:${s.id}`, () => nav.disc(s.x, s.y, s.radius + 2));
      const lane = defenceLane(snap, s, cfg.structures.hq.weapon.range + def.margin);
      while (need > 0) {
        let pick: Entity = 0;
        let pd = Infinity;
        for (let k = 0; k < squad!.ids.length; k++) {
          const o = squad!.ids[k]!;
          if (!squad!.isAvailable(o, tick)) continue;
          const m = metres(nav, field, squad!.xs[k]!, squad!.ys[k]!);
          if (m <= def.maxTravel && m < pd) {
            pd = m;
            pick = o;
          }
        }
        if (pick === 0) break;
        squad!.defend(s.id, lane, pick, tick);
        need--;
      }
    }
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

  /**
   * Dodging (TDD §7, D-085): the soonest enemy or boss marker it stands in (live areas last).
   * On stepping into danger it rolls its tier's `dodgeChancePct` once, and keeps that result until it is
   * out. On a yes it waits `reactionSeconds`, then heads for the near way out, or the far one if
   * a wall is in the way; only if it can get there before impact (a live area: always).
   */
  function dodgeExit(cfg: Config, snap: Snapshot, me: EntitySnapshot, tick: number): { x: number; y: number } | undefined {
    const dc = cfg.bots.dodge;
    const clear = me.radius + dc.margin;
    let threat: TelegraphSnapshot | undefined;
    let left = Infinity;
    for (let i = 0; i < snap.telegraphs.length; i++) {
      const t = snap.telegraphs[i]!;
      if (t.team === team || !inTelegraph(t, me.x, me.y, clear)) continue;
      const l = t.elapsed >= t.total ? Infinity : t.total - t.elapsed;
      if (!threat || l < left) {
        threat = t;
        left = l;
      }
    }
    dodge.active = false;
    if (!threat) {
      dodge.danger = false;
      return undefined;
    }
    if (!dodge.danger) {
      dodge.danger = true;
      dodge.since = tick;
      dodge.will = rng() < cfg.bots.difficulty[difficulty].dodgeChancePct;
    }
    if (!dodge.will || tick - dodge.since < cfg.bots.difficulty[difficulty].reactionSeconds) return undefined;
    exits(threat, me.x, me.y, clear, exitNear, exitFar);
    const speed = (cfg.champions.find((c) => c.id === me.modelId)?.moveSpeed ?? 5) / 30;
    const grid = getGrid?.();
    const ok = (e: { x: number; y: number }) => len(e.x - me.x, e.y - me.y) / speed <= left && (!grid || rayBlocked(grid, me.x, me.y, e.x, e.y, grid.blocked) < 0);
    const exit = ok(exitNear) ? exitNear : ok(exitFar) ? exitFar : undefined;
    dodge.active = !!exit;
    return exit;
  }

  /**
   * Drafting (TDD §7, D-085): a new offer is answered after a random 1–3 s, with the card its
   * champion's tag weights and owned powers score highest.
   */
  function pickCard(cfg: Config, me: EntitySnapshot, tick: number) {
    const cards = me.draftCards;
    if (cards.length === 0) {
      draft.cards = undefined;
      return;
    }
    const d = cfg.bots.draft;
    if (cards !== draft.cards) {
      draft.cards = cards;
      draft.pickAt = tick + Math.round(d.minDelaySeconds + (d.maxDelaySeconds - d.minDelaySeconds) * rng());
      return;
    }
    if (draft.pickAt < 0 || tick < draft.pickAt) return;
    draft.pickAt = -1;
    const ranked = rankCards(cfg.powers, me.powers, cards, d.tagWeights[me.modelId], d.synergy);
    const top = Math.min(cfg.bots.difficulty[difficulty].draftTop, ranked.length);
    // ponytail: Hard drafts like Normal; TDD's "plans for Epic levels" isn't built, add it if Hard feels soft.
    cmd.draftPick = (top > 1 ? ranked[Math.floor(rng() * top)]! : (ranked[0] ?? 0)) as Command['draftPick'];
  }

  /** Flow fields: to camp i, to its own lane, to its spawn pad. */
  const campField = (nav: Nav, cfg: Config, i: number) => nav.field(`camp:${i}`, () => nav.disc(cfg.map.camps[i]!.x, cfg.map.camps[i]!.y, 1.5));
  /** The way to a plan's camp. A boss's own arena has no avoid cost (D-095). */
  const planField = (nav: Nav, cfg: Config, i: number) => {
    const c = cfg.map.camps[i]!;
    if (!cfg.neutrals.camps[c.kind].boss) return campField(nav, cfg, i);
    return nav.field(`boss:${i}`, () => nav.disc(c.x, c.y, 1.5), { x: c.x, y: c.y, r: cfg.bots.farm.bossAvoidRadius });
  };
  const laneField = (nav: Nav, id = laneId) =>
    nav.field(`lane:${id}`, () => {
      const cells: number[] = [];
      for (const l of getLanes()) if (l.id === id) for (const pts of l.branches) cells.push(...nav.polyline(pts));
      return cells.length ? cells : nav.polyline(trackFrom!);
    });
  const padField = (nav: Nav, cfg: Config) => {
    const pad = team === Team.Blue ? cfg.map.spawn.blue : cfg.map.spawn.red;
    return nav.field(`pad:${team}`, () => nav.disc(pad.x, pad.y, 1));
  };
  /** Walking cost along a field in metres (Infinity: can't get there). */
  const metres = (nav: Nav, f: Uint16Array, x: number, y: number) => {
    const c = nav.cost(f, x, y);
    return c === FAR ? Infinity : (c / 2) * nav.grid.cell;
  };

  /** A visible enemy champion within `r` of (x, y)? */
  function enemyNear(snap: Snapshot, x: number, y: number, r: number): boolean {
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind === Kind.Champion && e.team !== team && e.hp > 0 && (e.visibleMask & (1 << team)) !== 0 && len(e.x - x, e.y - y) <= r) return true;
    }
    return false;
  }

  /** A camp's living HP as a share of the full camp. */
  function campShare(cfg: Config, snap: Snapshot, i: number): number {
    const c = snap.camps[i]!;
    return c.hp / (cfg.map.camps[i]!.count * cfg.neutrals.camps[c.kind].unit.maxHp);
  }

  /** Is this pair's job done (cleared, failed, out of time, or its partner gone)? */
  function planOver(cfg: Config, snap: Snapshot, plan: FarmPlan, self: Entity, tick: number): boolean {
    const f = cfg.bots.farm;
    const camp = snap.camps[plan.camp];
    const limit = camp && cfg.neutrals.camps[camp.kind].boss ? cfg.bots.boss.maxSeconds : f.maxSeconds;
    if (!camp || camp.members === 0 || camp.leashing || tick - plan.started > limit) return true;
    let others = 0;
    for (let k = 0; k < plan.members.length; k++) {
      const m = plan.members[k]!;
      if (m === self) continue;
      const mate = byId(snap, m);
      if (mate && mate.hp > 0 && tick - plan.seen[k]! <= f.staleSeconds) others++;
    }
    // Alone, it finishes only a camp that is nearly down.
    return others === 0 && !(camp.engaged && campShare(cfg, snap, plan.camp) < f.finishHpPct);
  }

  /**
   * A free bot with no plan looks for another free bot of its squad and a camp for both
   * (D-075): up, not fought over, no enemy champion at it, within `maxTravel` for each, and
   * the shortest walk for the two of them (camps in the enemy half count further away).
   */
  function tryForm(cfg: Config, snap: Snapshot, nav: Nav, me: EntitySnapshot, tick: number): FarmPlan | undefined {
    const f = cfg.bots.farm;
    let best = Infinity;
    let bestCamp = -1;
    let bestPartner: Entity = 0;
    for (let k = 0; k < squad!.ids.length; k++) {
      const o = squad!.ids[k]!;
      if (o === me.id || !squad!.isFree(o, tick)) continue;
      const partner = byId(snap, o);
      if (!partner || partner.hp <= 0) continue;
      for (let i = 0; i < snap.camps.length; i++) {
        const camp = snap.camps[i]!;
        // Mini-bosses are left alone until bots can dodge their telegraphs (D-079).
        if (camp.members === 0 || camp.engaged || camp.leashing || cfg.neutrals.camps[camp.kind].boss || squad!.campTaken(i) || enemyNear(snap, camp.x, camp.y, f.contestRadius)) continue;
        const field = campField(nav, cfg, i);
        const dMe = metres(nav, field, me.x, me.y);
        const dPartner = metres(nav, field, partner.x, partner.y);
        if (dMe > f.maxTravel || dPartner > f.maxTravel) continue;
        const cost = dMe + dPartner + (camp.y * side > 0 ? f.enemyHalfPenalty : 0);
        if (cost < best) {
          best = cost;
          bestCamp = i;
          bestPartner = o;
        }
      }
    }
    if (bestCamp < 0) return undefined;
    squad!.form(bestCamp, [me.id, bestPartner], tick);
    return squad!.planOf(me.id);
  }

  /**
   * Contesting a boss (TDD §7, D-095): one that is up and unclaimed, idle with no enemy champion
   * at it or being fought and below `stealHpPct`, for the nearest free bots of the level it asks
   * for, if enough are within `maxTravel`. Any free bot may start it for the squad.
   */
  function tryBoss(cfg: Config, snap: Snapshot, nav: Nav, me: EntitySnapshot, tick: number): FarmPlan | undefined {
    const c = cfg.bots.boss;
    let best = Infinity;
    let bestCamp = -1;
    let bestMembers: Entity[] = [];
    for (let i = 0; i < snap.camps.length; i++) {
      const camp = snap.camps[i]!;
      const need = c.squad[camp.kind];
      const level = c.minLevel[camp.kind];
      if (!cfg.neutrals.camps[camp.kind].boss || need === undefined || level === undefined || camp.members === 0 || camp.leashing || squad!.campTaken(i)) continue;
      if (camp.engaged ? campShare(cfg, snap, i) >= c.stealHpPct : enemyNear(snap, camp.x, camp.y, cfg.bots.farm.contestRadius)) continue;
      const field = planField(nav, cfg, i);
      const ready: { id: Entity; d: number }[] = [];
      for (let k = 0; k < squad!.ids.length; k++) {
        const o = squad!.ids[k]!;
        if (!squad!.isFree(o, tick)) continue;
        const bot = o === me.id ? me : byId(snap, o);
        if (!bot || bot.hp <= 0 || bot.level < level) continue;
        const d = metres(nav, field, bot.x, bot.y);
        if (d <= c.maxTravel) ready.push({ id: o, d });
      }
      if (ready.length < need) continue;
      ready.sort((a, b) => a.d - b.d || a.id - b.id);
      let total = 0;
      for (let k = 0; k < need; k++) total += ready[k]!.d;
      if (total < best) {
        best = total;
        bestCamp = i;
        bestMembers = ready.slice(0, need).map((r) => r.id);
      }
    }
    if (bestCamp < 0) return undefined;
    squad!.form(bestCamp, bestMembers, tick);
    return squad!.planOf(me.id);
  }

  /**
   * Where to stand while farming: down the camp's flow field until in its own range of the
   * nearest camp unit; until its partner has caught up (or the camp is already fighting), it
   * waits just out of range so it doesn't pull the camp alone.
   */
  function farmAim(cfg: Config, snap: Snapshot, nav: Nav, plan: FarmPlan, me: EntitySnapshot): { x: number; y: number } | undefined {
    const camp = snap.camps[plan.camp]!;
    const field = planField(nav, cfg, plan.camp);
    let near: EntitySnapshot | undefined;
    let nd = Infinity;
    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i]!;
      if (e.kind !== Kind.Neutral || e.hp <= 0 || len(e.x - camp.x, e.y - camp.y) > CAMP_REACH) continue;
      const d = len(e.x - me.x, e.y - me.y) - e.radius;
      if (d < nd) {
        nd = d;
        near = e;
      }
    }
    // They stand at the shortest of their ranges, so all draw the camp's fire.
    let together = true;
    let range = read.range;
    for (let k = 0; k < plan.members.length; k++) {
      const mate = byId(snap, plan.members[k]!);
      if (!mate || mate.id === me.id || mate.hp <= 0) continue;
      if (!camp.engaged && metres(nav, field, mate.x, mate.y) > metres(nav, field, me.x, me.y) + cfg.bots.farm.gatherSlack) together = false;
      range = Math.min(range, cfg.champions.find((c) => c.id === mate.modelId)?.weapon.range ?? read.range);
    }
    // A boss sleeps until someone stands on its floor (D-081): gather outside, then all walk on.
    if (cfg.neutrals.camps[camp.kind].boss && !camp.engaged) {
      const floor = cfg.map.walkable.find((w) => w.shape === 'circle' && len(w.x - camp.x, w.y - camp.y) < 1);
      const gather = (floor?.shape === 'circle' ? floor.r : 0) + cfg.bots.boss.gatherMargin;
      if (!together && len(me.x - camp.x, me.y - camp.y) <= gather) return undefined;
      return nav.towards(field, me.x, me.y, NAV_LOOK, p) ? p : undefined;
    }
    if (near) {
      const sight = rayBlocked(nav.grid, me.x, me.y, near.x, near.y) < 0;
      if (together && sight && nd <= range * personality.spacing * 0.9) return undefined; // in place: shoot
      if (!together && nd <= range + 1.5) {
        if (nd > range + 0.5) return undefined; // wait here, just out of range
        p.x = me.x + (me.x - near.x); // too close to wait: step back
        p.y = me.y + (me.y - near.y);
        return p;
      }
    }
    if (nav.towards(field, me.x, me.y, NAV_LOOK, p)) return p;
    if (!near) return undefined;
    p.x = near.x;
    p.y = near.y;
    return p;
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
    /** Tick its current hesitation ends (D-086). */
    get pauseUntil() {
      return state.pauseUntil;
    },
    /** Stepping out of a marker this tick (D-085). */
    get dodging() {
      return dodge.active;
    },
    /** The lane it plays now (its own, or one it defends). */
    get lane() {
      return laneId;
    },

    command(snap: Snapshot, tick: number, self: Entity): Command {
      const cfg = getConfig();
      const b = cfg.bots;
      cmd.tick = tick;
      cmd.moveX = cmd.moveY = 0;
      cmd.ult = false;
      cmd.draftPick = -1;
      const defence = squad?.defenceOf(self);
      laneId = defence?.lane ?? squad?.regroupLane ?? homeLane;
      if (snap.match.phase === 'ended' || !laneTrack()) return cmd;
      readLane(read, snap, self, team, track!, cfg, laneId);
      const me = read.me;
      if (!me) return cmd;
      updateConfidence(cfg, me, tick);
      pickCard(cfg, me, tick); // dead or alive
      // Home once the structure is safe or gone, or when it must heal (D-083).
      if (defence) {
        const s = byId(snap, defence.structure);
        if (!s || s.destroyed || me.hp <= 0 || state.mode === 'retreat' || tick - defence.lastThreat > b.defend.releaseSeconds) squad!.release(self);
      }
      if (me.hp <= 0) {
        state.mode = 'dead';
        return cmd;
      }
      const hpMe = me.hp / me.maxHp;
      const nav = squad && getGrid ? navFor(getGrid(), b.farm.clearance, () => cfg.map.camps.filter((c) => cfg.neutrals.camps[c.kind].boss), b.farm.bossAvoidRadius, b.farm.bossAvoidCost) : undefined;
      let plan = squad?.planOf(self);
      if (plan && planOver(cfg, snap, plan, self, tick)) {
        squad!.end(plan, tick, b.farm.cooldownSeconds);
        plan = undefined;
      }

      // Decide: on the beat, or at once when retreat fires.
      score(cfg, snap, hpMe);
      desires.farm = plan ? b.farm.desire : 0;
      // A new need to retreat is answered only after its reaction time (D-086).
      if (desires.retreat < 1) state.retreatSince = -1;
      else if (state.mode !== 'retreat') {
        if (state.retreatSince < 0) state.retreatSince = tick;
        if (tick - state.retreatSince < b.difficulty[difficulty].reactionSeconds) desires.retreat = 0;
      }
      const urgent = desires.retreat >= 1 && state.mode !== 'retreat';
      if (tick >= state.nextDecision || urgent || state.mode === 'dead') {
        state.nextDecision = tick + b.difficulty[difficulty].decisionSeconds;
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
        if (squad && nav) {
          callDefenders(cfg, snap, nav, tick);
          updateRegroup(cfg, snap, nav, tick);
          plan = squad.planOf(self); // a bot sent to defend stops farming
        }
        // Now and then it hesitates, like a human (never while retreating).
        if (best !== 'retreat' && rng() < (b.hesitation.chancePerSecond * b.difficulty[difficulty].decisionSeconds) / 30) {
          state.pauseUntil = tick + Math.round((b.hesitation.minSeconds + (b.hesitation.maxSeconds - b.hesitation.minSeconds) * rng()) * 30);
        }
      }
      // Farming (D-075): report whether it is free; a free bot pairs up for a camp at once.
      if (squad && nav) {
        const calm = !read.ownTowerThreatened && !enemyNear(snap, me.x, me.y, b.lane.threatRadius);
        const defending = !!squad.defenceOf(self);
        const free = !plan && !defending && hpMe >= b.farm.minHpPct && CALM.has(state.mode) && calm;
        const available = !defending && calm && hpMe >= b.defend.minHpPct && state.mode !== 'retreat';
        squad.report(self, free, me.x, me.y, tick, available);
        if (free) {
          plan = tryBoss(cfg, snap, nav, me, tick) ?? tryForm(cfg, snap, nav, me, tick);
          if (plan) {
            state.mode = 'farm';
            state.committedUntil = tick + personality.patience;
          }
        }
        if (plan && state.mode === 'farm') squad.seen(plan, self, tick);
      }
      if (state.mode === 'farm' && !plan) state.mode = 'contest';
      if (tick < state.pauseUntil && state.mode !== 'retreat') return cmd;

      // Where to go.
      const mode = state.mode;
      const enemy = read.enemy;
      let aim: { x: number; y: number } | undefined;
      // Off its lane (in a trench after a camp), it walks back through the trenches first.
      track!.project(me.x, me.y);
      const offLane = !!nav && Math.sqrt(track!.lastDistSq) > b.farm.offLane;
      if (mode === 'farm' && plan && nav) {
        aim = farmAim(cfg, snap, nav, plan, me);
      } else if (offLane && mode === 'retreat' && nav!.towards(padField(nav!, cfg), me.x, me.y, NAV_LOOK, p)) {
        aim = p;
      } else if (offLane && mode !== 'trade' && mode !== 'allin' && nav!.towards(laneField(nav!), me.x, me.y, NAV_LOOK, p)) {
        aim = p;
      } else if (mode === 'retreat') {
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

      // Out of an enemy or boss marker first (D-085); otherwise weave sideways while fighting
      // (dodges lead-aimed bullets).
      const out = dodgeExit(cfg, snap, me, tick);
      if (out) aim = out;
      let dx = 0;
      let dy = 0;
      if (aim) {
        dx = aim.x - me.x;
        dy = aim.y - me.y;
      }
      if (!out && FIGHTING.has(mode) && personality.weaveAmplitude > 0) {
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
        if (target?.kind === Kind.Neutral) cmd.ult = mode === 'farm' && !!plan && campShare(cfg, snap, plan.camp) > 0.3;
        else if (target?.kind === Kind.Champion) cmd.ult = FIGHTING.has(mode) || target.hp / target.maxHp < 0.6 || state.confidence > 0.2;
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
