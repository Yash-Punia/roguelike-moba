import type { CampKind, Config } from '../data/schema';
import type { Entity } from '../sim/ecs';
import type { SimEvent } from '../sim/events';
import { displayTeam } from '../sim/sides';
import { Kind, Team, type EntitySnapshot, type Snapshot } from '../sim/sim';

export type HudSide = 'ours' | 'theirs' | 'neutral';

export const sideOf = (team: Team, localTeam: Team): HudSide => {
  const d = displayTeam(team, localTeam);
  return d === Team.Blue ? 'ours' : d === Team.Red ? 'theirs' : 'neutral';
};

/** A unit's display name: its champion, structure, soldier or camp. Read when it kills, while the id is still good. */
export function unitName(e: EntitySnapshot, config: Config): string {
  if (e.kind === Kind.Champion) return config.champions.find((c) => c.id === e.modelId)?.name ?? e.modelId;
  if (e.kind === Kind.HQ) return config.structures.hq.name;
  if (e.kind === Kind.SubBase) return config.structures.subBase.name;
  if (e.kind === Kind.Minion) return config.units[e.modelId as keyof Config['units']]?.name ?? 'Soldier';
  if (e.modelId.startsWith('deserter')) return config.neutrals.camps.deserter.name;
  return config.neutrals.camps[e.modelId as CampKind]?.name ?? '';
}

/** A line of banners shown one at a time for `ticks` each, keeping at most `max` waiting (older ones drop). */
export class BannerQueue<T> {
  private readonly queue: T[] = [];
  private until = 0;

  constructor(
    private readonly ticks: number,
    private readonly max: number,
  ) {}

  push(banner: T) {
    this.queue.push(banner);
    if (this.queue.length > this.max) this.queue.shift();
  }

  /** The banner to show now; `null` to clear the one `showing`; `undefined` to leave things as they are. */
  advance(tick: number, showing: boolean): T | null | undefined {
    if (tick < this.until) return undefined;
    const next = this.queue.shift();
    if (next !== undefined) {
      this.until = tick + this.ticks;
      return next;
    }
    return showing ? null : undefined;
  }

  reset() {
    this.queue.length = 0;
    this.until = 0;
  }
}

/** One stretch of a kill banner's sentence; `plain` is the words between the names. */
export interface KillPart {
  text: string;
  side: HudSide | 'plain';
}

/** A kill banner (D-088). `headline` is '' for a plain kill. */
export interface KillView {
  id: number;
  headline: string;
  parts: KillPart[];
}

const KILL_TICKS = 90;
const KILL_QUEUE = 4;
const MULTI = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUADRA KILL', 'PENTA KILL'];
const SPREE = ['KILLING SPREE', 'RAMPAGE', 'UNSTOPPABLE', 'DOMINATING', 'GODLIKE', 'LEGENDARY'];
/** Kills without dying that start `SPREE`. */
const SPREE_FROM = 3;

interface Tally {
  /** Kills since it was last knocked out. */
  spree: number;
  /** Kills in the current chain, and the tick of the last one (−1: none). */
  multi: number;
  lastKill: number;
}

const queue = new BannerQueue<Omit<KillView, 'id'>>(KILL_TICKS, KILL_QUEUE);
const tallies = new Map<Entity, Tally>();
/** Teams announced as wiped; cleared once one of them is back up. */
const wiped = new Set<Team>();
let firstBlood = false;
let nextId = 1;

/** Forgets the match so far (between matches and tests). */
export function resetKills() {
  queue.reset();
  tallies.clear();
  wiped.clear();
  firstBlood = false;
}

function tallyOf(e: Entity): Tally {
  let t = tallies.get(e);
  if (!t) tallies.set(e, (t = { spree: 0, multi: 0, lastKill: -1 }));
  return t;
}

function headlineFor(tally: Tally, shutdown: boolean, first: boolean): string {
  if (first) return 'FIRST BLOOD';
  if (shutdown) return 'SHUTDOWN';
  if (tally.multi >= 2) return MULTI[Math.min(tally.multi, MULTI.length - 1)]!;
  if (tally.spree >= SPREE_FROM) return SPREE[Math.min(tally.spree - SPREE_FROM, SPREE.length - 1)]!;
  return '';
}

