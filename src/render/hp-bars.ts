import * as THREE from 'three';
import { Kind, Team } from '../sim/sim';
import { palette } from './palette';

/** HP per segment tick: 250 on units (GDD §10); 1,000 on structures, whose 6,000–10,000 HP would otherwise read as a barcode (D-028). */
const UNIT_SEGMENT_HP = 250;
const STRUCTURE_SEGMENT_HP = 1000;
const BORDER = 0.05;

/** Bar size and height above the ground per kind (render presentation, not gameplay). */
const sizes: Record<Kind, { width: number; height: number; lift: number }> = {
  [Kind.Champion]: { width: 1.3, height: 0.16, lift: 2.2 },
  [Kind.SubBase]: { width: 2.4, height: 0.2, lift: 3.6 },
  [Kind.HQ]: { width: 3.4, height: 0.24, lift: 4.9 },
};

// Left-anchored unit quad (x 0..1), so scaling x fills the bar from the left.
const unitQuad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
const flat = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
const backMat = flat(0x1b1a17);
const tickMat = flat(0x1b1a17);
const fillMat: Record<Team, THREE.MeshBasicMaterial> = {
  [Team.Blue]: flat(palette.blue),
  [Team.Red]: flat(palette.red),
  [Team.Neutral]: flat(palette.hazard),
};

/** A world-space HP bar: dark back, team-colour fill and a tick every 250 HP. Billboarded by the scene. */
export class HpBar {
  readonly group = new THREE.Group();
  readonly lift: number;
  private readonly fill: THREE.Mesh;
  private readonly ticks = new THREE.Group();
  private readonly width: number;
  private readonly height: number;
  private readonly segmentHp: number;
  private maxHp = -1;

  constructor(kind: Kind, team: Team) {
    const { width, height, lift } = sizes[kind];
    this.width = width;
    this.height = height;
    this.lift = lift;
    this.segmentHp = kind === Kind.Champion ? UNIT_SEGMENT_HP : STRUCTURE_SEGMENT_HP;
    const back = new THREE.Mesh(unitQuad, backMat);
    back.scale.set(width + BORDER * 2, height + BORDER * 2, 1);
    back.position.x = -width / 2 - BORDER;
    back.renderOrder = 10;
    this.fill = new THREE.Mesh(unitQuad, fillMat[team]);
    this.fill.scale.set(width, height, 1);
    this.fill.position.x = -width / 2;
    this.fill.renderOrder = 11;
    this.group.add(back, this.fill, this.ticks);
  }

  set(hp: number, maxHp: number) {
    const f = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    this.fill.visible = f > 0;
    this.fill.scale.x = Math.max(1e-3, this.width * f);
    if (maxHp !== this.maxHp) this.rebuildTicks(maxHp);
  }

  private rebuildTicks(maxHp: number) {
    this.maxHp = maxHp;
    this.ticks.clear();
    for (let hp = this.segmentHp; hp < maxHp; hp += this.segmentHp) {
      const tick = new THREE.Mesh(unitQuad, tickMat);
      const w = this.segmentHp > UNIT_SEGMENT_HP ? 0.04 : 0.022;
      tick.scale.set(w, this.height, 1);
      tick.position.x = -this.width / 2 + (this.width * hp) / maxHp - w / 2;
      tick.renderOrder = 12;
      this.ticks.add(tick);
    }
  }
}
