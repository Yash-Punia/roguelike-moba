import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseConfig, rawConfig } from '../src/data/load';
import { createModel, partsOf } from '../src/render/models';
import { buildTerrain } from '../src/render/terrain';
import { buildTerrainGeometry } from '../src/render/terrain-mesh';
import { HpBars } from '../src/render/hp-bars';
import { Kind, Team } from '../src/sim/sim';

const stats = (o: THREE.Object3D) => {
  let meshes = 0;
  let tris = 0;
  o.traverse((x) => {
    if (x instanceof THREE.Mesh) {
      meshes++;
      const g = x.geometry as THREE.BufferGeometry;
      tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    }
  });
  return { meshes, tris };
};

describe('baked models (D-044)', () => {
  // Triangle counts of the unbaked primitive builds (measured before the bake).
  const cases: [Kind, string, number, number][] = [
    [Kind.Champion, 'alpha', 612, 4], // legs, upper, cap + Steady Hand ring
    [Kind.Champion, 'beta', 608, 4], // legs, upper, cap + Light Feet ring
    [Kind.Champion, 'gamma', 692, 4], // legs, upper, helmet + Charge ring
    [Kind.Minion, 'mgSoldier', 454, 3], // legs, upper, helmet
    [Kind.SubBase, 'subBase', 284, 3], // body, turret, flag
    [Kind.HQ, 'hq', 736, 5], // body, 2 flak mounts, mast, shield dome
  ];

  it.each(cases)('kind %s %s keeps every triangle in a few meshes', (kind, id, tris, meshes) => {
    const s = stats(createModel(kind, id, Team.Blue));
    expect(s.tris).toBe(tris);
    expect(s.meshes).toBe(meshes);
  });

  it('keeps the animation pivots: turning the upper body moves only its geometry', () => {
    const m = createModel(Kind.Champion, 'alpha', Team.Blue);
    const { upper, cap, traitRing } = partsOf(m);
    expect(upper && cap && traitRing).toBeTruthy();
    expect(cap!.parent).toBe(upper);
    const legs = m.children.flatMap((c) => (c instanceof THREE.Mesh ? [c] : c.children.filter((x): x is THREE.Mesh => x instanceof THREE.Mesh)));
    const before = new THREE.Box3().setFromObject(legs[0]!);
    upper!.rotation.y = Math.PI / 2;
    m.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(legs[0]!).equals(before)).toBe(true);
  });

  it('colours vertices from the source materials, team colour included', () => {
    const red = new THREE.Color(0xd23c32);
    const m = createModel(Kind.Minion, 'mgSoldier', Team.Red);
    const helmet = partsOf(m).cap!.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
    const c = helmet.geometry.attributes.color!;
    let found = false;
    for (let i = 0; i < c.count && !found; i++) found = Math.abs(c.getX(i) - red.r) < 1e-6 && Math.abs(c.getY(i) - red.g) < 1e-6;
    expect(found).toBe(true);
  });

  it('shares geometry between instances of the same model and team, with separate parts', () => {
    const a = createModel(Kind.Minion, 'mgSoldier', Team.Blue);
    const b = createModel(Kind.Minion, 'mgSoldier', Team.Blue);
    const ga = (partsOf(a).upper!.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh).geometry;
    const gb = (partsOf(b).upper!.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh).geometry;
    expect(ga).toBe(gb);
    expect(partsOf(a).upper).not.toBe(partsOf(b).upper);
    // Soldiers rely on ground blobs, not shadow-map shadows; champions keep theirs.
    let soldierCasts = false;
    a.traverse((o) => (soldierCasts ||= o.castShadow));
    expect(soldierCasts).toBe(false);
  });
});

describe('terrain tiles (D-044)', () => {
  it('cover exactly the same triangles as the single mesh, in ~12 m tiles', () => {
    const map = parseConfig(rawConfig).map;
    const { tags } = buildTerrainGeometry(map);
    const terrain = buildTerrain(map);
    expect(stats(terrain.mesh).tris).toBe(tags.length);
    expect(terrain.mesh.children.length).toBeGreaterThan(50);
    for (const tile of terrain.mesh.children as THREE.Mesh[]) {
      const box = new THREE.Box3().setFromObject(tile);
      expect(box.max.x - box.min.x).toBeLessThan(12 + 3); // a tile plus the triangles straddling its edge
      expect(box.max.z - box.min.z).toBeLessThan(12 + 3);
    }
  });
});

describe('instanced HP bars (D-044)', () => {
  const camera = new THREE.PerspectiveCamera();

  it('draw every bar in three instanced meshes, with a tick per 250 HP (1,000 on structures)', () => {
    const layer = new HpBars();
    const a = layer.create(Kind.Champion, Team.Blue);
    a.set(700, 1000); // ticks at 250, 500, 750
    const b = layer.create(Kind.SubBase, Team.Red);
    b.set(6000, 6000); // ticks every 1,000: 5
    layer.update(camera);
    const [backs, fills, ticks] = layer.group.children as THREE.InstancedMesh[];
    expect(layer.group.children).toHaveLength(3);
    expect([backs!.count, fills!.count, ticks!.count]).toEqual([2, 2, 8]);
    b.visible = false;
    layer.update(camera);
    expect([backs!.count, fills!.count, ticks!.count]).toEqual([1, 1, 3]);
    a.dispose();
    layer.update(camera);
    expect(backs!.count).toBe(0);
  });

  it('grow past their starting capacity', () => {
    const layer = new HpBars(2, 4);
    for (let i = 0; i < 10; i++) layer.create(Kind.Champion, Team.Blue).set(1000, 1000);
    layer.update(camera);
    const [backs, , ticks] = layer.group.children as THREE.InstancedMesh[];
    expect(backs!.count).toBe(10);
    expect(ticks!.count).toBe(30);
  });
});
