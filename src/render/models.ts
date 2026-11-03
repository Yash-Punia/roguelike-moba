import * as THREE from 'three';
import { Kind, Team } from '../sim/sim';
import { palette } from './palette';
import { bake } from './bake';

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

/** Baked templates, one per model and team; instances are clones that share geometry (D-044). */
const templates = new Map<string, { root: THREE.Object3D; names: PartNames }>();

/** Part slots by object name, so a clone can find its own copies of the animated parts. */
interface PartNames {
  upper?: string;
  cap?: string;
  aimParts?: string[];
  standing?: string[];
  mast?: string;
  shield?: string;
  traitRing?: string;
}

/** Builds a model from primitives, then bakes it to one mesh per moving part. */
function buildTemplate(kind: Kind, modelId: string, team: Team) {
  const root = new THREE.Group();
  if (kind === Kind.SubBase) pillbox(root, team);
  else if (kind === Kind.HQ) commandBunker(root, team);
  else if (modelId === 'alpha') alpha(root, team);
  else if (modelId === 'beta') beta(root, team);
  else if (modelId === 'gamma') gamma(root, team);
  else if (modelId === 'mgSoldier') mgSoldier(root, team);
  else championPlaceholder(root, team);
  if (kind === Kind.Champion) addTraitRing(root, modelId === 'beta' ? lightFeetRingMat : modelId === 'gamma' ? chargeRingMat : steadyRingMat);
  const parts = partsOf(root);
  // Name every part object (once, even when it fills two slots: a Sub-base's turret both aims and falls).
  let next = 0;
  const nameOf = (o: THREE.Object3D) => (o.name ||= `part${next++}`);
  const names: PartNames = {
    upper: parts.upper && nameOf(parts.upper),
    cap: parts.cap && nameOf(parts.cap),
    aimParts: parts.aimParts?.map(nameOf),
    standing: parts.standing?.map(nameOf),
    mast: parts.mast && nameOf(parts.mast),
    shield: parts.shield && nameOf(parts.shield),
    traitRing: parts.traitRing && nameOf(parts.traitRing),
  };
  const owners = [root, parts.upper, parts.cap, parts.mast, ...(parts.aimParts ?? []), ...(parts.standing ?? [])].filter((o): o is THREE.Object3D => !!o);
  bake(root, owners, new Set([parts.shield, parts.traitRing].filter((o): o is THREE.Object3D => !!o)));
  root.userData = {}; // clone() JSON-copies userData: no object references in templates
  return { root, names };
}

export function createModel(kind: Kind, modelId: string, team: Team): THREE.Object3D {
  const key = `${kind}:${modelId}:${team}`;
  let t = templates.get(key);
  if (!t) templates.set(key, (t = buildTemplate(kind, modelId, team)));
  const root = t.root.clone(true);
  const find = (name: string | undefined) => (name ? root.getObjectByName(name) : undefined);
  const { names } = t;
  Object.assign(partsOf(root), {
    upper: find(names.upper),
    cap: find(names.cap),
    aimParts: names.aimParts?.map((n) => find(n)!),
    standing: names.standing?.map((n) => find(n)!),
    mast: find(names.mast),
    shield: find(names.shield),
    traitRing: find(names.traitRing),
  } satisfies ModelParts);
  // Real shadows for champions and structures; soldiers get a cheap ground blob instead (D-044).
  const casts = kind !== Kind.Minion;
  root.traverse((o) => {
    o.castShadow = casts;
    o.receiveShadow = true;
  });
  const { shield, traitRing } = partsOf(root);
  if (shield) shield.castShadow = shield.receiveShadow = false;
  if (traitRing) traitRing.castShadow = traitRing.receiveShadow = false;
  return root;
}

/** Parts the scene animates: `upper` turns with the aim while the root turns with the legs. */
export interface ModelParts {
  upper?: THREE.Object3D;
  traitRing?: THREE.Object3D;
  /** Headgear that flies off on a knock-out (GDD §11 "bouncing helmet"). */
  cap?: THREE.Object3D;
  /** Structure guns: each turns to the aim while the bunker stays put. */
  aimParts?: THREE.Object3D[];
  /** Hidden when a structure falls (flags, guns). */
  standing?: THREE.Object3D[];
  /** HQ radio mast, pivoting at its base: it topples when the HQ falls (GDD §11). */
  mast?: THREE.Object3D;
  /** Translucent dome shown while the structure is invulnerable (HQ gate). */
  shield?: THREE.Object3D;
}
export const partsOf = (root: THREE.Object3D) => root.userData as ModelParts;

