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

export const teamColour = (team: Team) => (team === Team.Blue ? palette.blue : team === Team.Red ? palette.red : palette.olive);
const teamShade = (team: Team) => (team === Team.Blue ? palette.blueShade : team === Team.Red ? palette.redShade : palette.olive);

/** Adds a mesh at (x, y, z) to a parent and returns it, for terse model building. */
export function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (top: number, bottom: number, h: number, sides: number) => new THREE.CylinderGeometry(top, bottom, h, sides);

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
  else if (modelId === 'shockTrooper') shockTrooper(root, team);
  else if (modelId === 'bazookaTank') bazookaTank(root, team);
  else if (modelId === 'warDog') warDog(root, team);
  else if (modelId.startsWith('deserter')) deserter(root, Number(modelId.slice(8)) || 0);
  else if (modelId === 'sniper') sniper(root);
  else if (modelId === 'fieldGun') fieldGun(root);
  else if (modelId === 'halftrack') halftrack(root);
  else if (modelId === 'behemoth') behemoth(root);
  else championPlaceholder(root, team);
  if (kind === Kind.Champion) {
    addTraitRing(root, modelId === 'beta' ? lightFeetRingMat : modelId === 'gamma' ? chargeRingMat : steadyRingMat);
    // Invincible (the Behemoth's reward, a lethal save): a faint brass dome, shown while invulnerable (D-082).
    const dome = new THREE.Mesh(championDomeGeo, championDomeMat);
    dome.visible = false;
    root.add(dome);
    partsOf(root).shield = dome;
  }
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
    tracked: modelId === 'bazookaTank',
  } satisfies ModelParts);
  // Real shadows for champions, structures and mini-bosses; soldiers and camp units get a cheap ground blob instead (D-044).
  const casts = (kind !== Kind.Minion && kind !== Kind.Neutral) || BOSS_MODELS.has(modelId);
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
  /** Rolls on treads: no marching bob. */
  tracked?: boolean;
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
/** War Dog (D-063): a stocky khaki-brown dog in a team collar, facing +x like every unit. */
function warDog(root: THREE.Object3D, team: Team) {
  part(root, box(0.62, 0.26, 0.28), palette.leather, 0, 0.36, 0);
  for (const x of [-0.22, 0.22]) for (const z of [-0.1, 0.1]) part(root, box(0.08, 0.24, 0.08), palette.leather, x, 0.12, z);
  part(root, box(0.24, 0.22, 0.22), palette.greatcoat, 0.36, 0.52, 0);
  part(root, box(0.16, 0.1, 0.12), palette.greatcoat, 0.52, 0.47, 0);
  part(root, box(0.04, 0.04, 0.05), EYES, 0.6, 0.5, 0);
  for (const z of [-0.08, 0.08]) {
    part(root, box(0.06, 0.12, 0.05), palette.leather, 0.3, 0.66, z);
    part(root, box(0.02, 0.04, 0.03), EYES, 0.48, 0.57, z * 0.7);
  }
  part(root, box(0.06, 0.07, 0.26), teamColour(team), 0.24, 0.48, 0);
  const tail = part(root, box(0.2, 0.05, 0.05), palette.leather, -0.38, 0.47, 0);
  tail.rotation.z = 0.6;
}

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

/** NT-01 neutral colours: faded uniforms, less saturated than either team. */
const FADED_GREY = 0x7b7870;
const FADED_BROWN = 0x7a6450;
const OLIVE_DRAB = 0x6f7445;
const RAG = 0xf2efe6;
const GINGER = 0xb0602e;
const DARK_SKIN = 0x9a6a48;

/**
 * A deserter (NT-01): the MG Soldier's chibi body in a mismatched faded uniform with a white
 * rag armband, no team colour. Variant by place in the squad: 0 Rifleman (knitted cap, beard,
 * rifle), 1 Scrounger (field cap and head bandage, SMG), 2 Old Hand (weathered helmet, rifle,
 * darker skin), 3 Gunner (bare head, ginger beard, heavy MG). About 400 tris.
 */
