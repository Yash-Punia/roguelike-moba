import { z } from 'zod';

export const TICK_HZ = 30;

// Unit conversion happens at load, inside the schema (TDD §4 "Units and coordinates").
export const secs = () => z.number().nonnegative().transform((s) => Math.round(s * TICK_HZ));
export const pct = () => z.number().transform((p) => p / 100);
export const deg = () => z.number().transform((d) => (d * Math.PI) / 180);

const vec = z.object({ x: z.number(), y: z.number() });
const positive = () => z.number().positive();
const nonneg = () => z.number().nonnegative();

const Match = z.object({
  defaultSeed: z.number().int().nonnegative(),
  /** Champions per team (D-009); `?size=` overrides it. Every slot but yours is a bot. */
  teamSize: z.number().int().min(2).max(5),
  /** Lane count, which picks the map: 3 = The Front, 2 = The Bridgehead (D-069); `?lanes=` overrides it. */
  lanes: z.union([z.literal(2), z.literal(3)]).default(3),
  /** Respawn timer (GDD §9): base + perLevel × level, capped. Stays in seconds: level is runtime. */
  /** Redeploy sprint (GDD §9): `sprintPct` more move speed after respawning, until combat or crossing y = 0 towards the enemy. */
  respawn: z.object({ baseSeconds: z.number().nonnegative(), perLevelSeconds: z.number().nonnegative(), maxSeconds: positive(), sprintPct: pct().default(0) }),
  /** The HQ spawn pad heals its own team's living champions standing on it (GDD §9). */
  spawnPad: z.object({ radius: positive(), healPctPerSecond: pct() }),
  /** Match phases (GDD §2, TDD §6.12): Sudden Death from `suddenDeathSeconds`, the time-out at `timeoutSeconds`, surrender allowed from `surrenderFromSeconds`. Deploy lasts until the first wave. */
  phases: z.object({ suddenDeathSeconds: secs(), timeoutSeconds: secs(), surrenderFromSeconds: secs() }),
  /** Sudden Death: structures take `structureDamageTakenPct` more damage and respawn timers run `respawnPct` longer. */
  suddenDeath: z.object({ structureDamageTakenPct: pct(), respawnPct: pct() }),
});

