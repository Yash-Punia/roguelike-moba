import { signal } from '@preact/signals';
import { TICK_HZ, type Config } from '../data/schema';
import { displayTeam } from '../sim/sides';
import type { Entity } from '../sim/ecs';
import type { CampKind } from '../data/schema';
import type { SimEvent } from '../sim/events';
import { Kind, Team, type EntitySnapshot, type Snapshot } from '../sim/sim';

export interface CardView {
  id: string;
  name: string;
  text: string;
  rarity: 'common' | 'rare' | 'epic';
  /** Stacks already owned, and the cap. */
  owned: number;
  cap: number;
}

/** The live draft offer for the local champion (GDD §8). */
export interface DraftView {
  cards: CardView[];
  /** Seconds left before the recommended card is taken. */
  secondsLeft: number;
  totalSeconds: number;
  recommended: number;
  /** Offers waiting behind this one ("+1"). */
  queued: number;
  /** Free rerolls left this match. */
  rerolls: number;
}

/** A short banner (TDD §10). `id` restarts its animation; `tone`: good or bad for the viewer's side. */
export interface NoticeView {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral';
}

export type HudSide = 'ours' | 'theirs' | 'neutral';

/** The local champion is down: the countdown, and who did it ('' if unknown). */
export interface RespawnView {
  seconds: number;
  killerName: string;
  killerSide: HudSide;
}

/** One scoreboard row (TDD §10). */
export interface BoardRow {
  id: Entity;
  name: string;
  side: HudSide;
  me: boolean;
  down: boolean;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  powers: { common: number; rare: number; epic: number };
}

export interface StructureView {
  id: Entity;
  kind: 'subBase' | 'hq';
  /** 0..1 */
  hp: number;
  shielded: boolean;
  destroyed: boolean;
}

/**
 * The few values the HUD shows (TDD §10 "State flow"), as Preact signals. `updateHud` copies
 * them from a snapshot; the app calls it at 10 Hz so re-renders stay cheap.
 */
export const hud = {
  /** Match clock in whole seconds. */
  seconds: signal(0),
  hp: signal(0),
  maxHp: signal(0),
  level: signal(1),
  /** Progress through the current level, 0..1 (1 at the max level). */
  xpFraction: signal(0),
  kills: signal(0),
  deaths: signal(0),
  /** Takedowns by side: yours (drawn Blue) and the enemy's (drawn Red). */
  score: signal({ ours: 0, theirs: 0 }),
  /** Structures by side, in a stable order (HQ first, then Sub-bases by id). */
  ours: signal<StructureView[]>([]),
  theirs: signal<StructureView[]>([]),
  draft: signal<DraftView | null>(null),
  /** Show keyboard plates (1/2/3) on cards: the last input was a keyboard. */
  keyHints: signal(false),
  /** The match is over: the tray hides. */
  ended: signal(false),
  /** Sudden Death is on (D-068). */
  suddenDeath: signal(false),
  /** Surrender would be accepted now. */
  canSurrender: signal(false),
  /** The banner showing now. */
  notice: signal<NoticeView | null>(null),
  /** The local champion's countdown while it is down. */
  respawn: signal<RespawnView | null>(null),
  /** The scoreboard: open (Tab or the score), and its rows, filled only while open. */
  boardOpen: signal(false),
  board: signal<BoardRow[]>([]),
};

/** How long each banner stays, and the most waiting behind it (older ones drop). UI timing, in sim ticks. */
const NOTICE_TICKS = Math.round(2.5 * TICK_HZ);
const NOTICE_QUEUE = 4;

const notices = {
  queue: [] as Omit<NoticeView, 'id'>[],
  nextId: 1,
  until: 0,
  /** `snap.camps[i].members` last tick, and each champion's streak. */
  members: [] as number[],
  streaks: new Map<Entity, number>(),
  killerName: '',
  killerSide: 'neutral' as HudSide,
};

/** Forgets notices between matches and tests. */
export function resetNotices() {
  notices.queue.length = 0;
  notices.until = 0;
  notices.members.length = 0;
  notices.streaks.clear();
  notices.killerName = '';
  notices.killerSide = 'neutral';
  hud.notice.value = null;
  hud.respawn.value = null;
}

const sideOf = (team: Team, localTeam: Team): HudSide => {
  const d = displayTeam(team, localTeam);
  return d === Team.Blue ? 'ours' : d === Team.Red ? 'theirs' : 'neutral';
};

const say = (text: string, tone: NoticeView['tone']) => {
  notices.queue.push({ text, tone });
  if (notices.queue.length > NOTICE_QUEUE) notices.queue.shift();
};

