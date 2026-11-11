import * as THREE from 'three';
import type { MapConfig, SurfaceKind } from '../data/schema';
import type { DressingTris } from './dressing';
import { patchFog } from './fog';
import { palette } from './palette';
import { buildTerrainGeometry, EDGE_HEIGHT, TAG_SLOPE } from './terrain-mesh';

const surfaceColour: Record<SurfaceKind, number> = {
  dirt: palette.laneDirt,
  grass: palette.grass,
  trench: palette.trenchFloor,
  arena: palette.arenaFloor,
  crater: palette.craterFloor,
  river: palette.river,
  ford: palette.fordStones,
  bridge: palette.wood,
  gravel: palette.gravel,
};

/** Exposed earth banks between floors and the raised jungle. */
const slopeColour = palette.mud;

export interface Terrain {
  /** The terrain as square tiles (one mesh each), so the camera pass skips what is off screen (D-044). They cast no shadow themselves. */
  mesh: THREE.Group;
  /**
   * Shadow-only copies of the terrain in `CASTER_CHUNK` squares, on `SHADOW_LAYER` (D-105): only the
   * triangles facing away from the sun, the only ones a front-side material's shadow pass draws.
   */
  casters: THREE.Group;
  /** Ground height (m) at sim (x, y), for standing units on the floor. */
  heightAt(x: number, y: number): number;
}

/** Terrain tile size (m): about a screen width, so a frame draws ~9–12 tiles. */
export const TERRAIN_TILE = 12;
/** Shadow caster chunk size (m): a few cover the fitted shadow box (D-099), so the shadow pass draws a few, not ~30 tiles. */
export const CASTER_CHUNK = 36;
/** Objects only the sun's shadow camera renders (the main camera sees layer 0 only). */
export const SHADOW_LAYER = 1;
const casterMaterial = new THREE.MeshBasicMaterial(); // front side, like the terrain: its shadow pass draws back faces

const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
patchFog(terrainMaterial); // fogged ground is drawn darker (D-010)

/**
 * Faceted terrain (D-018 heights are render-only; D-026 contour-cut edges), split into
 * `TERRAIN_TILE` square tiles by triangle centroid. Triangles are unchanged, only regrouped,
 * so tiles meet without seams. `dressing` adds map props to the same tiles, so they cost no draw
 * calls of their own (D-097).
 */
export function buildTerrain(map: MapConfig, dressing?: (heightAt: Terrain['heightAt']) => DressingTris, toSun = DEFAULT_SUN): Terrain {
  const { triangles, tags, heightAt } = buildTerrainGeometry(map);
  const surfaces = map.walkable.map((s) => new THREE.Color(surfaceColour[s.surface]));
  const top = new THREE.Color(palette.jungle);
  const slope = new THREE.Color(slopeColour);
  const { minX, minY, maxX } = map.bounds;
  const cols = Math.max(1, Math.ceil((maxX - minX) / TERRAIN_TILE));
  const tileAt = (cx: number, cy: number) => Math.max(0, Math.floor((cy - minY) / TERRAIN_TILE)) * cols + Math.min(cols - 1, Math.max(0, Math.floor((cx - minX) / TERRAIN_TILE)));
  const tileOf = (t: number) => {
    const cx = (triangles[t * 9]! + triangles[t * 9 + 3]! + triangles[t * 9 + 6]!) / 3;
    const cy = (triangles[t * 9 + 1]! + triangles[t * 9 + 4]! + triangles[t * 9 + 7]!) / 3;
    return tileAt(cx, cy);
  };
  const extra = dressing?.(heightAt);
  // Dressing is already in world space: x, height, −y.
  const extraCount = extra ? extra.positions.length / 9 : 0;
  const extraTile = (t: number) => {
    const p = extra!.positions;
    return tileAt((p[t * 9]! + p[t * 9 + 3]! + p[t * 9 + 6]!) / 3, -(p[t * 9 + 2]! + p[t * 9 + 5]! + p[t * 9 + 8]!) / 3);
  };
  // Count triangles per tile, then fill each tile's buffers.
  const counts = new Map<number, number>();
  for (let t = 0; t < tags.length; t++) counts.set(tileOf(t), (counts.get(tileOf(t)) ?? 0) + 1);
  for (let t = 0; t < extraCount; t++) counts.set(extraTile(t), (counts.get(extraTile(t)) ?? 0) + 1);
  const buffers = new Map<number, { positions: Float32Array; colours: Float32Array; used: number }>();
  for (const [tile, n] of counts) buffers.set(tile, { positions: new Float32Array(n * 9), colours: new Float32Array(n * 9), used: 0 });
  for (let t = 0; t < tags.length; t++) {
    const tag = tags[t]!;
    const colour = tag >= 0 ? surfaces[tag]! : tag === TAG_SLOPE ? slope : top;
    const b = buffers.get(tileOf(t))!;
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      const o = b.used * 3;
      // Sim (x, y, height) → world (x, height, −y).
      b.positions[o] = triangles[v * 3]!;
      b.positions[o + 1] = triangles[v * 3 + 2]!;
      b.positions[o + 2] = -triangles[v * 3 + 1]!;
      b.colours[o] = colour.r;
      b.colours[o + 1] = colour.g;
      b.colours[o + 2] = colour.b;
      b.used++;
    }
  }
  for (let t = 0; t < extraCount; t++) {
    const b = buffers.get(extraTile(t))!;
    b.positions.set(extra!.positions.subarray(t * 9, t * 9 + 9), b.used * 3);
    b.colours.set(extra!.colours.subarray(t * 9, t * 9 + 9), b.used * 3);
    b.used += 3;
  }
  const group = new THREE.Group();
  const casters = new THREE.Group();
  const chunkCols = Math.max(1, Math.ceil((maxX - minX) / CASTER_CHUNK));
  const chunks = new Map<number, number[]>();
  for (const tile of [...buffers.keys()].sort((a, b) => a - b)) {
    const b = buffers.get(tile)!;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(b.colours, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, terrainMaterial);
    mesh.receiveShadow = true;
    mesh.name = `terrain-tile-${tile}`;
    group.add(mesh);
    collectCasters(b.positions, toSun, (cx, cz) => Math.max(0, Math.floor((-cz - minY) / CASTER_CHUNK)) * chunkCols + Math.min(chunkCols - 1, Math.max(0, Math.floor((cx - minX) / CASTER_CHUNK))), chunks);
  }
  for (const [chunk, positions] of [...chunks].sort((a, b) => a[0] - b[0])) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, casterMaterial);
    mesh.castShadow = true;
    mesh.layers.set(SHADOW_LAYER);
    mesh.name = `terrain-caster-${chunk}`;
    casters.add(mesh);
  }
  return { mesh: group, casters, heightAt };
}