const traitRingGeo = new THREE.RingGeometry(0.58, 0.7, 28).rotateX(-Math.PI / 2);
const steadyRingMat = new THREE.MeshBasicMaterial({ color: palette.brass, transparent: true, opacity: 0.75, depthWrite: false });
const lightFeetRingMat = new THREE.MeshBasicMaterial({ color: palette.shearling, transparent: true, opacity: 0.6, depthWrite: false });
const chargeRingMat = new THREE.MeshBasicMaterial({ color: palette.steam, transparent: true, opacity: 0.6, depthWrite: false });

/** A faint ring at the feet while the trait is active: brass for Steady Hand, dust for Light Feet, steam for Charge. */
function addTraitRing(root: THREE.Object3D, material: THREE.Material) {
  const ring = new THREE.Mesh(traitRingGeo, material);
  ring.position.y = 0.04;
  ring.visible = false;
  ring.castShadow = ring.receiveShadow = false;
  root.add(ring);
  partsOf(root).traitRing = ring;
}

const SHIRT = 0xeeeae0;
const EYES = 0x1b1a17;

/**
 * Alpha, the Sergeant (CH-01): 1.9 m chibi with navy legs, a greatcoat that flares into a
 * bell, a barrel chest with a diagonal bandolier, brass buttons and buckle, oversized
 * grey-green gloves, a square head with grey moustache, brows and sideburns, and a wide
 * peaked cap. Team colour only on the cap band and epaulettes. The revolver arm is locked
 * out forward (attack pose), so the gun points where the upper body aims. About 700 tris.
 */
