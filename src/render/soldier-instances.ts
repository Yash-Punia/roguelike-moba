import * as THREE from 'three';
import { bakedMaterial } from './bake';
import { partsOf } from './models';

/** Instances of one baked part in view; far more than a frame can show. */
const MAX_IN_VIEW = 64;
/** A soldier's rough bounds, for the camera test (m). */
const SOLDIER_RADIUS = 2;

/**
 * Live soldiers and camp units, one draw per baked part of each model and team (D-101). A soldier
 * here hides its own model, which stays in the scene and keeps being posed: a knock-out or a
 * concealment fade simply shows the model again and works on it as before.
 */
export class SoldierInstances {
  readonly group = new THREE.Group();
  private readonly layers = new Map<THREE.BufferGeometry, THREE.InstancedMesh>();
  private readonly roots: THREE.Object3D[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProjection = new THREE.Matrix4();
  private readonly bounds = new THREE.Sphere(new THREE.Vector3(), SOLDIER_RADIUS);

  /** Draws this model instanced in the next `draw`. */
  add(root: THREE.Object3D) {
    root.visible = false;
    this.roots.push(root);
  }

  /** Writes every soldier in view (call after the camera moved). Off-screen ones cost no triangles. */
  draw(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const layer of this.layers.values()) layer.count = 0;
    for (const root of this.roots) {
      this.bounds.center.copy(root.position);
      if (!this.frustum.intersectsSphere(this.bounds)) continue;
      for (const part of partsOf(root).baked!) {
        const layer = this.layer(part.geometry);
        if (layer.count >= MAX_IN_VIEW) continue;
        part.updateWorldMatrix(true, false);
        layer.setMatrixAt(layer.count++, part.matrixWorld);
      }
    }
    for (const layer of this.layers.values()) {
      layer.visible = layer.count > 0;
      layer.instanceMatrix.needsUpdate = true;
    }
    this.roots.length = 0;
  }

  private layer(geometry: THREE.BufferGeometry) {
    let layer = this.layers.get(geometry);
    if (!layer) {
      layer = new THREE.InstancedMesh(geometry, bakedMaterial, MAX_IN_VIEW);
      layer.count = 0;
      layer.frustumCulled = false; // culled per soldier in `draw`
      layer.receiveShadow = true;
      this.layers.set(geometry, layer);
      this.group.add(layer);
    }
    return layer;
  }
}