function deserter(root: THREE.Object3D, variant: number) {
  const coat = [FADED_GREY, palette.khaki, OLIVE_DRAB, FADED_BROWN][variant % 4]!;
  const trousers = [OLIVE_DRAB, palette.trouserNavy, FADED_BROWN, palette.khaki][variant % 4]!;
  const skin = variant === 2 ? DARK_SKIN : palette.skin;
  for (const z of [-0.08, 0.08]) {
    part(root, box(0.11, 0.2, 0.11), trousers, 0, 0.16, z);
    part(root, box(0.16, 0.08, 0.12), palette.leather, 0.02, 0.04, z);
  }
  const upper = new THREE.Group();
  root.add(upper);
  partsOf(root).upper = upper;
  part(upper, box(0.3, 0.32, 0.34), coat, 0, 0.42, 0);
  part(upper, box(0.31, 0.05, 0.35), palette.leather, 0, 0.3, 0);
  part(upper, box(0.14, 0.2, 0.22), FADED_BROWN, -0.21, 0.44, 0);
  for (const z of [-0.15, 0.15]) {
    part(upper, box(0.24, 0.09, 0.09), coat, 0.12, 0.44, z);
    part(upper, box(0.08, 0.08, 0.08), skin, 0.26, 0.44, z * 0.6);
  }
  part(upper, box(0.06, 0.1, 0.1), RAG, 0.02, 0.48, -0.17); // the neutral armband
  // Weapon: rifle (long thin barrel), SMG (short with a drum), or heavy MG (thick, long).
  if (variant === 1) {
    part(upper, box(0.3, 0.07, 0.06), palette.gunmetal, 0.3, 0.47, 0);
    part(upper, cyl(0.07, 0.07, 0.05, 8), palette.gunmetal, 0.28, 0.41, 0).rotation.x = Math.PI / 2;
  } else if (variant === 3) {
    part(upper, box(0.3, 0.1, 0.09), palette.gunmetal, 0.28, 0.48, 0);
    part(upper, box(0.4, 0.06, 0.06), palette.gunmetal, 0.62, 0.5, 0);
  } else {
    part(upper, box(0.3, 0.06, 0.06), palette.wood, 0.24, 0.47, 0);
    part(upper, box(0.36, 0.035, 0.035), palette.gunmetal, 0.52, 0.49, 0);
  }
  part(upper, new THREE.IcosahedronGeometry(0.23, 1), skin, 0.02, 0.77, 0);
  for (const z of [-0.07, 0.07]) part(upper, box(0.02, 0.05, 0.04), EYES, 0.235, 0.76, z);
  if (variant === 0) part(upper, box(0.1, 0.12, 0.26), FADED_BROWN, 0.18, 0.66, 0); // full beard
  if (variant === 3) part(upper, box(0.1, 0.1, 0.24), GINGER, 0.18, 0.66, 0);
  const cap = new THREE.Group();
  cap.position.y = 0.82;
  upper.add(cap);
  partsOf(root).cap = cap;
  if (variant === 0) {
    part(cap, new THREE.SphereGeometry(0.25, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), FADED_BROWN, 0, 0, 0); // knitted cap
  } else if (variant === 1) {
    part(cap, cyl(0.2, 0.23, 0.1, 10), OLIVE_DRAB, 0, 0.04, 0); // field cap
    part(cap, cyl(0.245, 0.245, 0.06, 12), RAG, 0, -0.05, 0); // head bandage
  } else if (variant === 2) {
    part(cap, new THREE.SphereGeometry(0.27, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), OLIVE_DRAB, 0, 0, 0);
    part(cap, cyl(0.31, 0.31, 0.035, 12), FADED_GREY, 0, 0.01, 0);
  } else {
    part(cap, box(0.06, 0.04, 0.06), GINGER, 0, 0.02, 0.12); // bare head: a tuft
  }
}