/** The sentence: "Alpha has slain Beta", "You have slain Beta", "Beta was slain by the Pillbox". */
function sentence(victim: EntitySnapshot, killer: EntitySnapshot | undefined, byChampion: boolean, localId: Entity | undefined, localTeam: Team, config: Config): KillPart[] {
  const you = (e: EntitySnapshot) => e.id === localId;
  const victimPart: KillPart = { text: you(victim) ? 'you' : unitName(victim, config), side: sideOf(victim.team, localTeam) };
  if (killer && byChampion) {
    return [
      { text: you(killer) ? 'You' : unitName(killer, config), side: sideOf(killer.team, localTeam) },
      { text: you(killer) ? ' have slain ' : ' has slain ', side: 'plain' },
      victimPart,
    ];
  }
  const subject: KillPart = { ...victimPart, text: you(victim) ? 'You' : victimPart.text };
  const verb = you(victim) ? ' were slain' : ' was slain';
  const name = killer ? unitName(killer, config) : '';
  if (!name) return [subject, { text: verb, side: 'plain' }];
  return [subject, { text: `${verb} by the `, side: 'plain' }, { text: name, side: killer ? sideOf(killer.team, localTeam) : 'neutral' }];
}

/**
 * Turns this tick's champion knock-outs into kill banners (D-088): who killed whom, with a
 * headline for first blood, a shutdown, a multi-kill or a spree, and an Ace when a whole team
 * is down. Reads events and the snapshot only; kills are counted here because the sim's
 * `streak` also counts assists.
 */
export function announceKills(events: readonly SimEvent[], snap: Snapshot, localId: Entity | undefined, localTeam: Team, config: Config) {
  const cfg = config.progression.announcer;
  let anyKnockout = false;
  for (const ev of events) {
    if (ev.type !== 'death' || ev.unit !== undefined) continue;
    const victim = snap.entities.find((e) => e.id === ev.id);
    if (!victim || victim.kind !== Kind.Champion) continue;
    anyKnockout = true;
    const killer = snap.entities.find((e) => e.id === ev.killer);
    const byChampion = killer?.kind === Kind.Champion && killer.team !== victim.team;
    const fallen = tallyOf(victim.id);
    const shutdown = byChampion && fallen.spree >= cfg.shutdownKills;
    fallen.spree = 0;
    fallen.multi = 0;
    fallen.lastKill = -1;
    let headline = '';
    if (byChampion) {
      const t = tallyOf(killer.id);
      t.multi = t.lastKill >= 0 && snap.tick - t.lastKill <= cfg.multiKillSeconds ? t.multi + 1 : 1;
      t.lastKill = snap.tick;
      t.spree++;
      headline = headlineFor(t, shutdown, !firstBlood);
      firstBlood = true;
    }
    queue.push({ headline, parts: sentence(victim, killer, byChampion, localId, localTeam, config) });
  }
  // Ace: every champion of a team of two or more is down.
  for (const team of [Team.Blue, Team.Red]) {
    let total = 0;
    let down = 0;
    for (const e of snap.entities) {
      if (e.kind !== Kind.Champion || e.team !== team) continue;
      total++;
      if (e.hp <= 0) down++;
    }
    if (down < total || total < 2) {
      wiped.delete(team);
      continue;
    }
    if (wiped.has(team) || !anyKnockout) continue;
    wiped.add(team);
    const side = sideOf(team, localTeam);
    queue.push({ headline: 'ACE', parts: [{ text: side === 'ours' ? 'Your team is down' : 'Enemy team is down', side }] });
  }
}

/** The kill banner to show now (see `BannerQueue.advance`). */
export function advanceKills(tick: number, showing: boolean): KillView | null | undefined {
  const next = queue.advance(tick, showing);
  return next ? { ...next, id: nextId++ } : next;
}
