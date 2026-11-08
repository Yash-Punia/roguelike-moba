import * as THREE from 'three';
import { rasterise } from '../data/map-geometry';
import type { MapConfig, PropKind } from '../data/schema';
import { Team } from '../sim/sim';
import { bake } from './bake';
import { mulberry32 } from '../sim/rng';
import { box, cyl, part, tankTrap, teamColour } from './models';
import { palette } from './palette';

/**
 * Map scenery (map spec "Dressing", PR-01, PR-02). Every prop is merged into the terrain's own
 * tiles, so all of it costs no draw calls beyond the ground under it (D-097). Decoration only:
 * nothing here reaches the sim (D-061).
 */

/** Ground decals: painted over the terrain, not modelled. */
type Decal = 'crater' | 'scorch';

export interface Placement {
  kind: PropKind | Decal;
  x: number;
  y: number;
  /** Sim radians: the prop's local +x points this way. Decals: radius (m), in `size`. */
  rot: number;
  team: Team;
  size?: number;
}

/** Scatter is the same every load and owes nothing to the match seed. */
const SCATTER_SEED = 0x5eed;
const CRATER_RADIUS: readonly [number, number] = [1, 2]; // map spec
const DECAL_SIDES = 8;
const DECAL_LIFT = 0.05;
/** Metres kept clear of the map edge by the scatter, for the edge ruins. */
const EDGE_CLEAR = 4;
/** Clearance from any walkable ground: past the 0.6 m slope, so props stand on the top. */
const SLOPE_CLEAR = 1.3;

/** World-space triangles to merge into the terrain, three vertices each. */
export interface DressingTris {
  positions: Float32Array;
  colours: Float32Array;
}

/** A triangular prism, apex up, running along local x. */
const prism = (radius: number, length: number) => new THREE.CylinderGeometry(radius, radius, length, 3).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);

const SAND = [palette.sandbag, palette.sandbagShadow, palette.sandbagLight] as const;

/** Sandbag rows along local z, each row a bag shorter and half a bag along (PR-01). */
function sandbags(root: THREE.Object3D, rows: number, count: number) {
  let n = 0;
  for (let row = 0; row < rows; row++) {
    const bags = count - row;
    for (let i = 0; i < bags; i++, n++) {
      const bag = part(root, box(0.36, 0.26, 0.62), SAND[n % 3]!, 0, 0.13 + row * 0.26, (i - (bags - 1) / 2) * 0.6);
      bag.rotation.y = (((n * 7) % 5) - 2) * 0.04; // ±5° so walls never look tiled
    }
  }
}

