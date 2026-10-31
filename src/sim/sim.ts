import { TICK_HZ, type Config } from '../data/schema';
import { World, type Entity } from './ecs';
import type { SimEvent } from './events';
import { buildGrid } from './grid';
import { createStreams, type Streams } from './rng';
import { movementSystem } from './systems/movement';

export type PlayerId = number;
export enum Team {
  Blue = 0,
  Red = 1,
  Neutral = 2,
}

/** One per player per tick. Move is in world space (D-014), quantised to -127..127. */
export interface Command {
  tick: number;
  player: PlayerId;
  moveX: number;
  moveY: number;
  ult: boolean;
  draftPick: -1 | 0 | 1 | 2;
  reroll: boolean;
}

export interface PlayerSetup {
  team: Team.Blue | Team.Red;
  championId: string;
}

/** facing: radians, atan2(dy, dx) in sim space (0 = +x, PI/2 = towards Red). */
export interface Transform {
  x: number;
  y: number;
  facing: number;
}
export interface Motion {
  vx: number;
  vy: number;
  speed: number;
  intentX: number;
  intentY: number;
}
export interface Collider {
  radius: number;
}
export interface Champion {
  championId: string;
  player: PlayerId;
}

export interface EntitySnapshot {
  id: Entity;
  team: Team;
  x: number;
  y: number;
  facing: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Snapshot {
  tick: number;
  entities: EntitySnapshot[];
}

export interface StepResult {
  tick: number;
  events: readonly SimEvent[];
}

export function createSim(initialConfig: Config, seed: number, players: PlayerSetup[]) {
  let config = initialConfig;
  const world = new World();
  const transforms = world.store<Transform>();
  const motions = world.store<Motion>();
  const colliders = world.store<Collider>();
  const teams = world.store<Team>();
  const champions = world.store<Champion>();
  const rng: Streams = createStreams(seed);
  const events: SimEvent[] = [];
  const playerEntity: Entity[] = [];
  let grid = buildGrid(config.map);
  let tick = 0;

  players.forEach((p, player) => {
    const def = config.champions.find((c) => c.id === p.championId);
    if (!def) throw new Error(`Unknown champion "${p.championId}"`);
    const spawn = p.team === Team.Blue ? config.map.spawn.blue : config.map.spawn.red;
    const e = world.create();
    transforms.add(e, { x: spawn.x, y: spawn.y, facing: p.team === Team.Blue ? Math.PI / 2 : -Math.PI / 2 });
    motions.add(e, { vx: 0, vy: 0, speed: def.moveSpeed, intentX: 0, intentY: 0 });
    colliders.add(e, { radius: def.radius });
    teams.add(e, p.team);
    champions.add(e, { championId: def.id, player });
    playerEntity[player] = e;
    events.push({ type: 'championSpawned', id: e, player });
  });

  const snap: Snapshot = { tick: 0, entities: [] };

  return {
    world,
    rng,
    get tick() {
      return tick;
    },

    /** Advances exactly one tick. Returned events are valid until the next step. */
    step(commands: readonly Command[]): StepResult {
      if (tick > 0) events.length = 0;
      for (const c of commands) {
        const e = playerEntity[c.player];
        const m = e === undefined ? undefined : motions.get(e);
        if (!m) continue;
        m.intentX = c.moveX / 127;
        m.intentY = c.moveY / 127;
      }
      movementSystem(motions, transforms, colliders, grid, config.map.bounds, 1 / TICK_HZ);
      tick++;
      return { tick, events };
    },

    /** Read-only view for render/UI/bots. Objects are reused between calls; copy what you keep. */
    snapshot(): Snapshot {
      snap.tick = tick;
      const ids = transforms.ids;
      snap.entities.length = ids.length;
      for (let i = 0; i < ids.length; i++) {
        const e = ids[i]!;
        const t = transforms.data[i]!;
        const m = motions.get(e);
        const s = (snap.entities[i] ??= { id: 0, team: Team.Neutral, x: 0, y: 0, facing: 0, vx: 0, vy: 0, radius: 0 });
        s.id = e;
        s.team = teams.get(e) ?? Team.Neutral;
        s.x = t.x;
        s.y = t.y;
        s.facing = t.facing;
        s.vx = m?.vx ?? 0;
        s.vy = m?.vy ?? 0;
        s.radius = colliders.get(e)?.radius ?? 0;
      }
      return snap;
    },

    /** Live tuning (dev only): swaps config and re-derives cached values from it. */
    setConfig(next: Config) {
      config = next;
      grid = buildGrid(next.map);
      for (let i = 0; i < champions.ids.length; i++) {
        const e = champions.ids[i]!;
        const def = next.champions.find((c) => c.id === champions.data[i]!.championId);
        if (!def) continue;
        motions.get(e)!.speed = def.moveSpeed;
        colliders.get(e)!.radius = def.radius;
      }
    },

    entityOf(player: PlayerId): Entity | undefined {
      return playerEntity[player];
    },
  };
}

export type Sim = ReturnType<typeof createSim>;