/** A unit's display name: its champion, structure, soldier or camp. Read when it kills, while the id is still good. */
function unitName(e: EntitySnapshot, config: Config): string {
  if (e.kind === Kind.Champion) return config.champions.find((c) => c.id === e.modelId)?.name ?? e.modelId;
  if (e.kind === Kind.HQ) return config.structures.hq.name;
  if (e.kind === Kind.SubBase) return config.structures.subBase.name;
  if (e.kind === Kind.Minion) return config.units[e.modelId as keyof Config['units']]?.name ?? 'Soldier';
  if (e.modelId.startsWith('deserter')) return config.neutrals.camps.deserter.name;
  return config.neutrals.camps[e.modelId as CampKind]?.name ?? '';
}

/**
 * Turns this tick's events into banners (TDD §10), and remembers who knocked out the local
 * champion. Called every tick, unlike `updateHud`, so no event is missed. Only reads the sim.
 */
export function pushNotices(events: readonly SimEvent[], snap: Snapshot, localId: Entity | undefined, localTeam: Team, config: Config) {
  for (const ev of events) {
    if (ev.type === 'structureDestroyed') {
      const name = ev.kind === 'hq' ? 'HQ' : 'Sub-base';
      if (sideOf(ev.team, localTeam) === 'ours') say(`Our ${name} lost`, 'bad');
      else say(`Enemy ${name} destroyed`, 'good');
    } else if (ev.type === 'hqLastLine') {
      if (sideOf(ev.team, localTeam) === 'ours') say('Our HQ: last line', 'neutral');
      else say('Enemy HQ: last line', 'good');
    } else if (ev.type === 'phaseChanged' && ev.phase === 'suddenDeath') {
      say('Sudden Death', 'neutral');
    } else if (ev.type === 'campCleared' && ev.team !== undefined && config.neutrals.camps[ev.kind].boss) {
      const name = config.neutrals.camps[ev.kind].name;
      if (sideOf(ev.team, localTeam) === 'ours') say(`We took the ${name}`, 'good');
      else say(`Enemy took the ${name}`, 'bad');
    } else if (ev.type === 'death' && ev.id === localId) {
      const killer = snap.entities.find((e) => e.id === ev.killer);
      notices.killerName = killer ? unitName(killer, config) : '';
      notices.killerSide = killer ? sideOf(killer.team, localTeam) : 'neutral';
    }
  }
  for (let i = 0; i < snap.camps.length; i++) {
    const c = snap.camps[i]!;
    const before = notices.members[i];
    notices.members[i] = c.members;
    if (before !== 0 || c.members === 0 || !config.neutrals.camps[c.kind].boss) continue;
    const name = config.neutrals.camps[c.kind].name;
    say(c.kind === 'behemoth' ? `${name} has awoken` : `${name} spotted`, 'neutral');
  }
  const min = config.progression.bounty.minStreak;
  for (const e of snap.entities) {
    if (e.kind !== Kind.Champion) continue;
    const before = notices.streaks.get(e.id) ?? 0;
    notices.streaks.set(e.id, e.streak);
    if (before >= min || e.streak < min) continue;
    const name = unitName(e, config);
    const ours = sideOf(e.team, localTeam) === 'ours';
    if (e.id === localId) say('You have a bounty', 'neutral');
    else say(`${ours ? 'Our' : 'Enemy'} ${name} has a bounty`, ours ? 'good' : 'bad');
  }
  if (snap.tick < notices.until) return;
  const next = notices.queue.shift();
  if (next) {
    hud.notice.value = { ...next, id: notices.nextId++ };
    notices.until = snap.tick + NOTICE_TICKS;
  } else if (hud.notice.value) hud.notice.value = null;
}

const order = (a: StructureView, b: StructureView) => (a.kind === b.kind ? a.id - b.id : a.kind === 'hq' ? -1 : 1);
const same = (a: StructureView[], b: StructureView[]) =>
  a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.hp === b[i]!.hp && s.shielded === b[i]!.shielded && s.destroyed === b[i]!.destroyed);

