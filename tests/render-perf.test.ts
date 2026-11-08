import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseConfig, rawConfig } from '../src/data/load';
import { createCameraRig, fitShadowBox } from '../src/render/camera';
import { createModel, partsOf } from '../src/render/models';
import { buildTerrain } from '../src/render/terrain';
import { buildTerrainGeometry } from '../src/render/terrain-mesh';
import { HpBars } from '../src/render/hp-bars';
import { SoldierInstances } from '../src/render/soldier-instances';
import { Decals, MAX_DECALS, Particles, SHAPES } from '../src/render/particles';
import { UltFx } from '../src/render/ult-fx';
import type { VfxBurst } from '../src/data/schema';
import type { ZoneSnapshot } from '../src/sim/sim';
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
    [Kind.Champion, 'alpha', 852, 5], // legs, upper, cap + Steady Hand ring + invincibility dome (D-082)
    [Kind.Champion, 'beta', 848, 5], // legs, upper, cap + Light Feet ring + dome
    [Kind.Champion, 'gamma', 932, 5], // legs, upper, helmet + Charge ring + dome
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

describe('shadow box (D-099)', () => {
  const cameraConfig = parseConfig(rawConfig).camera;
  const sunOffset = new THREE.Vector3(-12, 20, 8);

  it.each([
    ['Blue', Team.Blue, 9 / 16],
    ['Red', Team.Red, 9 / 16],
    ['Blue, tall frame', Team.Blue, 9 / 21],
  ] as const)('holds the whole view on the ground for %s, in less than the old 60 m square', (_, team, aspect) => {
    const camera = new THREE.PerspectiveCamera(cameraConfig.fovDeg, aspect, 1, 300);
    createCameraRig(camera, team).update({ x: 7, y: -31, vx: 0, vy: 0 }, cameraConfig, 1 / 60);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const sun = new THREE.DirectionalLight();
    fitShadowBox(sun, sunOffset, camera);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
    const box = sun.shadow.camera;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const ray = new THREE.Vector3(x, y, 0.5).unproject(camera).sub(camera.position);
      const ground = ray.multiplyScalar(-camera.position.y / ray.y).add(camera.position);
      const local = ground.applyMatrix4(box.matrixWorldInverse);
      expect(Math.abs(local.x)).toBeLessThan(box.right);
      expect(Math.abs(local.y)).toBeLessThan(box.top);
    }
    expect((box.right - box.left) * (box.top - box.bottom)).toBeLessThan(60 * 60);
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

describe('soldier instancing (D-101)', () => {
  const camera = new THREE.PerspectiveCamera(35, 0.5, 1, 300);
  camera.position.set(0, 40, 20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const soldier = (x: number, z: number, team = Team.Blue) => {
    const m = createModel(Kind.Minion, 'mgSoldier', team);
    m.position.set(x, 0, z);
    return m;
  };
  const counts = (s: SoldierInstances) => (s.group.children as THREE.InstancedMesh[]).map((m) => m.count);

  it('draws soldiers of one model and team as one mesh per part, each hidden and posed', () => {
    const s = new SoldierInstances();
    const units = [soldier(0, 0), soldier(2, 0), soldier(-2, 1)];
    for (const u of units) s.add(u);
    units[1]!.rotation.y = 1;
    s.draw(camera);
    expect(counts(s)).toEqual([3, 3, 3]);
    expect(units.every((u) => !u.visible)).toBe(true);
    const m = new THREE.Matrix4();
    const layers = s.group.children as THREE.InstancedMesh[];
    layers[0]!.getMatrixAt(1, m);
    expect(m.elements[12]).toBeCloseTo(2);
    partsOf(units[1]!).baked![0]!.matrixWorld.elements.forEach((v, i) => expect(m.elements[i]).toBeCloseTo(v));
  });

  it('gives each team its own parts, and skips what the camera cannot see', () => {
    const s = new SoldierInstances();
    s.add(soldier(0, 0));
    s.add(soldier(0, 0, Team.Red));
    s.add(soldier(500, 0));
    s.draw(camera);
    expect(counts(s)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('leaves a soldier past the cap as its own visible model', () => {
    const s = new SoldierInstances();
    const units = Array.from({ length: 65 }, (_, i) => soldier(i % 5, i % 13));
    for (const u of units) s.add(u);
    s.draw(camera);
    expect(counts(s)).toEqual([64, 64, 64]);
    expect(units.filter((u) => u.visible)).toEqual([units[64]]);
  });

  it('draws nothing once no soldier is added, and leaves champions and bosses out', () => {
    const s = new SoldierInstances();
    s.add(soldier(0, 0));
    s.draw(camera);
    s.draw(camera);
    expect(counts(s)).toEqual([0, 0, 0]);
    expect(s.group.children.every((c) => !c.visible)).toBe(true);
    expect(partsOf(createModel(Kind.Champion, 'alpha', Team.Blue)).baked).toBeUndefined();
    expect(partsOf(createModel(Kind.Neutral, 'fieldGun', Team.Neutral)).baked).toBeUndefined();
  });
});

describe('GPU particles (D-102)', () => {
  const vfx = parseConfig(rawConfig).vfx;
  const pinned = (shape: VfxBurst['shape'], count: number) => ({
    ...vfx,
    density: 1,
    wind: [0, 0] as [number, number],
    presets: { p: [{ ...vfx.presets['death']![0]!, shape, count, life: 1 }] },
  });
  const started = (v: Parameters<Particles['setVfx']>[0]) => {
    const p = new Particles(() => 0, v);
    p.update(0);
    return p;
  };
  const meshes = (p: Particles) => p.group.children as THREE.Mesh<THREE.InstancedBufferGeometry>[];
  const drawn = (p: Particles) => meshes(p).filter((m) => m.visible);

  it('fit the mobile budget of 2,000', () => {
    expect(Object.values(SHAPES).reduce((n, s) => n + s.capacity, 0)).toBeLessThanOrEqual(2000);
  });

  it('every preset in vfx.json compiles (its colours are in the palette)', () => {
    expect(() => new Particles(() => 0, vfx)).not.toThrow();
    const bad = { ...vfx, presets: { p: [{ ...vfx.presets['death']![0]!, colour: ['nope', 'mud'] as [string, string] }] } };
    expect(() => new Particles(() => 0, bad)).toThrow(/nope/);
  });

  it('add no objects or materials however many fire, and draw one mesh per shape', () => {
    const p = started(vfx);
    const before = p.group.children.length;
    for (let i = 0; i < 200; i++) p.emit('explosion', i, 0, 0, 2);
    p.update(16);
    expect(p.group.children).toHaveLength(before);
    expect(new Set(meshes(p).map((m) => m.material)).size).toBe(1);
    expect(drawn(p)).toHaveLength(3); // fireball, debris and smoke, however many blasts
  });

  it('hide once the longest life is over, and restart the ring', () => {
    const p = started(pinned('ico', 5));
    p.emit('p', 0, 0);
    p.update(100);
    expect(p.live).toBe(5);
    expect(drawn(p)[0]!.geometry.instanceCount).toBe(5);
    p.update(5000);
    expect(p.live).toBe(0);
    expect(drawn(p)).toHaveLength(0);
    p.emit('p', 0, 0);
    p.update(5100);
    expect(drawn(p)[0]!.geometry.instanceCount).toBe(5);
  });

  it('reuse the oldest slot and never pass a shape\'s capacity', () => {
    const p = started(pinned('ring', 10));
    for (let i = 0; i < 4; i++) p.emit('p', i, 0);
    p.update(16);
    expect(drawn(p)[0]!.geometry.instanceCount).toBe(SHAPES.ring.capacity);
    expect(p.live).toBe(SHAPES.ring.capacity);
  });

  it('"team" draws as the emit\'s tint', () => {
    const v = pinned('cube', 1);
    v.presets.p[0] = { ...v.presets.p[0]!, colour: ['team', 'mud'] };
    const p = started(v);
    p.emit('p', 0, 0, 0, 1, new THREE.Color(0.25, 0.5, 0.75));
    p.update(16);
    const from = drawn(p)[0]!.geometry.getAttribute('aFrom');
    expect([from.getX(0), from.getY(0), from.getZ(0)]).toEqual([0.25, 0.5, 0.75]);
  });

  it('flames and fire pools emit particles and add no meshes (D-104)', () => {
    const p = started(vfx);
    const decals = new Decals(() => 0);
    const fx = new UltFx(() => 0, p, decals);
    fx.flame(1, true, 6, 1);
    fx.capture([], [{ id: 9, x: 5, y: 5, radius: 3, elapsed: 0, total: 300 } as ZoneSnapshot]);
    const before = fx.group.children.length;
    expect(decals.mesh.count).toBe(1); // the pool's scorch
    fx.placeChampion(1, 0, 0, 0, 0);
    fx.update(0, 0);
    fx.update(0, 100);
    p.update(100);
    expect(p.live).toBeGreaterThanOrEqual(Math.floor(vfx.flameRate * 0.1));
    expect(fx.group.children).toHaveLength(before);
    fx.flame(1, false, 6, 1);
    fx.capture([], []); // the fire is out; the scorch stays
    const live = p.live;
    fx.update(0, 200);
    p.update(200);
    expect(p.live).toBeLessThanOrEqual(live);
    expect(decals.mesh.count).toBeGreaterThanOrEqual(1);
  });

  it('decals stay at 64 and recycle the oldest', () => {
    const d = new Decals(() => 0);
    for (let i = 0; i < 70; i++) d.stamp(i, 0, 1);
    expect(d.mesh.count).toBe(MAX_DECALS);
    const m = new THREE.Matrix4();
    d.mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(64); // the 65th took slot 0
    d.mesh.getMatrixAt(6, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(6);
  });

  it('density scales the counts', () => {
    const p = started({ ...pinned('cube', 10), density: 0.5 });
    p.emit('p', 0, 0);
    p.update(16);
    expect(p.live).toBe(5);
  });

  it('a live edit reaches the next emit', () => {
    const p = started(pinned('cube', 2));
    p.setVfx(pinned('cube', 7));
    p.emit('p', 0, 0);
    p.update(16);
    expect(p.live).toBe(7);
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