/** One weapon (TDD §6.3). `interval` is seconds between shots; speeds stay in m/s. */
const Weapon = z.object({
  /** `cone` (Gamma's flamethrower): no projectile, hits every enemy in a `coneAngle` sector out to `range`. `rocket` (Bazooka Tank): a bullet that bursts for `splashRadius` where it hits. */
  kind: z.enum(['bullet', 'flak', 'cone', 'rocket']),
  damage: positive(),
  interval: secs().refine((t) => t >= 1, 'interval must be at least one tick'),
  range: positive(),
  /** Bullet speed (m/s); cones have none. */
  projectileSpeed: z.number().nonnegative().default(0),
  /** Full width of a cone weapon's sector. */
  coneAngle: deg().default(0),
  spread: deg().default(0),
  /** Targets hit per shot (HQ flak hits 2). */
  targets: z.number().int().min(1).default(1),
  /** Bullets per trigger pull (Beta's Burst SMG fires 4), `burstGapSeconds` apart (TDD §6.3). */
  burstCount: z.number().int().min(1).default(1),
  burstGapSeconds: secs().refine((t) => t >= 1, 'burst gap must be at least one tick').default(1), // default is the output: 1 tick
  /** A rocket also hits every other enemy whose collider is within this distance of the impact (m). */
  splashRadius: z.number().nonnegative().default(0),
  /** Extra damage to structures (GDD §5 Bazooka Tank +100%). */
  vsStructuresPct: pct().default(0),
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

/**
 * Beta's Lead Storm (GDD §7, TDD §6.5): after a red-strip windup, a channelled barrage that hits
 * every enemy in a `length` × `width` strip in front of her and slows them; the strip turns
 * towards her Ultimate target at `turnRate`. She moves at `moveSpeedPct` meanwhile.
 */
const LeadStorm = z.object({
  id: z.literal('leadStorm'),
  castRange: positive(),
  targetOrder: z.array(UltTargetClass).min(1),
  /** The strip shows this long before it hits (GDD §10: telegraphs ≥ 0.5 s). */
  windupSeconds: secs(),
  seconds: secs().refine((t) => t >= 1, 'channel must be at least one tick'),
  length: positive(),
  width: positive(),
  /** Degrees per second. */
  turnRate: deg(),
  /** Per bullet; `bulletsPerSecond` × `tickSeconds` bullets land per hit. */
  damage: z.number().nonnegative(),
  damagePerLevel: z.number().nonnegative(),
  bulletsPerSecond: positive(),
  tickSeconds: secs().refine((t) => t >= 1, 'tick must be at least one tick'),
  slowPct: pct(),
  slowSeconds: secs(),
  moveSpeedPct: pct(),
  structurePct: pct(),
});

/**
 * Gamma's Heat Wave (GDD §7, TDD §6.5): an aura of `radius` around him for `seconds`, needing no
 * target. Every `tickSeconds`, allied champions and minions inside heal and enemies inside burn
 * (shares of their max HP per second); units inside deal ± `damageDealtPct`. Not structures.
 */
const HeatWave = z.object({
  id: z.literal('heatWave'),
  radius: positive(),
  seconds: secs().refine((t) => t >= 1, 'aura must last at least one tick'),
  healPctPerSecond: pct(),
  burnPctPerSecond: pct(),
  tickSeconds: secs().refine((t) => t >= 1, 'tick must be at least one tick'),
  damageDealtPct: pct(),
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
  trait: z.discriminatedUnion('id', [
    /** Alpha's Steady Hand (GDD §7): still this long → + fire rate until moving again. */
    z.object({ id: z.literal('steadyHand'), stillSeconds: secs(), fireRatePct: pct() }),
    /** Beta's Light Feet (GDD §7): this long without dealing or taking damage → + move speed. */
    z.object({ id: z.literal('lightFeet'), outOfCombatSeconds: secs(), moveSpeedPct: pct() }),
    /** Gamma's Charge (GDD §7): moving within `angle` of the nearest enemy champion within `radius` → + move speed. */
    z.object({ id: z.literal('charge'), radius: positive(), angle: deg(), moveSpeedPct: pct() }),
  ]),
  ultimate: z.discriminatedUnion('id', [FragGrenade, LeadStorm, HeatWave]),
  /** Bots of this champion take a lane of this kind first (TDD §7 lane assignment). */
  lanePreference: z.enum(['centre', 'side']).optional(),
  /** Tags of shared powers that fit this champion's weapon: an offer always has one of them or a signature power (GDD §8 rule 5, D-064). */
  weaponTags: z.array(z.string()).default([]),
});

/** Ground finish of a walkable shape; render picks the colour (SG-01), the sim ignores it. */
const Surface = z.enum(['dirt', 'grass', 'trench', 'arena', 'crater', 'river', 'ford', 'bridge', 'gravel']);

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
  /** Cave mouths behind each HQ that waves come out of (D-051; render only: lane routes start there). */
  caves: z.array(z.object({ team: TeamName, x: z.number(), y: z.number() })).default([]),
  /** Medkit crates in the Trench medkit rooms (GDD §4). */
  medkits: z.array(vec).default([]),
  /** Neutral camps in the Trench rooms (GDD §4, map spec C1–C4 and S1–S4) and the mini-bosses in their arenas: `count` units at the centre (x, y). */
  camps: z.array(z.object({ id: z.string(), kind: z.enum(['deserter', 'sniper', 'fieldGun', 'halftrack']), x: z.number(), y: z.number(), count: z.number().int().min(1).default(1) })).default([]),
  /** Units on a `ford` cell move this much slower (The Bridgehead, D-069). `river` cells block movement but not shots or sight. */
  fordSlowPct: pct().default(0),
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
  /** When on, an HQ's max HP drops by `hqHpPerSubBaseLostPct` of its base for every Sub-base its team has lost (D-051, toggle D-052); its HP keeps its fraction. */
  hqHpCutEnabled: z.boolean(),
  hqHpPerSubBaseLostPct: pct(),
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
  /** Takes this much less damage from structures (GDD §5 Bazooka Tank 50%). */
  structureResistPct: pct().default(0),
});
const Units = z.object({ mgSoldier: MinionDef, shockTrooper: MinionDef, bazookaTank: MinionDef });
/** Per lane minion type, valued in XP and Ultimate charge. */
const perUnit = () => z.object({ mgSoldier: z.number().nonnegative(), shockTrooper: z.number().nonnegative(), bazookaTank: z.number().nonnegative() });