function alpha(root: THREE.Object3D, team: Team) {
  const fig = new THREE.Group();
  fig.scale.setScalar(0.84); // modelled at ~2.28 m to the cap top; the sheet's 1.9 m
  root.add(fig);

  // Legs and boots: stay with the movement facing.
  for (const z of [-0.13, 0.13]) {
    part(fig, box(0.17, 0.34, 0.17), palette.trouserNavy, 0, 0.29, z);
    part(fig, box(0.25, 0.12, 0.18), palette.leather, 0.03, 0.06, z);
  }

  const upper = new THREE.Group();
  fig.add(upper);
  partsOf(root).upper = upper;

  // Greatcoat: bell skirt, barrel chest, wide shoulders.
  part(upper, cyl(0.3, 0.44, 0.78, 8), palette.greatcoat, 0, 0.71, 0);
  part(upper, box(0.5, 0.34, 0.72), palette.greatcoat, 0, 1.18, 0);
  part(upper, box(0.38, 0.2, 0.92), palette.greatcoat, -0.02, 1.3, 0);
  part(upper, box(0.04, 0.26, 0.3), palette.coatShadow, 0.26, 1.2, 0);
  part(upper, box(0.24, 0.08, 0.28), SHIRT, 0.1, 1.43, 0);
  for (const z of [-0.36, 0.36]) part(upper, box(0.3, 0.06, 0.2), teamColour(team), -0.02, 1.43, z);
  // Belt, buckle and buttons.
  part(upper, cyl(0.335, 0.335, 0.08, 8), palette.leather, 0, 0.96, 0);
  part(upper, box(0.05, 0.09, 0.11), palette.brass, 0.34, 0.96, 0);
  for (const y of [0.62, 0.8]) part(upper, box(0.04, 0.05, 0.05), palette.brass, 0.36, y, -0.07);
  // Bandolier from the left shoulder to the right hip, with brass pouch studs.
  const strap = part(upper, box(0.04, 0.08, 0.78), palette.leather, 0.27, 1.13, 0);
  strap.rotation.x = 0.6;
  for (const [y, z] of [[1.25, -0.17], [1.13, 0], [1.01, 0.17]] as const) part(upper, box(0.05, 0.06, 0.06), palette.brass, 0.3, y, z);

  // Right arm (+z) locked out forward with the revolver; left arm at the side.
  part(upper, box(0.52, 0.2, 0.2), palette.greatcoat, 0.22, 1.24, 0.4);
  part(upper, box(0.06, 0.22, 0.22), palette.coatShadow, 0.47, 1.24, 0.4);
  part(upper, box(0.24, 0.24, 0.24), palette.glove, 0.6, 1.24, 0.4);
  part(upper, box(0.14, 0.14, 0.13), palette.gunmetal, 0.72, 1.34, 0.4);
  part(upper, box(0.42, 0.09, 0.09), palette.gunmetal, 0.95, 1.36, 0.4);
  part(upper, box(0.2, 0.5, 0.2), palette.greatcoat, 0.02, 1.08, -0.44);
  part(upper, box(0.22, 0.06, 0.22), palette.coatShadow, 0.02, 0.84, -0.44);
  part(upper, box(0.24, 0.24, 0.24), palette.glove, 0.02, 0.7, -0.46);

  // Head and face (front is +x): big and square, so he reads as three heads tall.
  part(upper, box(0.56, 0.56, 0.56), palette.skin, 0, 1.72, 0);
  for (const z of [-0.12, 0.12]) {
    part(upper, box(0.02, 0.08, 0.07), EYES, 0.285, 1.76, z);
    part(upper, box(0.06, 0.05, 0.15), palette.hairGrey, 0.285, 1.84, z);
  }
  part(upper, box(0.09, 0.12, 0.1), palette.skin, 0.32, 1.68, 0);
  part(upper, box(0.06, 0.07, 0.3), palette.hairGrey, 0.3, 1.6, 0);
  for (const z of [-0.285, 0.285]) {
    part(upper, box(0.24, 0.22, 0.04), palette.hairGrey, -0.02, 1.74, z);
    part(upper, box(0.1, 0.12, 0.05), palette.skin, -0.08, 1.74, z * 1.1);
  }

  // Peaked cap (its own group, so it can fly off): team band, wide crown, leather brim, brass badge.
  const cap = new THREE.Group();
  cap.position.y = 2.05;
  upper.add(cap);
  partsOf(root).cap = cap;
  part(cap, box(0.6, 0.1, 0.6), teamColour(team), 0, 0, 0);
  part(cap, box(0.66, 0.13, 0.66), palette.greatcoat, 0, 0.11, 0);
  part(cap, box(0.78, 0.06, 0.76), palette.greatcoat, 0.02, 0.2, 0);
  const brim = part(cap, box(0.24, 0.045, 0.6), palette.leather, 0.4, -0.03, 0);
  brim.rotation.z = -0.15;
  part(cap, box(0.03, 0.08, 0.08), palette.brass, 0.345, 0.1, 0);
}

/**
 * Beta, the Runner (CH-02): the slimmest hero, 1.75 m (legs 0.5, jacket 0.62, head 0.66). Khaki
 * trousers, a short leather bomber jacket with a shearling collar, a canvas pack, and the team
 * scarf trailing behind (the brightest team read in the roster; cuffs and arm chevrons too).
 * Round aviator cap with ear flaps and goggles pushed up: the only round-topped hero. The drum
 * SMG is held forward across the body, scaled up 25% so the drum reads from above. About 600 tris.
 */
