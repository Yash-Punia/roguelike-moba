import * as THREE from 'three';
import type { MapConfig, PropKind } from '../data/schema';
import { Team } from '../sim/sim';
import { bake } from './bake';
import { box, cyl, part, teamColour } from './models';
import { palette } from './palette';

/**
 * Map scenery (map spec "Dressing", PR-01, PR-02). Every prop is merged into the terrain's own
 * tiles, so all of it costs no draw calls beyond the ground under it (D-097). Decoration only:
 * nothing here reaches the sim (D-061).
 */

export interface Placement {
  kind: PropKind;
  x: number;
  y: number;
  /** Sim radians: the prop's local +x points this way. */
  rot: number;
  team: Team;
}

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
};

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
  for (const p of map.dressing.placed) {
    out.push({ kind: p.kind, x: p.x, y: p.y, rot: p.rot, team: Team.Blue });
    out.push({ kind: p.kind, x: -p.x, y: -p.y, rot: p.rot + Math.PI, team: Team.Red });
  }
  return out;
}

/** `side` flips team colours to the viewer's point of view (D-039). */
export function buildDressing(map: MapConfig, heightAt: (x: number, y: number) => number, side: (t: Team) => Team): DressingTris {
  const items = planDressing(map).map((p) => ({ p, geo: propTemplate(p.kind, side(p.team)) }));
  const vertices = items.reduce((n, i) => n + i.geo.attributes.position!.count, 0);
  const positions = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let o = 0;
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
