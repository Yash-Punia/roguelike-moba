import type { Entity } from './ecs';

/**
 * A hit after the whole damage pipeline (TDD §6.4). `amount` is HP plus shield lost, of
 * which `absorbed` went to the shield. `lethal`: it killed the target; `saved`: it would
 * have, but a lethal save left 1 HP. Pooled: copy what you keep past the next step.
 */
export interface DamageEvent {
  type: 'damage';
  source: Entity;
  target: Entity;
  amount: number;
  absorbed: number;
  critical: boolean;
  lethal: boolean;
  saved: boolean;
}

export type SimEvent =
  | { type: 'championSpawned'; id: Entity; player: number }
  /** A unit fired at its target (for muzzle flashes and sound). */
  | { type: 'shot'; id: Entity; target: Entity }
  /** An Ultimate was cast at `target`; a lobbed one lands at (x, y). */
  | { type: 'ultCast'; id: Entity; target: Entity; x: number; y: number }
  /** A channelled Ultimate (Lead Storm) stopped: ran out, or its caster was knocked out. */
  | { type: 'channelEnd'; id: Entity }
  /** A grenade went off (for the flash, smoke and sound). */
  | { type: 'explosion'; owner: Entity; team: number; x: number; y: number; radius: number }
  /** A unit was knocked out at (x, y); `killer` landed the lethal hit (0 = none). Minions are removed the same tick, so they carry their `unit`. */
  | { type: 'death'; id: Entity; team: number; killer: Entity; x: number; y: number; unit?: 'mgSoldier' | 'bazookaTank' }
  /** An HQ fell: the match is over and the sim stops advancing (TDD §6.12 `Ended`). */
  | { type: 'matchOver'; winner: number; tick: number }
  /** A draft offer was queued for a champion (power ids). */
  | { type: 'draftOffered'; id: Entity; cards: readonly string[] }
  /** A champion took a power: by choice, or by the timer (`auto`). */
  | { type: 'powerPicked'; id: Entity; power: string; auto: boolean }
  /** A champion reached a new level. */
  | { type: 'levelUp'; id: Entity; level: number }
  /** A structure fell (it stays as rubble); `killer` landed the last hit. */
  | { type: 'structureDestroyed'; id: Entity; kind: 'subBase' | 'hq'; team: number; killer: Entity; x: number; y: number }
  /** A minion wave spawned on every wave lane (0 = the first). */
  | { type: 'waveSpawned'; wave: number }
  /** A champion redeployed at (x, y). */
  | { type: 'respawn'; id: Entity; x: number; y: number }
  | DamageEvent;