/** Copies the HUD's values from a snapshot, for the champion `localId` on team `localTeam`. */
export function updateHud(snap: Snapshot, localId: Entity | undefined, localTeam: Team, powers?: Config['powers'], champions?: Config['champions']) {
  hud.ended.value = snap.match.phase === 'ended';
  hud.suddenDeath.value = snap.match.phase === 'suddenDeath';
  hud.canSurrender.value = snap.match.canSurrender;
  hud.seconds.value = Math.floor((snap.match.phase === 'ended' ? snap.match.endTick : snap.tick) / TICK_HZ);
  let ours = 0;
  let theirs = 0;
  let respawn: RespawnView | null = null;
  const board: BoardRow[] = [];
  const mine: StructureView[] = [];
  const enemy: StructureView[] = [];
  for (const e of snap.entities) {
    const side = displayTeam(e.team, localTeam);
    if (e.kind === Kind.Champion) {
      if (side === Team.Blue) ours += e.kills;
      else if (side === Team.Red) theirs += e.kills;
      if (hud.boardOpen.value) board.push(boardRow(e, localId, localTeam, powers, champions));
      if (e.id === localId && e.respawnTicks > 0) respawn = { seconds: Math.ceil(e.respawnTicks / TICK_HZ), killerName: notices.killerName, killerSide: notices.killerSide };
      if (e.id === localId) {
        hud.hp.value = Math.max(0, Math.round(e.hp));
        hud.maxHp.value = Math.round(e.maxHp);
        hud.level.value = e.level;
        const band = e.xpLevelEnd - e.xpLevelStart;
        hud.xpFraction.value = band > 0 ? Math.min(1, (e.xp - e.xpLevelStart) / band) : 1;
        hud.kills.value = e.kills;
        hud.deaths.value = e.deaths;
        hud.draft.value = powers ? draftView(e.draftCards, e.draftTicksLeft, e.draftRecommended, e.draftQueued, e.draftRerolls, e.powers, powers) : null;
      }
    } else if (e.kind === Kind.SubBase || e.kind === Kind.HQ) {
      const view: StructureView = {
        id: e.id,
        kind: e.kind === Kind.HQ ? 'hq' : 'subBase',
        hp: e.maxHp > 0 ? Math.round((Math.max(0, e.hp) / e.maxHp) * 100) / 100 : 0,
        shielded: e.invulnerable && !e.destroyed,
        destroyed: e.destroyed,
      };
      (side === Team.Blue ? mine : enemy).push(view);
    }
  }
  const r = respawn as RespawnView | null;
  const shown = hud.respawn.value;
  if (r?.seconds !== shown?.seconds || r?.killerName !== shown?.killerName) hud.respawn.value = r;
  if (hud.boardOpen.value) hud.board.value = board.sort((a, b) => Number(b.side === 'ours') - Number(a.side === 'ours') || a.id - b.id);
  const s = hud.score.value;
  if (s.ours !== ours || s.theirs !== theirs) hud.score.value = { ours, theirs };
  mine.sort(order);
  enemy.sort(order);
  if (!same(hud.ours.value, mine)) hud.ours.value = mine;
  if (!same(hud.theirs.value, enemy)) hud.theirs.value = enemy;
}

function boardRow(e: EntitySnapshot, localId: Entity | undefined, localTeam: Team, powers?: Config['powers'], champions?: Config['champions']): BoardRow {
  const count = { common: 0, rare: 0, epic: 0 };
  for (const p of powers?.powers ?? []) count[p.rarity] += e.powers[p.id] ?? 0;
  return {
    id: e.id,
    name: champions?.find((c) => c.id === e.modelId)?.name ?? e.modelId,
    side: sideOf(e.team, localTeam),
    me: e.id === localId,
    down: e.hp <= 0,
    level: e.level,
    kills: e.kills,
    deaths: e.deaths,
    assists: e.assists,
    powers: count,
  };
}

function draftView(
  cards: readonly string[],
  ticksLeft: number,
  rec: number,
  queued: number,
  rerolls: number,
  owned: Readonly<Record<string, number>>,
  powers: Config['powers'],
): DraftView | null {
  if (cards.length === 0) return null;
  const views: CardView[] = [];
  for (const id of cards) {
    const def = powers.powers.find((p) => p.id === id);
    if (!def) continue;
    views.push({ id, name: def.name, text: def.text, rarity: def.rarity, owned: owned[id] ?? 0, cap: powers.draft.stackCaps[def.rarity] });
  }
  const prev = hud.draft.value;
  const secondsLeft = Math.ceil((ticksLeft / TICK_HZ) * 10) / 10;
  if (prev && prev.recommended === rec && prev.queued === queued && prev.rerolls === rerolls && prev.secondsLeft === secondsLeft && prev.cards.map((c) => c.id).join() === cards.join()) return prev;
  return { cards: views, secondsLeft, totalSeconds: powers.draft.autoPickSeconds / TICK_HZ, recommended: rec, queued, rerolls };
}