function beta(root: THREE.Object3D, team: Team) {
  // Legs and boots: long for her height ("fast").
  for (const z of [-0.1, 0.1]) {
    part(root, box(0.15, 0.4, 0.15), palette.khaki, 0, 0.32, z);
    part(root, box(0.22, 0.12, 0.16), palette.coatShadow, 0.03, 0.06, z);
  }

  const upper = new THREE.Group();
  root.add(upper);
  partsOf(root).upper = upper;
  const team1 = teamColour(team);

  // Jacket: narrow torso, a darker waistband, shearling collar, canvas pack on the back.
  part(upper, box(0.34, 0.5, 0.44), palette.leather, 0, 0.82, 0);
  part(upper, box(0.36, 0.08, 0.46), palette.coatShadow, 0, 0.6, 0);
  part(upper, box(0.36, 0.08, 0.42), palette.shearling, 0.01, 1.08, 0);
  part(upper, box(0.18, 0.34, 0.34), palette.canvas, -0.26, 0.88, 0);

  // Scarf: wrapped at the neck, a long tail streaming back (static; the sheet's spring chain is cut, D-049).
  part(upper, box(0.36, 0.09, 0.46), team1, 0, 1.14, 0);
  const tail = part(upper, box(0.44, 0.06, 0.13), team1, -0.36, 1.12, 0.12);
  tail.rotation.z = 0.12;
  const tip = part(upper, box(0.3, 0.05, 0.11), teamShade(team), -0.7, 1.07, 0.16);
  tip.rotation.z = 0.2;

  // Arms forward round the gun; team cuffs and shoulder chevrons.
  for (const [z, reach] of [[0.25, 0.32], [-0.25, 0.46]] as const) {
    part(upper, box(0.13, 0.08, 0.15), team1, 0, 1.0, z * 1.02);
    part(upper, box(reach, 0.13, 0.13), palette.leather, reach / 2, 0.9, z);
    part(upper, box(0.05, 0.14, 0.14), team1, reach, 0.9, z);
    part(upper, box(0.13, 0.13, 0.13), palette.glove, reach + 0.08, 0.9, z * 0.4);
  }

  // Drum SMG (+25%): receiver, ribbed barrel, wooden stock, and the big drum facing sideways.
  part(upper, box(0.45, 0.12, 0.1), palette.gunmetal, 0.55, 0.96, 0.02);
  part(upper, box(0.3, 0.07, 0.07), palette.gunmetal, 0.92, 0.98, 0.02);
  for (const x of [0.86, 0.96]) part(upper, box(0.03, 0.1, 0.1), palette.iron, x, 0.98, 0.02);
  part(upper, box(0.22, 0.09, 0.08), palette.wood, 0.25, 0.92, 0.02);
  const drum = part(upper, cyl(0.15, 0.15, 0.09, 10), palette.gunmetal, 0.52, 0.83, 0.02);
  drum.rotation.x = Math.PI / 2;

  // Head (front is +x): rounder and smaller than Alpha's; big eyes, a little nose, a braid.
  part(upper, box(0.46, 0.44, 0.44), palette.skin, 0, 1.42, 0);
  for (const z of [-0.1, 0.1]) part(upper, box(0.02, 0.1, 0.07), EYES, 0.235, 1.43, z);
  part(upper, box(0.06, 0.07, 0.07), palette.skin, 0.25, 1.37, 0);
  part(upper, box(0.12, 0.26, 0.1), palette.hairBrown, -0.26, 1.3, 0);

  // Aviator cap (flies off on a knock-out): a rounded leather dome, ear flaps, goggles pushed up.
  const cap = new THREE.Group();
  cap.position.y = 1.62;
  upper.add(cap);
  partsOf(root).cap = cap;
  part(cap, cyl(0.27, 0.26, 0.16, 8), palette.leather, 0, 0, 0);
  part(cap, cyl(0.16, 0.27, 0.12, 8), palette.leather, 0, 0.14, 0);
  for (const z of [-0.25, 0.25]) part(cap, box(0.2, 0.26, 0.05), palette.leather, -0.02, -0.18, z);
  part(cap, box(0.06, 0.05, 0.42), palette.leather, 0.24, 0.02, 0);
  for (const z of [-0.1, 0.1]) {
    const lens = part(cap, cyl(0.075, 0.075, 0.05, 8), palette.goggleGlass, 0.25, 0.06, z);
    lens.rotation.z = Math.PI / 2;
  }
}

/**
 * Gamma, the Furnace (CH-03): the biggest hero, 2.1 m (legs 0.44, a barrel body almost as wide
 * as tall, head 0.76). Rust padded suit, dark armour plates with team-coloured pauldron edges
 * and chest tabs, a sealed gas-mask helmet with two orange lenses and a canister snout, twin
 * silver fuel tanks standing up behind the head with team bands, and a hose looping round his
 * right side to the flamethrower held low and forward. About 650 tris (the sheet's 3,200 is
 * for the concept render; the hose is two boxes, not a spline tube).
 */