const PROPS: Record<PropKind, (root: THREE.Object3D, team: Team) => void> = {
  tent(root, team) {
    part(root, prism(1.1, 2.6), teamColour(team), 0, 0.55, 0);
    part(root, prism(0.72, 0.04), palette.gunmetal, 1.31, 0.36, 0);
    part(root, box(2.9, 0.06, 0.06), palette.wood, 0, 1.68, 0);
    for (const x of [-1.4, 1.4]) part(root, box(0.07, 1.68, 0.07), palette.wood, x, 0.84, 0);
  },
  flag(root, team) {
    part(root, cyl(0.16, 0.22, 0.18, 6), palette.concrete, 0, 0.09, 0);
    part(root, cyl(0.05, 0.05, 2.5, 5), palette.wood, 0, 1.25, 0);
    part(root, box(0.08, 0.08, 0.08), palette.brass, 0, 2.54, 0);
    part(root, box(0.7, 0.44, 0.04), teamColour(team), 0.38, 2.2, 0);
    part(root, box(0.24, 0.14, 0.05), palette.shearling, 0.38, 2.2, 0);
  },
  searchlight(root) {
    part(root, cyl(0.3, 0.42, 0.5, 6), palette.gunmetal, 0, 0.25, 0);
    const head = new THREE.Group();
    head.position.set(0, 0.82, 0);
    head.rotation.z = 0.35;
    root.add(head);
    part(head, new THREE.CylinderGeometry(0.36, 0.36, 0.52, 8).rotateZ(Math.PI / 2), palette.olive, 0, 0, 0);
    part(head, new THREE.CylinderGeometry(0.3, 0.3, 0.04, 8).rotateZ(Math.PI / 2), palette.shearling, 0.27, 0, 0); // flat bright lens, no emissive (D-097)
    part(root, box(0.1, 0.5, 0.82), palette.gunmetal, 0, 0.72, 0);
  },
  crates(root, team) {
    part(root, box(0.9, 0.72, 0.9), palette.wood, 0, 0.36, 0);
    part(root, box(0.94, 0.06, 0.94), palette.leather, 0, 0.72, 0);
    part(root, box(0.62, 0.5, 0.62), palette.greatcoat, 0.05, 1.0, -0.04).rotation.y = 0.3;
    part(root, box(0.7, 0.56, 0.7), palette.greatcoat, 0.95, 0.28, 0.3).rotation.y = -0.2;
    part(root, box(0.72, 0.12, 0.72), teamColour(team), 0.95, 0.3, 0.3).rotation.y = -0.2; // painted for its side (GDD §11)
  },
  drums(root) {
    const drum = (x: number, z: number, colour: number) => {
      part(root, cyl(0.3, 0.3, 0.86, 8), colour, x, 0.43, z);
      for (const y of [0.28, 0.58]) part(root, cyl(0.315, 0.315, 0.05, 8), palette.gunmetal, x, y, z);
    };
    drum(0, 0, palette.olive);
    drum(0.62, 0.12, palette.suitRust);
    part(root, box(0.2, 0.42, 0.36), palette.olive, 0.38, 0.21, -0.6).rotation.y = 0.2;
  },
  sandbagWall(root) {
    sandbags(root, 2, 6);
  },
  pole(root) {
    const mast = new THREE.Group();
    mast.rotation.z = 0.05;
    root.add(mast);
    part(mast, cyl(0.06, 0.09, 2.7, 5), palette.wood, 0, 1.35, 0);
    part(mast, box(0.95, 0.08, 0.08), palette.wood, 0, 2.45, 0);
    for (const x of [-0.38, 0.38]) part(mast, box(0.07, 0.12, 0.07), palette.concrete, x, 2.54, 0);
  },
  revetment(root) {
    sandbags(root, 2, 4);
  },
  wire(root) {
    for (let i = 0; i < 6; i++) part(root, new THREE.TorusGeometry(0.28, 0.025, 3, 8), palette.gunmetal, 0, 0.3, (i - 2.5) * 0.5);
    for (const z of [-1.5, 0, 1.5]) {
      for (const lean of [-0.5, 0.5]) part(root, box(0.07, 0.8, 0.07), palette.leather, 0, 0.36, z).rotation.x = lean;
    }
    part(root, box(0.03, 0.03, 3.1), palette.gunmetal, 0, 0.68, 0);
  },
  traps(root) {
    tankTrap(root, 0, 0, 0.2);
    tankTrap(root, 1, 0.5, 1.1);
    tankTrap(root, 0.25, 1.15, 2);
  },
  biplane(root) {
    const body = new THREE.Group();
    body.position.y = 0.4;
    body.rotation.z = -0.18;
    root.add(body);
    part(body, new THREE.CylinderGeometry(0.12, 0.3, 2.4, 6).rotateZ(Math.PI / 2), palette.olive, 0, 0, 0);
    part(body, new THREE.CylinderGeometry(0.32, 0.32, 0.35, 6).rotateZ(Math.PI / 2), palette.gunmetal, 1.3, 0, 0);
    part(body, box(0.06, 0.95, 0.1), palette.wood, 1.5, 0, 0).rotation.x = 0.7;
    part(body, box(0.4, 0.42, 0.05), palette.olive, -1.1, 0.26, 0);
    part(body, box(0.36, 0.04, 0.95), palette.olive, -1.1, 0.06, 0);
    part(body, box(0.8, 0.06, 3), palette.olive, 0.2, 0.62, 0).rotation.x = 0.28;
    for (const z of [-0.8, 0.8]) part(body, box(0.05, 0.6, 0.05), palette.wood, 0.2, 0.3, z);
    part(root, box(0.75, 0.06, 1.2), palette.camoNet, 0.2, 0.2, 1).rotation.x = -0.35;
    part(root, box(0.75, 0.06, 1), palette.camoNet, 0.5, 0.1, -1.1).rotation.z = 0.5;
  },
  tree(root) {
    const trunk = new THREE.Group();
    trunk.rotation.z = 0.08;
    root.add(trunk);
    part(trunk, cyl(0.09, 0.24, 2.3, 5), palette.craterFloor, 0, 1.15, 0);
    part(trunk, box(0.5, 0.09, 0.09), palette.craterFloor, 0.22, 1.5, 0).rotation.z = 0.5;
    part(trunk, box(0.42, 0.08, 0.08), palette.craterFloor, -0.18, 1.85, 0.05).rotation.z = -0.6;
  },
  stump(root) {
    part(root, cyl(0.2, 0.28, 0.42, 6), palette.craterFloor, 0, 0.21, 0);
    part(root, cyl(0.2, 0.2, 0.02, 6), palette.wood, 0, 0.43, 0);
  },
  rubble(root) {
    part(root, new THREE.IcosahedronGeometry(0.34, 0), palette.concreteShadow, 0, 0.18, 0);
    part(root, new THREE.IcosahedronGeometry(0.24, 0), palette.smoke, 0.42, 0.12, 0.15);
    part(root, new THREE.IcosahedronGeometry(0.2, 0), palette.concrete, -0.2, 0.1, 0.38);
  },
};