/**
 * The sniper (NT-01): a chibi body under a ghillie cape of camo scraps, with a long rifle. The
 * sandbag horseshoe is a static prop of the nest (`createSniperNest`). About 380 tris.
 */
function sniper(root: THREE.Object3D) {
  for (const z of [-0.08, 0.08]) {
    part(root, box(0.11, 0.2, 0.11), OLIVE_DRAB, 0, 0.16, z);
    part(root, box(0.16, 0.08, 0.12), palette.leather, 0.02, 0.04, z);
  }
  const upper = new THREE.Group();
  root.add(upper);
  partsOf(root).upper = upper;
  part(upper, box(0.3, 0.32, 0.34), OLIVE_DRAB, 0, 0.42, 0);
  // Ghillie cape: shaggy layers over back, shoulders and hood.
  part(upper, box(0.26, 0.4, 0.42), palette.camoNet, -0.08, 0.46, 0);
  for (const [x, y, z] of [[-0.18, 0.3, -0.16], [-0.2, 0.34, 0.15], [-0.05, 0.62, -0.18], [-0.06, 0.62, 0.18], [-0.22, 0.55, 0]] as const) {
    part(upper, box(0.12, 0.14, 0.12), palette.grass, x, y, z);
  }
  for (const z of [-0.15, 0.15]) {
    part(upper, box(0.24, 0.09, 0.09), palette.camoNet, 0.12, 0.44, z);
    part(upper, box(0.08, 0.08, 0.08), palette.skin, 0.26, 0.44, z * 0.6);
  }
  part(upper, box(0.06, 0.1, 0.1), RAG, 0.02, 0.48, -0.17);
  part(upper, box(0.3, 0.06, 0.06), palette.wood, 0.22, 0.47, 0);
  part(upper, box(0.62, 0.035, 0.035), palette.gunmetal, 0.66, 0.49, 0);
  part(upper, cyl(0.03, 0.03, 0.16, 6), palette.gunmetal, 0.3, 0.54, 0).rotation.z = Math.PI / 2; // scope
  part(upper, new THREE.IcosahedronGeometry(0.23, 1), palette.skin, 0.02, 0.77, 0);
  for (const z of [-0.07, 0.07]) part(upper, box(0.02, 0.05, 0.04), EYES, 0.235, 0.76, z);
  const hood = new THREE.Group();
  hood.position.y = 0.82;
  upper.add(hood);
  partsOf(root).cap = hood;
  part(hood, new THREE.SphereGeometry(0.28, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), palette.camoNet, -0.03, 0, 0);
  for (const z of [-0.14, 0.14]) part(hood, box(0.1, 0.1, 0.1), palette.grass, -0.08, 0.1, z);
}

/**
 * Shock Trooper (UN-01): the MG Soldier 12% larger, with goggles on the helmet, a team armband,
 * a bigger pack and spare drums on the belt. About 470 tris.
 */
function shockTrooper(root: THREE.Object3D, team: Team) {
  mgSoldier(root, team);
  const { upper, cap } = partsOf(root);
  for (const z of [-0.09, 0.09]) part(cap!, box(0.06, 0.07, 0.1), palette.goggleGlass, 0.24, 0.05, z);
  part(cap!, box(0.03, 0.03, 0.42), palette.leather, 0.2, 0.05, 0);
  part(upper!, box(0.1, 0.1, 0.1), teamColour(team), 0.04, 0.44, -0.15);
  part(upper!, box(0.2, 0.3, 0.32), palette.khaki, -0.25, 0.47, 0);
  for (const z of [-0.12, 0.12]) part(upper!, cyl(0.07, 0.07, 0.05, 8), palette.olive, -0.1, 0.3, z).rotation.x = Math.PI / 2;
  for (const c of root.children) {
    c.position.multiplyScalar(1.12);
    c.scale.multiplyScalar(1.12);
  }
}

/**
 * Bazooka Tank (UN-01): a stubby 1.5 m tracked runabout in olive, about the soldier's height.
 * Dark treads with road wheels, a sloped hull with headlights and team stripes front and back,
 * and a round turret (the `upper` part, so it tracks targets apart from the hull) carrying
 * twin rocket tubes and a gunner in the hatch wearing the team helmet. About 900 tris.
 */
