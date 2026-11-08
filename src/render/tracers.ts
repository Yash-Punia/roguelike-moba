import * as THREE from 'three';
import { TICK_HZ } from '../data/schema';
import { Kind, Team, type ProjectileSnapshot } from '../sim/sim';
import { displayTeam } from '../sim/sides';
import { palette } from './palette';

const LENGTH = 0.9;
const WIDTH = 0.08;
/** Gun height above the ground. */
const LIFT = 1.0;
/** Minion bullets: shorter, thinner and lower (their guns are at ~0.5 m). */
const MINION_SCALE = 0.55;
const MINION_LIFT = 0.5;
/** Structure rounds: heavier, from gun height on the bunker; warm-up grows them further. */
const STRUCTURE_SCALE = 1.3;
const STRUCTURE_LIFT = 1.6;
const BOOST_GROWTH = 0.6;
/** Bazooka Tank rockets: fat and slow, from the launcher tubes. */
const ROCKET_SCALE = 2;
const ROCKET_LIFT = 0.75;

/** How high a unit's gun is above the ground (m): where its tracers fly and its muzzle flashes. */
export function gunLift(kind: Kind, rocket = false) {
  if (rocket) return ROCKET_LIFT;
  if (kind === Kind.Minion) return MINION_LIFT;
  return kind === Kind.SubBase || kind === Kind.HQ ? STRUCTURE_LIFT : LIFT;
}

/**
 * Bullet tracers (GDD §11, TDD §8): one instanced, flat, stretched quad per projectile in its
 * team colour, so you can see who is shooting at whom. Positions are copied at capture and
 * interpolated back along the velocity by alpha, so nothing allocates per frame.
 */
export class Tracers {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private xs = new Float64Array(256);
  private ys = new Float64Array(256);
  private vxs = new Float64Array(256);
  private vys = new Float64Array(256);
  private teams = new Uint8Array(256);
  private sizes = new Float32Array(256);
  private lifts = new Float32Array(256);
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** Lightened team colours, by display team (impacts match the tracer that made them). */
  readonly colours: Record<Team, THREE.Color>;

  constructor(private readonly heightAt: (x: number, y: number) => number, capacity = 512) {
    // Head at the origin, tail trailing back along −x, lying flat.
    const geo = new THREE.PlaneGeometry(LENGTH, WIDTH).translate(-LENGTH / 2, 0, 0).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const bright = (c: number) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.35);
    this.colours = { [Team.Blue]: bright(palette.blue), [Team.Red]: bright(palette.red), [Team.Neutral]: bright(palette.hazard) };
  }

  /** Copies this tick's projectiles that `shown` passes (fog of war); `viewer`'s team draws Blue (D-039). */
  capture(projectiles: readonly ProjectileSnapshot[], viewer: Team = Team.Blue, shown?: (x: number, y: number) => boolean) {
    const max = Math.min(projectiles.length, this.mesh.instanceMatrix.count);
    if (max > this.xs.length) this.grow(max);
    let n = 0;
    for (let k = 0; k < max; k++) {
      const p = projectiles[k]!;
      if (shown && !shown(p.x, p.y)) continue;
      const i = n++;
      this.xs[i] = p.x;
      this.ys[i] = p.y;
      this.vxs[i] = p.vx / TICK_HZ;
      this.vys[i] = p.vy / TICK_HZ;
      this.teams[i] = displayTeam(p.team, viewer);
      const structure = p.ownerKind === Kind.SubBase || p.ownerKind === Kind.HQ;
      const base = p.rocket ? ROCKET_SCALE : p.ownerKind === Kind.Minion ? MINION_SCALE : structure ? STRUCTURE_SCALE : 1;
      this.sizes[i] = base * (1 + (p.boost - 1) * BOOST_GROWTH);
      this.lifts[i] = gunLift(p.ownerKind, p.rocket);
    }
    this.count = n;
  }

  /** Places every tracer between last tick's position and this tick's by alpha. */
  update(alpha: number) {
    for (let i = 0; i < this.count; i++) {
      const x = this.xs[i]! - this.vxs[i]! * (1 - alpha);
      const y = this.ys[i]! - this.vys[i]! * (1 - alpha);
      this.position.set(x, this.heightAt(x, y) + this.lifts[i]!, -y);
      this.rotation.setFromAxisAngle(this.up, Math.atan2(this.vys[i]!, this.vxs[i]!));
      this.scale.setScalar(this.sizes[i]!);
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, this.colours[this.teams[i] as Team]);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private grow(n: number) {
    const size = Math.max(n, this.xs.length * 2);
    this.xs = new Float64Array(size);
    this.ys = new Float64Array(size);
    this.vxs = new Float64Array(size);
    this.vys = new Float64Array(size);
    this.teams = new Uint8Array(size);
    this.sizes = new Float32Array(size);
    this.lifts = new Float32Array(size);
  }
}
