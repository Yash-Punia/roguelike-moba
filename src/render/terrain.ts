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
  /** The terrain as square tiles (one mesh each), so the camera and shadow passes skip what is off screen (D-044). */
  mesh: THREE.Group;
  /** Ground height (m) at sim (x, y), for standing units on the floor. */
  heightAt(x: number, y: number): number;
}

/** Terrain tile size (m): about a screen width, so a frame draws ~9–12 tiles. */
export const TERRAIN_TILE = 12;

const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
patchFog(terrainMaterial); // fogged ground is drawn darker (D-010)

/**
 * Faceted terrain (D-018 heights are render-only; D-026 contour-cut edges), split into
 * `TERRAIN_TILE` square tiles by triangle centroid. Triangles are unchanged, only regrouped,
 * so tiles meet without seams. `dressing` adds map props to the same tiles, so they cost no draw
 * calls of their own (D-097).
 */
export function buildTerrain(map: MapConfig, dressing?: (heightAt: Terrain['heightAt']) => DressingTris): Terrain {
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
  for (const tile of [...buffers.keys()].sort((a, b) => a - b)) {
    const b = buffers.get(tile)!;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(b.colours, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, terrainMaterial);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = `terrain-tile-${tile}`;
    group.add(mesh);
  }
  return { mesh: group, heightAt };
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