function bazookaTank(root: THREE.Object3D, team: Team) {
  // Treads and road wheels.
  for (const z of [-0.5, 0.5]) {
    part(root, box(1.5, 0.34, 0.3), palette.gunmetal, 0, 0.2, z);
    for (const x of [-0.5, -0.17, 0.17, 0.5]) {
      const wheel = part(root, cyl(0.12, 0.12, 0.06, 8), palette.iron, x, 0.17, z * 1.33);
      wheel.rotation.x = Math.PI / 2;
    }
  }
  // Hull: a wide deck over the treads, a sloped glacis, headlights, team stripes front and back.
  part(root, box(1.42, 0.24, 1.18), palette.olive, 0, 0.46, 0);
  part(root, box(1.1, 0.16, 0.9), palette.olive, -0.06, 0.64, 0);
  const glacis = part(root, box(0.3, 0.06, 0.9), palette.olive, 0.62, 0.6, 0);
  glacis.rotation.z = -0.5;
  for (const z of [-0.34, 0.34]) part(root, cyl(0.06, 0.06, 0.05, 8), palette.shearling, 0.72, 0.52, z).rotation.z = Math.PI / 2;
  for (const x of [0.72, -0.72]) part(root, box(0.04, 0.07, 1.0), teamColour(team), x, 0.5, 0);
  part(root, box(1.0, 0.03, 0.08), teamColour(team), -0.06, 0.73, 0.3);
  part(root, box(1.0, 0.03, 0.08), teamColour(team), -0.06, 0.73, -0.3);
  // Turret: ring, twin rocket tubes on the right, gunner in the hatch.
  const upper = new THREE.Group();
  root.add(upper);
  partsOf(root).upper = upper;
  part(upper, cyl(0.34, 0.38, 0.2, 10), palette.olive, -0.1, 0.82, 0);
  for (const y of [0.98, 1.16]) {
    const tube = part(upper, cyl(0.09, 0.09, 0.8, 8), palette.olive, 0.15, y, -0.22);
    tube.rotation.z = Math.PI / 2;
    const mouth = part(upper, cyl(0.065, 0.065, 0.02, 8), palette.gunmetal, 0.56, y, -0.22);
    mouth.rotation.z = Math.PI / 2;
  }
  part(upper, box(0.2, 0.3, 0.12), palette.olive, -0.05, 1.05, -0.22);
  part(upper, new THREE.IcosahedronGeometry(0.16, 1), palette.skin, -0.14, 1.03, 0.08);
  const helmet = new THREE.Group();
  helmet.position.set(-0.14, 1.08, 0.08);
  upper.add(helmet);
  partsOf(root).cap = helmet;
  part(helmet, new THREE.SphereGeometry(0.19, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), teamColour(team), 0, 0, 0);
  part(helmet, cyl(0.22, 0.22, 0.03, 12), teamShade(team), 0, 0.01, 0);
}

