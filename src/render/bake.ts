import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Every baked mesh shares this: flat colours come from vertex colours (D-044). */
export const bakedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const inverse = new THREE.Matrix4();
const local = new THREE.Matrix4();

/**
 * Bakes a primitive model into one mesh per moving part (D-044). Every mesh under `root` is
 * merged into the nearest ancestor in `owners` (the root, or a part the scene animates:
 * upper body, cap, guns, mast …), keeping its transform relative to that owner and its
 * material colour as a vertex colour. Meshes in `keep` (the shield dome, the Steady Hand
 * ring: their own materials) are left alone. Triangles and looks are unchanged; draw calls
 * drop to one per owner.
 */
export function bake(root: THREE.Object3D, owners: readonly THREE.Object3D[], keep: ReadonlySet<THREE.Object3D> = new Set()) {
  root.updateMatrixWorld(true);
  const ownerSet = new Set(owners);
  const buckets = new Map<THREE.Object3D, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !keep.has(o)) meshes.push(o);
  });
  for (const mesh of meshes) {
    let owner: THREE.Object3D | null = mesh.parent;
    while (owner && !ownerSet.has(owner)) owner = owner.parent;
    if (!owner) owner = root;
    inverse.copy(owner.matrixWorld).invert();
    local.multiplyMatrices(inverse, mesh.matrixWorld);
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(local);
    g.deleteAttribute('uv');
    const colour = (mesh.material as THREE.MeshLambertMaterial).color;
    const n = g.attributes.position!.count;
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    let list = buckets.get(owner);
    if (!list) buckets.set(owner, (list = []));
    list.push(g);
    mesh.removeFromParent();
  }
  for (const [owner, list] of buckets) {
    const merged = mergeGeometries(list);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, bakedMaterial);
    mesh.name = 'baked';
    owner.add(mesh);
  }
}