export const propKinds = Object.keys(PROPS) as PropKind[];

const templates = new Map<string, THREE.BufferGeometry>();

/** One baked mesh of a prop in local space, built once per kind and team. */
export function propTemplate(kind: PropKind, team: Team): THREE.BufferGeometry {
  const key = `${kind}:${team}`;
  let geo = templates.get(key);
  if (!geo) {
    const root = new THREE.Group();
    PROPS[kind](root, team);
    bake(root, [root]);
    geo = (root.getObjectByName('baked') as THREE.Mesh).geometry;
    templates.set(key, geo);
  }
  return geo;
}

/** Where every prop goes. Pure, so tests can check the rules without a renderer. */
export function planDressing(map: MapConfig): Placement[] {
  const out: Placement[] = [];
  const add = (kind: Placement['kind'], x: number, y: number, rot: number, size?: number) => {
    out.push({ kind, x, y, rot, team: Team.Blue, size });
    out.push({ kind, x: -x, y: -y, rot: rot + Math.PI, team: Team.Red, size });
  };
  const raster = rasterise(map);
  /** True where (x, y) and four points `margin` metres round it are all raised ground. */
  const raised = (x: number, y: number, margin = 0) => {
    for (const [dx, dy] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]] as const) {
      const c = Math.floor((x + dx - raster.minX) / raster.cell);
      const r = Math.floor((y + dy - raster.minY) / raster.cell);
      if (c < 0 || c >= raster.cols || r < 0 || r >= raster.rows || raster.owner[r * raster.cols + c] !== -1) return false;
    }
    return true;
  };

  for (const p of map.dressing.placed) add(p.kind, p.x, p.y, p.rot);
  // Spots already used, so generated props never land on hand-placed ones.
  const taken: { x: number; y: number; r: number }[] = map.dressing.placed.map((p) => ({ x: p.x, y: p.y, r: 2 }));
  const free = (x: number, y: number, spacing: number) => !taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + spacing);

  // Telegraph poles on the map-edge side of a lane, every third a revetment (map spec).
  const { poleLanes, poleSpacing, revetmentEvery } = map.dressing;
  for (const id of poleLanes) {
    const lane = map.walkable.findIndex((s) => s.id === id);
    const shape = map.walkable[lane];
    const pts = raster.samples[lane];
    if (shape?.shape !== 'path' || !pts) continue;
    let next = poleSpacing / 2;
    let walked = 0;
    let n = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k]!;
      const ay = pts[k + 1]!;
      const dx = pts[k + 2]! - ax;
      const dy = pts[k + 3]! - ay;
      const step = Math.hypot(dx, dy);
      const tx = dx / step;
      const ty = dy / step;
      // The normal that points away from the centre of the map.
      const side = -ty * ax > 0 ? 1 : -1;
      for (; next <= walked + step; next += poleSpacing) {
        const along = next - walked;
        const revetment = ++n % revetmentEvery === 0;
        const reach = shape.width / 2 + (revetment ? 0.9 : 1.2);
        const x = ax + tx * along - ty * side * reach;
        const y = ay + ty * along + tx * side * reach;
        if (raised(x, y, 0.4) && free(x, y, 0.5)) add(revetment ? 'revetment' : 'pole', x, y, Math.atan2(tx, -ty)); // local z runs along the lane
      }
      walked += step;
    }
  }

  // Scatter on the raised ground of the Blue half; each piece gets its twin. A piece that finds no spot is dropped.
  const d = map.dressing;
  const rng = mulberry32(SCATTER_SEED);
  const { minX, maxX, minY } = map.bounds;
  const scatter = (kind: Placement['kind'], count: number, spacing: number, yMin: number, size?: () => number) => {
    for (let i = 0; i < Math.round(count / 2); i++) {
      for (let attempt = 0; attempt < 60; attempt++) {
        const x = minX + EDGE_CLEAR + rng() * (maxX - minX - 2 * EDGE_CLEAR);
        const y = yMin + rng() * -yMin;
        if (!raised(x, y, SLOPE_CLEAR) || !free(x, y, spacing)) continue;
        taken.push({ x, y, r: spacing });
        add(kind, x, y, rng() * Math.PI * 2, size?.());
        break;
      }
    }
  };
  const band = -d.middleBandY;
  const near = minY + EDGE_CLEAR;
  scatter('wire', d.wire, 2, band);
  scatter('traps', d.traps, 1.5, band);
  scatter('scorch', d.scorch, 2, band, () => 2 + rng());
  scatter('crater', d.craters, 1.6, near, () => CRATER_RADIUS[0] + rng() * (CRATER_RADIUS[1] - CRATER_RADIUS[0]));
  scatter('tree', d.trees, 1, near);
  scatter('stump', d.stumps, 0.8, near);
  scatter('rubble', d.rubble, 0.8, near);
  return out;
}