/** Mini-boss model ids: real shadows and a big HP bar (D-079). */
export const BOSS_MODELS: ReadonlySet<string> = new Set(['fieldGun', 'halftrack', 'behemoth']);
const championDomeGeo = new THREE.SphereGeometry(1.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const championDomeMat = new THREE.MeshBasicMaterial({ color: palette.brass, transparent: true, opacity: 0.4, depthWrite: false });

// Bosses sheet BS-01 palette.
const BS_OLIVE = 0x6d7a3c;
const BS_HAZARD = 0xd9a628;
const BS_TYRE = 0x3d3e43;
const BS_RUST = 0x7a5236;

/** A deserter standing in a model at (x, z), facing local +x turned by `turn`. */
function crewman(root: THREE.Object3D, variant: number, x: number, z: number, turn: number) {
  const g = new THREE.Group();
  deserter(g, variant);
  g.userData = {}; // its part slots belong to a lone deserter, not to this model
  g.position.set(x, 0, z);
  g.rotation.y = turn;
  root.add(g);
}

/**
 * Field Gun (BS-01): a wheeled howitzer behind a gun shield with a yellow top strip, long barrel
 * and recoil cylinder, spoked rust wheels, two splayed trail legs, an ammo box, a sandbag bed in
 * front, and a crew of two deserters. Faces local +x; about 3 m long. The whole gun turns to its
 * target (the sim sets its facing).
 */
function fieldGun(root: THREE.Object3D) {
  for (const z of [-0.78, 0.78]) {
    part(root, cyl(0.58, 0.58, 0.12, 16), BS_RUST, 0, 0.58, z).rotation.x = Math.PI / 2;
    part(root, cyl(0.16, 0.16, 0.16, 8), BS_TYRE, 0, 0.58, z).rotation.x = Math.PI / 2;
    for (let k = 0; k < 4; k++) part(root, box(0.06, 1.0, 0.05), BS_TYRE, 0, 0.58, z * 1.02).rotation.z = (k * Math.PI) / 4;
  }
  part(root, box(0.3, 0.16, 1.5), palette.gunmetal, 0, 0.58, 0); // axle
  part(root, box(0.1, 0.95, 1.5), BS_OLIVE, 0.32, 0.95, 0); // gun shield
  part(root, box(0.12, 0.12, 1.52), BS_HAZARD, 0.32, 1.46, 0);
  part(root, box(0.6, 0.34, 0.34), BS_OLIVE, 0.1, 0.98, 0); // breech
  part(root, cyl(0.12, 0.15, 2.0, 10), BS_OLIVE, 1.25, 1.02, 0).rotation.z = Math.PI / 2;
  part(root, cyl(0.17, 0.17, 0.14, 10), palette.gunmetal, 2.24, 1.02, 0).rotation.z = Math.PI / 2; // muzzle
  part(root, cyl(0.08, 0.08, 1.0, 8), palette.gunmetal, 0.75, 0.84, 0).rotation.z = Math.PI / 2; // recoil cylinder
  for (const z of [-1, 1]) {
    const leg = part(root, box(1.9, 0.12, 0.14), BS_OLIVE, -1.0, 0.36, z * 0.32);
    leg.rotation.set(0, z * 0.22, 0.24);
    part(root, box(0.2, 0.08, 0.3), palette.gunmetal, -1.9, 0.06, z * 0.52); // spade
  }
  part(root, box(0.42, 0.26, 0.3), BS_OLIVE, -0.5, 0.13, 1.15); // ammo box
  part(root, box(0.44, 0.05, 0.32), BS_HAZARD, -0.5, 0.28, 1.15);
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + (1.8 * i) / 6;
    const bag = part(root, box(0.26, 0.16, 0.5), i % 2 ? palette.sandbagShadow : palette.sandbag, 1.2 + Math.cos(a) * 1.3, 0.08, -Math.sin(a) * 1.3);
    bag.rotation.y = a;
  }
  crewman(root, 1, -0.7, -0.75, 0.3);
  crewman(root, 2, -0.6, 0.55, -0.4);
}

/**
 * Halftrack (BS-01): an armoured truck cab with a grille, headlights and a hazard-striped bumper
 * in front, road wheels under the cab, tracks under the open troop bay at the back, red
 * jerrycans on the flanks, a striped tailgate and a pintle machine gun on a ring over the cab.
 * Faces local +x; about 3.2 m long. It turns to its target as a whole (the sim sets its facing).
 */