/** One neutral camp kind (GDD §4, NT-01): its units, timers and reward. */
const CampDef = z.object({
  name: z.string(),
  firstSpawnSeconds: secs(),
  respawnSeconds: secs(),
  /** Split between the killer's team's champions within `rewardRadius` when the camp is cleared. */
  xp: nonneg(),
  /** Ultimate charge points each of those champions gains (not split). */
  ultCharge: nonneg(),
  /** `weapon`: camp units auto-fire it; a mini-boss has none and fires its `boss.pattern` instead. */
  unit: z.object({ maxHp: positive(), radius: positive(), /** 0: holds its spot (the sniper). */ moveSpeed: nonneg(), weapon: Weapon.optional() }),
  /** A mini-boss (GDD §4, D-079): its XP and charge go to the whole killing team, anywhere. */
  boss: z
    .object({
      pattern: z.discriminatedUnion('kind', [
        /** Field Gun: every `intervalSeconds`, a shell at each of up to `targets` attackers within `range`, landing `flightSeconds` later. */
        z.object({
          kind: z.literal('shells'),
          range: positive(),
          intervalSeconds: secs(),
          targets: z.number().int().min(1),
          flightSeconds: secs(),
          damage: nonneg(),
          radius: positive(),
          /** Apex of the shell's arc (render, m). */
          arcHeight: nonneg(),
        }),
        /**
         * Halftrack (D-080): every `intervalSeconds`, at the nearest attacker within `range`, a spray
         * (a cone `range` long, `spray.angle` wide) or, every `chargeEvery`th attack, a charge (a strip
         * `charge.length` long and `charge.width` wide, then it drives down it at `charge.speed`).
         * Each is marked `windupSeconds` before it hits, and locked where it was aimed.
         */
        z.object({
          kind: z.literal('halftrack'),
          range: positive(),
          intervalSeconds: secs(),
          windupSeconds: secs(),
          chargeEvery: z.number().int().min(1),
          spray: z.object({ angle: deg(), damage: nonneg() }),
          charge: z.object({ length: positive(), width: positive(), damage: nonneg(), speed: positive() }),
        }),
      ]),
      /** Artillery Support: the killing team's next this many waves bring an extra Bazooka Tank in every lane. */
      artilleryWaves: z.number().int().min(0).default(0),
      /** Supply Drop (D-080): every champion of the killing team deals `damagePct` more and moves `speedPct` faster for `seconds`. */
      supplyDrop: z.object({ damagePct: pct(), speedPct: pct(), seconds: secs() }).optional(),
    })
    .optional(),
});
/** Neutral camps (GDD §4, TDD §6.8, D-073). */
const Neutrals = z.object({
  /** A member pulled further than this from its spot (m) sends the camp home. */
  leashRadius: positive(),
  /** An engaged camp with no damage dealt or taken for this long goes home. */
  resetSeconds: secs(),
  /** Walking home this much faster than its move speed (the sniper still walks back at the deserters' pace). */
  returnSpeedPct: pct(),
  rewardRadius: positive(),
  /** Squad members stand on a ring this wide round the campfire (m). */
  ringRadius: nonneg(),
  camps: z.object({ deserter: CampDef, sniper: CampDef, fieldGun: CampDef, halftrack: CampDef }),
});

/** XP and levels (GDD §8). */
const Progression = z.object({
  /** XP from each level to the next: [1→2, 2→3, …]. The max level is its length + 1. */
  xpPerLevel: z.array(positive()).min(1),
  /** A minion's XP is split between allied champions within this distance of where it fell. */
  shareRadius: positive(),
  minionXp: perUnit(),
  /** Champion takedown: base + perVictimLevel × victim level, plus a bonus for the killer. */
  championKill: z.object({ base: z.number().nonnegative(), perVictimLevel: z.number().nonnegative(), killerBonus: z.number().nonnegative() }),
  /** Whole-team XP for destroying a structure. */
  structureXp: z.object({ subBase: z.number().nonnegative() }),
  /** Ultimate charge from kills, in points of the 0–100 meter (GDD §8). */
  /** An assist on a takedown: an enemy champion that damaged the victim within this long (GDD §8; D-065, D-067). */
  assistSeconds: secs(),
  ultCharge: z.object({
    /** Each living enemy champion within `minionRadius` of a dying minion gains this (not split). */
    minion: perUnit(),
    minionRadius: positive(),
    /** Every enemy champion in on a takedown (the killer and its assists) gains this (D-065). */
    championTakedown: z.number().nonnegative(),
    /** +1 point per this much damage a champion deals to, or takes from, enemy champions (GDD §8). */
    perDamageDealt: positive(),
    perDamageTaken: positive(),
  }),
});