/** A disc over the ground: every vertex sits on the terrain, or it would float and clip on the facets. */
function drapeDecal(p: Placement, heightAt: (x: number, y: number) => number, positions: Float32Array, colours: Float32Array, start: number) {
  const inner = new THREE.Color(p.kind === 'crater' ? palette.craterFloor : palette.scorched);
  const outer = new THREE.Color(p.kind === 'crater' ? palette.mud : palette.scorched);
  const r = p.size!;
  // Ragged rim, repeatable from the position.
  const rim = (i: number) => r * (0.82 + 0.3 * ((Math.abs(Math.round(p.x * 13 + p.y * 7)) + i * 5) % 7) / 7);
  const ring = (i: number, k: number) => {
    const a = p.rot + (i / DECAL_SIDES) * Math.PI * 2;
    const reach = k * rim(((i % DECAL_SIDES) + DECAL_SIDES) % DECAL_SIDES);
    return [p.x + Math.cos(a) * reach, p.y + Math.sin(a) * reach] as const;
  };
  let o = start;
  const vertex = (x: number, y: number, colour: THREE.Color) => {
    positions[o] = x;
    positions[o + 1] = heightAt(x, y) + DECAL_LIFT;
    positions[o + 2] = -y;
    colours[o] = colour.r;
    colours[o + 1] = colour.g;
    colours[o + 2] = colour.b;
    o += 3;
  };
  for (let i = 0; i < DECAL_SIDES; i++) {
    const [ax, ay] = ring(i, 0.5);
    const [bx, by] = ring(i + 1, 0.5);
    const [cx, cy] = ring(i, 1);
    const [dx, dy] = ring(i + 1, 1);
    vertex(p.x, p.y, inner); vertex(ax, ay, inner); vertex(bx, by, inner);
    vertex(ax, ay, inner); vertex(cx, cy, outer); vertex(dx, dy, outer);
    vertex(ax, ay, inner); vertex(dx, dy, outer); vertex(bx, by, inner);
  }
  return o;
}

const isDecal = (p: Placement): p is Placement & { kind: Decal } => p.kind === 'crater' || p.kind === 'scorch';
const DECAL_VERTICES = DECAL_SIDES * 9;

/** `side` flips team colours to the viewer's point of view (D-039). */
export function buildDressing(map: MapConfig, heightAt: (x: number, y: number) => number, side: (t: Team) => Team): DressingTris {
  const plan = planDressing(map);
  const items = plan.filter((p) => !isDecal(p)).map((p) => ({ p, geo: propTemplate(p.kind as PropKind, side(p.team)) }));
  const decals = plan.filter(isDecal);
  const vertices = items.reduce((n, i) => n + i.geo.attributes.position!.count, 0) + decals.length * DECAL_VERTICES;
  const positions = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let o = 0;
  for (const p of decals) o = drapeDecal(p, heightAt, positions, colours, o);
  for (const { p, geo } of items) {
    m.makeRotationY(p.rot).setPosition(p.x, heightAt(p.x, p.y), -p.y);
    const pos = geo.attributes.position!;
    const col = geo.attributes.color!;
    for (let i = 0; i < pos.count; i++, o += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      positions[o] = v.x;
      positions[o + 1] = v.y;
      positions[o + 2] = v.z;
      colours[o] = col.getX(i);
      colours[o + 1] = col.getY(i);
      colours[o + 2] = col.getZ(i);
    }
  }
  return { positions, colours };
}
