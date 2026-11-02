import * as THREE from 'three';
import type { MapConfig, SurfaceKind } from '../data/schema';
import { palette } from './palette';
import { buildTerrainGeometry, EDGE_HEIGHT, TAG_SLOPE } from './terrain-mesh';

const surfaceColour: Record<SurfaceKind, number> = {
  dirt: palette.laneDirt,
  grass: palette.grass,
  trench: palette.trenchFloor,
  arena: palette.arenaFloor,
  crater: palette.craterFloor,
};

/** Exposed earth banks between floors and the raised jungle. */
const slopeColour = palette.mud;

export interface Terrain {
  mesh: THREE.Mesh;
  /** Ground height (m) at sim (x, y), for standing units on the floor. */
  heightAt(x: number, y: number): number;
}

/** Faceted terrain mesh (D-018 heights are render-only; D-026 contour-cut edges). */
export function buildTerrain(map: MapConfig): Terrain {
  const { triangles, tags, heightAt } = buildTerrainGeometry(map);
  const count = tags.length * 3;
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const surfaces = map.walkable.map((s) => new THREE.Color(surfaceColour[s.surface]));
  const top = new THREE.Color(palette.jungle);
  const slope = new THREE.Color(slopeColour);
  for (let t = 0; t < tags.length; t++) {
    const tag = tags[t]!;
    const colour = tag >= 0 ? surfaces[tag]! : tag === TAG_SLOPE ? slope : top;
    for (let v = t * 3; v < t * 3 + 3; v++) {
      // Sim (x, y, height) → world (x, height, −y).
      positions[v * 3] = triangles[v * 3]!;
      positions[v * 3 + 1] = triangles[v * 3 + 2]!;
      positions[v * 3 + 2] = -triangles[v * 3 + 1]!;
      colours[v * 3] = colour.r;
      colours[v * 3 + 1] = colour.g;
      colours[v * 3 + 2] = colour.b;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, heightAt };
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
