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
  /** Respawn timer (GDD §9): base + perLevel × level, capped. Stays in seconds: level is runtime. */
  respawn: z.object({ baseSeconds: z.number().nonnegative(), perLevelSeconds: z.number().nonnegative(), maxSeconds: positive() }),
  /** The HQ spawn pad heals its own team's living champions standing on it (GDD §9). */
  spawnPad: z.object({ radius: positive(), healPctPerSecond: pct() }),
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

/** Auto-target classes in the order an Ultimate prefers them (GDD §6). */
const UltTargetClass = z.enum(['champion', 'hq', 'subBase', 'minion', 'neutral']);

/** Alpha's Frag Grenade (GDD §7, TDD §6.5): a lob to the target's spot, a blast, then a fire pool. */
const FragGrenade = z.object({
  id: z.literal('fragGrenade'),
  castRange: positive(),
  targetOrder: z.array(UltTargetClass).min(1),
  flightSeconds: secs().refine((t) => t >= 1, 'flight must be at least one tick'),
  /** Apex height of the lob (render only). */
  arcHeight: z.number().nonnegative(),
  radius: positive(),
  damage: z.number().nonnegative(),
  damagePerLevel: z.number().nonnegative(),
  zone: z.object({
    radius: positive(),
    seconds: secs(),
    dps: z.number().nonnegative(),
    dpsPerLevel: z.number().nonnegative(),
    /** Share of the fire's damage structures take. */
    structurePct: pct(),
    /** The pool hits every this often for dps × tickSeconds (readable damage numbers). */
    tickSeconds: secs().refine((t) => t >= 1, 'tick must be at least one tick'),
  }),
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
  /** Alpha's Steady Hand (GDD §7): still this long → + fire rate until moving again. */
  trait: z.object({ id: z.literal('steadyHand'), stillSeconds: secs(), fireRatePct: pct() }),
  ultimate: FragGrenade,
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
  /**
   * Minion lanes: route steps from the Blue end to the Red end, each listing the `path` shapes
   * that can be taken there (two at a branch). Red walks the same routes reversed.
   */
  lanes: z.array(z.object({ id: z.string(), route: z.array(z.array(z.string()).min(1)).min(1) })).default([]),
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
const StructureDef = z.object({
  name: z.string(),
  maxHp: positive(),
  radius: positive(),
  footprint: Footprint,
  weapon: Weapon,
  /** Heals `rules.regenPctPerSecond` while no enemy is near (GDD §5: the HQ only, D-036). */
  regen: z.boolean(),
});
/** Structure rules shared by every structure (GDD §5, TDD §6.7). */
const StructureRules = z.object({
  /** Extra damage per consecutive shot at the same champion, up to the max. */
  warmupPct: pct(),
  warmupMaxPct: pct(),
  /** Warm-up resets after this long without firing. */
  warmupResetSeconds: secs(),
  /** With no enemy minion this close, the structure takes `backdoorPct` less damage. */
  backdoorRadius: positive(),
  backdoorPct: pct(),
  regenPctPerSecond: pct(),
  /** Regen pauses while any enemy unit is this close. */
  regenClearRadius: positive(),
});
const Structures = z.object({ subBase: StructureDef, hq: StructureDef, rules: StructureRules });

/** Lane minions (GDD §5). Ranges in metres to collider edges; `leash` is the distance from the lane. */
const MinionDef = z.object({
  name: z.string(),
  maxHp: positive(),
  radius: positive(),
  moveSpeed: positive(),
  weapon: Weapon,
  /** Notices and walks to targets this close. */
  acquireRange: positive(),
  /** Gives up a chase that would take it this far from its lane. */
  leash: positive(),
  /** An enemy champion hitting an allied champion within `radius` pulls these minions onto it for `seconds`. */
  callForHelp: z.object({ radius: positive(), seconds: secs() }),
});
const Units = z.object({ mgSoldier: MinionDef });

/** Minion waves (GDD §5, TDD §6.6). */
const Waves = z.object({
  enabled: z.boolean(),
  firstSeconds: secs(),
  intervalSeconds: secs().refine((t) => t >= 1, 'interval must be at least one tick'),
  soldiers: z.number().int().min(0),
  /** Gap between soldiers in a wave's row (m). */
  spacing: z.number().nonnegative(),
  /** Lane ids (from `map.lanes`) that get waves. */
  lanes: z.array(z.string()),
});

const nonneg = () => z.number().nonnegative();

/** Auto-targeting tuning (GDD §6, TDD §6.2). Distances in metres, measured to collider edges. */
const Combat = z.object({
  targeting: z.object({
    /** Keep the current target while within weapon range + this. */
    stickyRange: nonneg(),
    /** Within the same class, switch only to a unit this much nearer. */
    sameClassSwitch: nonneg(),
    /** Units this close to the nearest count as tied; the lowest HP% wins. */
    tieBand: nonneg(),
    /** A higher class must stay in range this long before it overrides the current target. */
    overrideSeconds: secs(),
    /** Hold fire this long after the current target dies. */
    retargetPauseSeconds: secs(),
  }),
  /** Aiming and bullets (TDD §6.3). */
  weapons: z.object({
    /** Upper-body aim turn speed, degrees per second. */
    aimTurnRate: deg(),
    /** Fire only when the aim is within this many degrees of the target. */
    fireCone: deg(),
    /** lead: straight, aimed where the target will be; direct: straight at where it is; homing: curves onto its target and ignores everything else (D-030). */
    bulletAim: z.enum(['lead', 'direct', 'homing']),
    /** Bullet collision radius (m), added to each unit's collider in the swept hit test. */
    bulletRadius: positive(),
    /** A bullet flies the shooter's range plus this far before it expires (m). */
    bulletOvershoot: nonneg(),
  }),
  /** Damage pipeline (TDD §6.4). */
  damage: z.object({
    /** Keep at least this much damage history (assists look back 8 s, GDD §7). */
    logSeconds: secs(),
    /** Invulnerability after a lethal save (Last Stand: 45 ticks). */
    lethalSaveSeconds: secs(),
    /** Damage × this on a critical hit. */
    critMultiplier: z.number().min(1),
  }),
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
  structures: Structures,
  units: Units,
  waves: Waves,
  combat: Combat,
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
export type MinionDef = z.output<typeof MinionDef>;
export type Footprint = z.output<typeof Footprint>;
export type ChampionConfig = Config['champions'][number];
export type Vec2 = z.output<typeof vec>;
export type WeaponConfig = z.output<typeof Weapon>;
export type UltTargetClass = z.output<typeof UltTargetClass>;
