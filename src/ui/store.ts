import { signal } from '@preact/signals';
import { TICK_HZ, type Config } from '../data/schema';
import { displayTeam } from '../sim/sides';
import type { Entity } from '../sim/ecs';
import { Kind, Team, type Snapshot } from '../sim/sim';

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
};

const order = (a: StructureView, b: StructureView) => (a.kind === b.kind ? a.id - b.id : a.kind === 'hq' ? -1 : 1);
const same = (a: StructureView[], b: StructureView[]) =>
  a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.hp === b[i]!.hp && s.shielded === b[i]!.shielded && s.destroyed === b[i]!.destroyed);

/** Copies the HUD's values from a snapshot, for the champion `localId` on team `localTeam`. */
export function updateHud(snap: Snapshot, localId: Entity | undefined, localTeam: Team, powers?: Config['powers']) {
  hud.ended.value = snap.match.phase === 'ended';
  hud.seconds.value = Math.floor((snap.match.phase === 'ended' ? snap.match.endTick : snap.tick) / TICK_HZ);
  let ours = 0;
  let theirs = 0;
  const mine: StructureView[] = [];
  const enemy: StructureView[] = [];
  for (const e of snap.entities) {
    const side = displayTeam(e.team, localTeam);
    if (e.kind === Kind.Champion) {
      if (side === Team.Blue) ours += e.kills;
      else if (side === Team.Red) theirs += e.kills;
      if (e.id === localId) {
        hud.hp.value = Math.max(0, Math.round(e.hp));
        hud.maxHp.value = Math.round(e.maxHp);
        hud.level.value = e.level;
        const band = e.xpLevelEnd - e.xpLevelStart;
        hud.xpFraction.value = band > 0 ? Math.min(1, (e.xp - e.xpLevelStart) / band) : 1;
        hud.kills.value = e.kills;
        hud.deaths.value = e.deaths;
        hud.draft.value = powers ? draftView(e.draftCards, e.draftTicksLeft, e.draftRecommended, e.draftQueued, e.powers, powers) : null;
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
  const s = hud.score.value;
  if (s.ours !== ours || s.theirs !== theirs) hud.score.value = { ours, theirs };
  mine.sort(order);
  enemy.sort(order);
  if (!same(hud.ours.value, mine)) hud.ours.value = mine;
  if (!same(hud.theirs.value, enemy)) hud.theirs.value = enemy;
}

function draftView(
  cards: readonly string[],
  ticksLeft: number,
  rec: number,
  queued: number,
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
  if (prev && prev.recommended === rec && prev.queued === queued && prev.secondsLeft === secondsLeft && prev.cards.map((c) => c.id).join() === cards.join()) return prev;
  return { cards: views, secondsLeft, totalSeconds: powers.draft.autoPickSeconds / TICK_HZ, recommended: rec, queued };
}
