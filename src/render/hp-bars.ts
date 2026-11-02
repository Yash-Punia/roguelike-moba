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

const DARK = 0x1b1a17;
const fillColour: Record<Team, THREE.Color> = {
  [Team.Blue]: new THREE.Color(palette.blue),
  [Team.Red]: new THREE.Color(palette.red),
  [Team.Neutral]: new THREE.Color(palette.hazard),
};

// Left-anchored unit quad (x 0..1), so scaling x fills the bar from the left.
const unitQuad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
const overlay = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });

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

/** One unit's bar: dark back, team-colour fill and a tick every 250 HP. Drawn by `HpBars`. */
export class HpBar {
  readonly lift: number;
  readonly width: number;
  readonly height: number;
  readonly segmentHp: number;
  readonly colour: THREE.Color;
  visible = true;
  x = 0;
  y = 0;
  z = 0;
  /** Filled share 0..1. */
  fill = 1;
  /** Tick positions as shares of the bar width (rebuilt when max HP changes). */
  ticks: number[] = [];
  badge: THREE.Mesh | undefined;
  private maxHp = -1;
  private level = 0;

  constructor(kind: Kind, team: Team, private readonly layer: HpBars) {
    const { width, height, lift } = sizes[kind];
    this.width = width;
    this.height = height;
    this.lift = lift;
    this.colour = fillColour[team];
    this.segmentHp = kind === Kind.Champion || kind === Kind.Minion ? UNIT_SEGMENT_HP : STRUCTURE_SEGMENT_HP;
  }

  setPosition(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /** Shows the level in a square badge at the bar's left end (champions). */
  setLevel(level: number) {
    if (level === this.level) return;
    this.level = level;
    if (!this.badge) this.badge = this.layer.addBadge();
    (this.badge.material as THREE.MeshBasicMaterial).map = levelTexture(level);
    (this.badge.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }

  set(hp: number, maxHp: number) {
    this.fill = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    if (maxHp !== this.maxHp) {
      this.maxHp = maxHp;
      this.ticks.length = 0;
      for (let at = this.segmentHp; at < maxHp; at += this.segmentHp) this.ticks.push(at / maxHp);
    }
  }

  dispose() {
    this.layer.remove(this);
  }
}

const base = new THREE.Matrix4();
const part = new THREE.Matrix4();
const one = new THREE.Vector3(1, 1, 1);
const pos = new THREE.Vector3();

/**
 * Every world HP bar in three instanced draw calls (D-044): backs, fills (team colour per
 * instance) and segment ticks. Each frame `update` faces them to the camera and writes the
 * instance matrices; level badges are a few small meshes of their own.
 */
export class HpBars {
  readonly group = new THREE.Group();
  private readonly bars: HpBar[] = [];
  private backs!: THREE.InstancedMesh;
  private fills!: THREE.InstancedMesh;
  private tickMesh!: THREE.InstancedMesh;
  private readonly backMat = overlay(DARK);
  private readonly fillMat = overlay(0xffffff);
  private readonly tickMat = overlay(DARK);

  constructor(private capacity = 64, private tickCapacity = 256) {
    this.build();
  }

  create(kind: Kind, team: Team): HpBar {
    const bar = new HpBar(kind, team, this);
    this.bars.push(bar);
    if (this.bars.length > this.capacity) {
      this.capacity *= 2;
      this.build();
    }
    return bar;
  }

  remove(bar: HpBar) {
    const i = this.bars.indexOf(bar);
    if (i >= 0) this.bars.splice(i, 1);
    if (bar.badge) {
      this.group.remove(bar.badge);
      (bar.badge.material as THREE.Material).dispose();
    }
  }

  addBadge(): THREE.Mesh {
    const badge = new THREE.Mesh(badgeQuad, new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
    badge.matrixAutoUpdate = false;
    badge.renderOrder = 12;
    badge.frustumCulled = false;
    this.group.add(badge);
    return badge;
  }

  /** Faces every bar to the camera and writes the instances (call after the camera moved). */
  update(camera: THREE.Camera): void {
    let backs = 0;
    let fills = 0;
    let ticks = 0;
    for (const bar of this.bars) {
      if (bar.badge) bar.badge.visible = bar.visible;
      if (!bar.visible) continue;
      pos.set(bar.x, bar.y, bar.z);
      base.compose(pos, camera.quaternion, one);
      const left = -bar.width / 2;
      part.makeScale(bar.width + BORDER * 2, bar.height + BORDER * 2, 1).setPosition(left - BORDER, 0, 0);
      this.backs.setMatrixAt(backs++, part.premultiply(base));
      if (bar.fill > 0) {
        part.makeScale(Math.max(1e-3, bar.width * bar.fill), bar.height, 1).setPosition(left, 0, 0);
        this.fills.setMatrixAt(fills, part.premultiply(base));
        this.fills.setColorAt(fills++, bar.colour);
      }
      const tw = bar.segmentHp > UNIT_SEGMENT_HP ? 0.04 : 0.022;
      for (const t of bar.ticks) {
        if (ticks >= this.tickCapacity) {
          this.tickCapacity *= 2;
          this.build();
          this.update(camera);
          return;
        }
        part.makeScale(tw, bar.height, 1).setPosition(left + bar.width * t - tw / 2, 0, 0);
        this.tickMesh.setMatrixAt(ticks++, part.premultiply(base));
      }
      if (bar.badge) {
        const size = bar.height * 2.4;
        part.makeScale(size, size, 1).setPosition(left - BORDER - size / 2, 0, 0);
        bar.badge.matrix.multiplyMatrices(base, part);
        bar.badge.matrixWorldNeedsUpdate = true;
      }
    }
    this.backs.count = backs;
    this.fills.count = fills;
    this.tickMesh.count = ticks;
    this.backs.instanceMatrix.needsUpdate = true;
    this.fills.instanceMatrix.needsUpdate = true;
    if (this.fills.instanceColor) this.fills.instanceColor.needsUpdate = true;
    this.tickMesh.instanceMatrix.needsUpdate = true;
  }

  /** (Re)creates the instanced meshes at the current capacities. */
  private build() {
    for (const m of [this.backs, this.fills, this.tickMesh]) if (m) this.group.remove(m);
    const make = (mat: THREE.Material, n: number, order: number) => {
      const m = new THREE.InstancedMesh(unitQuad, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = order;
      this.group.add(m);
      return m;
    };
    this.backs = make(this.backMat, this.capacity, 10);
    this.fills = make(this.fillMat, this.capacity, 11);
    this.fills.setColorAt(0, fillColour[Team.Blue]); // allocates the colour buffer
    this.tickMesh = make(this.tickMat, this.tickCapacity, 12);
  }
}
