import * as THREE from 'three';
import type { Config, MapConfig } from '../data/schema';
import type { SimEvent } from '../sim/events';
import { Kind, Team, type Snapshot } from '../sim/sim';
import { displayTeam } from '../sim/sides';
import { DamageNumbers, damageColours } from './damage-numbers';
import { HpBars, type HpBar } from './hp-bars';
import { createCave, createModel, createSpawnPad, partsOf } from './models';
import { UltFx } from './ult-fx';
import { bake } from './bake';
import { Knockouts } from './knockout';
import { TargetLine } from './target-line';
import { Tracers } from './tracers';
import { palette } from './palette';
import { buildSurround, buildTerrain } from './terrain';

const coarsePointer = matchMedia('(pointer: coarse)').matches;
/** Metres (Manhattan) moved in one tick that count as a teleport rather than movement. */
const SNAP_DISTANCE = 5;
/** Ground blob under each soldier, in place of a shadow-map shadow (D-044). */
const BLOB_RADIUS = 0.42;
/** A fallen structure sinks to this share of its height over COLLAPSE_MS, then stays as rubble. */
const RUBBLE_HEIGHT = 0.35;
const COLLAPSE_MS = 600;
const rubbleTint = new THREE.Color(palette.scorched);

/** The HQ's mast falls over this long after the HQ does (GDD §11 "mast topples"). */
const MAST_FALL_MS = 800;
/** HQ destruction: a chain of this many blasts over the bunker, this far apart (GDD §11). */
const HQ_BLASTS = 5;
const HQ_BLAST_GAP_MS = 120;

/** Starts a structure's collapse: guns and flag go, and the concrete darkens towards scorched earth. */
function collapse(root: THREE.Object3D, s: { fellAt: number }, now: number) {
  s.fellAt = now;
  for (const o of partsOf(root).standing ?? []) o.visible = false;
  const shield = partsOf(root).shield;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o === shield || !(o.material instanceof THREE.MeshLambertMaterial)) return;
    const m = o.material.clone();
    m.color.lerp(rubbleTint, 0.45);
    o.material = m;
  });
}