/** The scene's sun direction (towards the sun), as `createScene` places it. */
export const SUN_OFFSET = new THREE.Vector3(-12, 20, 8);
const DEFAULT_SUN = SUN_OFFSET.clone().normalize();

/**
 * Adds to `chunks` every triangle of world-space `positions` that faces away from the sun: a
 * front-side material's shadow pass culls the rest, so dropping them changes no shadow.
 */
function collectCasters(positions: Float32Array, toSun: THREE.Vector3, chunkOf: (x: number, z: number) => number, chunks: Map<number, number[]>) {
  for (let o = 0; o < positions.length; o += 9) {
    const ax = positions[o]!, ay = positions[o + 1]!, az = positions[o + 2]!;
    const ux = positions[o + 3]! - ax, uy = positions[o + 4]! - ay, uz = positions[o + 5]! - az;
    const vx = positions[o + 6]! - ax, vy = positions[o + 7]! - ay, vz = positions[o + 8]! - az;
    // Winding normal (u × v), as the renderer culls by.
    const facing = (uy * vz - uz * vy) * toSun.x + (uz * vx - ux * vz) * toSun.y + (ux * vy - uy * vx) * toSun.z;
    if (facing >= 0) continue;
    const chunk = chunkOf((ax + positions[o + 3]! + positions[o + 6]!) / 3, (az + positions[o + 5]! + positions[o + 8]!) / 3);
    let list = chunks.get(chunk);
    if (!list) chunks.set(chunk, (list = []));
    for (let k = 0; k < 9; k++) list.push(positions[o + k]!);
  }
}

/** Flat ground outside the map at embankment height, so the camera never sees the void at the edges. */
export function buildSurround(map: MapConfig): THREE.Mesh {
  const { minX, maxX, minY, maxY } = map.bounds;
  const pad = 120;
  const shape = new THREE.Shape([
    new THREE.Vector2(minX - pad, minY - pad),
    new THREE.Vector2(maxX + pad, minY - pad),
    new THREE.Vector2(maxX + pad, maxY + pad),
    new THREE.Vector2(minX - pad, maxY + pad),
  ]);
  shape.holes.push(
    new THREE.Path([
      new THREE.Vector2(minX, minY),
      new THREE.Vector2(minX, maxY),
      new THREE.Vector2(maxX, maxY),
      new THREE.Vector2(maxX, minY),
    ]),
  );
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // shape (x, y) → world (x, 0, −y)
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: palette.jungle }));
  mesh.position.y = EDGE_HEIGHT;
  mesh.receiveShadow = true;
  return mesh;
}
