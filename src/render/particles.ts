import * as THREE from 'three';
import type { Config, VfxBurst } from '../data/schema';
import { palette } from './palette';

type HeightAt = (x: number, y: number) => number;
type Vfx = Config['vfx'];
type Shape = VfxBurst['shape'];

/** Floats per particle: the five vec4 attributes in the vertex shader. */
const STRIDE = 20;
/** Each particle's life and throw vary by this share, so a burst isn't a perfect ring. */
const JITTER = 0.15;
const TAU = Math.PI * 2;

const star = () => {
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const r = i % 2 === 0 ? 1 : 0.32;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
};

/**
 * The meshes, in the units a burst's `size` scales. Each is one draw while anything of it is
 * live, and a ring of its own, so a burst of one kind can't evict another. The capacities add
 * up to the TDD's mobile budget of 2,000 live particles.
 */
export const SHAPES: Record<Shape, { make: () => THREE.BufferGeometry; capacity: number; order: number }> = {
  star: { make: star, capacity: 128, order: 3 },
  cube: { make: () => new THREE.BoxGeometry(1, 1, 1), capacity: 384, order: 2 },
  ico: { make: () => new THREE.IcosahedronGeometry(1, 0), capacity: 640, order: 3 },
  ball: { make: () => new THREE.IcosahedronGeometry(1, 1), capacity: 48, order: 3 },
  cone: { make: () => new THREE.ConeGeometry(0.32, 1.05, 5, 1, true).translate(0, 0.52, 0), capacity: 640, order: 2 },
  ring: { make: () => new THREE.RingGeometry(0.93, 1, 24).rotateX(-Math.PI / 2), capacity: 32, order: 2 },
  pillar: { make: () => new THREE.CylinderGeometry(0.55, 0.7, 2.4, 16, 1, true).translate(0, 1.2, 0), capacity: 16, order: 3 },
};