interface Interp {
  /** Previous and current position, aim (pf, f) and leg facing (pl, l). */
  px: number; py: number; pf: number; pl: number;
  x: number; y: number; f: number; l: number;
  vx: number; vy: number;
  /** Interpolated position this frame. */
  ix: number; iy: number;
  targetId: number;
  radius: number;
  kind: Kind;
  /** Structures: when it fell (ms), for the collapse; 0 while standing. */
  fellAt: number;
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

/** Three.js world. Only reads snapshots; never writes sim state. Sim (x, y) → three (x, height, −y). */
/**
 * `viewer`: the local player's true team. Every team colour is drawn from their side of the
 * fight: their team in Blue, the enemy in Red (GDD §10, D-039).
 */
export function createScene(container: HTMLElement, config: Config, viewer: Team = Team.Blue) {
  const side = (t: Team) => displayTeam(t, viewer);
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

  let arena = buildArena(config.map, side);
  scene.add(arena.group);

  const camera = new THREE.PerspectiveCamera(config.camera.fovDeg, 1, 1, 300);

  const meshes = new Map<number, THREE.Object3D>();
  const bars = new Map<number, HpBar>();
  // Soldiers cast no shadow-map shadows; one instanced soft disc sits under each instead (D-044).
  const blobs = new THREE.InstancedMesh(
    new THREE.CircleGeometry(BLOB_RADIUS, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    128,
  );
  blobs.count = 0;
  blobs.frustumCulled = false;
  blobs.renderOrder = 1;
  scene.add(blobs);
  const blobMatrix = new THREE.Matrix4();
  // Every HP bar in three instanced draws (D-044).
  const barLayer = new HpBars();
  scene.add(barLayer.group);
  const tracers = new Tracers((x, y) => arena.terrain.heightAt(x, y));
  scene.add(tracers.mesh);
  const ultFx = new UltFx((x, y) => arena.terrain.heightAt(x, y));
  scene.add(ultFx.group);
  const knockouts = new Knockouts(scene, (x, z) => arena.terrain.heightAt(x, -z));
  let lastUpdate = performance.now();
  /**
   * Render clock (ms) for every effect timing: real time × `timeScale`. The HQ's slow motion
   * scales it while the sim itself is frozen (D-038).
   */
  let clock = performance.now();
  let timeScale = 1;
  const blastQueue: { x: number; y: number; at: number }[] = [];
  const toppling: { mast: THREE.Object3D; from: THREE.Quaternion; born: number }[] = [];
  const tipAxis = new THREE.Vector3(0, 0, 1);
  const tip = new THREE.Quaternion();
  const teams = new Map<number, Team>();
  const interp = new Map<number, Interp>();
  const seen = new Set<number>();
  const damageNumbers = new DamageNumbers(container);
  /** Team of the followed champion: damage to it and its allies shows white, to enemies gold. */
  let localTeam: Team | undefined;

  /** Call after every sim tick: shifts current → previous. */
  function capture(snap: Snapshot) {
    seen.clear();
    for (const e of snap.entities) {
      seen.add(e.id);
      let s = interp.get(e.id);
      if (!s) {
        s = { px: e.x, py: e.y, pf: e.aim, pl: e.facing, x: e.x, y: e.y, f: e.aim, l: e.facing, vx: 0, vy: 0, ix: e.x, iy: e.y, targetId: 0, radius: e.radius, kind: e.kind, fellAt: 0 };
        interp.set(e.id, s);
        teams.set(e.id, e.team);
        const root = createModel(e.kind, e.modelId, side(e.team));
        scene.add(root);
        meshes.set(e.id, root);
      }
      let bar = bars.get(e.id);
      if (!bar && e.maxHp > 0) {
        bar = barLayer.create(e.kind, side(e.team));
        bars.set(e.id, bar);
      }
      bar?.set(e.hp, e.maxHp);
      if (bar && e.kind === Kind.Champion) bar.setLevel(e.level);
      if (bar) bar.visible = e.hp > 0;
      // While channelling Lead Storm the upper body sprays along the strip, not at the weapon target.
      const aim = e.channel !== 0 ? e.channelAngle : e.aim;
      // A jump this big in one tick is a teleport (respawn): don't streak across the map.
      if (Math.abs(e.x - s.x) + Math.abs(e.y - s.y) > SNAP_DISTANCE) {
        s.x = e.x;
        s.y = e.y;
        s.l = e.facing;
        s.f = aim;
      }
      s.px = s.x; s.py = s.y; s.pf = s.f; s.pl = s.l;
      s.x = e.x; s.y = e.y; s.f = aim; s.l = e.facing;
      if (e.kind === Kind.Champion) {
        const def = config.champions.find((c) => c.id === e.modelId);
        const ult = def?.ultimate;
        if (ult?.id === 'leadStorm' && e.channel !== 0) ultFx.storm(e.id, e.channel, ult.length, ult.width);
        else ultFx.storm(e.id, 0, 0, 0);
        if (ult?.id === 'heatWave') ultFx.heatWave(e.id, e.aura > 0 && e.hp > 0, ult.radius);
        if (def?.weapon.kind === 'cone') ultFx.flame(e.id, e.firing && e.hp > 0, def.weapon.range, def.weapon.coneAngle);
      }
      const parts = partsOf(meshes.get(e.id)!);
      if (parts.traitRing) parts.traitRing.visible = e.traitActive && e.hp > 0;
      if (parts.shield) parts.shield.visible = e.invulnerable && !e.destroyed;
      if (e.destroyed && s.fellAt === 0) {
        const root = meshes.get(e.id)!;
        collapse(root, s, clock);
        // The mast leaves the bunker (so the collapse doesn't squash it) and topples on its own.
        const mast = partsOf(root).mast;
        if (mast) {
          scene.attach(mast);
          toppling.push({ mast, from: mast.quaternion.clone(), born: clock });
        }
      }
      s.vx = e.vx; s.vy = e.vy;
      s.targetId = e.targetId;
      s.radius = e.radius;
    }
    tracers.capture(snap.projectiles, viewer);
    ultFx.capture(snap.lobs, snap.zones);
    for (const [id, mesh] of meshes) {
      if (seen.has(id)) continue;
      // A minion removed on its knock-out tick: the knock-out keeps the model until it fades.
      if (knockouts.has(id)) knockouts.own(id);
      else scene.remove(mesh);
      meshes.delete(id);
      interp.delete(id);
      teams.delete(id);
      bars.get(id)?.dispose();
      bars.delete(id);
    }
  }

  /** Call after every sim tick with its events (after `capture`), for damage numbers. */
  function addEvents(events: readonly SimEvent[]) {
    const now = clock;
    for (const ev of events) {
      if (ev.type === 'explosion') ultFx.explode(ev.x, ev.y, ev.radius, now);
      if (ev.type === 'powerPicked') {
        const s = interp.get(ev.id);
        const name = config.powers.powers.find((p) => p.id === ev.power)?.name ?? ev.power;
        if (s) {
          const lift = (bars.get(ev.id)?.lift ?? 2) + 0.9;
          damageNumbers.spawn(s.x, arena.terrain.heightAt(s.x, s.y) + lift, -s.y, `+ ${name}`, damageColours.level, false, now);
        }
      }
      if (ev.type === 'levelUp') {
        const s = interp.get(ev.id);
        if (s) {
          ultFx.levelUp(s.x, s.y, now);
          const lift = (bars.get(ev.id)?.lift ?? 2) + 0.9;
          damageNumbers.spawn(s.x, arena.terrain.heightAt(s.x, s.y) + lift, -s.y, `LEVEL ${ev.level}`, damageColours.level, true, now);
        }
      }
      if (ev.type === 'structureDestroyed' && ev.kind === 'hq') {
        // A chain of explosions across the bunker (GDD §11).
        for (let i = 0; i < HQ_BLASTS; i++) {
          const a = i * 2.4;
          blastQueue.push({ x: ev.x + Math.cos(a) * 1.6, y: ev.y + Math.sin(a) * 1.4, at: now + i * HQ_BLAST_GAP_MS });
        }
      }
      if (ev.type === 'structureDestroyed') {
        // Roof caves in: a dust and smoke column (GDD §11), then rubble for the rest of the match.
        ultFx.smoke(ev.x, ev.y, 3.2, palette.smoke, 10, now);
        ultFx.smoke(ev.x, ev.y, 2, palette.mud, 6, now);
      }
      if (ev.type === 'death') {
        const mesh = meshes.get(ev.id);
        if (mesh) knockouts.start(ev.id, mesh, now);
        ultFx.smoke(ev.x, ev.y, 1.4, palette.mud, 4, now);
      }
      if (ev.type === 'respawn') {
        knockouts.restore(ev.id);
        ultFx.smoke(ev.x, ev.y, 2, palette.smoke, 7, now); // smoke-grenade pop on the pad
      }
      if (ev.type !== 'damage') continue;
      const s = interp.get(ev.target);
      if (!s) continue;
      const lift = bars.get(ev.target)?.lift ?? 2;
      const ally = teams.get(ev.target) === localTeam;
      const hpLost = ev.amount - ev.absorbed;
      const text = ev.saved ? 'SAVED' : `${Math.round(ev.amount)}${ev.critical ? '!' : ''}`;
      const colour = hpLost <= 0 && !ev.saved ? damageColours.absorbed : ally ? damageColours.ally : damageColours.enemy;
      damageNumbers.spawn(s.x, arena.terrain.heightAt(s.x, s.y) + lift + 0.5, -s.y, text, colour, ev.critical || ev.saved, now);
    }
  }

  // The followed champion's target line, coloured for its team on first sight.
  let targetLine: TargetLine | undefined;

  /** Interpolated position and velocity of the followed entity (sim space). */
  const focus = { x: 0, y: 0, vx: 0, vy: 0 };

  /**
   * Interpolates every entity by alpha. `localId` is the player's champion (team colours,
   * target line); `focusId` is what the camera follows (the killer while knocked out).
   */
  function update(alpha: number, localId: number | undefined, focusId = localId) {
    const real = performance.now();
    const dt = Math.min(0.1, (real - lastUpdate) / 1000) * timeScale;
    lastUpdate = real;
    clock += dt * 1000;
    const now = clock;
    let blobCount = 0;
    for (let i = blastQueue.length - 1; i >= 0; i--) {
      const b = blastQueue[i]!;
      if (b.at > now) continue;
      ultFx.explode(b.x, b.y, 2.2, now);
      blastQueue.splice(i, 1);
    }
    for (const t of toppling) {
      const k = Math.min(1, (now - t.born) / MAST_FALL_MS);
      tip.setFromAxisAngle(tipAxis, (Math.PI / 2) * 0.95 * k * k);
      t.mast.quaternion.copy(t.from).multiply(tip);
    }
    for (const [id, s] of interp) {
      const mesh = meshes.get(id)!;
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      s.ix = x;
      s.iy = y;
      mesh.position.set(x, arena.terrain.heightAt(x, y), -y);
      if (s.kind === Kind.Minion && blobCount < blobs.instanceMatrix.count) {
        blobMatrix.makeTranslation(x, mesh.position.y + 0.03, -y);
        blobs.setMatrixAt(blobCount++, blobMatrix);
      }
      // Minions march with a bouncy stride (UN-01).
      if (s.kind === Kind.Minion && (s.vx !== 0 || s.vy !== 0)) mesh.position.y += Math.abs(Math.sin(now * 0.016 + id)) * 0.07;
      // Units turn their legs with the movement facing and the upper body with the aim;
      // structures stay put and turn only their guns.
      const aim = lerpAngle(s.pf, s.f, alpha);
      const facing = lerpAngle(s.pl, s.l, alpha);
      const { upper, aimParts } = partsOf(mesh);
      mesh.rotation.y = upper || aimParts ? facing : aim;
      if (upper) upper.rotation.y = aim - facing;
      if (s.kind === Kind.Champion) ultFx.placeChampion(id, x, y, aim, now);
      if (aimParts && s.fellAt === 0) for (const g of aimParts) g.rotation.y = aim - facing;
      if (s.fellAt > 0) {
        const t = Math.min(1, (now - s.fellAt) / COLLAPSE_MS);
        mesh.scale.y = 1 - (1 - RUBBLE_HEIGHT) * t * t;
      }
      const bar = bars.get(id);
      if (bar) bar.setPosition(x, mesh.position.y + bar.lift, -y);
      if (id === focusId) Object.assign(focus, { x, y, vx: s.vx, vy: s.vy });
    }
    blobs.count = blobCount;
    blobs.instanceMatrix.needsUpdate = true;
    knockouts.update(now, dt);
    tracers.update(alpha);
    ultFx.update(alpha, now);
    const me = localId === undefined ? undefined : interp.get(localId);
    const target = me && me.targetId ? interp.get(me.targetId) : undefined;
    if (me) localTeam = teams.get(localId!);
    if (me && !targetLine) {
      targetLine = new TargetLine(side(teams.get(localId!) ?? viewer));
      scene.add(targetLine.group);
    }
    if (me && target) {
      const h = arena.terrain.heightAt;
      targetLine!.show(me.ix, me.iy, h(me.ix, me.iy), target.ix, target.iy, h(target.ix, target.iy), target.radius);
    } else {
      targetLine?.hide();
    }
    sun.target.position.set(focus.x, 0, -focus.y);
    sun.position.copy(sun.target.position).add(sunOffset);
  }

  function render() {
    // Bars face the camera; done here because the camera rig moves after update().
    barLayer.update(camera);
    renderer.render(scene, camera);
    damageNumbers.update(camera, container.clientWidth, container.clientHeight, clock);
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
    arena = buildArena(map, side);
    scene.add(arena.group);
  }

  /** Slows (or speeds) every render-side effect; 1 = real time. */
  function setTimeScale(s: number) {
    timeScale = s;
  }

  return { renderer, camera, focus, capture, addEvents, update, render, setMap, setTimeScale };
}

function lerpAngle(a: number, b: number, t: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** Static map: terrain, the area outside the bounds, spawn pads and obstacle blocks. */
function buildArena(map: MapConfig, side: (t: Team) => Team) {
  const group = new THREE.Group();
  const terrain = buildTerrain(map);
  group.add(terrain.mesh, buildSurround(map));

  for (const team of [Team.Blue, Team.Red]) {
    const at = team === Team.Blue ? map.spawn.blue : map.spawn.red;
    const pad = createSpawnPad(side(team));
    pad.position.set(at.x, terrain.heightAt(at.x, at.y), -at.y);
    group.add(pad);
  }
  // Wave caves behind the HQs (D-051), mouths facing their HQ.
  for (const c of map.caves) {
    const team = c.team === 'blue' ? Team.Blue : Team.Red;
    const cave = createCave(side(team));
    cave.position.set(c.x, terrain.heightAt(c.x, c.y), -c.y);
    cave.rotation.y = team === Team.Blue ? 0 : Math.PI;
    group.add(cave);
  }

  // Sandbag blocks, baked into one mesh (D-044).
  if (map.obstacles.length > 0) {
    const blocks = new THREE.Group();
    const sandbag = lambert(palette.sandbag);
    for (const o of map.obstacles) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(o.w, 1, o.h), sandbag);
      box.position.set(o.x, 0.5, -o.y);
      blocks.add(box);
    }
    bake(blocks, [blocks]);
    blocks.traverse((m) => (m.castShadow = m.receiveShadow = true));
    group.add(blocks);
  }
  return { group, terrain };
}