function gamma(root: THREE.Object3D, team: Team) {
  const team1 = teamColour(team);
  // Short legs, heavy boots.
  for (const z of [-0.2, 0.2]) {
    part(root, box(0.22, 0.3, 0.22), palette.suitShadow, 0, 0.29, z);
    part(root, box(0.3, 0.14, 0.24), palette.mask, 0.03, 0.07, z);
  }

  const upper = new THREE.Group();
  root.add(upper);
  partsOf(root).upper = upper;

  // Barrel body with a belt, chest plate and team chest tabs.
  part(upper, cyl(0.52, 0.48, 0.9, 8), palette.suitRust, 0, 0.9, 0);
  part(upper, cyl(0.53, 0.53, 0.08, 8), palette.suitShadow, 0, 0.62, 0);
  part(upper, box(0.1, 0.42, 0.56), palette.armour, 0.46, 0.95, 0);
  for (const z of [-0.14, 0.14]) part(upper, box(0.04, 0.06, 0.14), team1, 0.52, 1.08, z);
  // Pauldrons with team edges.
  for (const z of [-0.55, 0.55]) {
    part(upper, box(0.36, 0.22, 0.3), palette.armour, 0, 1.28, z);
    part(upper, box(0.32, 0.06, 0.04), team1, 0, 1.3, z * 1.29);
  }

  // Twin fuel tanks behind the head, with caps and team bands; the hose loops round his right.
  for (const z of [-0.2, 0.2]) {
    part(upper, cyl(0.17, 0.17, 0.95, 8), palette.fuelTank, -0.58, 1.35, z);
    part(upper, cyl(0.175, 0.175, 0.06, 8), team1, -0.58, 1.1, z);
    part(upper, cyl(0.06, 0.06, 0.1, 6), palette.iron, -0.58, 1.87, z);
  }
  part(upper, box(0.6, 0.08, 0.08), palette.hose, -0.25, 0.78, 0.5);
  part(upper, box(0.5, 0.08, 0.08), palette.hose, 0.3, 0.8, 0.42);

  // Arms forward to the flamethrower: a long tube, brass ring, dark nozzle.
  part(upper, box(0.42, 0.2, 0.2), palette.suitRust, 0.25, 1.0, 0.45);
  part(upper, box(0.2, 0.2, 0.2), palette.armour, 0.5, 0.96, 0.32);
  part(upper, box(0.5, 0.2, 0.2), palette.suitRust, 0.3, 0.98, -0.38);
  part(upper, box(0.2, 0.2, 0.2), palette.armour, 0.6, 0.94, -0.18);
  const tube = part(upper, cyl(0.06, 0.06, 0.8, 6), palette.gunmetal, 0.85, 0.95, 0.06);
  tube.rotation.z = Math.PI / 2;
  const ring = part(upper, cyl(0.1, 0.1, 0.05, 6), palette.brass, 1.2, 0.95, 0.06);
  ring.rotation.z = Math.PI / 2;
  const nozzle = part(upper, cyl(0.09, 0.08, 0.12, 6), palette.mask, 1.29, 0.95, 0.06);
  nozzle.rotation.z = Math.PI / 2;

  // Gas-mask head (front is +x): two orange lenses and the canister snout.
  part(upper, box(0.62, 0.56, 0.6), palette.mask, 0, 1.65, 0);
  for (const z of [-0.14, 0.14]) {
    const lens = part(upper, cyl(0.12, 0.12, 0.04, 8), palette.fire, 0.31, 1.7, z);
    lens.rotation.z = Math.PI / 2;
  }
  part(upper, box(0.16, 0.16, 0.16), palette.armour, 0.36, 1.5, 0);

  // Helmet dome (flies off on a knock-out).
  const cap = new THREE.Group();
  cap.position.y = 1.97;
  upper.add(cap);
  partsOf(root).cap = cap;
  part(cap, cyl(0.28, 0.36, 0.16, 8), palette.mask, 0, 0, 0);
}

