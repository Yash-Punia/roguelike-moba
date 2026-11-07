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
export const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
export const ringGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
/** A unit strip lying along local +x from the origin, 1 wide. */
const stripGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0).rotateX(-Math.PI / 2);
const LIFT = 0.05;
/** Unit sectors along local +x, `arc` wide, one per arc (the Halftrack's spray, D-080). */
const sectors = new Map<number, THREE.BufferGeometry>();
const sectorGeo = (arc: number) => {
  let g = sectors.get(arc);
  if (!g) sectors.set(arc, (g = new THREE.CircleGeometry(1, 24, -arc / 2, arc).rotateX(-Math.PI / 2)));
  return g;
};

interface Slot {
  group: THREE.Group;
  /** A circle's ring, or the strip's faint shape. */
  base: THREE.Mesh;
  fill: THREE.Mesh;
  t: TelegraphSnapshot;
}

/**
 * Ground telegraphs (TDD §9, D-078): a bright ring (circles) or a faint strip or cone, and a fill
 * that grows with the time to impact; a live damage area (Lead Storm firing) shows the faint strip
 * only. Two draws a marker, pooled by index per shape. Reads `snap.telegraphs`; never writes sim state.
 */
export class Telegraphs {
  readonly group = new THREE.Group();
  private readonly circles: Slot[] = [];
  private readonly strips: Slot[] = [];
  private readonly cones: Slot[] = [];
  private shownCircles = 0;
  private shownStrips = 0;
  private shownCones = 0;

  constructor(private readonly heightAt: HeightAt) {}

  /** `shown`: fog of war. A circle shows if its centre is seen, a strip or cone if its start or far end is. */
  capture(telegraphs: readonly TelegraphSnapshot[], shown: (x: number, y: number) => boolean) {
    let c = 0;
    let s = 0;
    let n = 0;
    for (const t of telegraphs) {
      if (t.shape === 'circle') {
        if (!shown(t.x, t.y)) continue;
        Object.assign(this.slot(this.circles, c++, ringGeo, edgeMat, discGeo).t, t);
      } else if (t.shape === 'cone') {
        if (!shown(t.x, t.y) && !shown(t.x + Math.cos(t.angle) * t.radius, t.y + Math.sin(t.angle) * t.radius)) continue;
        const slot = this.slot(this.cones, n++, sectorGeo(t.arc), baseMat, sectorGeo(t.arc));
        slot.base.geometry = slot.fill.geometry = sectorGeo(t.arc);
        Object.assign(slot.t, t);
      } else {
        if (!shown(t.x, t.y) && !shown(t.x + Math.cos(t.angle) * t.length, t.y + Math.sin(t.angle) * t.length)) continue;
        Object.assign(this.slot(this.strips, s++, stripGeo, baseMat, stripGeo).t, t);
      }
    }
    for (let i = c; i < this.shownCircles; i++) this.circles[i]!.group.visible = false;
    for (let i = s; i < this.shownStrips; i++) this.strips[i]!.group.visible = false;
    for (let i = n; i < this.shownCones; i++) this.cones[i]!.group.visible = false;
    this.shownCircles = c;
    this.shownStrips = s;
    this.shownCones = n;
  }

  update(alpha: number, at: At) {
    for (let i = 0; i < this.shownCircles; i++) {
      const { group, fill, t } = this.circles[i]!;
      group.visible = true;
      group.position.set(t.x, this.ground(t.x, t.y, t.radius) + LIFT, -t.y);
      group.scale.set(t.radius, 1, t.radius);
      const k = progress(t, alpha);
      fill.visible = k < 1;
      fill.scale.set(k, 1, k);
    }
    for (let i = 0; i < this.shownStrips; i++) {
      const { group, base, fill, t } = this.strips[i]!;
      const a = t.anchor ? at(t.anchor) : undefined;
      const x = a?.x ?? t.x;
      const y = a?.y ?? t.y;
      group.visible = true;
      group.position.set(x, this.ground(x + (Math.cos(t.angle) * t.length) / 2, y + (Math.sin(t.angle) * t.length) / 2, t.length / 2) + LIFT, -y);
      group.rotation.y = a?.angle ?? t.angle;
      group.scale.set(t.length, 1, t.width);
      const k = progress(t, alpha);
      fill.visible = k < 1;
      fill.scale.x = k;
      base.material = k < 1 ? baseMat : liveMat;
    }
    for (let i = 0; i < this.shownCones; i++) {
      const { group, fill, t } = this.cones[i]!;
      group.visible = true;
      group.position.set(t.x, this.ground(t.x, t.y, t.radius) + LIFT, -t.y);
      group.rotation.y = t.angle;
      group.scale.set(t.radius, 1, t.radius);
      const k = progress(t, alpha);
      fill.visible = k < 1;
      fill.scale.set(k, 1, k);
    }
  }

  /**
   * The highest ground under a flat marker of radius `r` round (x, y): its centre and four rim
   * points. A marker at its centre's height would sink into a bowl (the Crater, D-082).
   */
  private ground(x: number, y: number, r: number): number {
    let h = this.heightAt(x, y);
    for (let k = 0; k < 4; k++) h = Math.max(h, this.heightAt(x + Math.cos((k * Math.PI) / 2) * r, y + Math.sin((k * Math.PI) / 2) * r));
    return h;
  }

  private slot(pool: Slot[], i: number, baseGeo: THREE.BufferGeometry, baseMaterial: THREE.Material, fillGeo: THREE.BufferGeometry): Slot {
    const existing = pool[i];
    if (existing) return existing;
    const group = new THREE.Group();
    const base = new THREE.Mesh(baseGeo, baseMaterial);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    base.renderOrder = 6;
    fill.renderOrder = 7;
    group.add(base, fill);
    group.visible = false;
    this.group.add(group);
    const slot: Slot = { group, base, fill, t: { team: 0, shape: 'circle', x: 0, y: 0, angle: 0, radius: 0, arc: 0, length: 0, width: 0, anchor: 0, elapsed: 0, total: 1 } };
    pool.push(slot);
    return slot;
  }
}

/** Share of the time to impact gone (0–1), interpolated between ticks. */
function progress(t: TelegraphSnapshot, alpha: number): number {
  return t.elapsed >= t.total ? 1 : Math.min(1, (t.elapsed + alpha) / Math.max(1, t.total));
}
