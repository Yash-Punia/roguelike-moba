import * as THREE from 'three';
import { Team } from '../sim/sim';
import { palette } from './palette';

const WIDTH = 0.09;
const LIFT = 0.06;

/**
 * The local champion's target line (GDD §10): a thin team-coloured ribbon on the ground from
 * the champion to its auto-target, plus a ring round the target. Drawn over the terrain.
 */
export class TargetLine {
  readonly group = new THREE.Group();
  private readonly ribbon: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private ringRadius = -1;

  constructor(team: Team) {
    const mat = new THREE.MeshBasicMaterial({
      color: team === Team.Red ? palette.red : palette.blue,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    // Unit ribbon along +x from the origin, lying flat.
    this.ribbon = new THREE.Mesh(new THREE.PlaneGeometry(1, WIDTH).translate(0.5, 0, 0).rotateX(-Math.PI / 2), mat);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), mat);
    this.ribbon.renderOrder = this.ring.renderOrder = 5;
    this.group.add(this.ribbon, this.ring);
    this.group.visible = false;
  }

  /** Sim-space endpoints with ground heights; `radius` is the target's collider radius. */
  show(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, radius: number) {
    this.group.visible = true;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    this.ribbon.position.set(x0, h0 + LIFT, -y0);
    this.ribbon.scale.set(Math.max(0, length - radius - 0.2), 1, 1);
    this.ribbon.rotation.y = Math.atan2(dy, dx); // sim angle → world yaw (sim y is world −z)
    if (radius !== this.ringRadius) {
      this.ringRadius = radius;
      this.ring.scale.setScalar(radius + 0.25);
    }
    this.ring.position.set(x1, h1 + LIFT, -y1);
  }

  hide() {
    this.group.visible = false;
  }
}
