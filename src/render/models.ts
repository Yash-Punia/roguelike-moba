import * as THREE from 'three';
import { Kind, Team } from '../sim/sim';
import { palette } from './palette';

/**
 * Primitive models (D-020): flat SG-01 colours, no textures. Every model faces local +x,
 * which is the entity's facing once the scene sets `rotation.y = facing`; up is +y.
 */

const materials = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number): THREE.MeshLambertMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materials.set(color, m);
  }
  return m;
}

const teamColour = (team: Team) => (team === Team.Blue ? palette.blue : team === Team.Red ? palette.red : palette.olive);
const teamShade = (team: Team) => (team === Team.Blue ? palette.blueShade : team === Team.Red ? palette.redShade : palette.olive);

/** Adds a mesh at (x, y, z) to a parent and returns it, for terse model building. */
function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (top: number, bottom: number, h: number, sides: number) => new THREE.CylinderGeometry(top, bottom, h, sides);

export function createModel(kind: Kind, modelId: string, team: Team): THREE.Object3D {
  const root = new THREE.Group();
  if (kind === Kind.SubBase) pillbox(root, team);
  else if (kind === Kind.HQ) commandBunker(root, team);
  else championPlaceholder(root, team); // modelId picks the champion's own model from feature 7
  root.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return root;
}

/** Until each champion gets its sheet model (Alpha: M2 feature 7). */
function championPlaceholder(root: THREE.Object3D, team: Team) {
  const body = part(root, new THREE.CapsuleGeometry(0.5, 0.8, 2, 8), teamColour(team), 0, 0.9, 0);
  part(body, box(0.5, 0.18, 0.18), palette.gunmetal, 0.55, 0.2, 0);
}

/** Sub-base (ST-01): squat 2.9 m concrete hexagon 1.9 m tall, camo-net roof, HMG slit facing the enemy, team stripe round the base, flag, sandbag ring. */
function pillbox(root: THREE.Object3D, team: Team) {
  part(root, cyl(1.3, 1.45, 1.9, 6), palette.concrete, 0, 0.95, 0);
  part(root, cyl(1.47, 1.48, 0.24, 6), teamColour(team), 0, 0.32, 0);
  part(root, cyl(1.15, 1.32, 0.3, 6), palette.camoNet, 0, 2.05, 0);
  // HMG slit on the front face (a hexagon side faces +x) and the gun poking out.
  part(root, box(0.14, 0.26, 1.1), palette.gunmetal, 1.2, 1.3, 0);
  const barrel = part(root, cyl(0.07, 0.07, 1, 6), palette.gunmetal, 1.65, 1.3, 0);
  barrel.rotation.z = Math.PI / 2;
  // Flag on a pole at the back.
  part(root, cyl(0.04, 0.04, 1.7, 5), palette.wood, -0.7, 2.6, 0.55);
  part(root, box(0.05, 0.45, 0.7), teamColour(team), -0.7, 3.2, 0.92);
  // Sandbag ring, open in front of the gun.
  const bag = box(0.62, 0.34, 0.34);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.cos(a) > 0.9) continue;
    const b = part(root, bag, i % 2 ? palette.sandbag : palette.sandbagShadow, Math.cos(a) * 1.85, 0.17, Math.sin(a) * 1.85);
    b.rotation.y = -a + Math.PI / 2;
  }
}

/** HQ (ST-01): two-step concrete bunker on a 5 × 4.2 m footprint, 3.4 m tall, camo-net roof, twin flak guns, team banner on the front, corner searchlights, door and slits, 4.4 m radio mast. Width 5 m runs along local z. */
function commandBunker(root: THREE.Object3D, team: Team) {
  part(root, box(4.2, 2, 5), palette.concrete, 0, 1, 0);
  part(root, box(3, 1.4, 3.8), palette.concreteShadow, -0.45, 2.7, 0);
  part(root, box(3.04, 0.3, 3.84), teamColour(team), -0.45, 3.1, 0);
  part(root, box(2.6, 0.12, 3.4), palette.camoNet, -0.45, 3.46, 0);
  // Front: banner, door and firing slits.
  part(root, box(0.06, 1.3, 1.5), teamColour(team), 2.12, 1.25, 0);
  part(root, box(0.06, 0.25, 1.3), teamShade(team), 2.13, 1.9, 0);
  part(root, box(0.06, 1.1, 0.8), palette.gunmetal, 2.12, 0.55, 1.75);
  part(root, box(0.06, 0.18, 0.9), palette.gunmetal, 2.12, 1.55, -1.7);
  // Twin flak guns on the front ledge, barrels raised towards the enemy.
  for (const z of [-1.4, 1.4]) {
    part(root, cyl(0.32, 0.38, 0.3, 8), palette.olive, 1.55, 2.15, z);
    for (const dz of [-0.1, 0.1]) {
      const b = part(root, cyl(0.05, 0.05, 1.1, 5), palette.gunmetal, 1.85, 2.55, z + dz);
      b.rotation.z = -Math.PI / 4;
    }
  }
  // Searchlights on the back corners.
  for (const z of [-2.2, 2.2]) {
    const light = part(root, cyl(0.2, 0.16, 0.32, 8), palette.brass, -1.8, 2.2, z);
    light.rotation.z = Math.PI / 6;
  }
  // Radio mast with cross-bars.
  part(root, cyl(0.04, 0.08, 4.4, 4), palette.gunmetal, -1.3, 3.4 + 2.2, 0);
  for (const y of [4.6, 5.8, 7]) part(root, box(0.06, 0.06, 0.9), palette.gunmetal, -1.3, y, 0);
}

/** Spawn pad (ST-01): 4.6 m concrete disc with a team-colour ring and yellow hazard markers. Static map dressing. */
export function createSpawnPad(team: Team): THREE.Object3D {
  const root = new THREE.Group();
  part(root, cyl(2.3, 2.3, 0.08, 24), palette.concrete, 0, 0.04, 0);
  const ring = part(root, new THREE.RingGeometry(1.85, 2.15, 24), teamColour(team), 0, 0.085, 0);
  ring.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const m = part(root, box(0.55, 0.02, 0.18), palette.hazard, Math.cos(a) * 1.45, 0.09, Math.sin(a) * 1.45);
    m.rotation.y = -a;
  }
  root.traverse((o) => (o.receiveShadow = true));
  return root;
}
