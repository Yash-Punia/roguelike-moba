import type { Entity } from './ecs';

export type SimEvent = { type: 'championSpawned'; id: Entity; player: number };