/** Stats a power's `stat` effect can raise (TDD §5 stat formula); names map to `Stat` in the sim. */
const StatName = z.enum(['damage', 'fireRate', 'maxHp', 'moveSpeed', 'range', 'damageTaken', 'ultCharge', 'damageVsChampions', 'damageVsStructures']);

/**
 * Effect records (TDD §5): powers are data that a few generic systems understand. Amounts add
 * up per stack; durations, radii and thresholds take the largest owned (D-060).
 */
const Effect = z.discriminatedUnion('type', [
  /** + pct to a stat, per stack. */
  z.object({ type: z.literal('stat'), stat: StatName, pct: pct() }),
  /** Heal pctPerSecond of max HP while out of combat for outOfCombatSeconds (Field Medic). */
  z.object({ type: z.literal('regen'), pctPerSecond: pct(), outOfCombatSeconds: secs() }),
  /**
   * Weapon changes. `shots`: more bullets per trigger pull, fired as a burst straight at the target (D-072; a burst
   * weapon gets them as more bullets per burst; a cone weapon converts them, GDD §8 rule 8, to
   * `cone.angle` wider and `cone.range` longer). `burst`: more bullets per burst. `pierce`:
   * enemies a bullet passes through. `ricochet`: on its last hit a bullet bounces to the nearest
   * other enemy within `radius` for `damagePct`. `critEvery`: every Nth shot is a critical hit.
   */
  z.object({
    type: z.literal('weaponMod'),
    shots: z.number().int().min(0).default(0),
    cone: z.object({ angle: deg(), range: nonneg() }).optional(),
    burst: z.number().int().min(0).default(0),
    pierce: z.number().int().min(0).default(0),
    ricochet: z.object({ count: z.number().int().min(1), radius: positive(), damagePct: pct() }).optional(),
    critEvery: z.number().int().min(0).default(0),
  }),
  /** On each weapon hit on an enemy unit: a burn (dps for seconds) and/or a mark (+pct damage taken from every source). */
  z.object({
    type: z.literal('onHit'),
    burn: z.object({ dps: positive(), seconds: secs() }).optional(),
    mark: z.object({ pct: pct(), seconds: secs() }).optional(),
    /** Every Nth weapon hit chains to up to `targets` other enemies within `radius` of the one struck, `damage` each (Tesla Rounds). */
    chain: z.object({ every: z.number().int().min(1), targets: z.number().int().min(1), damage: positive(), radius: positive() }).optional(),
  }),
  /** Heal healPct of max HP when an enemy minion dies within radius (Scavenger). */
  z.object({ type: z.literal('onNearbyMinionDeath'), radius: positive(), healPct: pct() }),
  /** Dropping below belowPct HP grants a shield of shieldPct max HP for seconds, then waits cooldownSeconds (Second Wind). */
  z.object({ type: z.literal('onLowHp'), belowPct: pct(), shieldPct: pct(), seconds: secs(), cooldownSeconds: secs() }),
  /** + pct to a stat while within radius of a standing allied structure or on a trench floor (Dug In). */
  z.object({ type: z.literal('conditionalStat'), stat: StatName, pct: pct(), when: z.literal('nearStructureOrTrench'), radius: positive() }),
  /** + pct to a stat for seconds after taking down an enemy champion (Adrenaline). */
  z.object({ type: z.literal('onKill'), stat: StatName, pct: pct(), seconds: secs() }),
  /** A cone weapon leaves burning ground (radius) every everySeconds while firing, dps for seconds (Napalm Tank). */
  z.object({ type: z.literal('flameGround'), dps: positive(), seconds: secs(), radius: positive(), everySeconds: secs().refine((t) => t >= 1, 'at least one tick') }),
  /**
   * Ultimate changes: grenade bomblets round the impact; aura radius and duration; `charges`
   * stored (Overcharge); `bombs` falling in a line across the cast target, `spacing` apart, on
   * every cast (Airstrike Beacon).
   */
  z.object({
    type: z.literal('ultMod'),
    bomblets: z.object({ count: z.number().int().min(1), damage: positive(), radius: positive(), spread: nonneg() }).optional(),
    radiusPct: pct().default(0),
    extraSeconds: secs().default(0),
    charges: z.number().int().min(1).default(1),
    bombs: z.object({ count: z.number().int().min(1), damage: positive(), radius: positive(), spacing: nonneg(), flightSeconds: secs().refine((t) => t >= 1, 'at least one tick') }).optional(),
  }),
  /** Every `everySeconds` while it has a living auto-target, a shell lobbed onto the target's spot (Mortar Support). */
  z.object({ type: z.literal('periodic'), everySeconds: secs().refine((t) => t >= 1, 'at least one tick'), damage: positive(), radius: positive(), flightSeconds: secs().refine((t) => t >= 1, 'at least one tick') }),
  /** While moving, a mine every `everySeconds` (at most `max` out; the oldest goes); it arms after `armSeconds` and bursts when an enemy comes within `trigger` (Minefield). */
  z.object({
    type: z.literal('whileMoving'),
    everySeconds: secs().refine((t) => t >= 1, 'at least one tick'),
    damage: positive(),
    radius: positive(),
    max: z.number().int().min(1),
    armSeconds: secs(),
    trigger: positive(),
  }),
  /** Once per life, a lethal hit leaves 1 HP and `combat.damage.lethalSaveSeconds` of invulnerability (Last Stand). */
  z.object({ type: z.literal('oncePerLife') }),
  /**
   * A companion. `drone`: circles at `orbit` and fires a bullet for `damagePct` of each trigger
   * pull at the owner's target (Attack Drone). `dog`: a unit that bites the owner's target within
   * `leash` of the owner and comes back `respawnSeconds` after dying (War Dog).
   */
  z.object({
    type: z.literal('summon'),
    drone: z.object({ damagePct: pct(), orbit: positive() }).optional(),
    dog: z.object({
      maxHp: positive(),
      radius: positive(),
      moveSpeed: positive(),
      bite: positive(),
      biteSeconds: secs().refine((t) => t >= 1, 'at least one tick'),
      reach: positive(),
      leash: positive(),
      respawnSeconds: secs(),
    }).optional(),
  }),
]);

