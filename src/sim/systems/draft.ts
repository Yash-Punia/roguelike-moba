import type { Config, PowerDef } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import { Kind, type Champion, type Health } from '../sim';
import { foldMods, STAT } from '../powers';
import { addPct, type Stats } from '../stats';

type Powers = Config['powers'];

/** One draft offer (TDD §6.10): its cards (power ids) and the ticks left before auto-pick. */
export interface DraftOffer {
  cards: string[];
  ticksLeft: number;
}

export interface DraftContext {
  champions: Store<Champion>;
  healths: Store<Health>;
  stats: Store<Stats>;
  kinds: Store<Kind>;
  events: SimEvent[];
  rng: Rng;
  /** Re-derives a champion's speed and max HP after a stat changed (max HP gained as HP). */
  onStatsChanged(e: Entity): void;
}

const powerById = (p: Powers, id: string) => p.powers.find((x) => x.id === id);

/** Powers this champion may be offered: the shared pool and its own signatures, under their stack caps. */
function eligible(p: Powers, c: Champion): PowerDef[] {
  return p.powers.filter((x) => (x.pool === 'all' || x.pool === c.championId) && (c.powers[x.id] ?? 0) < p.draft.stackCaps[x.rarity]);
}

const TIERS = ['epic', 'rare', 'common'] as const;

/**
 * Draws an offer of distinct cards from the seeded `draft` stream (GDD §8 rule 4, pulled
 * forward, D-060): each card rolls its rarity on `rarityOdds`, then a power of it; with none of
 * that rarity left it falls back a tier (Epic → Rare → Common → any). Empty if nothing is eligible.
 */
export function makeOffer(p: Powers, c: Champion, rng: Rng): string[] {
  const pool = eligible(p, c);
  const cards: string[] = [];
  const odds = p.draft.rarityOdds;
  while (cards.length < p.draft.cards && pool.length > 0) {
    const roll = rng() * (odds.common + odds.rare + odds.epic);
    let tier = roll < odds.epic ? 0 : roll < odds.epic + odds.rare ? 1 : 2;
    let pick = -1;
    for (; tier < TIERS.length && pick < 0; tier++) {
      let n = 0;
      for (const x of pool) if (x.rarity === TIERS[tier]) n++;
      if (n === 0) continue;
      let k = Math.floor(rng() * n);
      for (let i = 0; i < pool.length; i++) {
        if (pool[i]!.rarity !== TIERS[tier]) continue;
        if (k-- === 0) {
          pick = i;
          break;
        }
      }
    }
    if (pick < 0) pick = Math.floor(rng() * pool.length);
    cards.push(pool[pick]!.id);
    pool.splice(pick, 1);
  }
  return cards;
}

/**
 * The highlighted card (GDD §8): the one sharing the most tags with powers already owned;
 * ties go to the earlier slot. It is also what the timer picks.
 */
