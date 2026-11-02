import * as THREE from 'three';
import { floorHeight, rasterise, signedDistance } from '../data/map-geometry';
import type { MapConfig, SurfaceKind } from '../data/schema';
import { palette } from './palette';

const surfaceColour: Record<SurfaceKind, number> = {
  dirt: palette.laneDirt,
  grass: palette.grass,
  trench: palette.trenchFloor,
  arena: palette.arenaFloor,
  crater: palette.craterFloor,
};

/** Height of the raised embankment along the map edge, and how far in it starts rising. */
const EDGE_HEIGHT = 2.2;
const EDGE_RISE = 4;
/** Horizontal run (m) of the slope from a walkable edge up to the jungle. */
const WALL_SLOPE = 0.6;
/** Corners within this many cells of a walkable/blocked change get exact edge heights. */
const EDGE_BAND = 2;

/**
 * Faceted heightfield over the whole map, one vertex per grid corner (D-018: heights are
 * render-only). Walkable cells sit at their shape's floor height; blocked cells are raised
 * jungle ground. Each cell is two flat-coloured triangles, so the walkable edge is exactly
 * where the sim's grid blocks movement.
 */
export interface Terrain {
  mesh: THREE.Mesh;
  /** Ground height (m) at sim (x, y), bilinear between grid corners; for placing units on the floor. */
  heightAt(x: number, y: number): number;
}

export function buildTerrain(map: MapConfig): Terrain {
  const { minX, minY, cell, cols, rows, owner, samples } = rasterise(map);
  const { bounds } = map;
  const shapes = map.walkable;
  const vcols = cols + 1;

  // Corner heights. Away from any edge a corner is either floor (the last-painted cell
  // touching it, so lanes stay flat where ramps meet them) or raised jungle. Near an edge the
  // height follows the shapes' true signed distance, so walls trace the curves instead of
  // the 0.5 m grid's staircase.
  const heights = new Float32Array(vcols * (rows + 1));
  const floorOf = new Int16Array(vcols * (rows + 1)).fill(-1); // shape whose floor a corner sits on, or -1
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = minX + i * cell;
      const y = minY + j * cell;
      let last = -1;
      let open = false;
      let shut = false;
      for (let r = j - EDGE_BAND; r < j + EDGE_BAND; r++) {
        for (let c = i - EDGE_BAND; c < i + EDGE_BAND; c++) {
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          const o = owner[r * cols + c]!;
          if (o < 0) shut = true;
          else open = true;
          if (o >= 0 && r >= j - 1 && r <= j && c >= i - 1 && c <= i) last = Math.max(last, o);
        }
      }
      let h: number;
      let on = last;
      if (open && shut) {
        // Edge band: last-painted shape containing the corner, else the nearest one.
        let inside = -1;
        let nearest = -1;
        let nearestD = Infinity;
        shapes.forEach((s, k) => {
          const d = signedDistance(s, samples[k]!, x, y);
          if (d <= 0) inside = k;
          if (d < nearestD) {
            nearestD = d;
            nearest = k;
          }
        });
        on = inside >= 0 ? inside : -1;
        const k = inside >= 0 ? inside : nearest;
        const floor = floorHeight(shapes[k]!, samples[k]!, x, y);
        const t = inside >= 0 ? 0 : smoothstep(nearestD / WALL_SLOPE);
        h = floor + (jungleHeight(x, y, bounds) - floor) * t;
      } else {
        h = last >= 0 ? floorHeight(shapes[last]!, samples[last]!, x, y) : jungleHeight(x, y, bounds);
      }
      heights[j * vcols + i] = h;
      floorOf[j * vcols + i] = on;
    }
  }

  const positions = new Float32Array(cols * rows * 18);
  const colours = new Float32Array(cols * rows * 18);
  const jungle = new THREE.Color(palette.jungle);
  const surfaces = shapes.map((s) => new THREE.Color(surfaceColour[s.surface]));
  let p = 0;
  // One triangle: floor-coloured only if all three corners sit on a floor, else jungle.
  const emit = (a: number, b: number, c: number, cellOwner: number) => {
    const fa = floorOf[a]!;
    const onFloor = fa >= 0 && floorOf[b]! >= 0 && floorOf[c]! >= 0;
    const colour = onFloor ? surfaces[cellOwner >= 0 ? cellOwner : fa]! : jungle;
    for (const v of [a, b, c]) {
      const i = v % vcols;
      const j = (v - i) / vcols;
      positions[p] = minX + i * cell;
      positions[p + 1] = heights[v]!;
      positions[p + 2] = -(minY + j * cell);
      colours[p] = colour.r;
      colours[p + 1] = colour.g;
      colours[p + 2] = colour.b;
      p += 3;
    }
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v00 = r * vcols + c;
      const v10 = v00 + 1;
      const v01 = v00 + vcols;
      const v11 = v01 + 1;
      const o = owner[r * cols + c]!;
      // Counter-clockwise seen from above (normal +y).
      emit(v00, v10, v11, o);
      emit(v00, v11, v01, o);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true;

  function heightAt(x: number, y: number): number {
    const fx = Math.min(cols - 1e-6, Math.max(0, (x - minX) / cell));
    const fy = Math.min(rows - 1e-6, Math.max(0, (y - minY) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const h = (a: number, b: number) => heights[(j + b) * vcols + i + a]!;
    return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
  }

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

/** Raised jungle ground: +0.3 to +1.4 m of gentle rolling noise, rising to the edge embankment. */
function jungleHeight(x: number, y: number, b: MapConfig['bounds']): number {
  const n = 0.5 + 0.25 * Math.sin(x * 0.35 + Math.sin(y * 0.21) * 2) + 0.25 * Math.sin(y * 0.29 + x * 0.13);
  const h = 0.3 + 1.1 * n;
  const edge = Math.min(x - b.minX, b.maxX - x, y - b.minY, b.maxY - y);
  if (edge >= EDGE_RISE) return h;
  const t = 1 - Math.max(0, edge) / EDGE_RISE;
  return h + (EDGE_HEIGHT - h) * t;
}

function smoothstep(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}