const Rarity = z.enum(['common', 'rare', 'epic']);

const Power = z.object({
  id: z.string(),
  name: z.string(),
  rarity: Rarity,
  /** 'all', or a champion id for signature powers. */
  pool: z.string(),
  /** For the recommendation (tag overlap with owned powers) and bot drafting. */
  tags: z.array(z.string()),
  /** One line of card copy. */
  text: z.string(),
  effects: z.array(Effect).min(1),
  /** Weapon kinds it may be offered to (Ricochet and Piercing Rounds: bullets only, D-064); any if left out. */
  weapons: z.array(z.enum(['bullet', 'flak', 'cone', 'rocket'])).optional(),
});

/** The power catalogue and draft rules (GDD §8, TDD §6.10). */
const Powers = z.object({
  draft: z.object({
    cards: z.number().int().min(1),
    /** An unanswered offer takes the recommended card after this long. */
    autoPickSeconds: secs().refine((t) => t >= 1, 'at least one tick'),
    /** Offers waiting behind the live one; one more auto-picks the oldest. */
    maxQueued: z.number().int().min(0),
    /** An offer every this many levels gained (2 = levels 3, 5, 7 …) (D-051). */
    levelsPerOffer: z.number().int().min(1).default(1),
    stackCaps: z.object({ common: z.number().int().min(1), rare: z.number().int().min(1), epic: z.number().int().min(1) }),
    /** Each card's rarity roll (GDD §8 rule 4); with none of a rarity left, the card falls back a tier. */
    rarityOdds: z.object({ common: pct(), rare: pct(), epic: pct() }),
    /** Level-ups whose offer has a guaranteed Epic in its first slot, "Field Promotion" (GDD §8 rule 4). */
    guaranteedEpicLevels: z.array(z.number().int().min(2)).default([]),
    /** Free rerolls of the live offer per match (GDD §8 rule 6). */
    rerolls: z.number().int().min(0).default(0),
  }),
  powers: z.array(Power).min(1),
});

