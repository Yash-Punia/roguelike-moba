import { signal } from '@preact/signals';
import { TICK_HZ } from '../data/schema';
import { displayTeam } from '../sim/sides';
import type { Entity } from '../sim/ecs';
import { Kind, Team, type Snapshot } from '../sim/sim';

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
};

const order = (a: StructureView, b: StructureView) => (a.kind === b.kind ? a.id - b.id : a.kind === 'hq' ? -1 : 1);
const same = (a: StructureView[], b: StructureView[]) =>
  a.length === b.length && a.every((s, i) => s.id === b[i]!.id && s.hp === b[i]!.hp && s.shielded === b[i]!.shielded && s.destroyed === b[i]!.destroyed);

/** Copies the HUD's values from a snapshot, for the champion `localId` on team `localTeam`. */
export function updateHud(snap: Snapshot, localId: Entity | undefined, localTeam: Team) {
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
