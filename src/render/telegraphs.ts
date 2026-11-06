import * as THREE from 'three';
import type { TelegraphSnapshot } from '../sim/sim';
import { palette } from './palette';

type HeightAt = (x: number, y: number) => number;
/** An entity's interpolated sim position and upper-body angle this frame. */
export type At = (id: number) => { x: number; y: number; angle: number } | undefined;

const basic = (opacity: number) => new THREE.MeshBasicMaterial({ color: palette.danger, transparent: true, opacity, depthWrite: false });

// Danger red, for telegraphs only (SG-01, GDD §11). Drawn above every other ground effect.
const baseMat = basic(0.16);
const liveMat = basic(0.14);
const fillMat = basic(0.3);
const edgeMat = basic(0.85);
const lineMat = new THREE.LineBasicMaterial({ color: palette.danger, transparent: true, opacity: 0.85, depthWrite: false });
export const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
export const ringGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
/** A unit strip lying along local +x from the origin, 1 wide. */
const stripGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
const outlineGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, -0.5),
  new THREE.Vector3(1, 0, -0.5),
  new THREE.Vector3(1, 0, 0.5),
  new THREE.Vector3(0, 0, 0.5),
]);
const LIFT = 0.05;

interface Slot {
  group: THREE.Group;
  base: THREE.Mesh;
  fill: THREE.Mesh;
  t: TelegraphSnapshot;
}

/**
 * Ground telegraphs (TDD §9, D-078): a faint red shape with a bright edge and a fill that grows
 * with the time to impact; a live damage area (Lead Storm firing) shows the faint shape only.
 * Meshes are pooled by index per shape. Reads `snap.telegraphs`; never writes sim state.
 */
export class Telegraphs {
  readonly group = new THREE.Group();
  private readonly circles: Slot[] = [];
  private readonly strips: Slot[] = [];
  private shownCircles = 0;
  private shownStrips = 0;

  constructor(private readonly heightAt: HeightAt) {}

  /** `shown`: fog of war. A circle shows if its centre is seen, a strip if its start or far end is. */
  capture(telegraphs: readonly TelegraphSnapshot[], shown: (x: number, y: number) => boolean) {
    let c = 0;
    let s = 0;
    for (const t of telegraphs) {
      if (t.shape === 'circle') {
        if (!shown(t.x, t.y)) continue;
        Object.assign(this.slot(this.circles, c++, discGeo, ringGeo).t, t);
      } else {
        if (!shown(t.x, t.y) && !shown(t.x + Math.cos(t.angle) * t.length, t.y + Math.sin(t.angle) * t.length)) continue;
        Object.assign(this.slot(this.strips, s++, stripGeo, undefined).t, t);
      }
    }
    for (let i = c; i < this.shownCircles; i++) this.circles[i]!.group.visible = false;
    for (let i = s; i < this.shownStrips; i++) this.strips[i]!.group.visible = false;
    this.shownCircles = c;
    this.shownStrips = s;
  }

  update(alpha: number, at: At) {
    for (let i = 0; i < this.shownCircles; i++) {
      const { group, base, fill, t } = this.circles[i]!;
      group.visible = true;
      group.position.set(t.x, this.heightAt(t.x, t.y) + LIFT, -t.y);
      group.scale.set(t.radius, 1, t.radius);
      const k = progress(t, alpha);
      fill.visible = k < 1;
      fill.scale.set(k, 1, k);
      base.material = k < 1 ? baseMat : liveMat;
    }
    for (let i = 0; i < this.shownStrips; i++) {
      const { group, base, fill, t } = this.strips[i]!;
      const a = t.anchor ? at(t.anchor) : undefined;
      const x = a?.x ?? t.x;
      const y = a?.y ?? t.y;
      group.visible = true;
      group.position.set(x, this.heightAt(x, y) + LIFT, -y);
      group.rotation.y = a?.angle ?? t.angle;
      group.scale.set(t.length, 1, t.width);
      const k = progress(t, alpha);
      fill.visible = k < 1;
      fill.scale.x = k;
      base.material = k < 1 ? baseMat : liveMat;
      group.children[2]!.visible = k < 1; // the outline marks the windup only
    }
  }

  private slot(pool: Slot[], i: number, geo: THREE.BufferGeometry, ring: THREE.BufferGeometry | undefined): Slot {
    let slot = pool[i];
    if (slot) return slot;
    const group = new THREE.Group();
    const base = new THREE.Mesh(geo, baseMat);
    const fill = new THREE.Mesh(geo, fillMat);
    const edge = ring ? new THREE.Mesh(ring, edgeMat) : new THREE.LineLoop(outlineGeo, lineMat);
    base.renderOrder = 6;
    fill.renderOrder = 7;
    edge.renderOrder = 8;
    group.add(base, fill, edge);
    group.visible = false;
    this.group.add(group);
    slot = { group, base, fill, t: { team: 0, shape: 'circle', x: 0, y: 0, angle: 0, radius: 0, length: 0, width: 0, anchor: 0, elapsed: 0, total: 1 } };
    pool.push(slot);
    return slot;
  }
}

/** Share of the time to impact gone (0–1), interpolated between ticks. */
function progress(t: TelegraphSnapshot, alpha: number): number {
  return t.elapsed >= t.total ? 1 : Math.min(1, (t.elapsed + alpha) / Math.max(1, t.total));
}
