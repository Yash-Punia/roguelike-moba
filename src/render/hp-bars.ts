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
  [Kind.Minion]: { width: 0.8, height: 0.12, lift: 1.45 },
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

/** One shared texture per level number: white digits on the bar's dark back. */
const levelTextures = new Map<number, THREE.CanvasTexture>();
function levelTexture(level: number): THREE.CanvasTexture {
  let tex = levelTextures.get(level);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1a17';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  g.font = '800 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(level), 32, 35);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  levelTextures.set(level, tex);
  return tex;
}
const badgeQuad = new THREE.PlaneGeometry(1, 1);

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
  private badge: THREE.Mesh | undefined;
  private level = 0;

  constructor(kind: Kind, team: Team) {
    const { width, height, lift } = sizes[kind];
    this.width = width;
    this.height = height;
    this.lift = lift;
    this.segmentHp = kind === Kind.Champion || kind === Kind.Minion ? UNIT_SEGMENT_HP : STRUCTURE_SEGMENT_HP;
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

  /** Shows the level in a square badge at the bar's left end (champions). */
  setLevel(level: number) {
    if (level === this.level) return;
    this.level = level;
    if (!this.badge) {
      const size = this.height * 2.4;
      this.badge = new THREE.Mesh(badgeQuad, new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
      this.badge.scale.set(size, size, 1);
      this.badge.position.x = -this.width / 2 - BORDER - size / 2;
      this.badge.renderOrder = 12;
      this.group.add(this.badge);
    }
    (this.badge.material as THREE.MeshBasicMaterial).map = levelTexture(level);
    (this.badge.material as THREE.MeshBasicMaterial).needsUpdate = true;
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
