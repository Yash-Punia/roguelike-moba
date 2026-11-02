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

/** One weapon (TDD §6.3). `interval` is seconds between shots; speeds stay in m/s. */
const Weapon = z.object({
  kind: z.enum(['bullet', 'flak']),
  damage: positive(),
  interval: secs().refine((t) => t >= 1, 'interval must be at least one tick'),
  range: positive(),
  projectileSpeed: positive(),
  spread: deg().default(0),
  /** Targets hit per shot (HQ flak hits 2). */
  targets: z.number().int().min(1).default(1),
});

const Champion = z.object({
  id: z.string(),
  name: z.string(),
  maxHp: positive(),
  moveSpeed: positive(),
  radius: positive(),
  /** Seconds for the Ultimate to charge 0 → 100% from the passive gain alone. */
  ultChargeSeconds: secs(),
  /** Per-level growth on top of level 1 (GDD §7). */
  growth: z.object({ hpPct: pct(), damagePct: pct() }),
  weapon: Weapon,
});

/** Ground finish of a walkable shape; render picks the colour (SG-01), the sim ignores it. */
const Surface = z.enum(['dirt', 'grass', 'trench', 'arena', 'crater']);

// Walkable shapes from the concept map spec (D-018). Painted in array order: where shapes
// overlap, the later one decides the surface and render height. `height` is render-only.
const shapeBase = { id: z.string(), surface: Surface, height: z.number().default(0) };
const WalkShape = z.discriminatedUnion('shape', [
  // Catmull-Rom curve through `points`, swept to `width`. `endHeight` slopes the floor (ramps).
  z.object({ shape: z.literal('path'), ...shapeBase, width: positive(), points: z.array(vec).min(2), endHeight: z.number().optional() }),
  // w, h are full sizes, not semi-axes.
  z.object({ shape: z.literal('ellipse'), ...shapeBase, x: z.number(), y: z.number(), w: positive(), h: positive() }),
  // `centreHeight` makes a bowl: `height` at the rim, `centreHeight` in the middle.
  z.object({ shape: z.literal('circle'), ...shapeBase, x: z.number(), y: z.number(), r: positive(), centreHeight: z.number().optional() }),
  z.object({ shape: z.literal('rect'), ...shapeBase, x: z.number(), y: z.number(), w: positive(), h: positive() }),
]);

const TeamName = z.enum(['blue', 'red']);
const StructureKind = z.enum(['subBase', 'hq']);

const MapConfig = z.object({
  id: z.string(),
  bounds: z.object({ minX: z.number(), maxX: z.number(), minY: z.number(), maxY: z.number() }),
  gridCell: positive(),
  /** Catmull-Rom samples per control-point segment. */
  splineSamples: z.number().int().min(1),
  spawn: z.object({ blue: vec, red: vec }),
  /** Structure placements from the map spec; their stats and footprints are in `structures`. */
  structures: z.array(
    z.object({ id: z.string(), kind: StructureKind, team: TeamName, lane: z.string().optional(), x: z.number(), y: z.number() }),
  ),
  /** Everything not covered by a walkable shape is raised jungle ground: blocked. */
  walkable: z.array(WalkShape).min(1),
  /** Blocking rectangles stamped on top of the walkable shapes (centre x, y; full w, h). */
  obstacles: z.array(
    z.object({ kind: z.enum(['sandbag']), x: z.number(), y: z.number(), w: positive(), h: positive() }),
  ),
});

// Footprint is stamped into the obstacle grid (units walk round it); `radius` is the
// collider used for targeting and hits, measured to its edge (GDD §6).
const Footprint = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('circle'), r: positive() }),
  z.object({ shape: z.literal('rect'), w: positive(), h: positive() }),
]);
const StructureDef = z.object({ name: z.string(), maxHp: positive(), radius: positive(), footprint: Footprint, weapon: Weapon });
const Structures = z.object({ subBase: StructureDef, hq: StructureDef });

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
  structures: Structures,
  camera: Camera,
  input: Input,
});

export type RawConfig = z.input<typeof ConfigSchema>;
export type Config = z.output<typeof ConfigSchema>;
export type MapConfig = Config['map'];
export type WalkShape = MapConfig['walkable'][number];
export type SurfaceKind = z.output<typeof Surface>;
export type StructureKind = z.output<typeof StructureKind>;
export type StructureDef = z.output<typeof StructureDef>;
export type Footprint = z.output<typeof Footprint>;
export type ChampionConfig = Config['champions'][number];
export type Vec2 = z.output<typeof vec>;
export type WeaponConfig = z.output<typeof Weapon>;