export function recommended(p: Powers, c: Champion, cards: readonly string[]): number {
  const owned = new Set<string>();
  for (const x of p.powers) if ((c.powers[x.id] ?? 0) > 0) for (const t of x.tags) owned.add(t);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < cards.length; i++) {
    const def = powerById(p, cards[i]!);
    const score = def ? def.tags.filter((t) => owned.has(t)).length : 0;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Applies one stack of a power: its `stat` effects add their pct (D-033 delta model), and the
 * champion's folded mods are rebuilt (D-060), then its stats and weapon re-derived.
 */
export function applyPower(ctx: DraftContext, p: Powers, e: Entity, id: string, auto: boolean) {
  const c = ctx.champions.get(e)!;
  const def = powerById(p, id);
  if (!def) return;
  c.powers[id] = (c.powers[id] ?? 0) + 1;
  const st = ctx.stats.get(e);
  for (const fx of def.effects) if (fx.type === 'stat' && st) addPct(st, STAT[fx.stat], fx.pct);
  foldMods(c.mods, p, c.powers);
  const h = ctx.healths.get(e);
  if (c.mods.lastStand && h && h.hp > 0) h.lethalSaves = Math.max(h.lethalSaves, 1); // Last Stand, armed for this life
  ctx.onStatsChanged(e);
  ctx.events.push({ type: 'powerPicked', id: e, power: id, auto });
}

function resolveFront(ctx: DraftContext, p: Powers, e: Entity, slot: number, auto: boolean) {
  const c = ctx.champions.get(e)!;
  const offer = c.draftQueue.shift();
  if (!offer) return;
  const card = offer.cards[slot];
  if (card) applyPower(ctx, p, e, card, auto);
  const next = c.draftQueue[0];
  if (next) next.ticksLeft = p.draft.autoPickSeconds; // its 10 s starts now
}

/**
 * The draft (GDD §8, TDD §6.10), in the rewards stage after XP:
 * 1. The live (front) offer resolves on a `draftPick` from its champion, or after
 *    `autoPickSeconds` with the recommended card; the next queued offer then starts its timer.
 * 2. Every level-up this tick (to a level below the max) adds an offer of distinct powers
 *    under their stack caps, by rarity odds. With `maxQueued` already waiting, the oldest is auto-picked first.
 * Play never pauses: none of this blocks anything else.
 */
export function draftSystem(ctx: DraftContext, p: Powers, events: readonly SimEvent[]) {
  const { champions } = ctx;
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const pick = c.pickQueued;
    c.pickQueued = -1;
    const front = c.draftQueue[0];
    if (!front) continue;
    if (pick >= 0 && pick < front.cards.length) resolveFront(ctx, p, e, pick, false);
    else if (--front.ticksLeft <= 0) resolveFront(ctx, p, e, recommended(p, c, front.cards), true);
  }
  const end = events.length;
  for (let k = 0; k < end; k++) {
    const ev = events[k]!;
    if (ev.type !== 'levelUp') continue;
    if ((ev.level - 1) % p.draft.levelsPerOffer !== 0) continue; // an offer every few levels (D-051)
    const c = champions.get(ev.id);
    if (!c) continue;
    if (c.draftQueue.length > p.draft.maxQueued) resolveFront(ctx, p, ev.id, recommended(p, c, c.draftQueue[0]!.cards), true);
    const cards = makeOffer(p, c, ctx.rng);
    if (cards.length === 0) continue;
    c.draftQueue.push({ cards, ticksLeft: p.draft.autoPickSeconds });
    ctx.events.push({ type: 'draftOffered', id: ev.id, cards });
  }
}

/**
 * Out-of-combat regeneration (Field Medic): any damage dealt or taken this tick stamps the
 * champion's last combat tick; once `outOfCombatSeconds` have passed, owned `regen` effects
 * heal their share of max HP per second, per stack.
 */
export function regenSystem(ctx: DraftContext, p: Powers, events: readonly SimEvent[], tick: number) {
  const { champions, healths, kinds } = ctx;
  for (let k = 0; k < events.length; k++) {
    const ev = events[k]!;
    if (ev.type !== 'damage') continue;
    if (kinds.get(ev.source) === Kind.Champion) champions.get(ev.source)!.lastCombatTick = tick;
    if (kinds.get(ev.target) === Kind.Champion) champions.get(ev.target)!.lastCombatTick = tick;
  }
  for (let i = 0; i < champions.ids.length; i++) {
    const e = champions.ids[i]!;
    const c = champions.data[i]!;
    const h = healths.get(e)!;
    if (h.hp <= 0 || h.hp >= h.maxHp) continue;
    for (const x of p.powers) {
      const stacks = c.powers[x.id] ?? 0;
      if (stacks === 0) continue;
      for (const fx of x.effects) {
        if (fx.type !== 'regen' || tick - c.lastCombatTick < fx.outOfCombatSeconds) continue;
        h.hp = Math.min(h.maxHp, h.hp + (h.maxHp * fx.pctPerSecond * stacks) / 30);
      }
    }
  }
}
