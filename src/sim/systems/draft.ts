import type { Config, PowerDef } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import type { SimEvent } from '../events';
import type { Rng } from '../rng';
import { Kind, type Champion, type Health } from '../sim';
import { foldMods, STAT } from '../powers';
import { addPct, type Stats } from '../stats';

type Powers = Config['powers'];

/** One draft offer (TDD §6.10): its cards (power ids), the ticks left before auto-pick, and the level it was for (a reroll keeps its rules). */
export interface DraftOffer {
  cards: string[];
  ticksLeft: number;
  level: number;
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

/** Powers this champion may be offered: the shared pool and its own signatures, under their stack caps, that fit its weapon kind. */
function eligible(p: Powers, c: Champion): PowerDef[] {
  const kind = c.def.weapon.kind;
  return p.powers.filter(
    (x) => (x.pool === 'all' || x.pool === c.championId) && (c.powers[x.id] ?? 0) < p.draft.stackCaps[x.rarity] && (!x.weapons || x.weapons.includes(kind)),
  );
}

/** A signature power, or a shared one sharing a tag with the champion's weapon (GDD §8 rule 5). */
const relevant = (x: PowerDef, c: Champion) => x.pool === c.championId || x.tags.some((t) => c.def.weaponTags.includes(t));

/** Takes one of the pool's powers that passes `ok`, uniformly on the seeded stream; −1 if none. */
function drawWhere(pool: PowerDef[], rng: Rng, ok: (x: PowerDef) => boolean): number {
  let n = 0;
  for (const x of pool) if (ok(x)) n++;
  if (n === 0) return -1;
  let k = Math.floor(rng() * n);
  for (let i = 0; i < pool.length; i++) if (ok(pool[i]!) && k-- === 0) return i;
  return -1;
}

const TIERS = ['epic', 'rare', 'common'] as const;

/**
 * Draws an offer of distinct cards for `level` from the seeded `draft` stream (GDD §8 rules 4–5,
 * D-060, D-064):
 * 1. At a `guaranteedEpicLevels` level the first card is an Epic, if any are left ("Field Promotion").
 * 2. Every other card rolls its rarity on `rarityOdds`, then a power of it; with none of that
 *    rarity left it falls back a tier (Epic → Rare → Common → any).
 * 3. If no card is a signature power or fits the champion's weapon (`weaponTags`), the last card
 *    is swapped for one that does, if any is left.
 * Empty if nothing is eligible.
 */
export function makeOffer(p: Powers, c: Champion, rng: Rng, level: number): string[] {
  const pool = eligible(p, c);
  const cards: PowerDef[] = [];
  const odds = p.draft.rarityOdds;
  const take = (i: number) => {
    cards.push(pool[i]!);
    pool.splice(i, 1);
  };
  if (p.draft.guaranteedEpicLevels.includes(level)) {
    const i = drawWhere(pool, rng, (x) => x.rarity === 'epic');
    if (i >= 0) take(i);
  }
  while (cards.length < p.draft.cards && pool.length > 0) {
    const roll = rng() * (odds.common + odds.rare + odds.epic);
    let pick = -1;
    for (let tier = roll < odds.epic ? 0 : roll < odds.epic + odds.rare ? 1 : 2; tier < TIERS.length && pick < 0; tier++) {
      pick = drawWhere(pool, rng, (x) => x.rarity === TIERS[tier]);
    }
    take(pick >= 0 ? pick : Math.floor(rng() * pool.length));
  }
  if (cards.length > 0 && !cards.some((x) => relevant(x, c))) {
    const i = drawWhere(pool, rng, (x) => relevant(x, c));
    if (i >= 0) cards[cards.length - 1] = pool[i]!;
  }
  return cards.map((x) => x.id);
}

const RANK = { common: 0, rare: 1, epic: 2 } as const;

/**
 * The highlighted card (GDD §8, TDD §6.10): the one sharing the most tags with powers already
 * owned; ties go to the higher rarity, then the earlier slot. It is also what the timer picks.
 */
export function recommended(p: Powers, c: Champion, cards: readonly string[]): number {
  const owned = new Set<string>();
  for (const x of p.powers) if ((c.powers[x.id] ?? 0) > 0) for (const t of x.tags) owned.add(t);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < cards.length; i++) {
    const def = powerById(p, cards[i]!);
    // Shared tags first; the rarity only breaks ties (it is worth less than one tag).
    const score = def ? def.tags.filter((t) => owned.has(t)).length + RANK[def.rarity] / 10 : 0;
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
 * 0. A `reroll` from its champion, with rerolls left, redraws the live offer's cards for its
 *    level and restarts its timer (GDD §8 rule 6, D-064).
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
    const reroll = c.rerollQueued;
    c.pickQueued = -1;
    c.rerollQueued = false;
    const front = c.draftQueue[0];
    if (!front) continue;
    if (reroll && c.rerollsLeft > 0) {
      const cards = makeOffer(p, c, ctx.rng, front.level);
      if (cards.length > 0) {
        c.rerollsLeft--;
        front.cards = cards;
        front.ticksLeft = p.draft.autoPickSeconds;
        ctx.events.push({ type: 'draftRerolled', id: e, cards });
        continue; // a new hand: a pick sent with the reroll was for the old cards
      }
    }
    if (pick >= 0 && pick < front.cards.length) resolveFront(ctx, p, e, pick, false);
    else if (--front.ticksLeft <= 0) resolveFront(ctx, p, e, recommended(p, c, front.cards), true);
  }
  const end = events.length;
  for (let k = 0; k < end; k++) {
    const ev = events[k]!;
    if (ev.type !== 'levelUp') continue;
    if (ev.level % p.draft.levelsPerOffer !== 0) continue; // an offer on every `levelsPerOffer`th level (2: levels 2, 4 … so Field Promotion's 4/8/12 line up, D-066)
    const c = champions.get(ev.id);
    if (!c) continue;
    if (c.draftQueue.length > p.draft.maxQueued) resolveFront(ctx, p, ev.id, recommended(p, c, c.draftQueue[0]!.cards), true);
    const cards = makeOffer(p, c, ctx.rng, ev.level);
    if (cards.length === 0) continue;
    c.draftQueue.push({ cards, ticksLeft: p.draft.autoPickSeconds, level: ev.level });
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
