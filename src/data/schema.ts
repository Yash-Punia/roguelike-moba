import { z } from 'zod';

export const TICK_HZ = 30;

// Unit conversion happens at load, inside the schema (TDD §4 "Units and coordinates").
export const secs = () => z.number().nonnegative().transform((s) => Math.round(s * TICK_HZ));
export const pct = () => z.number().transform((p) => p / 100);
export const deg = () => z.number().transform((d) => (d * Math.PI) / 180);

const vec = z.object({ x: z.number(), y: z.number() });
const positive = () => z.number().positive();

const Match = z.object({
  defaultSeed: z.number().int().nonnegative(),
});

const Champion = z.object({
  id: z.string(),
  name: z.string(),
  moveSpeed: positive(),
  radius: positive(),
});

const MapConfig = z.object({
  bounds: z.object({ minX: z.number(), maxX: z.number(), minY: z.number(), maxY: z.number() }),
  gridCell: positive(),
  laneWidth: positive(),
  lanes: z.array(z.object({ x: z.number() })),
  hq: z.object({ blue: vec, red: vec }),
  spawn: z.object({ blue: vec, red: vec }),
  obstacles: z.array(
    z.object({ kind: z.enum(['hq', 'sandbag']), x: z.number(), y: z.number(), w: positive(), h: positive() }),
  ),
});

// Camera runs in real time (render), so its seconds stay seconds.
const Camera = z.object({
  fovDeg: positive(),
  pitchDeg: positive(),
  viewWidth: positive(),
  playerFramePct: pct(),
  followSeconds: positive(),
  lookAhead: z.number().nonnegative(),
});

const Input = z.object({
  pxPerMm: positive(),
  deadZoneMm: z.number().nonnegative(),
  ringRadiusPx: positive(),
  fullSpeedPct: pct(),
  zoneWidthPct: pct(),
  zoneHeightPct: pct(),
});

export const ConfigSchema = z.object({
  match: Match,
  champions: z.array(Champion).min(1),
  map: MapConfig,
  camera: Camera,
  input: Input,
});

export type RawConfig = z.input<typeof ConfigSchema>;
export type Config = z.output<typeof ConfigSchema>;
export type MapConfig = Config['map'];
export type ChampionConfig = Config['champions'][number];
export type Vec2 = z.output<typeof vec>;