/**
 * MG Soldier (UN-01): a 1.1 m chibi infantryman, 2.3 heads tall. Dome helmet in team colour
 * with a darker rim, big round head, green uniform, khaki backpack, brown boots, and a light
 * machine gun with a drum magazine held forward at port arms. Legs and upper body are
 * separate parts so the gun tracks the target. About 400 tris.
 */
function mgSoldier(root: THREE.Object3D, team: Team) {
  for (const z of [-0.08, 0.08]) {
    part(root, box(0.11, 0.2, 0.11), palette.infantry, 0, 0.16, z);
    part(root, box(0.16, 0.08, 0.12), palette.leather, 0.02, 0.04, z);
  }
  const upper = new THREE.Group();
  root.add(upper);
  partsOf(root).upper = upper;
  part(upper, box(0.3, 0.32, 0.34), palette.infantry, 0, 0.42, 0);
  part(upper, box(0.31, 0.05, 0.35), palette.leather, 0, 0.3, 0);
  for (const z of [-0.08, 0.08]) part(upper, box(0.05, 0.07, 0.08), palette.leather, 0.16, 0.33, z);
  part(upper, box(0.16, 0.24, 0.26), palette.khaki, -0.23, 0.45, 0);
  // Arms forward at port arms, hands on the gun.
  for (const z of [-0.15, 0.15]) {
    part(upper, box(0.24, 0.09, 0.09), palette.infantry, 0.12, 0.44, z);
    part(upper, box(0.08, 0.08, 0.08), palette.skin, 0.26, 0.44, z * 0.6);
  }
  part(upper, box(0.24, 0.08, 0.07), palette.gunmetal, 0.26, 0.48, 0);
  part(upper, box(0.36, 0.045, 0.045), palette.gunmetal, 0.55, 0.5, 0);
  part(upper, box(0.14, 0.06, 0.05), palette.leather, 0.08, 0.47, 0);
  part(upper, cyl(0.09, 0.09, 0.04, 10), palette.olive, 0.27, 0.55, 0);
  // Big round head and the team helmet (its own group, so it can bounce off on a knock-out).
  part(upper, new THREE.IcosahedronGeometry(0.23, 1), palette.skin, 0.02, 0.77, 0);
  for (const z of [-0.07, 0.07]) part(upper, box(0.02, 0.05, 0.04), EYES, 0.235, 0.76, z);
  const helmet = new THREE.Group();
  helmet.position.y = 0.82;
  upper.add(helmet);
  partsOf(root).cap = helmet;
  part(helmet, new THREE.SphereGeometry(0.27, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), teamColour(team), 0, 0, 0);
  part(helmet, cyl(0.31, 0.31, 0.035, 12), teamShade(team), 0, 0.01, 0);
}

/** Until each champion gets its sheet model (Beta and Gamma: M3). */
function championPlaceholder(root: THREE.Object3D, team: Team) {
  const body = part(root, new THREE.CapsuleGeometry(0.5, 0.8, 2, 8), teamColour(team), 0, 0.9, 0);
  part(body, box(0.5, 0.18, 0.18), palette.gunmetal, 0.55, 0.2, 0);
}