function halftrack(root: THREE.Object3D) {
  // Running gear: wheels under the cab, tracks under the bay.
  for (const z of [-0.78, 0.78]) {
    part(root, cyl(0.36, 0.36, 0.26, 12), BS_TYRE, 0.95, 0.36, z).rotation.x = Math.PI / 2;
    part(root, cyl(0.14, 0.14, 0.28, 8), BS_OLIVE, 0.95, 0.36, z * 1.01).rotation.x = Math.PI / 2;
    part(root, box(1.7, 0.5, 0.34), BS_TYRE, -0.62, 0.3, z);
    for (const x of [-1.25, -0.82, -0.4, 0.02]) part(root, cyl(0.16, 0.16, 0.36, 8), palette.gunmetal, x, 0.26, z).rotation.x = Math.PI / 2;
  }
  // Hull: bay at the back, cab and bonnet in front.
  part(root, box(2.0, 0.62, 1.5), BS_OLIVE, -0.55, 0.86, 0);
  part(root, box(1.0, 0.75, 1.4), BS_OLIVE, 0.55, 0.95, 0); // cab
  part(root, box(0.9, 0.06, 1.42), palette.gunmetal, 0.55, 1.35, 0); // cab roof
  part(root, box(0.7, 0.5, 1.2), BS_OLIVE, 1.3, 0.78, 0); // bonnet
  part(root, box(0.06, 0.4, 0.9), palette.gunmetal, 1.66, 0.76, 0); // grille
  for (const z of [-0.45, 0.45]) part(root, cyl(0.1, 0.1, 0.06, 10), palette.shearling, 1.66, 0.98, z).rotation.z = Math.PI / 2;
  for (const z of [-0.3, 0.3]) part(root, box(0.04, 0.12, 0.42), palette.gunmetal, 1.0, 1.15, z); // vision slits
  // Hazard bumper: yellow with dark stripes.
  part(root, box(0.16, 0.2, 1.6), BS_HAZARD, 1.78, 0.42, 0);
  for (let k = 0; k < 5; k++) part(root, box(0.17, 0.21, 0.1), BS_TYRE, 1.78, 0.42, -0.64 + k * 0.32).rotation.x = 0.6;
  // Open bay rim, striped tailgate, red jerrycans on the flanks.
  for (const z of [-0.72, 0.72]) part(root, box(1.9, 0.18, 0.06), BS_OLIVE, -0.55, 1.26, z);
  part(root, box(0.06, 0.3, 1.5), BS_HAZARD, -1.56, 1.0, 0);
  for (let k = 0; k < 4; k++) part(root, box(0.07, 0.31, 0.1), BS_TYRE, -1.56, 1.0, -0.5 + k * 0.33).rotation.x = 0.6;
  for (const z of [-0.8, 0.8]) part(root, box(0.22, 0.3, 0.1), palette.red, 0.1, 0.95, z);
  // Pintle MG over the cab.
  part(root, cyl(0.26, 0.28, 0.12, 10), palette.gunmetal, 0.4, 1.44, 0);
  part(root, box(0.36, 0.16, 0.14), palette.gunmetal, 0.55, 1.6, 0);
  part(root, box(0.6, 0.06, 0.06), palette.gunmetal, 0.95, 1.62, 0);
  part(root, box(0.16, 0.12, 0.14), BS_RUST, 0.42, 1.6, 0.14); // ammo can
}

/**
 * The Behemoth (BS-01): a land ironclad about 5 m long. A stepped, riveted gunmetal hull with rust
 * patches over tracks and road wheels, a bow plough and headlamps in front (+x), four turrets with
 * twin barrels (fore, aft and one each side), two smokestacks with rust caps. It turns as a whole
 * to its first target (the sim sets its facing).
 */
