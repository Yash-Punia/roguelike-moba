import * as THREE from 'three';
import type { Config, MapConfig } from '../data/schema';
import { Team, type Snapshot } from '../sim/sim';
import { HpBar } from './hp-bars';
import { createModel, createSpawnPad } from './models';
import { palette } from './palette';
import { buildSurround, buildTerrain } from './terrain';

const coarsePointer = matchMedia('(pointer: coarse)').matches;

interface Interp {
  px: number; py: number; pf: number;
  x: number; y: number; f: number;
  vx: number; vy: number;
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

/** Three.js world. Only reads snapshots; never writes sim state. Sim (x, y) → three (x, height, −y). */
export function createScene(container: HTMLElement, config: Config) {
  const renderer = new THREE.WebGLRenderer({ antialias: !coarsePointer });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarsePointer ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.haze);

  // Lights: warm late-afternoon sun at ~45°, cool hemisphere fill (GDD §11).
  scene.add(new THREE.HemisphereLight(0xbcd3e6, palette.mud, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  const sunOffset = new THREE.Vector3(-12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(coarsePointer ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 80 });
  scene.add(sun, sun.target);

  let arena = buildArena(config.map);
  scene.add(arena.group);

  const camera = new THREE.PerspectiveCamera(config.camera.fovDeg, 1, 1, 300);

  const meshes = new Map<number, THREE.Object3D>();
  const bars = new Map<number, HpBar>();
  const interp = new Map<number, Interp>();
  const seen = new Set<number>();

  /** Call after every sim tick: shifts current → previous. */
  function capture(snap: Snapshot) {
    seen.clear();
    for (const e of snap.entities) {
      seen.add(e.id);
      let s = interp.get(e.id);
      if (!s) {
        s = { px: e.x, py: e.y, pf: e.facing, x: e.x, y: e.y, f: e.facing, vx: 0, vy: 0 };
        interp.set(e.id, s);
        const root = createModel(e.kind, e.modelId, e.team);
        scene.add(root);
        meshes.set(e.id, root);
      }
      let bar = bars.get(e.id);
      if (!bar && e.maxHp > 0) {
        bar = new HpBar(e.kind, e.team);
        scene.add(bar.group);
        bars.set(e.id, bar);
      }
      bar?.set(e.hp, e.maxHp);
      s.px = s.x; s.py = s.y; s.pf = s.f;
      s.x = e.x; s.y = e.y; s.f = e.facing;
      s.vx = e.vx; s.vy = e.vy;
    }
    for (const [id, mesh] of meshes) {
      if (seen.has(id)) continue;
      scene.remove(mesh);
      meshes.delete(id);
      interp.delete(id);
      const bar = bars.get(id);
      if (bar) scene.remove(bar.group);
      bars.delete(id);
    }
  }

  /** Interpolated position and velocity of the followed entity (sim space). */
  const focus = { x: 0, y: 0, vx: 0, vy: 0 };

  /** Interpolates every entity by alpha and updates `focus` from the followed one. */
  function update(alpha: number, focusId: number | undefined) {
    for (const [id, s] of interp) {
      const mesh = meshes.get(id)!;
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      mesh.position.set(x, arena.terrain.heightAt(x, y), -y);
      mesh.rotation.y = lerpAngle(s.pf, s.f, alpha);
      const bar = bars.get(id);
      if (bar) bar.group.position.set(x, mesh.position.y + bar.lift, -y);
      if (id === focusId) Object.assign(focus, { x, y, vx: s.vx, vy: s.vy });
    }
    sun.target.position.set(focus.x, 0, -focus.y);
    sun.position.copy(sun.target.position).add(sunOffset);
  }

  function render() {
    // Bars face the camera; done here because the camera rig moves after update().
    for (const bar of bars.values()) bar.group.quaternion.copy(camera.quaternion);
    renderer.render(scene, camera);
  }

  function resize(width: number, height: number) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(([entry]) => {
    if (entry) resize(entry.contentRect.width, entry.contentRect.height);
  });
  ro.observe(container);

  /** Rebuilds the static map (terrain, pads, obstacles) after a live map edit. */
  function setMap(map: MapConfig) {
    scene.remove(arena.group);
    arena.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    arena = buildArena(map);
    scene.add(arena.group);
  }

  return { renderer, camera, focus, capture, update, render, setMap };
}

function lerpAngle(a: number, b: number, t: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** Static map: terrain, the area outside the bounds, spawn pads and obstacle blocks. */
function buildArena(map: MapConfig) {
  const group = new THREE.Group();
  const terrain = buildTerrain(map);
  group.add(terrain.mesh, buildSurround(map));

  for (const team of [Team.Blue, Team.Red]) {
    const at = team === Team.Blue ? map.spawn.blue : map.spawn.red;
    const pad = createSpawnPad(team);
    pad.position.set(at.x, terrain.heightAt(at.x, at.y), -at.y);
    group.add(pad);
  }

  for (const o of map.obstacles) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, 1, o.h), lambert(palette.sandbag));
    box.position.set(o.x, 0.5, -o.y);
    box.castShadow = box.receiveShadow = true;
    group.add(box);
  }
  return { group, terrain };
}