/** Sub-base (ST-01): squat 2.9 m concrete hexagon 1.9 m tall, camo-net roof, HMG slit facing the enemy, team stripe round the base, flag, sandbag ring. */
function pillbox(root: THREE.Object3D, team: Team) {
  part(root, cyl(1.3, 1.45, 1.9, 6), palette.concrete, 0, 0.95, 0);
  part(root, cyl(1.47, 1.48, 0.24, 6), teamColour(team), 0, 0.32, 0);
  part(root, cyl(1.15, 1.32, 0.3, 6), palette.camoNet, 0, 2.05, 0);
  // HMG slit on the front face (a hexagon side faces +x), and the gun on a turret ring that
  // swings round the pillbox to its target.
  part(root, box(0.14, 0.26, 1.1), palette.gunmetal, 1.2, 1.3, 0);
  const turret = new THREE.Group();
  root.add(turret);
  part(turret, box(0.16, 0.34, 0.5), palette.gunmetal, 1.38, 1.3, 0);
  const barrel = part(turret, cyl(0.07, 0.07, 1, 6), palette.gunmetal, 1.85, 1.3, 0);
  barrel.rotation.z = Math.PI / 2;
  // Flag on a pole at the back.
  const flag = new THREE.Group();
  root.add(flag);
  part(flag, cyl(0.04, 0.04, 1.7, 5), palette.wood, -0.7, 2.6, 0.55);
  part(flag, box(0.05, 0.45, 0.7), teamColour(team), -0.7, 3.2, 0.92);
  partsOf(root).aimParts = [turret];
  partsOf(root).standing = [turret, flag];
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
  // Twin flak guns on the front ledge, barrels raised; each mount turns to its target.
  const mounts: THREE.Object3D[] = [];
  for (const z of [-1.4, 1.4]) {
    const mount = new THREE.Group();
    mount.position.set(1.55, 2.15, z);
    root.add(mount);
    mounts.push(mount);
    part(mount, cyl(0.32, 0.38, 0.3, 8), palette.olive, 0, 0, 0);
    for (const dz of [-0.1, 0.1]) {
      const b = part(mount, cyl(0.05, 0.05, 1.1, 5), palette.gunmetal, 0.3, 0.4, dz);
      b.rotation.z = -Math.PI / 4;
    }
  }
  // Searchlights on the back corners.
  for (const z of [-2.2, 2.2]) {
    const light = part(root, cyl(0.2, 0.16, 0.32, 8), palette.brass, -1.8, 2.2, z);
    light.rotation.z = Math.PI / 6;
  }
  // Radio mast with cross-bars.
  const mast = new THREE.Group();
  mast.position.set(-1.3, 3.4, 0); // pivot at the base
  root.add(mast);
  part(mast, cyl(0.04, 0.08, 4.4, 4), palette.gunmetal, 0, 2.2, 0);
  for (const y of [4.6, 5.8, 7]) part(mast, box(0.06, 0.06, 0.9), palette.gunmetal, 0, y - 3.4, 0);
  partsOf(root).mast = mast;
  partsOf(root).aimParts = mounts;
  partsOf(root).standing = mounts;
  // The HQ gate's shield (GDD §5): a faint team dome, shown while invulnerable.
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(3.7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: teamColour(team), transparent: true, opacity: 0.16, depthWrite: false }),
  );
  shield.visible = false;
  root.add(shield);
  partsOf(root).shield = shield;
}

/** Spawn pad (ST-01): 4.6 m concrete disc with a team-colour ring and yellow hazard markers. Static map dressing. */
const CAVE_DARK = 0x1b1a17;

/**
 * The wave cave behind an HQ (D-051): a rock mound against the map's back edge with a
 * timber-framed dark mouth, sandbags either side and a team-coloured sign over the lintel. The
 * mouth faces local −z (towards the HQ once placed); waves walk out of it single file.
 */
export function createCave(team: Team): THREE.Object3D {
  const root = new THREE.Group();
  // Rock mound, stepped back and up.
  part(root, box(10, 3.2, 3.2), palette.jungle, 0, 1.6, 1.4);
  part(root, box(7, 1.6, 2.6), palette.mud, 0, 3.9, 1.8);
  for (const x of [-5.6, 5.6]) part(root, box(2.4, 2.2, 2.6), palette.jungle, x, 1.1, 1.6);
  // Dark mouth with a timber frame.
  part(root, box(3.4, 2.5, 0.6), CAVE_DARK, 0, 1.25, -0.05);
  for (const x of [-1.85, 1.85]) part(root, box(0.3, 2.8, 0.3), palette.wood, x, 1.4, -0.3);
  part(root, box(4.2, 0.35, 0.4), palette.wood, 0, 2.95, -0.3);
  part(root, box(2.4, 0.45, 0.1), teamColour(team), 0, 3.45, -0.5);
  // Sandbags flanking the entrance.
  for (const x of [-3, 3]) {
    part(root, box(1.6, 0.5, 0.8), palette.sandbag, x, 0.25, -0.6);
    part(root, box(1.2, 0.45, 0.7), palette.sandbagShadow, x, 0.7, -0.6);
  }
  bake(root, [root]);
  root.traverse((o) => (o.castShadow = o.receiveShadow = true));
  return root;
}

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
  bake(root, [root]);
  root.traverse((o) => (o.receiveShadow = true));
  return root;
}