function behemoth(root: THREE.Object3D) {
  const RUST = BS_RUST;
  for (const z of [-1.55, 1.55]) {
    part(root, box(4.6, 0.8, 0.6), BS_TYRE, 0, 0.42, z);
    for (let k = 0; k < 6; k++) part(root, cyl(0.28, 0.28, 0.64, 10), palette.gunmetal, -1.9 + k * 0.76, 0.36, z).rotation.x = Math.PI / 2;
  }
  part(root, box(4.4, 0.9, 2.9), palette.iron, 0, 1.15, 0); // lower hull
  part(root, box(3.4, 0.7, 2.4), palette.gunmetal, -0.2, 1.9, 0); // upper deck
  part(root, box(1.6, 0.6, 1.6), palette.iron, -0.5, 2.55, 0); // bridge
  for (const [x, z, w, d] of [[1.2, 1.0, 0.7, 0.5], [-1.4, -1.2, 0.9, 0.4], [0.3, -1.46, 0.6, 0.06], [-0.6, 1.46, 0.8, 0.06]] as const) {
    part(root, box(w, 0.32, d), RUST, x, 1.35, z); // rust streaks and patches
  }
  for (let k = 0; k < 7; k++) {
    for (const z of [-1.47, 1.47]) part(root, box(0.08, 0.08, 0.04), palette.gunmetal, -1.8 + k * 0.6, 1.5, z); // rivets
  }
  // Bow plough and headlamps.
  const plough = part(root, box(0.3, 0.7, 3.2), RUST, 2.45, 0.55, 0);
  plough.rotation.z = -0.35;
  for (const z of [-0.9, 0.9]) part(root, cyl(0.16, 0.16, 0.1, 10), palette.shearling, 2.22, 1.3, z).rotation.z = Math.PI / 2;
  // Four turrets with twin barrels.
  for (const [x, z, a] of [[1.25, 0, 0], [-1.7, 0, Math.PI], [-0.2, 1.05, Math.PI / 2], [-0.2, -1.05, -Math.PI / 2]] as const) {
    const turret = new THREE.Group();
    turret.position.set(x, 2.25, z);
    turret.rotation.y = a;
    root.add(turret);
    part(turret, cyl(0.42, 0.48, 0.38, 10), palette.gunmetal, 0, 0, 0);
    for (const dz of [-0.12, 0.12]) part(turret, cyl(0.06, 0.07, 1.0, 6), palette.iron, 0.75, 0.04, dz).rotation.z = Math.PI / 2;
  }
  // Twin smokestacks with rust caps.
  for (const z of [-0.45, 0.45]) {
    part(root, cyl(0.2, 0.24, 1.3, 10), palette.iron, -0.9, 3.4, z);
    part(root, cyl(0.25, 0.25, 0.14, 10), RUST, -0.9, 4.1, z);
  }
}

/** Crossed girders: a tank trap (Czech hedgehog), cover dressing in the Behemoth's arena. */
export function tankTrap(root: THREE.Object3D, x: number, z: number, turn: number) {
  for (const [rx, ry, rz] of [[0.6, 0, 0.6], [-0.6, 0, 0.6], [0, Math.PI / 2, 0.9]] as const) {
    const g = part(root, box(1.1, 0.1, 0.1), palette.iron, x, 0.4, z);
    g.rotation.set(rx, ry + turn, rz);
  }
}

/**
 * A boss arena's dressing (map spec), one baked mesh, decoration only:
 * - a mini-boss arena: yellow-black hazard posts round the 6.5 m rim with a gap at each trench
 *   mouth (`gaps`: centre angle and half-width, sim radians) and two sandbag horseshoes at the rim
 *   angles furthest from any mouth;
 * - the Behemoth's (`behemoth`): no posts, four horseshoes and four tank traps between its ways in.
 */
