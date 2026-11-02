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
  /** A grenade went off (for the flash, smoke and sound). */
  | { type: 'explosion'; owner: Entity; team: number; x: number; y: number; radius: number }
  | DamageEvent;
