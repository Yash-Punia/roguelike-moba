import * as THREE from 'three';
import type { LobSnapshot, ZoneSnapshot } from '../sim/sim';
import { palette } from './palette';
import { discGeo, ringGeo } from './telegraphs';

// Presentation only: timings and sizes of the effects (not gameplay numbers).
const FLASH_MS = 280;
const SMOKE_MS = 900;
const FLAMES = 11;
/** The pool size `FLAMES` is drawn for (the Frag Grenade's fire pool, m). */
const POOL_RADIUS = 3;
const POOL_FADE_TICKS = 15;

type HeightAt = (x: number, y: number) => number;

const basic = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

const grenadeGeo = new THREE.SphereGeometry(0.13, 8, 6).scale(1, 1.3, 1);
const grenadeMat = new THREE.MeshLambertMaterial({ color: palette.olive, flatShading: true });
const scorchMat = basic(palette.scorched, 0.85);
const flameGeo = new THREE.ConeGeometry(0.32, 1.05, 5).translate(0, 0.52, 0);
const flameOuterMat = new THREE.MeshBasicMaterial({ color: palette.fire });
const flameInnerMat = new THREE.MeshBasicMaterial({ color: palette.muzzle });
const flashGeo = new THREE.IcosahedronGeometry(1, 1);
const smokeGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
/** Live smoke puffs across the map; past this the oldest is reused (D-100). */
const MAX_PUFFS = 128;
const PUFF_OPACITY = 0.8;
const puffAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS), 1);
puffAlpha.setUsage(THREE.DynamicDrawUsage);
smokeGeo.setAttribute('instanceAlpha', puffAlpha);
// Every puff in one draw (D-100): colour per instance, and the fade as one more instance attribute.
const smokeMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
smokeMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceAlpha;');
};
const puffMatrix = new THREE.Matrix4();
const puffPosition = new THREE.Vector3();
const puffRotation = new THREE.Quaternion();
const puffEuler = new THREE.Euler();
const puffScale = new THREE.Vector3();
const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 2.4, 16, 1, true).translate(0, 1.2, 0);
const LEVEL_FLASH_MS = 600;
// Lead Storm: bright streaks flying down the strip (the strip itself is a telegraph, D-078).
const streakGeo = new THREE.BoxGeometry(0.8, 0.04, 0.04);
const streakMat = new THREE.MeshBasicMaterial({ color: palette.muzzle, toneMapped: false });
const STREAKS = 12;
/** Streak passes down the strip per second, and the gun height they fly from. */
const STREAK_RATE = 2.2;
const GUN_HEIGHT = 0.9;

// Gamma's flamethrower: tumbling blobs from the nozzle, yellow near it, orange out to the tip.
const FLAME_BLOBS = 9;
const FLAME_RATE = 3.2;
const flameBlobGeo = new THREE.IcosahedronGeometry(1, 0);
const NOZZLE = { x: 1.3, y: 0.95 };
// Gamma's Heat Wave: a pulsing gold ring with a faint gold floor.
const waveRingMat = basic(palette.brass, 0.85);
const waveFillMat = basic(palette.brass, 0.12);

interface Flames {
  group: THREE.Group;
  blobs: THREE.Mesh[];
  range: number;
  half: number;
}

interface Storm {
  group: THREE.Group;
  streaks: THREE.Mesh[];
  length: number;
  width: number;
}

interface Lob {
  grenade: THREE.Mesh;
  snap: Omit<LobSnapshot, 'id' | 'team'>;
}
interface Pool {
  group: THREE.Group;
  flames: THREE.Mesh[];
  phase: number[];
  elapsed: number;
  total: number;
}
interface Puff {
  /** Render clock (ms) it was made; dead once `SMOKE_MS` old. */
  born: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  colour: THREE.Color;
}
interface Blast {
  flash: THREE.Mesh;
  born: number;
  radius: number;
}

/**
 * Frag Grenade effects (GDD §11 "Alpha's Frag Grenade"): the grenade on its arc (its
 * landing telegraph is drawn by `Telegraphs`, D-078), an explosion flash with smoke, and the fire pool
 * as scorched ground with flickering flame cones. Reads lob and zone snapshots and
 * explosion events; never writes sim state.
 */