export function createArena(gaps: readonly (readonly [number, number])[], radius = 6.3, behemoth = false): THREE.Object3D {
  const root = new THREE.Group();
  const off = (a: number) => gaps.reduce((m, [c, h]) => Math.min(m, Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) - h), Infinity);
  const posts = behemoth ? 0 : Math.round((2 * Math.PI * radius) / 1.1);
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * 2 * Math.PI;
    if (off(a) < 0) continue;
    const x = Math.cos(a) * radius;
    const z = -Math.sin(a) * radius;
    part(root, box(0.16, 0.42, 0.16), BS_HAZARD, x, 0.21, z);
    part(root, box(0.17, 0.14, 0.17), palette.gunmetal, x, 0.5, z);
    part(root, box(0.17, 0.1, 0.17), BS_HAZARD, x, 0.62, z);
  }
  let best = 0;
  for (let k = 1; k < 36; k++) if (off((k * Math.PI) / 18) > off(best)) best = (k * Math.PI) / 18;
  const spots = behemoth ? [0, 1, 2, 3].map((k) => best + (k * Math.PI) / 2) : [best, best + Math.PI];
  if (behemoth) for (const a of spots) tankTrap(root, Math.cos(a + 0.45) * 6.8, -Math.sin(a + 0.45) * 6.8, a);
  for (const a of spots) {
    const cx = Math.cos(a) * (behemoth ? 5 : 3.8);
    const cz = -Math.sin(a) * (behemoth ? 5 : 3.8);
    for (let i = 0; i < 6; i++) {
      const t = a + Math.PI - 1.2 + (2.4 * i) / 5; // the open side faces out to the rim
      const bag = part(root, box(0.24, 0.16, 0.46), i % 2 ? palette.sandbagShadow : palette.sandbag, cx + Math.cos(t) * 0.8, 0.08, cz - Math.sin(t) * 0.8);
      bag.rotation.y = t;
      part(root, box(0.24, 0.16, 0.46), palette.sandbag, cx + Math.cos(t) * 0.8, 0.24, cz - Math.sin(t) * 0.8).rotation.y = t;
    }
  }
  bake(root, [root]);
  root.traverse((o) => (o.castShadow = o.receiveShadow = true));
  return root;
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

/** Trench medkit crate (GDD §4, map spec "cream medkit crate"): a khaki-banded box with a white cross on the lid. */
export function createMedkit(): THREE.Object3D {
  const root = new THREE.Group();
  part(root, box(0.8, 0.5, 0.55), palette.shearling, 0, 0.25, 0);
  part(root, box(0.82, 0.1, 0.57), palette.khaki, 0, 0.12, 0);
  part(root, box(0.42, 0.02, 0.13), 0xffffff, 0, 0.51, 0);
  part(root, box(0.13, 0.02, 0.42), 0xffffff, 0, 0.51, 0);
  bake(root, [root]);
  root.traverse((o) => (o.castShadow = o.receiveShadow = true));
  return root;
}

/**
 * A deserter camp's campfire (NT-01): a ring of stones, crossed logs and a bright flame, the
 * only warm colour in the Trench so camps are easy to spot. One baked mesh, no light (draw-call
 * budget, D-073).
 */
export function createCampfire(): THREE.Object3D {
  const root = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    part(root, new THREE.IcosahedronGeometry(0.11, 0), palette.concrete, Math.cos(a) * 0.38, 0.07, Math.sin(a) * 0.38);
  }
  part(root, box(0.6, 0.08, 0.1), palette.wood, 0, 0.06, 0).rotation.y = 0.6;
  part(root, box(0.6, 0.08, 0.1), palette.scorched, 0, 0.1, 0).rotation.y = -0.6;
  part(root, new THREE.ConeGeometry(0.18, 0.5, 6), palette.fire, 0, 0.35, 0);
  part(root, new THREE.ConeGeometry(0.1, 0.32, 5), palette.muzzle, 0.03, 0.3, 0.02);
  bake(root, [root]);
  root.traverse((o) => (o.receiveShadow = true));
  return root;
}

/**
 * A sniper nest's sandbag horseshoe (NT-01): three rows round the front, open at the back.
 * Faces local +x (the nearest lane); decoration only, sandbags don't block (D-061).
 */
export function createSniperNest(): THREE.Object3D {
  const root = new THREE.Group();
  for (let row = 0; row < 3; row++) {
    const n = 7 - row;
    for (let i = 0; i < n; i++) {
      const a = -1.6 + (3.2 * (i + (row % 2) * 0.5)) / (n - 1 + (row % 2));
      const bag = part(root, box(0.22, 0.14, 0.42), row % 2 ? palette.sandbagShadow : palette.sandbag, Math.cos(a) * 0.95, 0.07 + row * 0.14, -Math.sin(a) * 0.95);
      bag.rotation.y = a;
    }
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
