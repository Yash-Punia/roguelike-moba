import type { Config, MapConfig } from '../../data/schema';
import type { Entity, Store } from '../ecs';
import { GROUND, zoneAt, type ObstacleGrid } from '../grid';
import { cos, sin } from '../math';
import { Kind, type Champion, type Concealment, type Health, type Team, type Transform, type Weapon } from '../sim';

export interface VisibilityContext {
  concealments: Store<Concealment>;
  transforms: Store<Transform>;
  teams: Store<Team>;
  healths: Store<Health>;
  weapons: Store<Weapon>;
  champions: Store<Champion>;
  kinds: Store<Kind>;
  grid: () => ObstacleGrid;
  vision: Vision;
}

/** Bit mask seen by every team. */
export const SEEN_BY_ALL = 0xff;

/** Each team's fog of war grid (D-010): 1 where the team sees the cell. Blue's is `teams[0]`, Red's `teams[1]`. */
export interface Vision {
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  teams: Uint8Array[];
  /** Cells that block sight (mostly raised ground), built from `blockFrom` on first use. */
  block: Uint8Array | undefined;
  blockFrom: ObstacleGrid | undefined;
  /** What a source sees from each cell, per radius: key `radius × cells + cell` → cell indices. The map is static, so each is cast once. */
  views: Map<number, Uint16Array>;
}

export function createVision(map: MapConfig, cell: number): Vision {
  const { minX, minY, maxX, maxY } = map.bounds;
  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxY - minY) / cell);
  return { minX, minY, cell, cols, rows, teams: [new Uint8Array(cols * rows), new Uint8Array(cols * rows)], block: undefined, blockFrom: undefined, views: new Map() };
}

/** Does `team`'s vision cover (x, y)? Outside the grid: no. */
export function inVision(v: Vision, team: Team, x: number, y: number): boolean {
  const col = Math.floor((x - v.minX) / v.cell);
  const row = Math.floor((y - v.minY) / v.cell);
  if (col < 0 || row < 0 || col >= v.cols || row >= v.rows || team > 1) return false;
  return v.teams[team]![row * v.cols + col] === 1;
}

/** A vision cell blocks sight when at least half the obstacle-grid cells centred in it are raised ground (sandbags don't count). */
function sightBlock(v: Vision, g: ObstacleGrid): Uint8Array {
  const block = new Uint8Array(v.cols * v.rows);
  const ground = new Uint16Array(v.cols * v.rows);
  const total = new Uint16Array(v.cols * v.rows);
  for (let r = 0; r < g.rows; r++) {
    const row = Math.floor((g.minY + (r + 0.5) * g.cell - v.minY) / v.cell);
    if (row < 0 || row >= v.rows) continue;
    for (let c = 0; c < g.cols; c++) {
      const col = Math.floor((g.minX + (c + 0.5) * g.cell - v.minX) / v.cell);
      if (col < 0 || col >= v.cols) continue;
      const k = row * v.cols + col;
      total[k]!++;
      if ((g.shotBlocked[r * g.cols + c]! & GROUND) !== 0) ground[k]!++;
    }
  }
  for (let k = 0; k < block.length; k++) block[k] = total[k]! > 0 && ground[k]! * 2 >= total[k]! ? 1 : 0;
  return block;
}

/** Unit ray directions [dx0, dy0, …] for `n` rays round a circle, built once per count. */
const directions = new Map<number, Float64Array>();
function rayDirections(n: number): Float64Array {
  let d = directions.get(n);
  if (!d) {
    d = new Float64Array(n * 2);
    for (let k = 0; k < n; k++) {
      d[k * 2] = cos((k / n) * 2 * Math.PI);
      d[k * 2 + 1] = sin((k / n) * 2 * Math.PI);
    }
    directions.set(n, d);
  }
  return d;
}

/** Walks one ray out from (sx, sy) for `r` m, marking every cell it crosses; it stops after the first sight-blocking cell past its own (bank edges are seen). */
function castRay(v: Vision, seen: Uint8Array, block: Uint8Array, sx: number, sy: number, dx: number, dy: number, r: number) {
  const fx = (sx - v.minX) / v.cell;
  const fy = (sy - v.minY) / v.cell;
  let col = Math.floor(fx);
  let row = Math.floor(fy);
  const stepC = dx > 0 ? 1 : -1;
  const stepR = dy > 0 ? 1 : -1;
  // Distances (m) along the ray to the next column and row boundary, and between boundaries.
  const tdx = dx !== 0 ? v.cell / Math.abs(dx) : Infinity;
  const tdy = dy !== 0 ? v.cell / Math.abs(dy) : Infinity;
  let tx = dx !== 0 ? (dx > 0 ? col + 1 - fx : fx - col) * tdx : Infinity;
  let ty = dy !== 0 ? (dy > 0 ? row + 1 - fy : fy - row) * tdy : Infinity;
  let t = 0;
  while (t <= r && col >= 0 && row >= 0 && col < v.cols && row < v.rows) {
    const k = row * v.cols + col;
    seen[k] = 1;
    if (block[k] && t > 0) return;
    if (tx < ty) {
      t = tx;
      tx += tdx;
      col += stepC;
    } else {
      t = ty;
      ty += tdy;
      row += stepR;
    }
  }
}

const marks: number[] = [];
let scratch = new Uint8Array(0);

/**
 * The cells a source of radius `r` sees from the centre of vision cell `at`: rays round the
 * circle, about two-thirds of a cell apart at the rim, stopped by raised ground (sandbags don't).
 * ponytail: views are cached per (cell, radius) for the whole match, a few MB at most on The Front; a smaller cache or shadowcasting if memory ever matters.
 */