export class UltFx {
  readonly group = new THREE.Group();
  private readonly lobs = new Map<number, Lob>();
  private readonly pools = new Map<number, Pool>();
  private readonly storms = new Map<number, Storm>();
  private readonly flames = new Map<number, Flames>();
  private readonly waves = new Map<number, THREE.Group>();
  private blasts: Blast[] = [];
  private readonly smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, MAX_PUFFS);
  private readonly smokePuffs: Puff[] = Array.from({ length: MAX_PUFFS }, () => ({ born: -Infinity, x: 0, y: 0, z: 0, angle: 0, colour: new THREE.Color() }));
  private nextPuff = 0;
  private flashes: { ring: THREE.Mesh; pillar: THREE.Mesh; born: number }[] = [];
  private readonly seen = new Set<number>();

  constructor(private readonly heightAt: HeightAt) {
    this.smokeMesh.count = 0;
    this.smokeMesh.visible = false;
    this.smokeMesh.frustumCulled = false;
    this.smokeMesh.renderOrder = 3; // over the blobs: one object can't be depth-sorted per puff
    this.smokeMesh.setColorAt(0, this.smokePuffs[0]!.colour); // allocates the colour buffer
    this.group.add(this.smokeMesh);
  }

  /** `shown`: fog of war; a grenade shows only if its landing spot is seen, a fire pool if its centre is. */
  capture(lobs: readonly LobSnapshot[], zones: readonly ZoneSnapshot[], shown?: (x: number, y: number) => boolean) {
    this.seen.clear();
    for (const l of lobs) {
      if (shown && !shown(l.x1, l.y1)) continue;
      this.seen.add(l.id);
      let fx = this.lobs.get(l.id);
      if (!fx) {
        const grenade = new THREE.Mesh(grenadeGeo, grenadeMat);
        grenade.castShadow = true;
        this.group.add(grenade);
        fx = { grenade, snap: { ...l } };
        this.lobs.set(l.id, fx);
      }
      Object.assign(fx.snap, l);
    }
    for (const [id, fx] of this.lobs) {
      if (this.seen.has(id)) continue;
      this.group.remove(fx.grenade);
      this.lobs.delete(id);
    }

    this.seen.clear();
    for (const z of zones) {
      if (shown && !shown(z.x, z.y)) continue;
      this.seen.add(z.id);
      let pool = this.pools.get(z.id);
      if (!pool) pool = this.addPool(z);
      pool.elapsed = z.elapsed;
      pool.total = z.total;
    }
    for (const [id, pool] of this.pools) {
      if (this.seen.has(id)) continue;
      this.group.remove(pool.group);
      this.pools.delete(id);
    }
  }

  /**
   * Beta's Lead Storm for champion `id` (GDD §11): a tracer stream down the strip while firing
   * (`channel` 2); removed at 0. The strip itself is a telegraph (D-078).
   */
  storm(id: number, channel: 0 | 1 | 2, length: number, width: number) {
    let st = this.storms.get(id);
    if (channel === 0) {
      if (st) this.group.remove(st.group);
      this.storms.delete(id);
      return;
    }
    if (!st) {
      const group = new THREE.Group();
      const streaks: THREE.Mesh[] = [];
      for (let k = 0; k < STREAKS; k++) streaks.push(new THREE.Mesh(streakGeo, streakMat));
      group.add(...streaks);
      this.group.add(group);
      this.storms.set(id, (st = { group, streaks, length, width }));
    }
    for (const s of st.streaks) s.visible = channel === 2;
  }

  /** Moves a storm with its caster (interpolated sim position and strip angle) and runs its streaks. */
  private placeStorm(id: number, x: number, y: number, angle: number, now: number) {
    const st = this.storms.get(id);
    if (!st) return;
    st.group.position.set(x, this.heightAt(x, y) + 0.06, -y);
    st.group.rotation.y = angle;
    for (let k = 0; k < st.streaks.length; k++) {
      const t = ((now / 1000) * STREAK_RATE + k / STREAKS) % 1;
      const lateral = (((k * 0.618) % 1) - 0.5) * st.width * 0.85;
      st.streaks[k]!.position.set(0.6 + t * (st.length - 0.6), GUN_HEIGHT * (1 - t) + 0.15, lateral * t);
    }
  }

  /** Shows or hides Gamma's flame cone (GDD §11) for champion `id`; `range` and `angle` are its sector. */
  flame(id: number, on: boolean, range: number, angle: number) {
    let f = this.flames.get(id);
    if (!f) {
      if (!on) return;
      const group = new THREE.Group();
      const blobs: THREE.Mesh[] = [];
      for (let k = 0; k < FLAME_BLOBS; k++) blobs.push(new THREE.Mesh(flameBlobGeo, flameInnerMat));
      group.add(...blobs);
      this.group.add(group);
      this.flames.set(id, (f = { group, blobs, range, half: angle / 2 }));
    }
    f.group.visible = on;
  }

  /** Shows or hides Gamma's Heat Wave ring (`radius`, GDD §11) for champion `id`. */
  heatWave(id: number, on: boolean, radius: number) {
    let g = this.waves.get(id);
    if (!g) {
      if (!on) return;
      g = new THREE.Group();
      const fill = new THREE.Mesh(discGeo, waveFillMat);
      const ring = new THREE.Mesh(ringGeo, waveRingMat);
      fill.renderOrder = ring.renderOrder = 4;
      g.add(fill, ring);
      g.scale.set(radius, 1, radius);
      this.group.add(g);
      this.waves.set(id, g);
    }
    g.visible = on;
  }

  /**
   * Moves a champion's flames, Heat Wave and Lead Storm with it (interpolated sim position and
   * upper-body angle) and animates them.
   */
  placeChampion(id: number, x: number, y: number, angle: number, now: number) {
    const ground = this.heightAt(x, y);
    const f = this.flames.get(id);
    if (f?.group.visible) {
      f.group.position.set(x, ground, -y);
      f.group.rotation.y = angle;
      const spread = Math.tan(f.half);
      for (let k = 0; k < f.blobs.length; k++) {
        const t = ((now / 1000) * FLAME_RATE + k / FLAME_BLOBS) % 1;
        const along = NOZZLE.x + t * (f.range - NOZZLE.x + 0.3);
        const b = f.blobs[k]!;
        b.position.set(along, NOZZLE.y + t * 0.35, (((k * 0.618) % 1) * 2 - 1) * spread * along * 0.8);
        b.scale.setScalar(0.12 + 0.32 * t);
        b.rotation.set(now * 0.004 + k, now * 0.003, 0);
        b.material = t < 0.35 ? flameInnerMat : flameOuterMat;
      }
    }
    const w = this.waves.get(id);
    if (w?.visible) {
      w.position.set(x, ground + 0.05, -y);
      waveRingMat.opacity = 0.55 + 0.3 * Math.sin(now * 0.008);
    }
    this.placeStorm(id, x, y, angle, now);
  }

  /** An explosion event at sim (x, y): a fire flash plus smoke. */
  explode(x: number, y: number, radius: number, now: number) {
    const flash = new THREE.Mesh(flashGeo, basic(palette.fire, 0.9));
    flash.position.set(x, this.heightAt(x, y) + 0.4, -y);
    this.group.add(flash);
    this.blasts.push({ flash, born: now, radius });
    this.smoke(x, y, radius, palette.smoke, 5, now);
  }

  /** A ring of rising, fading puffs at sim (x, y): knock-out dust, respawn smoke. */
  smoke(x: number, y: number, radius: number, colour: number, count: number, now: number) {
    const h = this.heightAt(x, y);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const puff = this.smokePuffs[this.nextPuff]!;
      this.nextPuff = (this.nextPuff + 1) % MAX_PUFFS;
      puff.born = now;
      puff.x = x + Math.cos(a) * radius * 0.35;
      puff.y = h + 0.4;
      puff.z = -y + Math.sin(a) * radius * 0.35;
      puff.angle = a;
      puff.colour.set(colour);
    }
  }

  /** Level-up flash (GDD §10) at sim (x, y): a brass ring spreading at the feet and a rising pillar of light. */
  levelUp(x: number, y: number, now: number) {
    const h = this.heightAt(x, y);
    const ring = new THREE.Mesh(ringGeo, basic(palette.brass, 0.9));
    ring.position.set(x, h + 0.06, -y);
    const pillar = new THREE.Mesh(pillarGeo, basic(palette.muzzle, 0.45));
    pillar.position.set(x, h, -y);
    this.group.add(ring, pillar);
    this.flashes.push({ ring, pillar, born: now });
  }

  update(alpha: number, now: number) {
    if (this.flashes.length) {
      const keep: typeof this.flashes = [];
      for (const f of this.flashes) {
        const t = (now - f.born) / LEVEL_FLASH_MS;
        if (t >= 1) {
          this.group.remove(f.ring, f.pillar);
          (f.ring.material as THREE.Material).dispose();
          (f.pillar.material as THREE.Material).dispose();
          continue;
        }
        f.ring.scale.setScalar(0.4 + 1.2 * t);
        (f.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
        f.pillar.scale.set(1 - 0.5 * t, 0.3 + 1.7 * t, 1 - 0.5 * t);
        (f.pillar.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - t);
        keep.push(f);
      }
      this.flashes = keep;
    }
    for (const fx of this.lobs.values()) {
      const { x0, y0, x1, y1, elapsed, total, arcHeight } = fx.snap;
      const t = Math.min(1, (elapsed + alpha) / total);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const ground = this.heightAt(x0, y0) + (this.heightAt(x1, y1) - this.heightAt(x0, y0)) * t;
      fx.grenade.position.set(x, ground + 1.2 * (1 - t) + 4 * arcHeight * t * (1 - t), -y);
      fx.grenade.rotation.z = -t * Math.PI * 3;
    }

    for (const pool of this.pools.values()) {
      const left = pool.total - pool.elapsed;
      const fade = Math.min(1, Math.max(0, left / POOL_FADE_TICKS));
      for (let i = 0; i < pool.flames.length; i++) {
        const f = pool.flames[i]!;
        const flicker = 0.75 + 0.25 * Math.sin(now * 0.018 + pool.phase[i]!) + 0.12 * Math.sin(now * 0.041 + pool.phase[i]! * 2);
        f.scale.set(fade, flicker * fade, fade);
      }
    }

    const keep: Blast[] = [];
    for (const b of this.blasts) {
      const tf = (now - b.born) / FLASH_MS;
      if (tf < 1) {
        b.flash.scale.setScalar(b.radius * (0.3 + 0.7 * Math.sqrt(tf)));
        (b.flash.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - tf);
        keep.push(b);
      } else {
        this.group.remove(b.flash);
        (b.flash.material as THREE.Material).dispose();
      }
    }
    this.blasts = keep;
    this.drawSmoke(now);
  }

  /** Writes every live puff to the one instanced mesh. */
  private drawSmoke(now: number) {
    let n = 0;
    for (const p of this.smokePuffs) {
      const t = (now - p.born) / SMOKE_MS;
      if (t >= 1) continue;
      p.y += 0.012;
      puffPosition.set(p.x, p.y, p.z);
      puffRotation.setFromEuler(puffEuler.set(p.angle, p.angle * 0.7, 0));
      puffScale.setScalar(0.6 + t * 1.4);
      this.smokeMesh.setMatrixAt(n, puffMatrix.compose(puffPosition, puffRotation, puffScale));
      this.smokeMesh.setColorAt(n, p.colour);
      puffAlpha.setX(n, PUFF_OPACITY * (1 - t));
      n++;
    }
    this.smokeMesh.count = n;
    this.smokeMesh.visible = n > 0;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceColor!.needsUpdate = true;
    puffAlpha.needsUpdate = true;
  }

  private addPool(z: ZoneSnapshot): Pool {
    const group = new THREE.Group();
    const h = this.heightAt(z.x, z.y);
    group.position.set(z.x, h, -z.y);
    const scorch = new THREE.Mesh(discGeo, scorchMat);
    scorch.scale.set(z.radius, 1, z.radius);
    scorch.position.y = 0.03;
    scorch.receiveShadow = true;
    group.add(scorch);
    const flames: THREE.Mesh[] = [];
    const phase: number[] = [];
    // Flames scale with the pool's area, so small burning ground (Napalm Tank, D-060) stays cheap.
    // ponytail: one draw call per flame; instance them with the M5 particle pool if pools pile up.
    const count = Math.max(2, Math.min(FLAMES, Math.round(FLAMES * (z.radius / POOL_RADIUS) ** 2)));
    for (let i = 0; i < count; i++) {
      // A golden-angle scatter: even cover, a different look for every pool.
      const a = i * 2.39996 + z.id;
      const r = z.radius * 0.85 * Math.sqrt((i + 0.5) / count);
      const inner = i % 3 === 0;
      const f = new THREE.Mesh(flameGeo, inner ? flameInnerMat : flameOuterMat);
      f.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r);
      f.rotation.y = a;
      if (inner) f.position.y += 0.02;
      flames.push(f);
      phase.push(a * 3.7);
      group.add(f);
    }
    this.group.add(group);
    const pool: Pool = { group, flames, phase, elapsed: z.elapsed, total: z.total };
    this.pools.set(z.id, pool);
    return pool;
  }
}