const vertexShader = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
attribute vec4 aStart;    // world position, born (s)
attribute vec4 aVelocity; // m/s, life (s)
attribute vec4 aFrom;     // colour, size at birth
attribute vec4 aTo;       // colour, size at death
attribute vec4 aMotion;   // gravity, alpha, spin, wind share
varying vec4 vColour;
const vec3 SUN = vec3(-0.47, 0.78, 0.31); // the scene's sun direction
void main() {
  float age = uTime - aStart.w;
  float t = age / aVelocity.w;
  if (t < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // dead: outside the clip box, no fragments
    vColour = vec4(0.0);
    return;
  }
  float ease = 1.0 - (1.0 - t) * (1.0 - t);
  vec3 p = position * mix(aFrom.w, aTo.w, ease);
  vec3 n = normal;
  if (aMotion.z != 0.0) {
    float seed = float(gl_InstanceID) * 2.399;
    vec3 axis = normalize(vec3(sin(seed), 0.7, cos(seed)));
    float a = aMotion.z * (age + 1.0);
    float c = cos(a);
    float s = sin(a);
    p = p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
    n = n * c + cross(axis, n) * s + axis * dot(axis, n) * (1.0 - c);
  }
  vec3 world = aStart.xyz + aVelocity.xyz * age + uWind * aMotion.w * age;
  world.y += p.y - 0.5 * aMotion.x * age * age;
  world.xz += p.xz;
  float light = 0.7 + 0.4 * max(dot(n, SUN), 0.0); // facets, so a puff reads as a solid and not a flat hexagon
  vColour = vec4(mix(aFrom.rgb, aTo.rgb, t) * light, aMotion.y * (1.0 - t));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const fragmentShader = /* glsl */ `
varying vec4 vColour;
void main() {
  gl_FragColor = vColour;
  #include <colorspace_fragment>
}`;

interface Ring {
  mesh: THREE.Mesh;
  geometry: THREE.InstancedBufferGeometry;
  buffer: THREE.InstancedInterleavedBuffer;
  data: Float32Array;
  capacity: number;
  /** The next slot to write; slots below `used` have been written. */
  head: number;
  used: number;
  /** Written since the last upload. */
  fresh: number;
  /** When the last live particle dies (s). */
  lastDeath: number;
}

interface Compiled {
  burst: VfxBurst;
  /** Undefined: "team", the emit's tint. */
  from: THREE.Color | undefined;
  to: THREE.Color | undefined;
}

const NO_TINT = new THREE.Color(1, 1, 1);

const colourOf = (name: string): THREE.Color | undefined => {
  if (name === 'team') return undefined;
  const hex = palette[name as keyof typeof palette];
  if (hex === undefined) throw new Error(`vfx.json: no palette colour "${name}"`);
  return new THREE.Color(hex);
};

/**
 * GPU particles (TDD §9, D-102): the CPU writes a particle once, at spawn; the vertex shader
 * moves, grows and fades it from one clock. Presets come from `vfx.json`. Times are seconds on
 * the render clock, so the HQ's slow motion (D-038) slows these too.
 */
export class Particles {
  readonly group = new THREE.Group();
  private readonly rings = new Map<Shape, Ring>();
  private readonly presets = new Map<string, Compiled[]>();
  private readonly uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3() } };
  /** The live config (the emitters read their rates from it). */
  vfx: Vfx;
  private density = 1;
  private base: number | undefined;
  private time = 0;

  constructor(private readonly heightAt: HeightAt, vfx: Vfx) {
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    for (const shape of Object.keys(SHAPES) as Shape[]) {
      const { make, capacity, order } = SHAPES[shape];
      const source = make();
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.index = source.index;
      geometry.setAttribute('position', source.getAttribute('position'));
      geometry.setAttribute('normal', source.getAttribute('normal'));
      const data = new Float32Array(capacity * STRIDE);
      const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE);
      buffer.setUsage(THREE.DynamicDrawUsage);
      ['aStart', 'aVelocity', 'aFrom', 'aTo', 'aMotion'].forEach((name, i) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4)));
      geometry.instanceCount = 0;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = order; // over the blobs (1), under the telegraphs (6, 7), which no effect may cover
      this.group.add(mesh);
      this.rings.set(shape, { mesh, geometry, buffer, data, capacity, head: 0, used: 0, fresh: 0, lastDeath: 0 });
    }
    this.vfx = vfx;
    this.setVfx(vfx);
  }

  /** (Re)compiles the presets: at start and after a live edit in the debug panel. */
  setVfx(vfx: Vfx) {
    this.vfx = vfx;
    this.presets.clear();
    for (const [name, bursts] of Object.entries(vfx.presets)) {
      this.presets.set(name, bursts.map((burst) => ({ burst, from: colourOf(burst.colour[0]), to: colourOf(burst.colour[1]) })));
    }
    this.density = vfx.density;
    this.uniforms.uWind.value.set(vfx.wind[0], 0, -vfx.wind[1]);
  }

  /**
   * Fires preset `name` at sim (x, y), `lift` metres above the ground; `scale` widens it (a
   * blast's radius), `tint` is what the colour name "team" draws as.
   */
  emit(name: string, x: number, y: number, lift = 0, scale = 1, tint = NO_TINT) {
    const compiled = this.presets.get(name);
    if (!compiled) throw new Error(`vfx.json: no preset "${name}"`);
    const ground = this.heightAt(x, y) + lift;
    for (let b = 0; b < compiled.length; b++) {
      const { burst, from, to } = compiled[b]!;
      const n = Math.floor(burst.count * this.density + Math.random());
      const phase = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const reach = burst.scatter * scale;
        const throwSpeed = burst.speed * scale * this.jitter();
        this.write(
          burst, from ?? tint, to ?? tint,
          x + ca * reach, ground + burst.lift, -y + sa * reach,
          ca * throwSpeed, burst.rise * this.jitter(), sa * throwSpeed,
          burst.scaleSize ? scale : 1,
        );
      }
    }
  }

  /** Fires preset `name` from sim (x, y) along `angle` (±`halfAngle`), each particle covering `reach` metres in its life. */
  emitAlong(name: string, x: number, y: number, lift: number, angle: number, reach: number, halfAngle: number) {
    const compiled = this.presets.get(name);
    if (!compiled) throw new Error(`vfx.json: no preset "${name}"`);
    const ground = this.heightAt(x, y) + lift;
    for (let b = 0; b < compiled.length; b++) {
      const { burst, from, to } = compiled[b]!;
      const n = Math.floor(burst.count * this.density + Math.random());
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() * 2 - 1) * halfAngle;
        const speed = reach / burst.life;
        this.write(burst, from ?? NO_TINT, to ?? NO_TINT, x, ground + burst.lift, -y, Math.cos(a) * speed, burst.rise * this.jitter(), -Math.sin(a) * speed, 1);
      }
    }
  }

  private jitter() {
    return 1 - JITTER + Math.random() * JITTER * 2;
  }

  private write(burst: VfxBurst, from: THREE.Color, to: THREE.Color, wx: number, wy: number, wz: number, vx: number, vy: number, vz: number, size: number) {
    const ring = this.rings.get(burst.shape)!;
    const life = burst.life * this.jitter();
    const d = ring.data;
    let o = ring.head * STRIDE;
    d[o++] = wx; d[o++] = wy; d[o++] = wz; d[o++] = this.time;
    d[o++] = vx; d[o++] = vy; d[o++] = vz; d[o++] = life;
    d[o++] = from.r; d[o++] = from.g; d[o++] = from.b; d[o++] = burst.size[0] * size;
    d[o++] = to.r; d[o++] = to.g; d[o++] = to.b; d[o++] = burst.size[1] * size;
    d[o++] = burst.gravity; d[o++] = burst.alpha; d[o++] = burst.spin; d[o] = burst.wind;
    ring.head = (ring.head + 1) % ring.capacity;
    ring.used = Math.min(ring.used + 1, ring.capacity);
    ring.fresh++;
    ring.lastDeath = Math.max(ring.lastDeath, this.time + life);
  }

  /** Call once a frame, after the frame's emits, with the render clock (ms). */
  update(now: number) {
    this.base ??= now;
    this.time = (now - this.base) / 1000;
    this.uniforms.uTime.value = this.time;
    for (const ring of this.rings.values()) {
      if (ring.fresh > 0) this.upload(ring);
      const alive = this.time < ring.lastDeath;
      if (!alive) ring.head = ring.used = 0;
      ring.mesh.visible = alive;
      ring.geometry.instanceCount = ring.used;
    }
  }

  /** Sends only the slots written this frame; they may wrap past the end of the ring. */
  private upload(ring: Ring) {
    const n = Math.min(ring.fresh, ring.capacity);
    const start = (ring.head - n + ring.capacity) % ring.capacity;
    const { buffer } = ring;
    buffer.clearUpdateRanges();
    const firstRun = Math.min(n, ring.capacity - start);
    buffer.addUpdateRange(start * STRIDE, firstRun * STRIDE);
    if (firstRun < n) buffer.addUpdateRange(0, (n - firstRun) * STRIDE);
    buffer.needsUpdate = true;
    ring.fresh = 0;
  }

  /** Particles still alive, for the perf overlay. */
  get live() {
    let n = 0;
    for (const ring of this.rings.values()) {
      for (let i = 0; i < ring.used; i++) {
        const o = i * STRIDE;
        if (this.time < ring.data[o + 3]! + ring.data[o + 7]!) n++;
      }
    }
    return n;
  }
}

/** Scorch marks at any one time; past this the oldest is reused (TDD §9). */
export const MAX_DECALS = 64;
const DECAL_LIFT = 0.03;
const decalMatrix = new THREE.Matrix4();
const decalPosition = new THREE.Vector3();
const decalRotation = new THREE.Quaternion();
const decalScale = new THREE.Vector3();

/** Scorched ground left by blasts, fire pools and flames, all in one draw (D-104). */
export class Decals {
  readonly mesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: palette.scorched, transparent: true, opacity: 0.8, depthWrite: false }),
    MAX_DECALS,
  );
  private head = 0;

  constructor(private readonly heightAt: HeightAt) {
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0.5; // under the blobs (1) and every effect
  }

  /** A mark at sim (x, y), `radius` metres wide. */
  stamp(x: number, y: number, radius: number) {
    decalPosition.set(x, this.heightAt(x, y) + DECAL_LIFT, -y);
    decalScale.set(radius, 1, radius);
    this.mesh.setMatrixAt(this.head, decalMatrix.compose(decalPosition, decalRotation, decalScale));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.head = (this.head + 1) % MAX_DECALS;
    this.mesh.count = Math.min(this.mesh.count + 1, MAX_DECALS);
  }
}
