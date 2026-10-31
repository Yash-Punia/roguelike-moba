import * as THREE from 'three';
import type { Config } from '../data/schema';
import { Team, type Snapshot } from '../sim/sim';
import { palette } from './palette';

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

  buildArena(scene, config);

  const camera = new THREE.PerspectiveCamera(config.camera.fovDeg, 1, 1, 300);

  const championGeo = new THREE.CapsuleGeometry(0.5, 0.8, 2, 8);
  const noseGeo = new THREE.BoxGeometry(0.5, 0.18, 0.18);
  const teamMat = { [Team.Blue]: lambert(palette.blue), [Team.Red]: lambert(palette.red), [Team.Neutral]: lambert(palette.olive) };
  const noseMat = lambert(palette.gunmetal);

  const meshes = new Map<number, THREE.Object3D>();
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
        const body = new THREE.Mesh(championGeo, teamMat[e.team]);
        const nose = new THREE.Mesh(noseGeo, noseMat);
        nose.position.set(0.55, 0.2, 0);
        body.add(nose);
        body.position.y = 0.9;
        const root = new THREE.Group();
        root.add(body);
        root.traverse((o) => (o.castShadow = true));
        scene.add(root);
        meshes.set(e.id, root);
      }
      s.px = s.x; s.py = s.y; s.pf = s.f;
      s.x = e.x; s.y = e.y; s.f = e.facing;
      s.vx = e.vx; s.vy = e.vy;
    }
    for (const [id, mesh] of meshes) {
      if (seen.has(id)) continue;
      scene.remove(mesh);
      meshes.delete(id);
      interp.delete(id);
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
      mesh.position.set(x, 0, -y);
      mesh.rotation.y = lerpAngle(s.pf, s.f, alpha);
      if (id === focusId) Object.assign(focus, { x, y, vx: s.vx, vy: s.vy });
    }
    sun.target.position.set(focus.x, 0, -focus.y);
    sun.position.copy(sun.target.position).add(sunOffset);
  }

  function render() {
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

  return { renderer, camera, focus, capture, update, render };
}

function lerpAngle(a: number, b: number, t: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function buildArena(scene: THREE.Scene, config: Config) {
  const { bounds, lanes, laneWidth, obstacles, hq } = config.map;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lambert(palette.olive));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, -cy);
  ground.receiveShadow = true;
  scene.add(ground);

  const laneLength = hq.red.y - hq.blue.y;
  for (const lane of lanes) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth, laneLength), lambert(palette.mud));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(lane.x, 0.01, -(hq.blue.y + hq.red.y) / 2);
    strip.receiveShadow = true;
    scene.add(strip);
  }

  for (const o of obstacles) {
    const height = o.kind === 'hq' ? 3 : 1;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(o.w, height, o.h),
      lambert(o.kind === 'hq' ? palette.concrete : palette.khaki),
    );
    box.position.set(o.x, height / 2, -o.y);
    box.castShadow = box.receiveShadow = true;
    scene.add(box);
    if (o.kind === 'hq') {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(o.w + 0.05, 0.4, o.h + 0.05),
        lambert(o.y < 0 ? palette.blue : palette.red),
      );
      stripe.position.set(o.x, height - 0.3, -o.y);
      scene.add(stripe);
    }
  }
}