const range = () => z.tuple([z.number(), z.number()]).refine(([a, b]) => a <= b, 'min must not exceed max');
const pctRange = () => z.tuple([pct(), pct()]).refine(([a, b]) => a <= b, 'min must not exceed max');
const secsRange = () => z.tuple([z.number().nonnegative(), z.number().nonnegative()]).refine(([a, b]) => a <= b, 'min must not exceed max');

/**
 * The lane bot (TDD §7; bot v2, D-043): utility modes over a lane read, a personality rolled
 * per match from these ranges, and a confidence that shifts with kills and deaths.
 */
const Bots = z.object({
  /** How often it re-scores its modes. */
  decisionSeconds: secs().refine((t) => t >= 1, 'at least one tick'),
  /** Added to the current mode's desire while its patience lasts (hysteresis). */
  commitBonus: z.number().nonnegative(),
  /** Considers fighting an enemy champion this close (m). */
  tradeRange: positive(),
  /** Keeps this much further out than an enemy structure's range when it may not go in (m). */
  towerMargin: z.number().nonnegative(),
  personality: z.object({
    /** Weights trading, all-ins and pushing. */
    aggression: range(),
    /** Accepts worse fights and near-certain tower dives. */
    riskTolerance: range(),
    retreatHpPct: pctRange(),
    returnHpPct: pctRange(),
    /** Preferred share of its weapon range to fight at. */
    spacingPct: pctRange(),
    /** Sideways weave while fighting (m), and its period. */
    weaveAmplitude: range(),
    weavePeriodSeconds: range(),
    /** How long it commits to a mode once chosen. */
    patienceSeconds: secsRange(),
  }),
  /** A mood that rises with success and falls with failure, decaying back to 0. */
  confidence: z.object({
    kill: z.number(),
    death: z.number(),
    towerDamagePer1000: z.number(),
    halfLifeSeconds: positive(),
    min: z.number(),
    max: z.number(),
  }),
  /** Now and then it stops briefly, like a human hesitating. */
  hesitation: z.object({ chance: z.number().min(0).max(1), minSeconds: z.number().nonnegative(), maxSeconds: z.number().nonnegative() }),
  lane: z.object({
    /** Minions this close to the clash count towards wave advantage (m). */
    clashWindow: positive(),
    /** How far ahead of its own wave it may contest or push (m). */
    aheadOfWave: z.number().nonnegative(),
    /** Holds this far in front of its own Sub-base with no wave (m). */
    holdAhead: z.number().nonnegative(),
    /** Enemy minions this close would turn on it for hitting their champion (GDD §5 call for help). */
    callForHelpRadius: positive(),
    /** Goes all in when it can kill the enemy champion within this long and faster than it dies (s). */
    allInSeconds: positive(),
    /** Minions further than this from the branch it walks are on the other Crater branch: out of reach, not read (m). */
    branchReach: positive(),
    /** An enemy champion further than this isn't contesting the lane: being behind doesn't matter, and a nearer knocked-out one is read instead (m). */
    threatRadius: positive(),
  }),
  /** Casts on a minion target only with this many enemy minions within `clusterRadius` of it. */
  ult: z.object({ minionCluster: z.number().int().min(1), clusterRadius: positive() }),
  /**
   * Camp farming in pairs (D-075): two free bots of a team take a camp together, from the
   * start and whenever their lanes are quiet.
   */
  farm: z.object({
    /** The farm mode's desire while in a pair (lane modes score 0.4–1). */
    desire: z.number().nonnegative(),
    /** Free to farm only at this much HP or more. */
    minHpPct: pct(),
    /** Each walks at most this far to a camp (m). */
    maxTravel: positive(),
    /** A camp in the enemy half counts this much further away (m). */
    enemyHalfPenalty: z.number().nonnegative(),
    /** Skips a camp with a visible enemy champion this close to it (m). */
    contestRadius: positive(),
    /** Waits out of range until its partner is this close to the camp too (m, compared with its own distance). */
    gatherSlack: z.number().nonnegative(),
    /** Gives up after this long, and stays in lane this long after a farm. */
    maxSeconds: secs(),
    cooldownSeconds: secs(),
    /** A partner that stops farming for this long ends the pair; alone it finishes a camp below `finishHpPct`. */
    staleSeconds: secs(),
    finishHpPct: pct(),
    /** Off its lane by more than this, a bot walks back to it through the trenches (m). */
    offLane: positive(),
    /** Champion clearance from walls on the navigation grid (m). */
    clearance: positive(),
    /** Bots path round each mini-boss (D-079): every step within this distance of one costs `bossAvoidCost` more (straight step = 2). */
    bossAvoidRadius: nonneg().default(0),
    bossAvoidCost: nonneg().default(0),
  }),
});