function viewFrom(v: Vision, at: number, r: number): Uint16Array {
  const key = r * v.cols * v.rows + at;
  let view = v.views.get(key);
  if (view) return view;
  if (scratch.length !== v.cols * v.rows) scratch = new Uint8Array(v.cols * v.rows);
  const sx = v.minX + ((at % v.cols) + 0.5) * v.cell;
  const sy = v.minY + (Math.floor(at / v.cols) + 0.5) * v.cell;
  const n = Math.max(8, Math.ceil((3 * Math.PI * r) / v.cell));
  const dirs = rayDirections(n);
  for (let k = 0; k < n; k++) castRay(v, scratch, v.block!, sx, sy, dirs[k * 2]!, dirs[k * 2 + 1]!, r);
  marks.length = 0;
  for (let k = 0; k < scratch.length; k++) {
    if (!scratch[k]) continue;
    marks.push(k);
    scratch[k] = 0;
  }
  view = Uint16Array.from(marks);
  v.views.set(key, view);
  return view;
}

/** Rebuilds both teams' vision from every living unit's and standing structure's view (see `viewFrom`). Fog off: everything is seen. */
function updateVision(ctx: VisibilityContext, fog: Config['combat']['fog']) {
  const v = ctx.vision;
  const blue = v.teams[0]!;
  const red = v.teams[1]!;
  if (!fog.enabled) {
    blue.fill(1);
    red.fill(1);
    return;
  }
  blue.fill(0);
  red.fill(0);
  const grid = ctx.grid();
  if (v.blockFrom !== grid) {
    v.block = sightBlock(v, grid);
    v.blockFrom = grid;
    v.views.clear();
  }
  const { kinds, healths, transforms, teams } = ctx;
  for (let i = 0; i < kinds.ids.length; i++) {
    const e = kinds.ids[i]!;
    const team = teams.get(e);
    const h = healths.get(e);
    if (team === undefined || team > 1 || !h || h.hp <= 0) continue;
    const kind = kinds.data[i]!;
    const r = kind === Kind.Champion ? fog.radius.champion : kind === Kind.Minion ? fog.radius.minion : kind === Kind.HQ ? fog.radius.hq : fog.radius.subBase;
    const t = transforms.get(e)!;
    const col = Math.floor((t.x - v.minX) / v.cell);
    const row = Math.floor((t.y - v.minY) / v.cell);
    if (r <= 0 || col < 0 || row < 0 || col >= v.cols || row >= v.rows) continue;
    const view = viewFrom(v, row * v.cols + col, r);
    const seen = v.teams[team]!;
    for (let k = 0; k < view.length; k++) seen[view[k]!] = 1;
  }
}

/**
 * Fog of war and Trench concealment (D-010, GDD §4, TDD §6.9), after movement and before any
 * targeting. Every `updateSeconds` each team's vision grid is rebuilt. A unit is seen by its own
 * team, and by an enemy team only where that team's vision covers it. On a trench floor it is
 * also hidden inside that vision unless an enemy unit is in the same Trench zone or within
 * `revealRadius`, or it fired, cast an Ultimate (or is channelling one) within the last
 * `revealSeconds` (brush on top of fog). Units without a `Concealment` (structures) are always seen.
 * ponytail: O(hidden × units) scan for same-zone and nearby enemies; fine at ~100 units, use the spatial grid if it shows in profiles.
 */
export function visibilitySystem(ctx: VisibilityContext, cfg: Config['combat']['trench'], fog: Config['combat']['fog'], tick: number) {
  const { concealments, transforms, teams, healths, weapons, champions, vision } = ctx;
  if (tick % fog.updateSeconds === 0) updateVision(ctx, fog);
  const grid = ctx.grid();
  const ids = concealments.ids;
  for (let i = 0; i < ids.length; i++) {
    const t = transforms.get(ids[i]!)!;
    concealments.data[i]!.zone = zoneAt(grid, t.x, t.y);
  }
  const rSq = cfg.revealRadius * cfg.revealRadius;
  for (let i = 0; i < ids.length; i++) {
    const e = ids[i]!;
    const cn = concealments.data[i]!;
    const team = teams.get(e)!;
    const t = transforms.get(e)!;
    // Teams whose vision covers it (its own always does).
    const inSight = (1 << team) | (inVision(vision, 0, t.x, t.y) ? 1 : 0) | (inVision(vision, 1, t.x, t.y) ? 2 : 0);
    const w = weapons.get(e);
    const c = champions.get(e);
    const revealed =
      (w !== undefined && w.lastShotTick >= 0 && tick - w.lastShotTick <= cfg.revealSeconds) ||
      (c !== undefined && (c.channelTicks > 0 || (c.lastCastTick >= 0 && tick - c.lastCastTick <= cfg.revealSeconds)));
    if (cn.zone === 0 || revealed) {
      cn.visible = inSight;
      continue;
    }
    let brush = 1 << team;
    for (let k = 0; k < ids.length; k++) {
      const o = ids[k]!;
      const ot = teams.get(o)!;
      if (ot === team || healths.get(o)!.hp <= 0) continue;
      const tt = transforms.get(o)!;
      const dx = tt.x - t.x;
      const dy = tt.y - t.y;
      if (concealments.data[k]!.zone === cn.zone || dx * dx + dy * dy <= rSq) brush |= 1 << ot;
    }
    cn.visible = brush & inSight;
  }
}

/** Can `team` see `e`? (Targeting, structures, minions, Ultimates and traits all ask this.) */
export function visibleTo(concealments: Store<Concealment>, e: Entity, team: Team): boolean {
  const cn = concealments.get(e);
  return !cn || (cn.visible & (1 << team)) !== 0;
}
