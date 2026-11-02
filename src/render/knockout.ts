import * as THREE from 'three';
import { partsOf } from './models';

// Presentation only (GDD §11 animation set: "knock-out — falls with a dust puff and a
// bouncing helmet, then fades").
const FALL_MS = 350;
const FALL_ANGLE = Math.PI * 0.47;
const FADE_START_MS = 1000;
const FADE_MS = 600;
const CAP_GRAVITY = 18; // m/s²
const CAP_BOUNCE = 0.45;

interface Knockout {
  root: THREE.Object3D;
  /** The unit is gone from the sim (minions): remove the model once it has faded. */
  owned: boolean;
  born: number;
  /** Original material of every mesh, restored on respawn; the fading copies replace them. */
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  fades: THREE.MeshLambertMaterial[];
  cap: { obj: THREE.Object3D; parent: THREE.Object3D; local: THREE.Matrix4; vx: number; vy: number; vz: number; spin: number } | undefined;
}

/**
 * Knocked-out models: tip over backwards, the cap flies off and bounces, then everything
 * fades. `restore` puts the model back exactly as it was for the respawn.
 */
export class Knockouts {
  private readonly active = new Map<number, Knockout>();

  constructor(private readonly world: THREE.Object3D, private readonly groundAt: (x: number, z: number) => number) {}

  has(id: number) {
    return this.active.has(id);
  }

  start(id: number, root: THREE.Object3D, now: number) {
    if (this.active.has(id)) return;
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const fades: THREE.MeshLambertMaterial[] = [];
    const ko: Knockout = { root, owned: false, born: now, originals, fades, cap: undefined };
    const cap = partsOf(root).cap;
    if (cap?.parent) {
      const parent = cap.parent;
      const local = cap.matrix.clone();
      this.world.attach(cap); // keeps its world pose, now free of the body
      const back = new THREE.Vector3(-1, 0, 0).applyQuaternion(root.quaternion); // behind the model
      ko.cap = { obj: cap, parent, local, vx: back.x * 1.6, vy: 3.2, vz: back.z * 1.6, spin: 7 };
    }
    for (const obj of [root, ...(ko.cap ? [ko.cap.obj] : [])]) {
      obj.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshLambertMaterial)) return;
        originals.set(o, o.material);
        const fade = o.material.clone();
        fade.transparent = true;
        fades.push(fade);
        o.material = fade;
      });
    }
    this.active.set(id, ko);
  }

  /** The unit left the sim mid-knock-out: this takes the model over and removes it after the fade. */
  own(id: number) {
    const ko = this.active.get(id);
    if (ko) ko.owned = true;
  }

  /** Call every frame after the scene has placed and turned the models. */
  update(now: number, dt: number) {
    for (const [id, ko] of this.active) {
      const age = now - ko.born;
      const fall = Math.min(1, age / FALL_MS);
      ko.root.rotation.z = FALL_ANGLE * fall * fall; // tips back about the feet
      const upper = partsOf(ko.root).upper;
      if (upper) upper.rotation.y = 0;
      const fade = Math.min(1, Math.max(0, (age - FADE_START_MS) / FADE_MS));
      for (const m of ko.fades) m.opacity = 1 - fade;
      ko.root.visible = fade < 1;
      const cap = ko.cap;
      if (cap) {
        const o = cap.obj;
        cap.vy -= CAP_GRAVITY * dt;
        o.position.x += cap.vx * dt;
        o.position.y += cap.vy * dt;
        o.position.z += cap.vz * dt;
        o.rotation.z += cap.spin * dt;
        const ground = this.groundAt(o.position.x, o.position.z) + 0.05;
        if (o.position.y < ground) {
          o.position.y = ground;
          cap.vy = Math.abs(cap.vy) * CAP_BOUNCE;
          cap.vx *= 0.6;
          cap.vz *= 0.6;
          cap.spin *= 0.5;
          if (cap.vy < 0.6) cap.vy = cap.spin = cap.vx = cap.vz = 0;
        }
        o.visible = fade < 1;
      }
      if (ko.owned && fade >= 1) {
        ko.root.removeFromParent();
        ko.cap?.obj.removeFromParent();
        for (const m of ko.fades) m.dispose();
        this.active.delete(id);
      }
    }
  }

  /** Back to the living model (respawn). */
  restore(id: number) {
    const ko = this.active.get(id);
    if (!ko) return;
    for (const [mesh, mat] of ko.originals) mesh.material = mat;
    for (const m of ko.fades) m.dispose();
    ko.root.rotation.z = 0;
    ko.root.visible = true;
    if (ko.cap) {
      const { obj, parent, local } = ko.cap;
      parent.add(obj);
      local.decompose(obj.position, obj.quaternion, obj.scale);
      obj.visible = true;
    }
    this.active.delete(id);
  }
}