/** Minion waves (GDD §5, TDD §6.6). */
const Waves = z.object({
  enabled: z.boolean(),
  firstSeconds: secs(),
  intervalSeconds: secs().refine((t) => t >= 1, 'interval must be at least one tick'),
  soldiers: z.number().int().min(0),
  /** Gap between soldiers in a row spawned all at once (the debug wave and tests) (m). */
  spacing: z.number().nonnegative(),
  /** A match wave leaves its cave single file, one soldier per lane this often (D-051). */
  spawnGapSeconds: secs().refine((t) => t >= 1, 'gap must be at least one tick'),
  /** Soldiers spawn with this much more HP and damage per minute of match time (GDD §5 +6%/min; D-051). */
  scalePctPerMinute: pct(),
  /** Shock Troops (GDD §5; D-051, D-054): in a lane whose enemy Sub-base has fallen, a team's waves are Shock Troopers plus a tank every wave, all with this HP and damage multiplier. */
  shockTroopsMult: z.number().min(1),
  /** Extra Shock Troopers per wave in such a lane (GDD §5: 1). */
  shockExtraSoldiers: z.number().int().min(0).default(0),
  /** Every Nth wave also brings a Bazooka Tank at the back of the line (GDD §5; D-053); 0 = none. */
  tankEveryNthWave: z.number().int().min(0).default(0),
  /** Lane ids (from `map.lanes`) that get waves. */
  lanes: z.array(z.string()),
});


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
  /** Trench concealment (GDD §4, TDD §6.9): a unit in a Trench is hidden from enemies outside its zone, except within `revealRadius` or for `revealSeconds` after it fires or casts. */
  trench: z.object({ revealRadius: nonneg(), revealSeconds: secs() }),
  /** Medkit crates (GDD §4): a champion below max HP within `pickupRadius` takes one and heals `healPct` of max HP; it comes back after `respawnSeconds`. */
  medkit: z.object({ healPct: pct(), respawnSeconds: secs(), pickupRadius: positive() }),
  /**
   * Fog of war (D-010): each team sees the cells within its units' and standing structures'
   * `radius` that raised ground doesn't hide, on a `cellSize` grid rebuilt every `updateSeconds`.
   * Off: everyone sees everything (Trench concealment still applies). `darkPct`: how much
   * darker fogged ground is drawn (render only).
   */
  fog: z.object({
    enabled: z.boolean(),
    cellSize: positive(),
    updateSeconds: secs().refine((t) => t >= 1, 'at least one tick'),
    radius: z.object({ champion: nonneg(), minion: nonneg(), subBase: nonneg(), hq: nonneg() }),
    darkPct: pct(),
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
  neutrals: Neutrals,
  waves: Waves,
  progression: Progression,
  powers: Powers,
  bots: Bots,
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
export type CampKind = keyof Config['neutrals']['camps'];
export type Footprint = z.output<typeof Footprint>;
export type ChampionConfig = Config['champions'][number];
export type FragGrenadeConfig = z.output<typeof FragGrenade>;
export type LeadStormConfig = z.output<typeof LeadStorm>;
export type HeatWaveConfig = z.output<typeof HeatWave>;
export type Vec2 = z.output<typeof vec>;
export type WeaponConfig = z.output<typeof Weapon>;
export type UltTargetClass = z.output<typeof UltTargetClass>;
export type PowerDef = z.output<typeof Power>;
export type EffectDef = z.output<typeof Effect>;
export type StatName = z.output<typeof StatName>;
