import type { Entity } from './ecs';

export type SimEvent =
  | { type: 'championSpawned'; id: Entity; player: number }
  /** A unit fired at its target (for muzzle flashes and sound). */
  | { type: 'shot'; id: Entity; target: Entity };
